import { closeBrackets } from '@codemirror/autocomplete';
import { javascript, javascriptLanguage as javascriptSyntax } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tern, lintEn, lintJa, beautify, defaultDefinitions } from '../../lib/vendor.js';
import defaults from '../../res/defaults.json';
import { AnalysisClient } from '../../analysis-client.js';
import { syntaxHighlightingExtension, syntaxHighlightingSource } from '../../extensions/syntax-highlighting/index.js';
import { adaptJavaScriptAnalysis } from './analysis-adapter.js';
import { analyzeSyntax } from './syntax-analysis.js';

// Internal language contract: see ../language-interface.md. No Editor private state
// crosses this boundary; the view applies returned data to its own document/UI.
export const javascriptLanguage = {
	extensions: [
		javascript(),
		javascriptSyntax.data.of({ closeBrackets: { brackets: ['(', '[', "'", '"', '`'] } }),
		closeBrackets(),
		bracketMatching(),
		EditorView.editorAttributes.of({ class: 'cm-javascript' }),
		syntaxHighlightingExtension,
		syntaxHighlightingSource(analyzeSyntax, update => syntaxTree(update.startState) !== syntaxTree(update.state)),
	],

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker.min.js', import.meta.url), { type: 'module' }));
	},

	analysisData(analysis, state, version) {
		return adaptJavaScriptAnalysis(analysis, state.doc.toString(), version, analyzeSyntax(state));
	},

	diagnostics(text, locale, options = {}) {
		const lint = locale === 'ja' ? lintJa : lintEn;
		lint(text, { ...defaults.jsHintOpt, indent: 1, ...options });
		return (lint.errors || []).filter(e => e && e.line > 0).map(e => ({
			message: e.reason,
			severity: e.code?.startsWith('W') ? 'warning' : 'error',
			from: { line: e.line - 1, ch: Math.max(0, e.character - 1) },
			to: { line: e.line - 1, ch: Math.max(1, e.character) },
		}));
	},

	completionTrigger(key) {
		return /\w|\./.test(key) ? { delay: 500, allowShort: key === '.' } : null;
	},

	createCompletionSession() {
		return new JavaScriptCompletion();
	},

	formatLine(text, { autoIndent, indentWithTabs, tabSize }) {
		try {
			const indent = autoIndent ? false : text.match(/^(\s+)/);
			const commentIndent = text.match(/^(\s*\/\/)/);
			text = beautify(text, {
				...defaults.jsBeautifyOpt,
				indent_char: indentWithTabs ? '\t' : ' ',
				indent_size: indentWithTabs ? 1 : tabSize,
				indent_with_tabs: indentWithTabs,
			});
			text = formatCommentWhitespace(text);
			if (commentIndent) {
				text = commentIndent[0].startsWith('//')
					? text.replace(/^\/\//, commentIndent[0])
					: text.replace(/^\s*\/\/\s*/, commentIndent[0] + ' ');
				return { text, indent: false };
			}
			if (indent) return { text: text.replace(/^\s+/, indent[0]), indent: false };
			return { text, indent: true };
		} catch (error) {
			console.error(error);
			return null;
		}
	},

	presentation(analysis = {}) {
		const position = p => ({ line: p.line - 1, ch: p.column });
		const decorations = [];
		for (const [key, fill, opacity] of [
			['classLocs', 'var(--croq-mirror-l-red, #e61e58)', 0.15],
			['fnLocs', 'hsla(40, 100%, 50%, 0.15)'],
			['ifLocs', 'hsla(150, 100%, 35%, 0.15)'],
			['forLocs', 'hsla(190, 90%, 50%, 0.20)'],
		]) {
			for (const [from, to, ...branches] of analysis[key] || []) {
				decorations.push({ kind: 'range', from: position(from), to: position(to), fill,
					...(opacity === undefined ? {} : { opacity }),
					spineChars: 3, branchChars: 4, branches: branches.map(position) });
			}
		}
		for (const [key, fill, stroke] of [
			['varLocs', 'hsla(0, 0%, 97%, 1)', 'hsla(0, 0%, 69%, 0.75)'],
			['letLocs', 'hsla(205, 100%, 97%, 1)', 'hsla(205, 100%, 52%, 0.75)'],
			['constLocs', 'hsla(240, 75%, 97%, 1)', 'hsla(240, 75%, 65%, 0.75)'],
		]) {
			for (const [from, to] of analysis[key] || []) {
				decorations.push({ kind: 'token', from: position(from), to: position(to), fill, stroke });
			}
		}
		return { canIndent: !!analysis.success, sectionStarts: [...(analysis.fnStarts || [])], decorations };
	},
};

class JavaScriptCompletion {
	constructor() {
		this.setDefinitions([]);
	}

	setDefinitions(definitions) {
		this.destroy();
		this.server = new tern.Server({ defs: structuredClone(defaultDefinitions).concat(definitions) });
	}

	request(doc, query, callback) {
		const server = this.server;
		if (!server) return;
		const files = doc === this.document ? [] : [{ type: 'full', name: 'editor.js', text: doc.toString() }];
		this.document = doc;
		server.request({ files, query: { file: 'editor.js', ...query } }, (error, result) => {
			if (server !== this.server) callback(new Error('Completion session changed'));
			else callback(error, result);
		});
	}

	complete({ state, pos, allowShort }, callback) {
		if (!state.selection.main.empty) return callback(null);
		this.request(state.doc, { type: 'completions', end: pos, types: true, includeKeywords: true }, (error, data) => {
			if (error || data.start > data.end || data.end !== pos || (!allowShort && data.end - data.start < 3)) {
				return callback(null);
			}
			callback({
				from: data.start, to: data.end,
				list: data.completions.map(item => ({
					text: item.name,
					displayText: item.displayName || item.name,
					className: typeToIcon(item.type),
				})),
			});
		});
	}

	argumentHint(state, pos) {
		let node = syntaxTree(state).resolveInner(pos, -1);
		while (node && node.name !== 'ArgList') node = node.parent;
		if (!node || node.firstChild?.name !== '(' || (node.lastChild?.name === ')' && pos >= node.lastChild.to)) return null;
		let active = 0;
		for (let child = node.firstChild; child && child.to <= pos; child = child.nextSibling) {
			if (child.name === ',') active++;
		}
		let hint = null;
		this.request(state.doc, { type: 'type', preferFunction: true, end: node.from }, (error, data) => {
			if (error || !data.type?.startsWith('fn(')) return;
			const { parameters, result } = parseSignature(data.type);
			hint = { pos: node.from, name: data.exprName || data.name || 'fn', parameters, result, active };
		});
		return hint;
	}

	destroy() {
		this.server?.delFile('editor.js');
		this.server = null;
		this.document = null;
	}
}

function parseSignature(type) {
	const parameters = [];
	let depth = 0, start = 3;
	for (let i = start; i < type.length; i++) {
		const char = type[i];
		if (depth === 0 && (char === ',' || char === ')')) {
			const parameter = type.slice(start, i).trim();
			if (parameter) parameters.push(parameter);
			if (char === ')') return { parameters, result: type.slice(i + 1) };
			start = i + 1;
		} else if ('([{'.includes(char)) depth++;
		else if (')]}'.includes(char)) depth--;
	}
	return { parameters, result: '' };
}

function typeToIcon(type = '?') {
	let suffix;
	if (type === '?') suffix = 'unknown';
	else if (type === 'number' || type === 'string' || type === 'bool') suffix = type;
	else if (type.startsWith('fn(')) suffix = 'fn';
	else if (type.startsWith('[')) suffix = 'array';
	else suffix = 'object';
	return 'cm-tern-icon cm-tern-' + suffix;
}

function formatCommentWhitespace(text) {
	const m = text.match(/\S+\s*(\/\/.+)$/);
	if (!m) return text;

	let state      = '';
	let lastIdx    = -1;
	let isLastEsc  = false;
	let slashCount = 0;

	for (let i = 0; i < text.length; i += 1) {
		const c = text[i];
		if (!isLastEsc && (c === "'" || c === '"' || c === '`')) {
			if (state === '') {
				state = c;
				slashCount = 0;
			} else if (state === c) {
				state = '';
				lastIdx = i;
			}
		} else if (state === '' && c === '/') {
			slashCount += 1;
			if (slashCount === 2) break;
		} else {
			slashCount = 0;
		}
		if (isLastEsc) isLastEsc = false;
		else if (!isLastEsc && c === '\\') isLastEsc = true;
	}
	if (state === '' && lastIdx !== -1) {
		const head = text.substring(0, lastIdx);
		const tail = text.substring(lastIdx);
		text = head + tail.replace(/(\S+)\s*\/\/\s*(.+)$/, '$1  // $2');  // Make the blank before the comment two blanks
	} else {
		text = text.replace(/(\S+)\s*\/\//m, '$1  //');  // Make the blank before the comment two blanks
	}
	return text;
}
