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
	const editorA = a.getCodeMirror().getWrapperElement();
	const editorB = b.getCodeMirror().getWrapperElement();
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
	a.setSettings({ lineWrapping: true });
	const simpleOptions = { scrollbarStyle: 'null', readOnly: 'nocursor', styleActiveLine: false, cursorBlinkRate: -1, cursorHeight: 0, lineWrapping: false };
	const cmA = a.getCodeMirror();
	const beforeSimple = Object.fromEntries(Object.keys(simpleOptions).map(key => [key, cmA.getOption(key)]));
	const originalView = a.setSimpleView();
	assert(Object.entries(simpleOptions).every(([key, value]) => cmA.getOption(key) === value) && editorA.classList.contains('simple'), 'simple view applies capture options');
	assert(a.getSettings().lineWrapping && !a.getSettings().readOnly && !editorB.classList.contains('simple'), 'simple view preserves settings and other editor');
	a.setSettings({ disabled: true });
	a.setSimpleView();
	a.setSettings({ disabled: false });
	a.restoreView(originalView);
	assert(Object.entries(beforeSimple).every(([key, value]) => cmA.getOption(key) === value) && !editorA.classList.contains('simple'), 'simple view restores original options after capture sequence');
	a.setSettings({ lineWrapping: false });
	const captureFailure = new Error('capture failed');
	for (const disabled of [false, true]) {
		a.setSettings({ disabled, readOnly: true, lineWrapping: true });
		const previousReadOnly = cmA.getOption('readOnly');
		let failure;
		try {
			await a.captureImage(async rect => {
				assert(rect.width > 0 && rect.height > 0 && a.getState().disabled, 'capture callback receives bounds while disabled');
				let concurrentRejected = false;
				try { await a.captureImage(() => {}); } catch { concurrentRejected = true; }
				assert(concurrentRejected, 'concurrent image capture rejected');
				throw captureFailure;
			});
		} catch (error) { failure = error; }
		assert(failure === captureFailure && a.getState().disabled === disabled && cmA.getOption('readOnly') === previousReadOnly && cmA.getOption('lineWrapping') && !editorA.classList.contains('simple'), 'capture failure restores view and previous disabled state');
	}
	a.setSettings({ disabled: false, readOnly: false, lineWrapping: false });
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
	const ja = a.getCodeMirror().getOption('lint').getAnnotations('var x = 1', { esversion: 10, varstmt: true });
	const en = b.getCodeMirror().getOption('lint').getAnnotations('var x = 1', { esversion: 10, varstmt: true });
	assert(ja.length && en.length && ja[0].message !== en[0].message, 'simultaneous localized diagnostics');
	a.loadDocument('const broken = ;');
	a.getCodeMirror().performLint();
	const lintMarker = editorA.querySelector('.CodeMirror-lint-marker-multiple') || editorA.querySelector('.CodeMirror-lint-marker');
	assert(lintMarker, 'lint marker available for tooltip test');
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
	a.execute('find');
	const jaSearch = a.getCodeMirror().phrase('Search:');
	assert(jaSearch !== 'Search:' && document.querySelector('#a .CodeMirror-dialog').textContent.includes(jaSearch), 'Japanese search uses language resources');
	a.getCodeMirror().getWrapperElement().querySelector('.CodeMirror-dialog input').dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true }));
	b.execute('find');
	assert(document.querySelector('#b .CodeMirror-dialog').textContent.includes('Search:'), 'English search uses language resources');
	b.getCodeMirror().getWrapperElement().querySelector('.CodeMirror-dialog input').dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true }));
	a.setSettings({ language: 'en' });
	assert(a.getCodeMirror().phrase('Search:') === 'Search:', 'language resources switch at runtime');
	a.setSettings({ language: 'ja' });
	assert(a.getCodeMirror().phrase('Search:') === jaSearch && b.getCodeMirror().phrase('Search:') === 'Search:', 'language resources remain independent');
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
	for (const method of ['focus', 'blur', 'hasFocus', 'setSimpleView', 'restoreView']) {
		let rejected = false;
		try { a[method](); } catch (error) { rejected = error.message === 'Editor destroyed'; }
		assert(rejected, method + ' rejects after destroy');
	}
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
