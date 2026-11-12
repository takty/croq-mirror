import { Editor } from '../.build/editor-view.js';
import { javascriptLanguage } from '../.build/lang/js/index.js';
import { plainLanguage } from '../.build/lang/plain/index.js';
import { analyze } from '../.build/lang/js/analyzer.js';

export async function runLanguageContractTests(assert) {
	const ja = javascriptLanguage.diagnostics('var x = 1', 'ja', { esversion: 10, varstmt: true });
	const en = javascriptLanguage.diagnostics('var x = 1', 'en', { esversion: 10, varstmt: true });
	assert(ja.length && en.length && ja[0].message !== en[0].message, 'simultaneous localized diagnostics');
	assert(!plainLanguage.extensions.length, 'plain language disables language-specific extensions');
	const plainClient = plainLanguage.createAnalysisClient();
	await plainClient.ready;
	assert(await plainClient.request('text', 1) === null, 'plain analysis client returns no result');
	plainClient.destroy();
	assert(plainLanguage.diagnostics('invalid JS').length === 0 && plainLanguage.formatLine('text', {}) === null && plainLanguage.completionTrigger('.') === null, 'plain language implements inert diagnostic, formatting and trigger methods');
	const plainSession = plainLanguage.createCompletionSession();
	let completed = false;
	plainSession.setDefinitions([]);
	assert(plainSession.argumentHint() === null, 'plain language has no argument hints');
	plainSession.complete({}, result => { completed = result === null; });
	plainSession.destroy();
	assert(completed, 'plain completion invokes callback with no candidates');
	const raw = analyze('function example() {\n let x = 1;\n if (x) { x++; } else { x--; }\n const y = 2;\n}');
	const snapshot = JSON.stringify(raw);
	const data = javascriptLanguage.presentation(raw);
	assert(JSON.stringify(raw) === snapshot, 'presentation conversion preserves public analysis');
	assert(data.canIndent && data.sectionStarts[0] === 0, 'analysis supplies section boundaries and indent permission');
	const branch = data.decorations.find(item => item.kind === 'range' && item.branches.length);
	assert(branch.from.line === 2 && branch.branches[0].line === 2 && branch.from.ch === 1, 'presentation converts branch and range coordinates to zero-based positions');
	assert(data.decorations.filter(item => item.kind === 'token').length === 2, 'declarations become generic token decorations');
	assert(!javascriptLanguage.presentation(analyze('function unfinished( {')).canIndent, 'tolerant analysis does not authorize indentation');

	const options = { autoIndent: false, indentWithTabs: true, tabSize: 4 };
	const formatted = javascriptLanguage.formatLine('const url="https://example.test";// note\n', options);
	assert(formatted.text === 'const url = "https://example.test";  // note', 'formatting preserves string slashes and comment spacing');
	const comment = javascriptLanguage.formatLine('\t// note\n', options);
	assert(comment.text === '\t// note' && !comment.indent, 'formatting preserves comment indentation');

	// A non-JS implementation proves the view consumes the contract rather than
	// JavaScript AST fields, JSHint errors or a Tern server.
	const root = document.createElement('div');
	root.className = 'croq-mirror';
	root.style.cssText = 'height:300px;width:500px;box-sizing:border-box';
	document.body.prepend(root);
	let disposed = false, definitions;
	const language = {
		extensions: [],
		presentation: () => ({ canIndent: false, sectionStarts: [], decorations: [] }),
		completionTrigger: () => null,
		formatLine: text => ({ text: text.trimEnd().toUpperCase(), indent: false }),
		createCompletionSession: () => ({
			setDefinitions: value => { definitions = value; },
			complete: (_options, callback) => callback({ from: 0, to: 3, list: [{ text: 'candidate', displayText: 'Generic candidate' }] }),
			argumentHint: () => null,
			destroy() { disposed = true; },
		}),
	};
	const view = new Editor({ language, phrases: {}, onFontSizeChange() {} }, root);
	try {
		const settings = { analysis: true, functionLineNumbers: true, completion: true, fontSize: 16, fontFamily: 'monospace', lineHeight: 165 };
		const diagnostics = () => [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, severity: 'error', message: 'Generic diagnostic' }];
		view.setOptions(settings, {}, diagnostics);
		view.loadDocument('abc\ndef\nghi');
		view.setDefinitions(['opaque definition']);
		assert(definitions[0] === 'opaque definition', 'view forwards definitions without interpreting them');
		view.setPresentation({
			canIndent: false, sectionStarts: [1],
			decorations: [{ kind: 'token', from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 }, fill: '#ff0000', stroke: '#000000' }],
		});
		assert(view.getSectionLineNumber(0).join() === '0,1' && view.getSectionLineNumber(2).join() === '1,2', 'view numbers sections from language-neutral data');
		assert(root.querySelector('.cm-function-number')?.textContent === '1', 'view renders section start markers');
		await new Promise(resolve => setTimeout(resolve, 450));
		const canvas = root.querySelector('canvas');
		assert(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value), 'view draws supplied token decoration');
		await new Promise(resolve => setTimeout(resolve, 200));
		assert(root.querySelector('.cm-lint-marker-error'), 'view renders generic diagnostics');
		view.view.dispatch({ selection: { anchor: 3 } });
		view.complete();
		await new Promise(resolve => setTimeout(resolve, 200));
		assert(root.querySelector('.cm-tooltip-autocomplete')?.textContent.includes('Generic candidate'), 'view displays generic completion candidates');
		view.closeCompletion();
		view.format();
		assert(view.view.state.doc.line(1).text === 'ABC', 'view applies language formatting result');
		view.setOptions({ ...settings, readOnly: true }, {}, diagnostics);
		view.view.dispatch({ selection: { anchor: 7 } });
		view.format();
		assert(view.view.state.doc.line(2).text === 'def', 'read-only blocks language formatting edits');
		view.setPresentation();
		assert(view.getSectionLineNumber(2).join() === '0,3', 'clearing presentation restores absolute numbering');
	} finally {
		view.destroy();
		root.remove();
	}
	assert(disposed, 'view disposes language session');
}
