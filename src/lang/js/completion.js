import { syntaxTree } from '@codemirror/language';
import { tern, defaultDefinitions } from '../../lib/vendor.js';

export function completionTrigger(key) {
	return /\w|\./.test(key) ? { delay: 500, allowShort: key === '.' } : null;
}

export function createCompletionSession() {
	return new JavaScriptCompletion();
}

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
		if (!server) return callback(new Error('Completion session closed'));
		const files = doc === this.document ? [] : [{ type: 'full', name: 'editor.js', text: doc.toString() }];
		this.document = doc;
		server.request({ files, query: { file: 'editor.js', ...query } }, (error, result) => {
			if (server !== this.server) {
				callback(new Error('Completion session changed'));
			} else {
				callback(error, result);
			}
		});
	}

	complete({ state, pos, allowShort }) {
		if (!state.selection.main.empty) return null;
		return new Promise(resolve => this.request(state.doc, {
			type: 'completions', end: pos, types: true, includeKeywords: true,
		}, (error, data) => {
			if (error || data.start > data.end || data.end !== pos || (!allowShort && data.end - data.start < 3)) {
				return resolve(null);
			}
			resolve({
				from: data.start, to: data.end,
				list: data.completions.map(item => ({
					text: item.name,
					displayText: item.displayName || item.name,
					className: typeToIcon(item.type),
				})),
			});
		}));
	}

	argumentHint({ state, pos }) {
		let node = syntaxTree(state).resolveInner(pos, -1);
		while (node && node.name !== 'ArgList') {
			node = node.parent;
		}
		if (!node || node.firstChild?.name !== '(' || (node.lastChild?.name === ')' && pos >= node.lastChild.to)) {
			return null;
		}
		let active = 0;
		for (let child = node.firstChild; child && child.to <= pos; child = child.nextSibling) {
			if (child.name === ',') active++;
		}
		return new Promise(resolve => this.request(state.doc, {
			type: 'type', preferFunction: true, end: node.from,
		}, (error, data) => {
			if (error || !data.type?.startsWith('fn(')) return resolve(null);
			const { parameters, result } = parseSignature(data.type);
			resolve({ pos: node.from, name: data.exprName || data.name || 'fn', parameters, result, active });
		}));
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
