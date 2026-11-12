import { Editor } from '../.build/editor-view.js';
import { javascriptLanguage } from '../.build/lang/js/index.js';
import { plainLanguage } from '../.build/lang/plain/index.js';
import { analyze } from '../.build/lang/js/analyzer.js';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { setStructure, structureView } from '../dist/structure-view.js';
import { functionLineNumbers, getSectionLineNumber, setSectionStarts } from '../dist/function-line-numbers.js';
import { gutterLineSelection, setLineSelectionMode } from '../dist/gutter-line-selection.js';
import { indentRulers } from '../dist/indent-rulers.js';

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

	const host = document.createElement('div');
	host.style.cssText = 'height:150px;width:500px';
	document.body.prepend(host);
	const compartment = new Compartment();
	const standalone = new EditorView({
		state: EditorState.create({ doc: 'if (x) {\n  work();\n}', extensions: [compartment.of(structureView)] }),
		parent: host,
	});
	const otherHost = document.createElement('div');
	otherHost.style.cssText = 'height:150px;width:500px';
	document.body.prepend(otherHost);
	const other = new EditorView({
		state: EditorState.create({ doc: 'other', extensions: [structureView] }),
		parent: otherHost,
	});
	const painted = () => {
		const canvas = host.querySelector('canvas');
		return canvas && canvas.width && canvas.height &&
			canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value);
	};
	const waitForPaint = async expected => {
		for (let i = 0; i < 50 && !!painted() !== expected; i++) await new Promise(resolve => setTimeout(resolve, 20));
		return !!painted() === expected;
	};
	try {
		host.style.setProperty('--croq-structure-overlay-z-index', '7');
		host.style.setProperty('--croq-structure-content-z-index', '8');
		host.style.setProperty('--croq-structure-scroller-z-index', '2');
		assert(getComputedStyle(host.querySelector('.cm-structure-overlay')).zIndex === '7' &&
			getComputedStyle(standalone.contentDOM).zIndex === '8' &&
			getComputedStyle(standalone.scrollDOM).zIndex === '2' &&
			getComputedStyle(otherHost.querySelector('.cm-structure-overlay')).zIndex === '0',
			'structure CSS custom properties apply per editor');
		host.style.removeProperty('--croq-structure-overlay-z-index');
		host.style.removeProperty('--croq-structure-content-z-index');
		host.style.removeProperty('--croq-structure-scroller-z-index');
		standalone.dispatch({ effects: setStructure.of([{
			kind: 'range', from: { line: 0, ch: 0 }, to: { line: 2, ch: 1 }, fill: '#ff0000',
			spineChars: 3, branchChars: 4, branches: [{ line: 1, ch: 0 }],
		}]) });
		assert(await waitForPaint(true), 'standalone structure extension draws externally supplied ranges');
		const otherCanvas = otherHost.querySelector('canvas');
		await new Promise(resolve => setTimeout(resolve, 100));
		assert(otherCanvas.width && !otherCanvas.getContext('2d').getImageData(0, 0, otherCanvas.width, otherCanvas.height).data.some((value, i) => i % 4 === 3 && value),
			'structure data is isolated between standalone editors');
		standalone.dispatch({ effects: setStructure.of([]) });
		assert(await waitForPaint(false), 'standalone structure extension clears explicitly');
		standalone.dispatch({ effects: setStructure.of([{
			kind: 'token', from: { line: 1, ch: 2 }, to: { line: 1, ch: 6 }, fill: '#00ff00', stroke: '#000000',
		}]) });
		assert(await waitForPaint(true), 'standalone structure extension draws externally supplied tokens');
		standalone.dispatch({ changes: { from: 0, insert: ' ' } });
		assert(await waitForPaint(false), 'document edits clear stale standalone structure');
		standalone.dispatch({ effects: setStructure.of([{
			kind: 'token', from: { line: 0, ch: 1 }, to: { line: 0, ch: 3 }, fill: '#00ff00', stroke: '#000000',
		}]) });
		assert(await waitForPaint(true), 'standalone structure can be supplied again after editing');
		standalone.dispatch({ userEvent: 'load' });
		assert(await waitForPaint(false), 'load event clears standalone structure even without a document change');
		standalone.dispatch({ effects: compartment.reconfigure([]) });
		assert(!host.querySelector('.cm-structure-overlay') && !host.querySelector('style'),
			'removing the structure extension removes its canvas and stylesheet');
	} finally {
		standalone.destroy();
		other.destroy();
		host.remove();
		otherHost.remove();
	}

	const numbersHost = document.createElement('div');
	document.body.prepend(numbersHost);
	const numbersCompartment = new Compartment();
	const numbers = new EditorView({
		state: EditorState.create({
			doc: Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\n'),
			extensions: [numbersCompartment.of(functionLineNumbers), EditorView.theme({
				'&': { height: '150px', width: '500px' }, '.cm-scroller': { overflow: 'auto' },
			})],
		}),
		parent: numbersHost,
	});
	try {
		numbers.dispatch({ effects: setSectionStarts.of([1, 30]) });
		await new Promise(resolve => setTimeout(resolve, 300));
		const gutter = numbersHost.querySelector('.cm-sectionNumbers');
		const visible = [...gutter.querySelectorAll('.cm-gutterElement')].filter(element => element.style.visibility !== 'hidden');
		assert(visible.slice(0, 3).map(element => element.textContent).join(',') === '1,1,2',
			'standalone function line numbers render section starts and relative lines');
		assert(getSectionLineNumber(numbers.state, 31).join() === '2,2',
			'standalone function line number query works outside the viewport');
		assert(getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after').backgroundImage.includes('repeating-linear-gradient'),
			'standalone function line numbers provide their own gutter styling');
		const firstSection = gutter.querySelector('.cm-function-even').parentElement;
		assert(getComputedStyle(gutter).overflow === 'visible' &&
			getComputedStyle(firstSection, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)',
			'standalone gutter renders the section background');
		assert(numbersHost.querySelectorAll('.cm-section-scroll-markers > span').length === 2,
			'standalone function line numbers render scroll markers');
		numbersHost.style.setProperty('--croq-function-number-color', '#123456');
		numbersHost.style.setProperty('--croq-function-line-color', '#234567');
		numbersHost.style.setProperty('--croq-function-number-padding', '0 9px 0 6px');
		numbersHost.style.setProperty('--croq-function-gutter-min-width', '48px');
		numbersHost.style.setProperty('--croq-function-gutter-edge-width', '21px');
		numbersHost.style.setProperty('--croq-function-stripe-width', '5px');
		numbersHost.style.setProperty('--croq-function-stripe-color', '#bcdef0');
		numbersHost.style.setProperty('--croq-function-alternate-background', '#345678');
		numbersHost.style.setProperty('--croq-mirror-lint-gutter-width', '8px');
		numbersHost.style.setProperty('--croq-function-scroll-marker-track-width', '16px');
		numbersHost.style.setProperty('--croq-function-scroll-marker-inset', '3px');
		numbersHost.style.setProperty('--croq-function-scroll-marker-radius', '25%');
		numbersHost.style.setProperty('--croq-function-scroll-marker-z-index', '6');
		numbersHost.style.setProperty('--croq-function-scroll-marker-color', '#102030');
		const edge = getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after');
		const track = numbersHost.querySelector('.cm-section-scroll-markers');
		const marker = track.querySelector('span');
		assert(getComputedStyle(gutter.querySelector('.cm-function-number')).color === 'rgb(18, 52, 86)' &&
			getComputedStyle(gutter.querySelector('.cm-function-number')).paddingLeft === '6px' &&
			getComputedStyle(gutter.querySelector('.cm-croq-line-number')).color === 'rgb(35, 69, 103)' &&
			getComputedStyle(visible[0]).minWidth === '48px' && edge.width === '21px' &&
			edge.backgroundImage.includes('5px') && edge.backgroundImage.includes('188, 222, 240') &&
			getComputedStyle(firstSection, '::before').backgroundColor === 'rgb(52, 86, 120)' &&
			getComputedStyle(firstSection, '::before').left === '-8px' &&
			getComputedStyle(track).width === '16px' && getComputedStyle(track).zIndex === '6' &&
			getComputedStyle(marker).left === '3px' && getComputedStyle(marker).borderRadius === '25%' &&
			getComputedStyle(marker).backgroundColor === 'rgb(16, 32, 48)',
			'function gutter colors, dimensions, stripes and markers respond to custom properties');
		numbersHost.style.setProperty('--croq-function-gutter-edge-pattern', 'none');
		numbersHost.style.setProperty('--croq-function-gutter-edge-color', '#456789');
		assert(getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after').backgroundImage === 'none' &&
			getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after').backgroundColor === 'rgb(69, 103, 137)',
			'function gutter edge pattern and color can be overridden');
		numbers.dispatch({ changes: { from: 0, insert: 'x' } });
		await new Promise(resolve => setTimeout(resolve, 100));
		assert(getSectionLineNumber(numbers.state, 31).join() === '0,32' &&
			!numbersHost.querySelector('.cm-section-scroll-markers > span'), 'editing clears stale numbering and scroll markers');
		numbers.dispatch({ effects: numbersCompartment.reconfigure([]) });
		assert(!numbersHost.querySelector('.cm-sectionNumbers') && !numbersHost.querySelector('.cm-section-scroll-markers'),
			'removing the function line-number extension removes its UI');
		numbers.dispatch({ effects: numbersCompartment.reconfigure(functionLineNumbers) });
		numbers.dispatch({ effects: setSectionStarts.of([1]) });
		assert(numbersHost.querySelector('.cm-function-number')?.textContent === '1',
			'reinstalling the function line-number extension accepts fresh section data');
	} finally {
		numbers.destroy();
		numbersHost.remove();
	}

	const selectionHost = document.createElement('div');
	document.body.prepend(selectionHost);
	const selectionCompartment = new Compartment();
	const gutterCompartment = new Compartment();
	const accessCompartment = new Compartment();
	const nonceCompartment = new Compartment();
	const selectionView = new EditorView({
		state: EditorState.create({
			doc: 'one\ntwo\nthree\nlast',
			extensions: [gutterCompartment.of(lineNumbers()), selectionCompartment.of(gutterLineSelection), accessCompartment.of([]),
				nonceCompartment.of(EditorView.cspNonce.of('first-nonce'))],
		}),
		parent: selectionHost,
	});
	const selectionText = () => selectionView.state.sliceDoc(selectionView.state.selection.main.from, selectionView.state.selection.main.to);
	const mode = () => selectionView.dom.classList.contains('line-selection-mode');
	const lineMouse = (type, index, options = {}) => {
		const lines = selectionHost.querySelectorAll('.cm-content .cm-line');
		const gutter = [...selectionHost.querySelectorAll(':is(.cm-lineNumbers, .cm-sectionNumbers) .cm-gutterElement')]
			.filter(element => element.style.visibility !== 'hidden')[index];
		const box = lines[index].getBoundingClientRect();
		gutter.dispatchEvent(new MouseEvent(type, {
			bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
			clientX: gutter.getBoundingClientRect().left + 2, clientY: box.top + box.height / 2, ...options,
		}));
	};
	const lineClick = (index, options = {}) => {
		lineMouse('mousedown', index, options);
		lineMouse('mouseup', index, options);
	};
	try {
		await new Promise(resolve => setTimeout(resolve, 150));
		const selectionStyle = selectionHost.querySelector('style');
		assert(selectionStyle?.nonce === 'first-nonce', 'extension stylesheet uses the editor CSP nonce');
		selectionView.dispatch({ effects: nonceCompartment.reconfigure(EditorView.cspNonce.of('next-nonce')) });
		assert(selectionStyle.nonce === 'next-nonce', 'extension stylesheet follows CSP nonce changes');
		selectionHost.style.setProperty('--croq-gutter-cursor', 'crosshair');
		selectionHost.style.setProperty('--croq-gutter-line-selection-cursor', 'move');
		assert(getComputedStyle(selectionHost.querySelector('.cm-lineNumbers')).cursor === 'crosshair',
			'gutter cursor can be customized through CSS');
		lineClick(1);
		assert(selectionText() === 'two\n' && mode() &&
			getComputedStyle(selectionHost.querySelector('.cm-lineNumbers')).cursor === 'move',
			'standalone gutter click selects a line and uses the customized selection cursor');
		lineClick(3);
		assert(selectionText() === 'two\nthree\nlast' && mode(), 'line mode extends selection from the previous anchor');
		lineClick(0, { shiftKey: true });
		assert(selectionText() === 'one\ntwo\nthree\nlast' && !mode(), 'shift-click selects whole lines in reverse and exits line mode');
		lineMouse('mousedown', 2);
		lineMouse('mousemove', 0);
		lineMouse('mouseup', 0);
		assert(selectionText() === 'one\ntwo\nthree\n' && !mode(), 'gutter dragging selects complete lines in reverse');
		selectionView.dispatch({ effects: setLineSelectionMode.of(true) });
		assert(mode(), 'host can set standalone line-selection mode');
		selectionView.dispatch({ selection: { anchor: 0 } });
		assert(!mode(), 'collapsing a selection clears line-selection mode');
		selectionView.dispatch({ effects: accessCompartment.reconfigure(EditorState.readOnly.of(true)) });
		lineClick(1);
		assert(selectionText() === 'two\n', 'gutter selection remains available in a read-only editor');
		selectionView.dispatch({ effects: accessCompartment.reconfigure(EditorView.editable.of(false)) });
		selectionView.dispatch({ selection: { anchor: 0 } });
		lineClick(1);
		assert(selectionText() === '' && !mode(), 'non-editable editor ignores gutter selection');
		selectionView.dispatch({ effects: accessCompartment.reconfigure([]) });
		const lint = document.createElement('span');
		lint.className = 'cm-lint-marker';
		const gutterElement = selectionHost.querySelector('.cm-lineNumbers .cm-gutterElement:not([style*="visibility: hidden"])');
		gutterElement.append(lint);
		lint.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
		assert(selectionText() === '' && !mode(), 'gutter selection ignores lint markers');
		lint.remove();
		lineClick(1);
		window.dispatchEvent(new Event('blur'));
		assert(!mode(), 'window blur exits line-selection mode');
		selectionView.dispatch({ effects: gutterCompartment.reconfigure(functionLineNumbers) });
		selectionView.dispatch({ effects: setSectionStarts.of([0, 2]) });
		lineClick(1);
		assert(selectionText() === 'two\n' && mode(), 'gutter selection works with function line numbers');
		selectionView.dispatch({ effects: selectionCompartment.reconfigure([]) });
		assert(!mode() && !getComputedStyle(selectionHost.querySelector('.cm-sectionNumbers')).cursor.includes('data:image/svg+xml'),
			'removing the extension removes its line-selection mode and cursor');
		selectionView.dispatch({ selection: { anchor: 0 } });
		lineClick(1);
		assert(selectionText() === '' && !mode(), 'removing the gutter selection extension removes its handlers');
	} finally {
		selectionView.destroy();
		selectionHost.remove();
	}

	const rulerHost = document.createElement('div');
	const noRulerHost = document.createElement('div');
	document.body.prepend(rulerHost, noRulerHost);
	const rulerCompartment = new Compartment();
	const rulerSource = Array.from({ length: 40 }, () => 'x'.repeat(120)).join('\n');
	const rulerView = new EditorView({
		state: EditorState.create({
			doc: rulerSource,
			extensions: [lineNumbers(), rulerCompartment.of(indentRulers), EditorView.theme({
				'&': { height: '150px', width: '300px' },
				'.cm-scroller': { overflow: 'auto' },
			})],
		}),
		parent: rulerHost,
	});
	const noRulerView = new EditorView({ parent: noRulerHost });
	const waitForRulers = () => new Promise(resolve => setTimeout(resolve, 120));
	try {
		await waitForRulers();
		const overlay = rulerHost.querySelector('.cm-ruler-overlay');
		const rules = [...overlay.querySelectorAll('span')];
		const expectedX = column => {
			const line = rulerView.contentDOM.querySelector('.cm-line');
			return line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).paddingLeft) +
				column * rulerView.defaultCharacterWidth;
		};
		const aligned = (rule, column) => Math.abs(rule.getBoundingClientRect().left - expectedX(column)) < 1;
		assert(rules.length === 3 && rules.every((rule, i) => aligned(rule, [4, 8, 12][i])) &&
			rules.every(rule => getComputedStyle(rule).borderLeftStyle === 'dashed'),
			'standalone rulers align with columns 4, 8 and 12, including default line padding');
		assert(!noRulerHost.querySelector('.cm-ruler-overlay') &&
			getComputedStyle(noRulerView.scrollDOM).zIndex === '0',
			'ruler styles do not affect an editor without the extension');
		assert(getComputedStyle(overlay).pointerEvents === 'none' &&
			Number(getComputedStyle(rulerView.contentDOM).zIndex) > Number(getComputedStyle(overlay).zIndex),
			'standalone ruler overlay stays behind text and does not intercept input');
		rulerHost.style.setProperty('--croq-indent-ruler-width', '3px');
		rulerHost.style.setProperty('--croq-indent-ruler-color', '#123456');
		rulerHost.style.setProperty('--croq-indent-ruler-style', 'solid');
		rules[0].style.setProperty('--croq-indent-ruler-column', '2');
		assert(getComputedStyle(rules[0]).borderLeftWidth === '3px' &&
			getComputedStyle(rules[0]).borderLeftColor === 'rgb(18, 52, 86)' &&
			getComputedStyle(rules[0]).borderLeftStyle === 'solid' && aligned(rules[0], 2) && aligned(rules[1], 8),
			'ruler color, width, style and individual columns accept custom properties');
		rules[0].style.removeProperty('--croq-indent-ruler-column');
		rulerView.scrollDOM.scrollLeft = 15;
		rulerView.scrollDOM.scrollTop = 100;
		await waitForRulers();
		assert(rulerView.scrollDOM.scrollLeft > 0 && rulerView.scrollDOM.scrollTop > 0 &&
			aligned(rules[0], 4) && Math.abs(overlay.getBoundingClientRect().top - rulerView.scrollDOM.getBoundingClientRect().top) < 1,
			'rulers follow horizontal scrolling and remain fixed vertically');
		rulerView.dom.style.fontSize = '24px';
		rulerView.requestMeasure();
		await waitForRulers();
		assert(aligned(rules[1], 8), 'rulers follow font metric changes');
		rulerView.dom.style.width = '200px';
		rulerView.requestMeasure();
		await waitForRulers();
		const frame = rulerView.scrollDOM.getBoundingClientRect();
		const expectedWidth = Math.max(0, Math.min(rulerView.defaultCharacterWidth * 64,
			frame.left + rulerView.scrollDOM.clientWidth - overlay.getBoundingClientRect().left));
		assert(Math.abs(overlay.getBoundingClientRect().width - expectedWidth) < 1 && aligned(rules[1], 8),
			'rulers follow editor resizing and remain clipped to the scroll viewport');
		assert(rulerView.state.doc.toString() === rulerSource, 'rulers do not change document text');
		rulerView.dispatch({ effects: rulerCompartment.reconfigure([]) });
		assert(!rulerHost.querySelector('.cm-ruler-overlay') && !rulerHost.querySelector('style') &&
			getComputedStyle(rulerView.scrollDOM).zIndex === '0',
			'removing the ruler extension removes its overlay and stylesheet');
		rulerView.dispatch({ effects: rulerCompartment.reconfigure(indentRulers) });
		await waitForRulers();
		assert(rulerHost.querySelectorAll('.cm-croq-rulers > span').length === 3,
			'reinstalling the ruler extension restores its guides');
	} finally {
		rulerView.destroy();
		noRulerView.destroy();
		rulerHost.remove();
		noRulerHost.remove();
	}

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
		view.setOptions({ ...settings, functionLineNumbers: false }, {}, diagnostics);
		assert(view.getSectionLineNumber(2).join() === '1,2' && root.querySelector('.cm-lineNumbers'),
			'section data remains available while ordinary numbering is displayed');
		view.setOptions(settings, {}, diagnostics);
		assert(root.querySelector('.cm-function-number')?.textContent === '1',
			'switching back restores the current section numbering');
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
