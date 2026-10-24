import { createEditor } from '../dist/croq-mirror.min.js';
const results = [];
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
	results.push(message);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let a, b;
try {
	a = await createEditor(document.querySelector('#a'), { value: 'function one() { return 1; }', autoFormat: false });
	b = await createEditor(document.querySelector('#b'), { value: 'function two() { return 2; }', language: 'en', autoFormat: false });
	assert(!window.CodeMirror && !window.acorn && !window.JSHINT && !window.tern, 'no library globals');
	assert(a.getAnalysis().fnNames[0] === 'one' && b.getAnalysis().fnNames[0] === 'two', 'independent analysis');
	assert(getComputedStyle(document.querySelector('#host-page')).color === 'rgb(1, 2, 3)', 'host CSS unaffected');
	const ja = a.getCodeMirror().getOption('lint').getAnnotations('var x = 1', { esversion: 10, varstmt: true });
	const en = b.getCodeMirror().getOption('lint').getAnnotations('var x = 1', { esversion: 10, varstmt: true });
	assert(ja.length && en.length && ja[0].message !== en[0].message, 'simultaneous localized diagnostics');
	a.setSettings({ lineWrapping: true, fontSize: 22 });
	assert(!b.getCodeMirror().getOption('lineWrapping') && b.getSettings().fontSize === 16, 'settings isolated');
	let origin;
	a.on('change', event => origin = event.origin);
	a.loadDocument('const old = 1;');
	assert(origin === 'load' && !a.getState().canUndo, 'load resets history and reports origin');
	a.replaceDocument('const next = 2;');
	assert(origin === 'edit' && a.getState().canUndo, 'API edit is undoable');
	a.execute('undo');
	assert(a.getValue() === 'const old = 1;', 'undo restores source');
	a.execute('redo');
	assert(a.getValue() === 'const next = 2;', 'redo restores edit');
	const pending = a.analyzeNow();
	a.replaceDocument('function newest() {}');
	const older = await pending;
	assert(older.text === 'const next = 2;', 'analysis snapshot keeps matching source');
	assert(a.getAnalysis() === null, 'stale analysis not published');
	const latest = await a.analyzeNow();
	latest.fnNames.push('mutated');
	assert(!a.getAnalysis().fnNames.includes('mutated'), 'analysis result detached from internal state');
	a.setSettings({ analysis: false, functionLineNumbers: true });
	assert(a.getAnalysis() === null && a.getCodeMirror().getOption('lineNumbers'), 'analysis disabled restores ordinary line numbers');
	const once = await a.analyzeNow();
	assert(once.fnNames[0] === 'newest' && a.getAnalysis() === null, 'explicit analysis works without enabling automatic display');
	a.setSettings({ readOnly: true, disabled: true });
	a.setSettings({ disabled: false });
	assert(a.getCodeMirror().getOption('readOnly') === true, 'disabled restores read-only');
	a.execute('undo');
	assert(a.getValue() === 'function newest() {}', 'read-only blocks editing commands');
	a.setSettings({ readOnly: false, analysis: true });
	a.setDefinitions([{ '!name': 'custom', customFunction: { '!type': 'fn(value: string)' } }]);
	a.loadDocument('customF');
	a.moveTo({ line: 0, ch: 7 });
	a.execute('complete');
	await wait(200);
	assert(document.querySelector('#a .CodeMirror-hints')?.textContent.includes('customFunction'), 'Tern completion uses additional definitions');
	assert(!document.querySelector('#b .CodeMirror-hints'), 'completion popup belongs to its editor');
	a.getCodeMirror().closeHint();
	const id = a.highlightLine(0);
	assert(a.getCodeMirror().lineInfo(0).wrapClass.includes('error-line'), 'external line highlighting');
	a.clearHighlight(id);
	assert(!a.getCodeMirror().lineInfo(0).wrapClass?.includes('error-line'), 'highlight clears');
	a.moveTo({ line: 0, ch: 3 }, { focus: false });
	assert(a.getCodeMirror().getCursor().ch === 3, 'position navigation');
	a.setSettings({ autoFormat: false });
	a.loadDocument('const x=1;');
	a.execute('format');
	assert(a.getValue().includes('x = 1'), 'manual format works while automatic format disabled');
	a.setSettings({ formatting: false });
	a.loadDocument('const x=1;');
	a.execute('format');
	assert(a.getValue() === 'const x=1;', 'formatting feature switch');
	a.setSettings({ formatting: true, autoFormat: true });
	a.loadDocument('const x=1;\n');
	a.getCodeMirror().setCursor({ line: 0, ch: 10 });
	a.getCodeMirror().replaceRange(' ', { line: 0, ch: 10 }, null, '+input');
	a.getCodeMirror().setCursor({ line: 1, ch: 0 });
	assert(a.getValue().includes('x = 1'), 'automatic formatting on leaving edited line');
	document.querySelector('#a').style.height = '420px';
	await wait(100);
	assert(a.getCodeMirror().getWrapperElement().getBoundingClientRect().height === 420, 'container resize');
	a.destroy();
	a.destroy();
	assert(document.querySelector('#a').childNodes.length === 0, 'destroy is idempotent and empties container');
	a = await createEditor(document.querySelector('#a'), { value: 'const recreated = true;' });
	assert(a.getValue().includes('recreated') && b.getValue().includes('two'), 'recreate without affecting sibling');
	b.destroy();
	a.destroy();
	const NativeWorker = window.Worker;
	window.Worker = class {
		constructor() {
			setTimeout(() => this.onerror({ message: 'test worker failure' }), 0);
		}
		terminate() {}
	};
	try {
		let rejected = false;
		try {
			await createEditor(document.querySelector('#a'));
		} catch {
			rejected = true;
		}
		assert(rejected && document.querySelector('#a').childNodes.length === 0, 'initialization failure cleans up container');
	} finally {
		window.Worker = NativeWorker;
	}
	window.testResult = { passed: true, results };
} catch (error) {
	window.testResult = { passed: false, results, error: error.stack };
	try {
		a?.destroy();
		b?.destroy();
	} catch {
	
		}
}
document.querySelector('#results').textContent = JSON.stringify(window.testResult, null, 2);
