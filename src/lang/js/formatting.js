import { beautify } from '../../lib/vendor.js';
import defaults from '../../res/defaults.json';

export function formatLine(text, { autoIndent, indentWithTabs, tabSize }) {
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
