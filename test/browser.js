import { createEditor } from '../dist/croq-mirror.min.js';
const results = [];
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
	results.push(message);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, message) => {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await wait(20);
	}
	throw new Error(message);
};
// Inspect rendered UI, without retrieving the underlying editor instance.
const searchLabel = (editor, host) => {
	editor.execute('find');
	const dialog = host.querySelector('.CodeMirror-dialog');
	const label = dialog.textContent;
	dialog.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true }));
	return label;
};
const escape = host => host.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
let a, b;
try {
	a = await createEditor(document.querySelector('#a'), { value: 'function one() { return 1; }', language: 'ja', autoFormat: false });
	b = await createEditor(document.querySelector('#b'), { value: 'function two() { return 2; }', language: 'en', autoFormat: false });
	assert(!window.CodeMirror && !window.acorn && !window.JSHINT && !window.tern, 'no library globals');
	assert(a.getAnalysis().fnNames[0] === 'one' && b.getAnalysis().fnNames[0] === 'two', 'independent analysis');
	assert(getComputedStyle(document.querySelector('#host-page')).color === 'rgb(1, 2, 3)', 'host CSS unaffected');
	assert(!('getCodeMirror' in a), 'public API does not expose editor instance');
	const editorA = document.querySelector('#a .CodeMirror');
	const editorB = document.querySelector('#b .CodeMirror');
	for (const [text, count] of [['', 1], ['first\nsecond\n', 3]]) {
		a.loadDocument(text);
		assert(a.getLineCount() === count, 'line count includes empty and trailing lines: ' + count);
	}
	a.loadDocument('function one() { return 1; }');
	const clipboardEvents = [];
	const offCopy = a.on('copy', event => clipboardEvents.push(['copy', event.text]));
	const offCut = a.on('cut', event => clipboardEvents.push(['cut', event.text]));
	a.execute('selectAll');
	for (const type of ['copy', 'cut']) {
		editorA.querySelector('textarea').dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
	}
	assert(clipboardEvents.length === 2 && clipboardEvents.every(([, text]) => text === 'function one() { return 1; }'), 'clipboard events expose selection before cutting');
	offCopy();
	offCut();
	a.loadDocument('function one() { return 1; }');
	b.focus();
	const focusEvents = [];
	const offFocus = a.on('focus', () => focusEvents.push('focus'));
	const offBlur = a.on('blur', () => focusEvents.push('blur'));
	a.focus();
	assert(a.hasFocus() && !b.hasFocus(), 'focus API targets one editor');
	a.blur();
	assert(!a.hasFocus() && focusEvents.join(',') === 'focus,blur', 'blur API and focus events');
	offFocus();
	offBlur();
	a.setSettings({ readOnly: true });
	a.focus();
	assert(a.hasFocus(), 'read-only editor can receive focus');
	a.setSettings({ disabled: true });
	assert(!a.hasFocus(), 'disabling editor removes input focus');
	b.focus();
	a.focus();
	a.blur();
	assert(!a.hasFocus() && b.hasFocus(), 'disabled focus and unrelated blur do not steal focus');
	a.setSettings({ readOnly: false, disabled: false });
	const clipboardCalls = [];
	const originalExecCommand = document.execCommand;
	try {
		document.execCommand = command => {
			clipboardCalls.push(command);
			assert(editorA.contains(document.activeElement), 'clipboard command focuses target editor: ' + command);
			return true;
		};
		for (const command of ['cut', 'copy', 'paste']) {
			b.focus();
			a.execute(command);
		}
		assert(clipboardCalls.join(',') === 'cut,copy,paste', 'clipboard commands delegate to document');
		clipboardCalls.length = 0;
		a.setSettings({ readOnly: true });
		for (const command of ['cut', 'copy', 'paste']) a.execute(command);
		assert(clipboardCalls.join(',') === 'copy', 'read-only allows copy only');
		clipboardCalls.length = 0;
		a.setSettings({ disabled: true });
		for (const command of ['cut', 'copy', 'paste']) a.execute(command);
		assert(clipboardCalls.length === 0, 'disabled blocks clipboard commands');
	} finally {
		document.execCommand = originalExecCommand;
		a.setSettings({ readOnly: false, disabled: false });
	}
	const cursorUrls = [];
	for (const lineSelection of [false, true]) {
		a.setLineSelectionMode(lineSelection);
		const cursor = getComputedStyle(editorA.querySelector('.CodeMirror-linenumber')).cursor;
		const url = cursor.match(/url\("(data:image\/svg\+xml[^"\n]+)"\)/)?.[1];
		assert(url && cursor.endsWith('22 8, pointer'), 'embedded cursor and hotspot: ' + lineSelection);
		const image = new Image();
		image.src = url;
		await image.decode();
		assert(image.naturalWidth === 32 && image.naturalHeight === 32, 'embedded cursor decodes: ' + lineSelection);
		cursorUrls.push(url);
	}
	assert(cursorUrls[0] !== cursorUrls[1], 'line selection changes embedded cursor');
	a.setLineSelectionMode(false);
	assert(getComputedStyle(editorA).backgroundColor === 'rgb(253, 253, 249)' && getComputedStyle(editorA).color === 'rgb(17, 17, 0)', 'default theme colors preserved');
	const themeRoot = editorA.closest('.croq-mirror');
	themeRoot.style.setProperty('--croq-mirror-color-editor', '#123456');
	assert(getComputedStyle(editorA).backgroundColor === 'rgb(18, 52, 86)', 'theme custom properties update at runtime');
	assert(getComputedStyle(editorB).backgroundColor === 'rgb(253, 253, 249)', 'theme custom properties isolated per editor');
	themeRoot.style.removeProperty('--croq-mirror-color-editor');
	a.loadDocument('function first() {\n\tvar firstValue = 1;\n}\nfunction second() {\n\tvar secondValue = 2;\n}');
	await a.analyzeNow();
	for (const functionLineNumbers of [true, false]) {
		a.setSettings({ functionLineNumbers });
		await waitFor(() => editorA.querySelectorAll('.CodeMirror-lint-marker-warning').length === 2, 'function diagnostics did not render');
		for (const [index, marker] of [...editorA.querySelectorAll('.CodeMirror-lint-marker-warning')].entries()) {
			const line = [1, 4][index];
			const box = marker.getBoundingClientRect();
			assert(marker.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), 'lint marker receives pointer over function region: ' + functionLineNumbers + ', line ' + line);
		}
	}
	a.loadDocument('const broken = ;');
	await waitFor(() => editorA.querySelector('.CodeMirror-lint-marker-error'), 'syntax diagnostics did not render');
	const lintMarker = editorA.querySelector('.CodeMirror-lint-marker-multiple') || editorA.querySelector('.CodeMirror-lint-marker');
	assert(lintMarker, 'lint marker available for tooltip test');
	const multipleMarker = editorA.querySelector('.CodeMirror-lint-marker-multiple');
	assert(multipleMarker, 'multiple diagnostics available for hover regression');
	const overlayBox = multipleMarker.getBoundingClientRect();
	const markerBox = multipleMarker.parentElement.getBoundingClientRect();
	assert(['x', 'y', 'width', 'height'].every(key => overlayBox[key] === markerBox[key]), 'multiple diagnostic overlay covers the entire icon');
	const editorBox = editorA.getBoundingClientRect();
	const mouseX = editorBox.right - 10, mouseY = editorBox.top + 100;
	lintMarker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: mouseX, clientY: mouseY }));
	const lintTooltip = editorA.querySelector('.CodeMirror-lint-tooltip');
	assert(lintTooltip?.parentElement === editorA, 'lint tooltip uses selfContain without patch');
	assert(getComputedStyle(lintTooltip).position === 'fixed', 'lint tooltip retains viewport positioning');
	document.dispatchEvent(new MouseEvent('mousemove', { clientX: mouseX, clientY: mouseY }));
	const tooltipBox = lintTooltip.getBoundingClientRect();
	assert(Math.abs(tooltipBox.top - Math.max(0, mouseY - lintTooltip.offsetHeight - 5)) < 1, 'lint tooltip follows pointer coordinates');
	const hit = document.elementFromPoint(Math.max(editorBox.right + 1, tooltipBox.left + 1), tooltipBox.top + 5);
	assert(hit && lintTooltip.contains(hit), 'lint tooltip is visible beyond editor boundary');
	lintMarker.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
	await wait(650);
	assert(!lintTooltip.isConnected, 'lint tooltip removed on mouseout');
	a.loadDocument('function one() { return 1; }');
	assert(searchLabel(a, editorA).includes('検索:'), 'Japanese search uses language resources');
	assert(searchLabel(b, editorB).includes('Search:'), 'English search uses language resources');
	a.setSettings({ language: 'en' });
	assert(searchLabel(a, editorA).includes('Search:'), 'language resources switch at runtime');
	a.setSettings({ language: 'ja' });
	assert(searchLabel(a, editorA).includes('検索:') && searchLabel(b, editorB).includes('Search:'), 'language resources remain independent');
	a.setSettings({ lineWrapping: true, fontSize: 22 });
	assert(!b.getSettings().lineWrapping && !editorB.classList.contains('CodeMirror-wrap') && b.getSettings().fontSize === 16, 'settings isolated');
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
	assert(a.getAnalysis() === null && editorA.querySelector('.CodeMirror-linenumber')?.textContent === '1', 'analysis disabled restores ordinary line numbers');
	const once = await a.analyzeNow();
	assert(once.fnNames[0] === 'newest' && a.getAnalysis() === null, 'explicit analysis works without enabling automatic display');
	a.setSettings({ readOnly: true, disabled: true });
	a.setSettings({ disabled: false });
	assert(a.getState().readOnly && !a.getState().disabled, 'disabled restores read-only');
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
	escape(editorA);
	a.loadDocument('customFunction(');
	a.moveTo({ line: 0, ch: 15 });
	await wait(200);
	const argHint = document.querySelector('.CodeMirror-Tern-tooltip');
	assert(argHint?.textContent.includes('value:') && argHint.textContent.includes('string'), 'Tern argument hints retain parameter types');
	a.loadDocument('const sampleNumber = 42;\nsampleN');
	a.moveTo({ line: 1, ch: 7 });
	a.execute('complete');
	await wait(200);
	assert(document.querySelector('#a .CodeMirror-Tern-completion-number')?.textContent.includes('sampleNumber'), 'Tern infers number type for completion');
	escape(editorA);
	const id = a.highlightLine(0);
	assert(editorA.querySelector('.error-line'), 'external line highlighting');
	a.clearHighlight(id);
	assert(!editorA.querySelector('.error-line'), 'highlight clears');
	let selection;
	const offSelection = a.on('selection', event => { selection = event.ranges; });
	a.moveTo({ line: 0, ch: 3 }, { focus: false });
	assert(selection?.[0].head.line === 0 && selection[0].head.ch === 3, 'position navigation');
	offSelection();
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
	a.moveTo({ line: 0, ch: 10 });
	assert(document.execCommand('insertText', false, ' '), 'native text insertion accepted');
	await waitFor(() => a.getValue().includes('; '), 'native input did not update document');
	a.moveTo({ line: 1, ch: 0 });
	assert(a.getValue().includes('x = 1'), 'automatic formatting on leaving edited line');
	document.querySelector('#a').style.height = '420px';
	await wait(100);
	assert(editorA.getBoundingClientRect().height === 420, 'container resize');
	a.destroy();
	a.destroy();
	for (const method of ['focus', 'blur', 'hasFocus', 'getLineCount']) {
		let rejected = false;
		try { a[method](); } catch (error) { rejected = error.message === 'Editor destroyed'; }
		assert(rejected, method + ' rejects after destroy');
	}
	assert(document.querySelector('#a').childNodes.length === 0, 'destroy is idempotent and empties container');
	a = await createEditor(document.querySelector('#a'), { value: 'const recreated = true;' });
	assert(a.getValue().includes('recreated') && b.getValue().includes('two'), 'recreate without affecting sibling');
	assert(a.getSettings().language === 'en' && searchLabel(a, document.querySelector('#a')).includes('Search:'), 'omitted UI language defaults to English');
	assert(a.getSettings().codeLanguage === 'javascript' && a.getAnalysis().success, 'omitted code language retains JavaScript analysis');
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
	window.Worker = class { constructor() { throw new Error('Plain text must not create a worker'); } };
	try {
		a = await createEditor(document.querySelector('#a'), { codeLanguage: null, value: 'const broken = ;\nordinary text', functionLineNumbers: true });
		const plain = document.querySelector('#a');
		assert(a.getSettings().codeLanguage === null, 'explicit null selects plain text without a worker');
		await wait(600);
		assert([...plain.querySelectorAll('.CodeMirror-code .CodeMirror-linenumber')].map(node => node.textContent).join(',') === '1,2' && !plain.querySelector('.CodeMirror-lint-marker'), 'plain text uses ordinary numbers without diagnostics');
		assert(a.getAnalysis() === null && await a.analyzeNow() === null, 'plain text has no analysis snapshot');
		const original = a.getValue();
		for (const command of ['format', 'complete', 'toggleComment']) a.execute(command);
		a.setDefinitions([{ '!name': 'unused' }]);
		assert(a.getValue() === original && !document.querySelector('#a .CodeMirror-hints'), 'language-specific commands leave plain text unchanged');
		a.replaceRange('!', { line: 1, ch: 13 });
		a.execute('undo');
		assert(a.getValue() === original, 'plain text retains editing and undo');
		a.setSettings({ language: 'ja', analysis: true, completion: true, diagnostics: true });
		await wait(600);
		assert(searchLabel(a, plain).includes('検索:') && a.getSettings().codeLanguage === null && !document.querySelector('#a .CodeMirror-lint-marker'), 'plain text locale switches independently without producing diagnostics');
		a.execute('find');
		assert(document.querySelector('#a .CodeMirror-dialog input'), 'plain text search remains available');
		let rejected = false;
		try { a.setSettings({ codeLanguage: 'javascript' }); } catch { rejected = true; }
		assert(rejected && a.getSettings().codeLanguage === null, 'code language is selected at creation');
		a.destroy();
		for (const codeLanguage of ['python', false, 42]) {
			let invalid = false;
			try { await createEditor(document.querySelector('#a'), { codeLanguage }); } catch (error) { invalid = error instanceof TypeError; }
			assert(invalid && !document.querySelector('#a').childNodes.length, 'unsupported code language rejected before mounting: ' + codeLanguage);
		}
	} finally {
		a?.destroy();
		window.Worker = NativeWorker;
	}
	const { runLanguageContractTests } = await import('./language-contract.js');
	await runLanguageContractTests(assert);
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
