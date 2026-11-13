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
	const dialog = host.querySelector('.cm-search');
	const label = dialog.querySelector('input[name="search"]').getAttribute('aria-label');
	dialog.querySelector('button[name="close"]').click();
	return label;
};
const escape = host => host.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
const mac = /Mac/.test(navigator.platform);
const mod = mac ? { metaKey: true } : { ctrlKey: true };
const press = (host, key, modifiers = {}) => host.querySelector('.cm-content').dispatchEvent(
	new KeyboardEvent('keydown', {
		key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
		bubbles: true, cancelable: true, ...modifiers,
	}),
);
let a, b;
try {
	a = await createEditor(document.querySelector('#a'), { value: 'function one() { return 1; }', language: 'ja', autoFormat: false });
	b = await createEditor(document.querySelector('#b'), { value: 'function two() { return 2; }', language: 'en', autoFormat: false });
	assert(!window.CodeMirror && !window.acorn && !window.JSHINT && !window.tern, 'no library globals');
	assert(a.getAnalysis().fnNames[0] === 'one' && b.getAnalysis().fnNames[0] === 'two', 'independent analysis');
	assert(getComputedStyle(document.querySelector('#host-page')).color === 'rgb(1, 2, 3)', 'host CSS unaffected');
	assert(!('getCodeMirror' in a), 'public API does not expose editor instance');
	const editorA = document.querySelector('#a .cm-editor');
	const editorB = document.querySelector('#b .cm-editor');
	for (const [text, count] of [['', 1], ['first\nsecond\n', 3]]) {
		a.loadDocument(text);
		assert(a.getLineCount() === count, 'line count includes empty and trailing lines: ' + count);
	}
	a.loadDocument('a \tb\nc \td');
	const whitespaceLines = () => [...editorA.querySelectorAll('.cm-content .cm-line')];
	assert(getComputedStyle(whitespaceLines()[0].querySelector('.cm-highlightSpace')).backgroundImage.includes('radial-gradient') &&
		getComputedStyle(whitespaceLines()[1].querySelector('.cm-highlightSpace')).backgroundImage === 'none' &&
		getComputedStyle(whitespaceLines()[1].querySelector('.cm-highlightTab'), '::before').color === 'rgb(251, 221, 230)',
		'component preserves active-space and inactive-tab display');
	a.loadDocument('function one() { return 1; }');
	const clipboardEvents = [];
	const offCopy = a.on('copy', event => clipboardEvents.push(['copy', event.text]));
	const offCut = a.on('cut', event => clipboardEvents.push(['cut', event.text]));
	a.focus();
	press(editorA, 'a', mod);
	assert(a.getSelection() === a.getValue(), 'select-all shortcut selects the entire document');
	const selectedLineStyle = getComputedStyle(editorA.querySelector('.cm-line'));
	assert(!editorA.querySelector('.cm-activeLine') && !editorA.querySelector('.cm-activeLineGutter') &&
		selectedLineStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && selectedLineStyle.boxShadow === 'none' &&
		getComputedStyle(editorA.querySelector('.cm-syntax-literal')).textShadow !== 'none',
		'JavaScript selection hides active-line and gutter highlighting without suppressing literal shadows');
	await waitFor(() => editorA.querySelector('.cm-selectionBackground'), 'selection is rendered');
	const selectionLayer = editorA.querySelector('.cm-selectionLayer');
	assert(Number(getComputedStyle(selectionLayer).zIndex) > Number(getComputedStyle(editorA.querySelector('.cm-structure-overlay')).zIndex),
		'selection highlight is painted above the structure canvas and editor background');
	for (const type of ['copy', 'cut']) {
		editorA.querySelector('.cm-content').dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
	}
	assert(clipboardEvents.length === 2 && clipboardEvents.every(([, text]) => text === 'function one() { return 1; }'), 'clipboard events expose selection before cutting');
	offCopy();
	offCut();
	a.loadDocument('one\ntwo');
	const restoredLine = editorA.querySelector('.cm-activeLine');
	assert(restoredLine && editorA.querySelector('.cm-activeLineGutter') &&
		getComputedStyle(restoredLine).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
		getComputedStyle(restoredLine).boxShadow !== 'none',
		'collapsing the selection restores active-line and gutter highlighting');
	editorA.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
	assert(a.getValue() === 'one\ntwo', 'cut without a selection leaves the current line intact');
	a.moveTo({ line: 0, ch: 1 });
	press(editorA, 'Tab');
	assert(a.getValue() === 'o\tne\ntwo', 'Tab inserts a tab at the caret');
	press(editorA, 'd', mod);
	assert(a.getValue() === 'two', 'legacy delete-line shortcut');
	press(editorA, 'z', mod);
	assert(a.getValue().endsWith('\ntwo'), 'keyboard undo restores the deleted line');
	press(editorA, mac ? 'y' : 'Z', { ...mod, shiftKey: !mac });
	assert(a.getValue() === 'two', 'legacy keyboard redo removes the line again');
	press(editorA, mac ? 'f' : 'F', { ...mod, altKey: mac, shiftKey: !mac });
	const replaceField = editorA.querySelector('.cm-search input[name="replace"]');
	assert(replaceField && document.activeElement === replaceField, 'legacy replace shortcut focuses the replacement field');
	editorA.querySelector('.cm-search button[name="close"]').click();
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
		const cursor = getComputedStyle(editorA.querySelector('.cm-lineNumbers .cm-gutterElement:not([style*="visibility: hidden"])')).cursor;
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
	a.loadDocument('function first() {\n\tvar firstValue = 1; console.log(firstValue);\n}\nfunction second() {\n\tvar secondValue = 2;\n}');
	await a.analyzeNow();
	const local = editorA.querySelector('.cm-syntax-local-reference');
	assert(local?.textContent === 'firstValue' && getComputedStyle(local).color === 'rgb(83, 122, 31)',
		'local variable references retain the original green highlight');
	assert([...editorA.querySelectorAll('.cm-syntax-variable')].some(node =>
		node.textContent === 'console' && getComputedStyle(node).color === 'rgb(0, 83, 99)'),
		'global variable references retain the original turquoise highlight');
	const jsReference = () => [...editorA.querySelectorAll('.cm-syntax-variable-reference')]
		.find(node => node.textContent === 'firstValue');
	const jsReferenceStyle = getComputedStyle(jsReference());
	const jsReferenceAppearance = {
		background: jsReferenceStyle.backgroundColor,
		shadow: jsReferenceStyle.boxShadow,
		radius: jsReferenceStyle.borderRadius,
	};
	assert(jsReferenceAppearance.shadow !== 'none', 'JavaScript reference has a background and shadow');
	a.moveTo({ line: 1, ch: 0 }, { focus: false });
	assert(getComputedStyle(jsReference()).boxShadow === 'none',
		'JavaScript reference shadow is hidden on the active line');
	a.moveTo({ line: 0, ch: 0 }, { focus: false });
	a.setSettings({ analysis: false });
	a.loadDocument('function f() { let item = 1; return item; }');
	assert(editorA.querySelector('.cm-syntax-local-reference')?.textContent === 'item',
		'JavaScript syntax highlighting remains immediate when background analysis is disabled');
	a.replaceDocument('function f() { let other = 1; return item; }');
	assert(!editorA.querySelector('.cm-syntax-local-reference') &&
		[...editorA.querySelectorAll('.cm-syntax-variable')].some(node => node.textContent === 'item'),
		'JavaScript edits immediately update local reference classification');
	a.setSettings({ analysis: true });
	a.loadDocument('function first() {\n\tvar firstValue = 1; console.log(firstValue);\n}\nfunction second() {\n\tvar secondValue = 2;\n}');
	await a.analyzeNow();
	const ruler = editorA.querySelector('.cm-croq-rulers');
	assert([...ruler.children].map(rule => rule.style.getPropertyValue('--ruler-column')).join(',') === '4,8,12' &&
		[...ruler.children].every(rule => getComputedStyle(rule).borderLeftStyle === 'dashed'),
		'three dashed rulers mark the original indentation columns');
	themeRoot.style.setProperty('--croq-indent-ruler-color', '#123456');
	assert(getComputedStyle(ruler.firstElementChild).borderLeftColor === 'rgb(18, 52, 86)' &&
		getComputedStyle(editorB.querySelector('.cm-croq-rulers > span')).borderLeftColor !== 'rgb(18, 52, 86)',
		'component ruler styling can be customized independently');
	themeRoot.style.removeProperty('--croq-indent-ruler-color');
	a.setSettings({ rulers: false });
	assert(!editorA.querySelector('.cm-ruler-overlay') && editorB.querySelector('.cm-ruler-overlay'),
		'ruler setting disables guides only in the selected editor');
	a.setSettings({ rulers: true });
	assert(editorA.querySelectorAll('.cm-croq-rulers > span').length === 3,
		'ruler setting restores guides');
	await new Promise(resolve => setTimeout(resolve, 120));
	const restoredRuler = editorA.querySelector('.cm-croq-rulers');
	const firstLine = editorA.querySelector('.cm-content .cm-line');
	assert(Math.abs(restoredRuler.firstElementChild.getBoundingClientRect().left -
		(firstLine.getBoundingClientRect().left + parseFloat(getComputedStyle(firstLine).paddingLeft) +
		4 * parseFloat(restoredRuler.style.getPropertyValue('--ruler-character-width')))) < 1,
		'component ruler aligns with its padded text after re-enabling');
	const gutterWidth = () => editorA.querySelector('.cm-gutters').getBoundingClientRect().width;
	const normalWidth = gutterWidth();
	const structureLayer = getComputedStyle(editorA.querySelector('.cm-structure-overlay'));
	const textLayer = getComputedStyle(editorA.querySelector('.cm-content'));
	assert(getComputedStyle(editorA.querySelector('.cm-scroller')).zIndex === 'auto' &&
		Number(textLayer.zIndex) > Number(structureLayer.zIndex), 'source text is painted above the structure canvas');
	themeRoot.style.setProperty('--croq-structure-overlay-z-index', '-1');
	assert(getComputedStyle(editorA.querySelector('.cm-structure-overlay')).zIndex === '-1' &&
		getComputedStyle(editorB.querySelector('.cm-structure-overlay')).zIndex === '0',
		'structure layering can be customized independently in the component');
	themeRoot.style.removeProperty('--croq-structure-overlay-z-index');
	themeRoot.style.setProperty('--croq-function-number-color', '#123456');
	themeRoot.style.setProperty('--croq-function-lint-gutter-width', '30px');
	assert(getComputedStyle(editorA.querySelector('.cm-gutter-lint')).width === '30px',
		'function lint gutter width is customizable from the component container');
	themeRoot.style.removeProperty('--croq-function-lint-gutter-width');
	for (const functionLineNumbers of [true, false]) {
		a.setSettings({ functionLineNumbers });
		assert(gutterWidth() === normalWidth, 'gutter width is stable when switching line-number modes: ' + functionLineNumbers);
		const strip = getComputedStyle(editorA.querySelector('.cm-gutters'), '::after');
		assert(strip.backgroundImage.includes('repeating-linear-gradient') === functionLineNumbers,
			'only per-function mode displays the striped gutter edge: ' + functionLineNumbers);
		if (functionLineNumbers) {
			assert(getComputedStyle(editorA.querySelectorAll('.cm-function-number')[1]).color === 'rgb(18, 52, 86)',
				'function number color is customizable in the component');
		}
		await waitFor(() => editorA.querySelectorAll('.cm-lint-marker-warning').length === 2, 'function diagnostics did not render');
		for (const [index, marker] of [...editorA.querySelectorAll('.cm-lint-marker-warning')].entries()) {
			const line = [1, 4][index];
			const box = marker.getBoundingClientRect();
			assert(marker.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), 'lint marker receives pointer over function region: ' + functionLineNumbers + ', line ' + line);
		}
		themeRoot.style.removeProperty('--croq-function-number-color');
	}
	a.loadDocument('function longFunction() {\n' + '\n'.repeat(999) + '}');
	await a.analyzeNow();
	const longWidth = gutterWidth();
	a.setSettings({ functionLineNumbers: true });
	assert(longWidth > normalWidth && gutterWidth() === longWidth, 'both gutters reserve the same width for four-digit numbers');
	a.setSettings({ functionLineNumbers: false });
	a.loadDocument('const broken = ;');
	await waitFor(() => editorA.querySelector('.cm-lint-marker-error'), 'syntax diagnostics did not render');
	const lintMarker = editorA.querySelector('.cm-lint-marker-error');
	lintMarker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
	await waitFor(() => editorA.querySelector('.cm-tooltip-lint li'), 'gutter hover opens the diagnostic tooltip');
	const lintTooltip = editorA.querySelector('.cm-tooltip-lint');
	assert(lintTooltip.querySelectorAll('li').length > 1, 'tooltip includes every diagnostic on the line');
	window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
	await waitFor(() => !lintTooltip.isConnected, 'lint tooltip removed when pointer leaves');
	a.loadDocument('function one() { return 1; }');
	assert(searchLabel(a, editorA).includes('検索'), 'Japanese search uses language resources');
	assert(searchLabel(b, editorB).includes('Find'), 'English search uses language resources');
	a.setSettings({ language: 'en' });
	assert(searchLabel(a, editorA).includes('Find'), 'language resources switch at runtime');
	a.setSettings({ language: 'ja' });
	assert(searchLabel(a, editorA).includes('検索') && searchLabel(b, editorB).includes('Find'), 'language resources remain independent');
	a.setSettings({ lineWrapping: true, fontSize: 22 });
	assert(editorA.querySelector('.cm-lineWrapping'), 'wrapping applies to the configured editor');
	assert(!b.getSettings().lineWrapping && !editorB.querySelector('.cm-lineWrapping') && b.getSettings().fontSize === 16, 'settings isolated');
	a.loadDocument('apple apple');
	a.execute('replace');
	const searchPanel = editorA.querySelector('.cm-search');
	const searchInput = searchPanel.querySelector('input[name="search"]');
	const replacement = searchPanel.querySelector('input[name="replace"]');
	assert(document.activeElement === replacement, 'replace focuses the replacement field');
	searchInput.value = 'apple';
	replacement.value = 'pear';
	replacement.dispatchEvent(new Event('change', { bubbles: true }));
	searchPanel.querySelector('button[name="replaceAll"]').click();
	assert(a.getValue() === 'pear pear', 'search panel can replace all matches');
	searchPanel.querySelector('button[name="close"]').click();
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
	assert(a.getAnalysis() === null && editorA.querySelector('.cm-lineNumbers .cm-gutterElement:not([style*="visibility: hidden"])')?.textContent === '1', 'analysis disabled restores ordinary line numbers');
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
	assert(document.querySelector('#a .cm-tooltip-autocomplete')?.textContent.includes('customFunction'), 'Tern completion uses additional definitions');
	assert(!document.querySelector('#b .cm-tooltip-autocomplete'), 'completion popup belongs to its editor');
	escape(editorA);
	a.loadDocument('customFunction(');
	a.moveTo({ line: 0, ch: 15 });
	await wait(200);
	const argHint = document.querySelector('.cm-tern-arguments');
	assert(argHint?.textContent.includes('value:') && argHint.textContent.includes('string'), 'Tern argument hints retain parameter types');
	a.loadDocument('const sampleNumber = 42;\nsampleN');
	a.moveTo({ line: 1, ch: 7 });
	a.execute('complete');
	await wait(200);
	assert(document.querySelector('#a .cm-tooltip-autocomplete li:has(.cm-tern-number)')?.textContent.includes('sampleNumber'), 'Tern infers number type for completion');
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
	const content = editorA.querySelector('.cm-content');
	content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	assert(editorA.classList.contains('ime'), 'composition activates the IME state');
	content.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
	assert(!editorA.classList.contains('ime'), 'composition end clears the IME state');
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
	assert(a.getSettings().language === 'en' && searchLabel(a, document.querySelector('#a')).includes('Find'), 'omitted UI language defaults to English');
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
		assert([...plain.querySelectorAll('.cm-lineNumbers .cm-gutterElement:not([style*="visibility: hidden"])')].map(node => node.textContent).join(',') === '1,2' && !plain.querySelector('.cm-lint-marker'), 'plain text uses ordinary numbers without diagnostics');
		assert(a.getAnalysis() === null && await a.analyzeNow() === null, 'plain text has no analysis snapshot');
		a.loadDocument('(text)');
		a.moveTo({ line: 0, ch: 0 });
		assert(!plain.querySelector('.cm-matchingBracket'), 'plain text does not enable bracket matching');
		a.loadDocument('const broken = ;\nordinary text');
		a.focus();
		press(plain, 'a', mod);
		assert(!plain.querySelector('.cm-activeLine') && !plain.querySelector('.cm-activeLineGutter'),
			'plain-text selection hides active-line and gutter highlighting');
		a.moveTo({ line: 0, ch: 0 });
		const original = a.getValue();
		for (const command of ['format', 'complete', 'toggleComment']) a.execute(command);
		a.setDefinitions([{ '!name': 'unused' }]);
		assert(a.getValue() === original && !document.querySelector('#a .cm-tooltip-autocomplete'), 'language-specific commands leave plain text unchanged');
		a.replaceRange('!', { line: 1, ch: 13 });
		a.execute('undo');
		assert(a.getValue() === original, 'plain text retains editing and undo');
		a.setSettings({ language: 'ja', analysis: true, completion: true, diagnostics: true });
		await wait(600);
		assert(searchLabel(a, plain).includes('検索') && a.getSettings().codeLanguage === null && !document.querySelector('#a .cm-lint-marker'), 'plain text locale switches independently without producing diagnostics');
		a.execute('find');
		assert(document.querySelector('#a .cm-search input'), 'plain text search remains available');
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
	const javaSource = '// 日本語 😀\nvoid main() {\n\tString message = "Hello";\n\tint count = 10;\n\tif (count > 0) {\n\t\tIO.println(count);\n\t}\n}\nvoid helper() {\n\tIO.println("helper");\n}';
	let javaEditor;
	try {
		javaEditor = await createEditor(document.querySelector('#b'), {
			codeLanguage: 'java', value: javaSource, analysisDelay: 0, functionLineNumbers: true,
		});
		const javaRoot = document.querySelector('#b');
		const javaAnalysis = javaEditor.getAnalysis();
		const highlighted = (kind, text) => [...javaRoot.querySelectorAll('.cm-syntax-' + kind)]
			.find(node => node.textContent === text);
		assert(javaEditor.getSettings().codeLanguage === 'java' && javaAnalysis?.success,
			'Java Tree-sitter worker analyzes Java 25 simple source files');
		javaEditor.focus();
		press(javaRoot, 'a', mod);
		assert(!javaRoot.querySelector('.cm-activeLine') && !javaRoot.querySelector('.cm-activeLineGutter'),
			'Java selection hides active-line and gutter highlighting');
		javaEditor.moveTo({ line: 0, ch: 0 });
		assert(javaRoot.querySelector('.cm-activeLine') && javaRoot.querySelector('.cm-activeLineGutter'),
			'Java collapsed selection restores active-line and gutter highlighting');
		assert(highlighted('keyword', 'void') && highlighted('function', 'main') &&
			highlighted('type', 'String') && highlighted('literal', '"Hello"') &&
			highlighted('variable', 'count'),
			'Java analysis results are passed to the syntax-highlighting extension');
		assert([...javaRoot.querySelectorAll('.cm-syntax-local-reference')].some(node =>
			node.textContent === 'count' && getComputedStyle(node).color === 'rgb(83, 122, 31)') &&
			javaAnalysis.decorations.some(item => item.kind === 'token' && item.from.line === 3),
			'Java variable declarations and local references use shared visual extensions');
		const javaReference = () => [...javaRoot.querySelectorAll('.cm-syntax-variable-reference')]
			.find(node => node.textContent === 'count');
		const javaStyle = getComputedStyle(javaReference());
		assert(javaStyle.backgroundColor === jsReferenceAppearance.background &&
			javaStyle.boxShadow === jsReferenceAppearance.shadow &&
			javaStyle.borderRadius === jsReferenceAppearance.radius,
			'Java reference background, shadow and radius match JavaScript');
		assert(!javaRoot.querySelector('.cm-line:nth-child(4) .cm-syntax-variable-reference'),
			'Java variable declarations are not decorated as references');
		javaRoot.style.setProperty('--croq-syntax-reference-background', '#123456');
		assert(getComputedStyle(javaReference()).backgroundColor === 'rgb(18, 52, 86)',
			'Java reference background accepts a CSS custom property');
		javaRoot.style.removeProperty('--croq-syntax-reference-background');
		javaEditor.moveTo({ line: 4, ch: 0 }, { focus: false });
		assert(getComputedStyle(javaReference()).boxShadow === 'none' &&
			getComputedStyle(javaReference()).backgroundColor === 'rgba(0, 0, 0, 0)',
			'Java reference background and shadow are hidden on the active line');
		const sectionMarkers = [...javaRoot.querySelectorAll('.cm-sectionNumbers .cm-function-number')]
			.map(element => element.textContent).join();
		assert(javaAnalysis.sectionStarts.join() === '1,8' && sectionMarkers === '1,2' &&
			javaAnalysis.decorations.some(item => item.kind === 'range' && item.from.line === 1) &&
			javaAnalysis.decorations.some(item => item.kind === 'range' && item.fill === 'hsla(150, 100%, 35%, 0.15)'),
			`Java method and conditional structure drives per-function numbering and structure display: sections=${javaAnalysis.sectionStarts.join()}, markers=${sectionMarkers}`);
		const countOffset = javaSource.indexOf('count');
		assert(countOffset >= 0 && javaAnalysis.syntaxHighlights.some(token =>
			token.from === countOffset && token.to === countOffset + 'count'.length && token.kind === 'variable'),
			'Java syntax ranges map UTF-8 parser positions to UTF-16 editor offsets');
		assert(!javaRoot.querySelector('.cm-lint-marker') && !javaRoot.querySelector('.cm-tooltip-autocomplete'),
			'Java initial implementation does not enable Java diagnostics or completion');
		const jsStyleSource = '//note\nfunction work(arg) {\n let item = 10;\n let flag = true; let notFlag = false;\n let empty = null;\n if (item > 0) { log(arg); }\n let str = "sample";\n}';
		const javaStyleSource = '//note\nvoid work(int arg) {\n int item = 10;\n boolean flag = true; boolean notFlag = false;\n Object empty = null;\n if (item > 0) { log(arg); }\n String str = "sample";\n}';
		a = await createEditor(document.querySelector('#a'), { value: jsStyleSource });
		javaEditor.loadDocument(javaStyleSource);
		await javaEditor.analyzeNow();
		const jsRoot = document.querySelector('#a');
		const syntaxToken = (root, kind, text) => [...root.querySelectorAll('.cm-syntax-' + kind)]
			.find(node => node.textContent === text);
		for (const [jsKind, javaKind, text] of [
			['comment', 'comment', '//note'],
			['keyword', 'keyword', 'if'],
			['keyword', 'operator', '='],
			['keyword', 'operator', '>'],
			['definition', 'definition', 'work'],
			['definition', 'definition', 'arg'],
			['definition', 'definition', 'item'],
			['literal', 'literal', '10'],
			['literal', 'literal', 'true'],
			['literal', 'literal', 'false'],
			['literal', 'literal', 'null'],
			['literal', 'literal', '"sample"'],
			['variable-reference', 'variable-reference', 'item'],
		]) {
			const jsToken = syntaxToken(jsRoot, jsKind, text);
			const javaToken = syntaxToken(javaRoot, javaKind, text);
			assert(jsToken && javaToken, `JavaScript and Java syntax tokens are present: ${text}`);
			const jsStyle = getComputedStyle(jsToken), style = getComputedStyle(javaToken);
			assert(jsStyle.fontWeight === (jsKind === 'variable-reference' ? '400' : '700') &&
				(jsStyle.textShadow !== 'none') === (jsKind === 'literal') &&
				(jsStyle.boxShadow !== 'none') === (jsKind === 'variable-reference'),
				`JavaScript retains expected syntax weight and shadows: ${text}`);
			assert(style.fontWeight === jsStyle.fontWeight && style.textShadow === jsStyle.textShadow &&
				style.boxShadow === jsStyle.boxShadow,
				`Java syntax weight and shadows match JavaScript: ${text}`);
		}
		for (const root of [jsRoot, javaRoot]) {
			root.style.setProperty('--croq-syntax-literal-font-weight', '400');
			root.style.setProperty('--croq-syntax-literal-text-shadow', 'rgb(1, 2, 3) 1px 2px 3px');
			const style = getComputedStyle(syntaxToken(root, 'literal', '10'));
			assert(style.fontWeight === '400' && style.textShadow.includes('rgb(1, 2, 3)'),
				'Literal weight and shadow accept CSS custom properties');
			root.style.removeProperty('--croq-syntax-literal-font-weight');
			root.style.removeProperty('--croq-syntax-literal-text-shadow');
		}
		a.moveTo({ line: 2, ch: 0 }, { focus: false });
		javaEditor.moveTo({ line: 2, ch: 0 }, { focus: false });
		assert(getComputedStyle(syntaxToken(jsRoot, 'literal', '10')).textShadow === 'none' &&
			getComputedStyle(syntaxToken(javaRoot, 'literal', '10')).textShadow === 'none',
			'Both languages hide literal text shadow on the active line');
		for (const [editor, root, source] of [
			[a, jsRoot, 'function test() {\n const text = "}";\n // }\n if (true) {\n  const values = [text];\n  return text;\n }\n}'],
			[javaEditor, javaRoot, 'class Test {\n String text = "}";\n // }\n void run() {\n  String[] values;\n  use(text);\n }\n}'],
		]) {
			root.scrollIntoView({ block: 'center' });
			editor.setSettings({ analysis: false });
			editor.loadDocument(source);
			editor.moveTo({ line: 0, ch: source.indexOf('{') });
			const lines = [...root.querySelectorAll('.cm-content .cm-line')];
			const matches = [...root.querySelectorAll('.cm-content .cm-matchingBracket')];
			assert(matches.length === 2 && matches[0].textContent === '{' && matches[1].textContent === '}' &&
				matches[0].closest('.cm-line') === lines[0] && matches[1].closest('.cm-line') === lines.at(-1),
				'bracket matching ignores braces in strings and comments even when analysis is disabled');
			const overlay = root.querySelector('.cm-bracket-gutter-overlay');
			await waitFor(() => overlay.children.length === 1, 'bracket gutter overlay was not painted');
			const gutter = root.querySelector('.cm-gutters');
			const gutterBox = gutter.getBoundingClientRect();
			const overlayBox = overlay.getBoundingClientRect();
			const bracketBox = matches[1].getBoundingClientRect();
			const overlayMarkBox = overlay.firstElementChild.getBoundingClientRect();
			const hit = document.elementFromPoint(gutterBox.right - 2, bracketBox.top + bracketBox.height / 2);
			const hitTestable = bracketBox.top >= 0 && bracketBox.bottom <= innerHeight;
			assert(Math.abs(overlayBox.right - gutterBox.right) < 1 &&
				Math.abs(overlayBox.width - parseFloat(getComputedStyle(gutter, '::after').width)) < 1 &&
				Math.abs(overlayMarkBox.left - bracketBox.left) < 1 &&
				Math.abs(overlayMarkBox.top - bracketBox.top) < 1 &&
				getComputedStyle(overlay).pointerEvents === 'none' &&
				getComputedStyle(overlay.firstElementChild, '::before').borderRadius === '50%' &&
				(!hitTestable || hit?.closest('.cm-gutters') === gutter),
				'bracket circle overlaps only the gutter edge without intercepting gutter input');
			const currentMark = getComputedStyle(matches[0], '::before');
			const otherMark = getComputedStyle(matches[1], '::before');
			assert(getComputedStyle(matches[0]).fontWeight === '700' &&
				getComputedStyle(matches[0]).backgroundColor === 'rgba(0, 0, 0, 0)' &&
				getComputedStyle(matches[1]).backgroundColor === 'rgba(0, 0, 0, 0)' &&
				currentMark.borderTopWidth === '0px' && currentMark.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
				otherMark.content !== 'none' && otherMark.borderTopWidth === '8px' && otherMark.borderRadius === '50%',
				'bracket matches use the CM5 active-line background and bold yellow circle');
			const theme = root.querySelector('.croq-mirror');
			const originalBorderColor = otherMark.borderTopColor;
			assert(getComputedStyle(overlay.firstElementChild, '::before').borderTopColor === originalBorderColor,
				'gutter overlay uses the same circle color');
			theme.style.setProperty('--croq-mirror-l-yellow', '#00ff00');
			assert(getComputedStyle(matches[1], '::before').borderTopColor !== originalBorderColor &&
				getComputedStyle(overlay.firstElementChild, '::before').borderTopColor ===
					getComputedStyle(matches[1], '::before').borderTopColor,
				'bracket circle uses the theme yellow color');
			theme.style.removeProperty('--croq-mirror-l-yellow');
			editor.loadDocument(source + '\n//' + 'x'.repeat(200));
			editor.moveTo({ line: 0, ch: source.indexOf('{') });
			await waitFor(() => overlay.children.length === 1, 'bracket gutter overlay did not update after editing');
			const scroller = root.querySelector('.cm-scroller');
			scroller.scrollLeft = 40;
			await waitFor(() => scroller.scrollLeft >= 40 && !overlay.children.length,
				'horizontally hidden bracket must not overlap the gutter');
			editor.loadDocument(source);
			editor.moveTo({ line: 3, ch: source.split('\n')[3].indexOf('(') + 1 });
			assert(root.querySelectorAll('.cm-matchingBracket').length === 2,
				'parentheses also match while automatic analysis is disabled');
			editor.moveTo({ line: 4, ch: source.split('\n')[4].indexOf('[') });
			assert([...root.querySelectorAll('.cm-matchingBracket')].map(node => node.textContent).join('') === '[]',
				'square brackets match while automatic analysis is disabled');
			editor.loadDocument('class Broken {');
			editor.moveTo({ line: 0, ch: 13 });
			assert(root.querySelector('.cm-nonmatchingBracket') && !root.querySelector('.cm-matchingBracket'),
				'unmatched brackets do not receive matching circles');
			editor.setSettings({ analysis: true });
			editor.loadDocument(source.replace('// }', '// { }'));
			await editor.analyzeNow();
			editor.setSettings({ functionLineNumbers: true });
			editor.moveTo({ line: 0, ch: source.indexOf('{') });
			await waitFor(() => root.querySelector('.cm-sectionNumbers') && overlay.children.length === 1,
				'bracket gutter overlay must also work with per-function line numbers');
			editor.moveTo({ line: 2, ch: 4 });
			assert([...root.querySelectorAll('.cm-matchingBracket')].every(node =>
				getComputedStyle(node, '::before').content === 'none'),
				'brackets in comments do not receive yellow circles');
			await waitFor(() => !overlay.children.length, 'comment brackets must not leave a gutter circle');
		}
		for (const [editor, root, source, editLine, retainedLine] of [
			[a, jsRoot, 'function one() {\n let a = 1;\n}\nfunction two() {\n let b = 2;\n}', 1, 3],
			[javaEditor, javaRoot, 'class Test {\n void one() {\n  int a = 1;\n }\n void two() {\n  int b = 2;\n }\n}', 2, 4],
		]) {
			editor.setSettings({ analysis: true, analysisDelay: 10000 });
			editor.loadDocument(source);
			await editor.analyzeNow();
			root.querySelector('.cm-scroller').scrollTop = 0;
			await wait(150);
			const alphaOnLine = lineNumber => {
				const canvas = root.querySelector('.code-structure-view');
				const line = root.querySelectorAll('.cm-content .cm-line')[lineNumber];
				if (!canvas?.width || !line) return 0;
				const scale = devicePixelRatio;
				const y = Math.max(0, Math.floor((line.getBoundingClientRect().top - canvas.getBoundingClientRect().top) * scale));
				const height = Math.min(canvas.height - y, Math.ceil(line.getBoundingClientRect().height * scale));
				if (height <= 0) return 0;
				const data = canvas.getContext('2d').getImageData(0, y, canvas.width, height).data;
				return data.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0);
			};
			await waitFor(() => alphaOnLine(retainedLine) > 0, 'unrelated structure was not initially painted');
			editor.replaceRange('0', { line: editLine, ch: source.split('\n')[editLine].indexOf('1') });
			await wait(150);
			assert(editor.getAnalysis() === null && alphaOnLine(retainedLine) > 0,
				'editing preserves unaffected structure until fresh analysis: ' + editor.getSettings().codeLanguage);
			editor.loadDocument(source);
			await editor.analyzeNow();
			await wait(150);
			const headerLine = editor.getSettings().codeLanguage === 'java' ? 1 : 0;
			const beforeHeader = alphaOnLine(headerLine);
			const beforeFollowing = alphaOnLine(retainedLine);
			assert(beforeHeader > 0 && beforeFollowing > 0, 'structure is painted before entering a newline');
			editor.moveTo({ line: editLine, ch: source.split('\n')[editLine].length });
			press(root, 'Enter');
			await waitFor(() => editor.getValue().split('\n').length === source.split('\n').length + 1,
				'editor did not process newline input');
			const headerFrames = [];
			for (let i = 0; i < 10; i++) {
				await new Promise(resolve => requestAnimationFrame(resolve));
				headerFrames.push(alphaOnLine(headerLine));
			}
			assert(editor.getAnalysis() === null && headerFrames.every(alpha => alpha >= beforeHeader * 0.9) &&
				alphaOnLine(retainedLine + 1) >= beforeFollowing * 0.9,
				'newline preserves enclosing and following structures: ' + editor.getSettings().codeLanguage);
		}
		a.destroy();
		javaEditor.setSettings({ analysis: true, analysisDelay: 10000 });
		const javaEditingSource = 'class Example {\n void run(int arg) {\n  int count = 10;\n  if (count > 0) { use(arg, count); }\n  use(count);\n }\n}';
		javaEditor.loadDocument(javaEditingSource);
		await javaEditor.analyzeNow();
		const javaToken = (kind, text) => [...javaRoot.querySelectorAll('.cm-syntax-' + kind)]
			.find(node => node.textContent === text);
		const referenceColor = getComputedStyle(javaToken('local-reference', 'count')).color;
		javaEditor.moveTo({ line: 2, ch: '  int count = 10'.length });
		assert(document.execCommand('insertText', false, ' + 2'), 'Java accepts native text input');
		await waitFor(() => javaEditor.getValue().includes('10 + 2') && javaEditor.getAnalysis() === null,
			'Java did not process native text input');
		assert(javaEditor.getAnalysis() === null && javaToken('keyword', 'class') &&
			javaToken('keyword', 'int') && javaToken('function', 'run') &&
			javaToken('local-reference', 'count') && javaToken('variable-reference', 'count') &&
			getComputedStyle(javaToken('local-reference', 'count')).color === referenceColor &&
			javaToken('operator', '+') && javaToken('literal', '2'),
			'Java retains existing syntax and local-reference colors and highlights typed tokens before analysis');
		javaEditor.replaceRange('\n  boolean active = true;', { line: 2, ch: javaEditor.getValue().split('\n')[2].length });
		assert(javaToken('keyword', 'boolean') && javaToken('definition', 'active') &&
			javaToken('literal', 'true') && javaToken('local-reference', 'count'),
			'Java highlights newly inserted declarations while preserving shifted reference colors');
		javaEditor.moveTo({ line: 4, ch: 2 });
		assert(document.execCommand('insertText', false, '/') && document.execCommand('insertText', false, '/'),
			'Java accepts line-comment input');
		await waitFor(() => javaEditor.getValue().split('\n')[4].startsWith('  //if'),
			'Java did not process line-comment input');
		const commentLine = javaRoot.querySelectorAll('.cm-content .cm-line')[4];
		assert([...commentLine.querySelectorAll('.cm-syntax-comment')].map(node => node.textContent).join('') ===
			'//if (count > 0) { use(arg, count); }' &&
			!commentLine.querySelector('.cm-syntax-keyword, .cm-syntax-local-reference, .cm-syntax-variable-reference, .cm-syntax-literal') &&
			javaToken('keyword', 'boolean') &&
			javaRoot.querySelectorAll('.cm-content .cm-line')[5].querySelector('.cm-syntax-local-reference')?.textContent === 'count',
			'Java immediately recolors the whole new line comment without waiting for analysis');
		javaEditor.replaceRange('', { line: 4, ch: 2 }, { line: 4, ch: 3 });
		assert(!commentLine.querySelector('.cm-syntax-comment') && javaToken('keyword', 'if') &&
			commentLine.querySelector('.cm-syntax-local-reference')?.textContent === 'count',
			'removing Java comment delimiters immediately restores code highlighting');
		javaEditor.replaceRange('', { line: 4, ch: 2 }, { line: 4, ch: 3 });
		const edited = await javaEditor.analyzeNow();
		assert(edited.success && javaToken('keyword', 'boolean') && javaToken('literal', 'true') &&
			javaToken('local-reference', 'count') &&
			getComputedStyle(javaToken('local-reference', 'count')).color === referenceColor,
			'fresh Java analysis replaces interim highlighting without changing established colors');
		javaEditor.loadDocument('class Existing {\n void run() {\n  //if (true) { use(1); }\n }\n}');
		await javaEditor.analyzeNow();
		javaEditor.replaceRange('', { line: 2, ch: 2 }, { line: 2, ch: 4 });
		assert(!javaRoot.querySelector('.cm-syntax-comment') && javaToken('keyword', 'if') &&
			javaToken('literal', 'true') && javaToken('literal', '1'),
			'removing an analyzed Java comment immediately restores syntax coloring');
		javaEditor.setSettings({ analysis: false });
		javaEditor.loadDocument('class Plain {\n int number = 42;\n boolean flag = false;\n Object value = null;\n}');
		assert(javaEditor.getAnalysis() === null && javaToken('keyword', 'class') &&
			javaToken('keyword', 'int') && javaToken('literal', '42') &&
			javaToken('literal', 'false') && javaToken('literal', 'null'),
			'Java syntax coloring remains available when automatic analysis is disabled');
		javaEditor.setSettings({ analysis: true });
		javaEditor.loadDocument('class Broken {\n  int value = ;\n}');
		const broken = await javaEditor.analyzeNow();
		assert(broken && !broken.success && javaRoot.querySelector('.cm-syntax-invalid') &&
			!javaRoot.querySelector('.cm-function-number'),
			'Java parser errors remain visible and stale method structure clears');
	} finally {
		javaEditor?.destroy();
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
