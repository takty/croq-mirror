import { CodeMirror, lintEn, lintJa, beautify, defaultDefinitions } from '../../lib/vendor.js';
import defaults from '../../res/defaults.json';
import { AnalysisClient } from '../../analysis-client.js';

// Internal language contract: see ../language-interface.md. No Editor private state
// crosses this boundary; the view applies returned data to its own document/UI.
export const javascriptLanguage = {
	mode: 'javascript',
	modeOptions: { closeBrackets: '()[]\'\'""``' },
	autoCloseBrackets: true,
	matchBrackets: true,

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker.min.js', import.meta.url), { type: 'module' }));
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

	createCompletionSession(cm) {
		return new JavaScriptCompletion(cm);
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
		for (const [key, fill] of [
			['fnLocs', 'hsla(40, 100%, 50%, 0.15)'],
			['ifLocs', 'hsla(150, 100%, 35%, 0.15)'],
			['forLocs', 'hsla(190, 90%, 50%, 0.20)'],
		]) {
			for (const [from, to, ...branches] of analysis[key] || []) {
				decorations.push({ kind: 'range', from: position(from), to: position(to), fill,
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
	constructor(cm) {
		this.cm = cm;
		this.defaults = structuredClone(defaultDefinitions);
		this.setDefinitions([]);
	}

	setDefinitions(definitions) {
		this.destroy();
		this.server = new CodeMirror.TernServer({ defs: this.defaults.concat(definitions) });
	}

	complete({ allowShort }, callback) {
		const server = this.server;
		if (!server) return callback(null);
		server.request(this.cm, { type: 'completions', types: true, includeKeywords: true }, (error, data) => {
			if (server !== this.server || error) return callback(null);
			const from = data.start, to = data.end;
			if (from.line !== to.line || (!allowShort && to.ch - from.ch < 3)) return callback(null);
			const list = data.completions.map(item => ({
				text: item.name,
				displayText: item.displayName || item.name,
				className: typeToIcon(item.type) + (data.guess ? ' CodeMirror-Tern-guess' : ''),
				data: item,
			}));
			callback({ from, to, list });
		});
	}

	// Tern's argument-hint renderer is kept behind the adapter for compatibility.
	updateArgumentHints() {
		this.server?.updateArgHints(this.cm);
	}

	destroy() {
		if (!this.server) return;
		for (const name of Object.keys(this.server.docs)) this.server.delDoc(name);
		this.server.destroy();
		this.server = null;
	}
}

function typeToIcon(type) {
	let suffix;
	if (type === '?') suffix = 'unknown';
	else if (type === 'number' || type === 'string' || type === 'bool') suffix = type;
	else if (/^fn\(/.test(type)) suffix = 'fn';
	else if (/^\[/.test(type)) suffix = 'array';
	else suffix = 'object';
	return 'CodeMirror-Tern-completion CodeMirror-Tern-completion-' + suffix;
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
