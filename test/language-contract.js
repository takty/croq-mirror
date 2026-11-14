import { Editor } from '../.build/editor-view.js';
import { javascriptLanguage } from '../.build/lang/js/index.js';
import { plainLanguage } from '../.build/lang/plain/index.js';
import { analyze } from '../.build/lang/js/analyzer.js';
import { createCommonAnalysis } from '../.build/analysis/common-analysis.js';
import { commonAnalysisState, setCommonAnalysis } from '../dist/analysis.js';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { retainStructureOnEdit, setStructure, structureView } from '../dist/structure-view.js';
import { functionLineNumbers, getSectionLineNumber, setSectionStarts } from '../dist/function-line-numbers.js';
import { functionScrollMarkers } from '../dist/function-scroll-markers.js';
import { gutterLineSelection, setLineSelectionMode } from '../dist/gutter-line-selection.js';
import { indentRulers } from '../dist/indent-rulers.js';
import { setSyntaxHighlights, syntaxHighlightingExtension, syntaxHighlightingOptions, syntaxHighlightingSource } from '../dist/syntax-highlighting.js';

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
	const source = 'function example() {\n let x = 1;\n if (x) { x++; } else { x--; }\n const y = 2;\n}';
	const raw = analyze(source);
	const snapshot = JSON.stringify(raw);
	const data = createCommonAnalysis({ ...raw.commonAnalysis, version: 1 });
	assert(JSON.stringify(raw) === snapshot, 'common analysis conversion preserves public analysis');
	assert(data.complete && data.sections[0].from === 0, 'analysis supplies language-neutral function sections');
	const branch = data.structures.find(item => item.kind === 'conditional' && item.branches.length);
	assert(branch.from === source.indexOf('if') && branch.branches[0] > branch.from && branch.branches[0] < branch.to,
		'conditional structures and branches use common UTF-16 offsets');
	assert(data.declarations.filter(item => item.kind === 'variable').length === 2,
		'variable declarations are represented as common semantic data');
	assert(!createCommonAnalysis({ ...analyze('function unfinished( {').commonAnalysis, version: 2 }).complete,
		'incomplete tolerant analysis does not authorize indentation');
	const classSource = 'class Example {\n method() {}\n}';
	const classData = createCommonAnalysis({ ...analyze(classSource).commonAnalysis, version: 3 });
	const classStructure = classData.structures.find(item => item.kind === 'class');
	assert(classStructure?.from === 0 && classStructure.to === classSource.length && classData.sections.length === 1,
		'JavaScript class and method data use language-neutral structure and section kinds');

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
		const classRange = [{
			kind: 'range', from: { line: 0, ch: 0 }, to: { line: 2, ch: 1 },
			fill: 'var(--test-class-color, #ff0000)', opacity: 0.15, spineChars: 3, branchChars: 4, branches: [],
		}];
		const hasColor = (red, blue) => {
			const canvas = host.querySelector('canvas');
			const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] === red && pixels[i + 2] === blue && pixels[i + 3] >= 37 && pixels[i + 3] <= 39) return true;
			}
			return false;
		};
		const waitForColor = async (red, blue) => {
			for (let i = 0; i < 50 && !hasColor(red, blue); i++) await new Promise(resolve => setTimeout(resolve, 20));
			return hasColor(red, blue);
		};
		standalone.dispatch({ effects: setStructure.of(classRange) });
		assert(await waitForColor(255, 0), 'structure resolves CSS color fallback and paints the supplied opacity');
		host.style.setProperty('--test-class-color', '#0000ff');
		standalone.dispatch({ effects: setStructure.of([...classRange]) });
		assert(await waitForColor(0, 255), 'structure resolves inherited CSS color on repaint');
		host.style.removeProperty('--test-class-color');
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
		standalone.dispatch({
			changes: { from: 0, to: standalone.state.doc.length, insert: 'header\nfirst\n\nmiddle\nthird' },
			userEvent: 'load',
			effects: compartment.reconfigure([structureView, retainStructureOnEdit]),
		});
		const token = (line, fill) => ({
			kind: 'token', from: { line, ch: 0 }, to: { line, ch: 5 }, fill, stroke: fill,
		});
		standalone.dispatch({ effects: setStructure.of([
			token(0, '#ff0000'), token(1, '#00ff00'), token(3, '#ffff00'), token(4, '#0000ff'),
		]) });
		const colors = () => {
			const canvas = host.querySelector('canvas'), ctx = canvas.getContext('2d');
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const found = new Set();
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i + 3] > 200) found.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
			}
			return found;
		};
		const waitForColors = async (present, absent = []) => {
			for (let i = 0; i < 50; i++) {
				const found = colors();
				if (present.every(color => found.has(color)) && absent.every(color => !found.has(color))) return true;
				await new Promise(resolve => setTimeout(resolve, 20));
			}
			return false;
		};
		const red = '255,0,0', green = '0,255,0', yellow = '255,255,0', blue = '0,0,255';
		assert(await waitForColors([red, green, yellow, blue]), 'retained structure test paints distinct items');
		const blueTop = () => {
			const canvas = host.querySelector('canvas'), pixels = canvas.getContext('2d')
				.getImageData(0, 0, canvas.width, canvas.height).data;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 255 && pixels[i + 3] > 200) {
					return Math.floor(i / 4 / canvas.width);
				}
			}
			return -1;
		};
		const oldBlueTop = blueTop();
		standalone.dispatch({ changes: { from: standalone.state.doc.line(3).from, insert: '\n' } });
		for (let i = 0; i < 50 && blueTop() <= oldBlueTop; i++) await new Promise(resolve => setTimeout(resolve, 20));
		assert(blueTop() > oldBlueTop && await waitForColors([red, green, yellow, blue]),
			'unaffected structure follows inserted blank lines');
		const middle = standalone.state.doc.line(5);
		standalone.dispatch({ changes: { from: middle.from + 2, insert: 'x' } });
		assert(await waitForColors([red, green, blue], [yellow]),
			'editing invalidates affected structure while preserving unrelated items before and after');
		standalone.dispatch({ changes: { from: middle.from + 2, insert: '/' } });
		assert(await waitForColors([red, green], [yellow, blue]),
			'potential lexical changes also invalidate later structure');
		standalone.dispatch({ effects: setStructure.of([token(5, '#0000ff')]) });
		assert(await waitForColors([blue], [red, green]), 'fresh structure replaces retained items');
		standalone.dispatch({
			changes: { from: 0, to: standalone.state.doc.length, insert: 'if (x) {\n}\n\nthird' },
			userEvent: 'load',
		});
		standalone.dispatch({ effects: setStructure.of([{
			kind: 'range', from: { line: 0, ch: 0 }, to: { line: 1, ch: 1 }, fill: '#ff0000',
			spineChars: 3, branchChars: 4, branches: [],
		}, token(3, '#0000ff')]) });
		assert(await waitForColors([red, blue]), 'conditional structure is painted before branch edits');
		standalone.dispatch({ changes: { from: standalone.state.doc.line(3).from, insert: 'else' } });
		assert(await waitForColors([], [red, blue]),
			'a new branch invalidates its preceding conditional and later structure');
		standalone.dispatch({
			changes: { from: 0, to: standalone.state.doc.length, insert: 'start\nalpha omega\nfinish' },
			userEvent: 'load',
		});
		standalone.dispatch({ effects: setStructure.of([{
			kind: 'range', from: { line: 0, ch: 0 }, to: { line: 2, ch: 6 }, fill: '#ff0000',
			spineChars: 3, branchChars: 4, branches: [],
		}, token(1, '#00ff00'), {
			...token(1, '#0000ff'), from: { line: 1, ch: 6 }, to: { line: 1, ch: 11 },
		}]) });
		assert(await waitForColors([red, green, blue]), 'structure is painted before splitting a line');
		const previousBlueTop = blueTop();
		standalone.dispatch({ changes: { from: standalone.state.doc.line(2).from + 5, insert: '\n  ' } });
		for (let i = 0; i < 50 && blueTop() <= previousBlueTop; i++) await new Promise(resolve => setTimeout(resolve, 20));
		assert(blueTop() > previousBlueTop && await waitForColors([red, green, blue]),
			'splitting a line moves tokens and preserves the enclosing structure');
		standalone.dispatch({ changes: { from: standalone.state.doc.line(2).from + 2, insert: '\n' } });
		assert(await waitForColors([], [red, green, blue]),
			'splitting an identifier conservatively invalidates affected structure');
		standalone.dispatch({
			changes: { from: 0, to: standalone.state.doc.length, insert: 'start\n// hidden code\nfinish' },
			userEvent: 'load',
		});
		standalone.dispatch({ effects: setStructure.of([token(0, '#ff0000'), token(2, '#0000ff')]) });
		assert(await waitForColors([red, blue]), 'structure is painted before splitting a line comment');
		standalone.dispatch({ changes: { from: standalone.state.doc.line(2).from + 9, insert: '\n' } });
		assert(await waitForColors([red], [blue]),
			'splitting a line comment invalidates later structure');
		standalone.dispatch({ userEvent: 'load' });
		assert(await waitForPaint(false), 'load clears retained structure');
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
		numbersHost.style.setProperty('--croq-function-number-color', '#123456');
		numbersHost.style.setProperty('--croq-function-line-color', '#234567');
		numbersHost.style.setProperty('--croq-function-number-padding', '0 9px 0 6px');
		numbersHost.style.setProperty('--croq-function-gutter-min-width', '48px');
		numbersHost.style.setProperty('--croq-function-gutter-edge-width', '21px');
		numbersHost.style.setProperty('--croq-function-stripe-width', '5px');
		numbersHost.style.setProperty('--croq-function-stripe-color', '#bcdef0');
		numbersHost.style.setProperty('--croq-function-alternate-background', '#345678');
		numbersHost.style.setProperty('--croq-mirror-lint-gutter-width', '8px');
		const edge = getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after');
		assert(getComputedStyle(gutter.querySelector('.cm-function-number')).color === 'rgb(18, 52, 86)' &&
			getComputedStyle(gutter.querySelector('.cm-function-number')).paddingLeft === '6px' &&
			getComputedStyle(gutter.querySelector('.cm-croq-line-number')).color === 'rgb(35, 69, 103)' &&
			getComputedStyle(visible[0]).minWidth === '48px' && edge.width === '21px' &&
			edge.backgroundImage.includes('5px') && edge.backgroundImage.includes('188, 222, 240') &&
			getComputedStyle(firstSection, '::before').backgroundColor === 'rgb(52, 86, 120)' &&
			getComputedStyle(firstSection, '::before').left === '-8px',
			'function gutter colors, dimensions and stripes respond to custom properties');
		numbersHost.style.setProperty('--croq-function-gutter-edge-pattern', 'none');
		numbersHost.style.setProperty('--croq-function-gutter-edge-color', '#456789');
		assert(getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after').backgroundImage === 'none' &&
			getComputedStyle(numbersHost.querySelector('.cm-gutters'), '::after').backgroundColor === 'rgb(69, 103, 137)',
			'function gutter edge pattern and color can be overridden');
		numbers.dispatch({ changes: { from: 0, insert: 'x' } });
		await new Promise(resolve => setTimeout(resolve, 100));
		assert(getSectionLineNumber(numbers.state, 31).join() === '0,32', 'editing clears stale standalone numbering');
		numbers.dispatch({ effects: numbersCompartment.reconfigure([]) });
		assert(!numbersHost.querySelector('.cm-sectionNumbers'),
			'removing the function line-number extension removes its UI');
		numbers.dispatch({ effects: numbersCompartment.reconfigure(functionLineNumbers) });
		numbers.dispatch({ effects: setSectionStarts.of([1]) });
		assert(numbersHost.querySelector('.cm-function-number')?.textContent === '1',
			'reinstalling the function line-number extension accepts fresh section data');
	} finally {
		numbers.destroy();
		numbersHost.remove();
	}

	const markersHost = document.createElement('div');
	markersHost.style.cssText = 'height:150px;width:500px';
	document.body.prepend(markersHost);
	const markersCompartment = new Compartment();
	const markerDoc = Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\n');
	const markers = new EditorView({
		state: EditorState.create({
			doc: markerDoc,
			extensions: [
				commonAnalysisState,
				markersCompartment.of(functionScrollMarkers),
				EditorView.theme({ '&': { height: '150px', width: '500px' }, '.cm-scroller': { overflow: 'auto' } }),
			],
		}),
		parent: markersHost,
	});
	try {
		markersHost.style.setProperty('--croq-function-scroll-marker-track-width', '16px');
		markersHost.style.setProperty('--croq-function-scroll-marker-inset', '3px');
		markersHost.style.setProperty('--croq-function-scroll-marker-radius', '25%');
		markersHost.style.setProperty('--croq-function-scroll-marker-z-index', '6');
		markersHost.style.setProperty('--croq-function-scroll-marker-color', '#102030');
		markers.dispatch({ effects: setCommonAnalysis.of(createCommonAnalysis({
			version: 1, sourceLength: markerDoc.length, complete: true,
			structures: [], declarations: [], syntax: [], references: [],
			sections: [
				{ kind: 'function', from: markerDoc.indexOf('line 1') },
				{ kind: 'function', from: markerDoc.indexOf('line 30') },
			],
		})) });
		await new Promise(resolve => setTimeout(resolve, 300));
		const track = markersHost.querySelector('.cm-editor > .cm-function-scroll-markers');
		const marker = track?.querySelector('span');
		assert(markersHost.querySelectorAll('.cm-function-scroll-markers > span').length === 2 &&
			!markersHost.querySelector('.cm-sectionNumbers'),
			'standalone scroll markers consume common sections without the line-number extension');
		assert(getComputedStyle(track).width === '16px' && getComputedStyle(track).zIndex === '6' &&
			getComputedStyle(marker).left === '3px' && getComputedStyle(marker).borderRadius === '25%' &&
			getComputedStyle(marker).backgroundColor === 'rgb(16, 32, 48)',
			'standalone scroll markers respond to their independent custom properties');
		markers.dispatch({ effects: markersCompartment.reconfigure([]) });
		assert(!markersHost.querySelector('.cm-function-scroll-markers'),
			'removing the scroll-marker extension removes its DOM');
	} finally {
		markers.destroy();
		markersHost.remove();
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
		assert(selectionText() === 'one\ntwo\nthree\n' && !mode(),
			'gutter dragging selects complete lines in reverse: ' + JSON.stringify(selectionText()) + ', mode=' + mode());
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

	const syntaxHost = document.createElement('div');
	document.body.prepend(syntaxHost);
	const syntaxCompartment = new Compartment();
	const syntaxView = new EditorView({
		state: EditorState.create({
			doc: 'class Example',
			extensions: [commonAnalysisState, syntaxCompartment.of(syntaxHighlightingExtension)],
		}),
		parent: syntaxHost,
	});
	try {
		syntaxHost.style.setProperty('--croq-syntax-keyword-color', '#123456');
		syntaxView.dispatch({ effects: setSyntaxHighlights.of([{ from: 0, to: 5, kind: 'keyword' }, { from: 6, to: 13, kind: 'type' }]) });
		const keyword = syntaxHost.querySelector('.cm-syntax-keyword');
		const type = syntaxHost.querySelector('.cm-syntax-type');
		assert(keyword?.textContent === 'class' && type?.textContent === 'Example' &&
			getComputedStyle(keyword).color === 'rgb(18, 52, 86)',
			'standalone syntax extension renders supplied token ranges and custom colors');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([
			syntaxHighlightingExtension, syntaxHighlightingOptions({ syntax: true, semantic: false }),
		]) });
		syntaxView.dispatch({ effects: setSyntaxHighlights.of([
			{ from: 0, to: 5, kind: 'keyword' }, { from: 6, to: 13, kind: 'local-reference' },
		]) });
		assert(syntaxHost.querySelector('.cm-syntax-keyword') && !syntaxHost.querySelector('.cm-syntax-local-reference'),
			'syntax coloring can be enabled without semantic highlighting');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([
			syntaxHighlightingExtension, syntaxHighlightingOptions({ syntax: false, semantic: true }),
		]) });
		assert(!syntaxHost.querySelector('.cm-syntax-keyword') && syntaxHost.querySelector('.cm-syntax-local-reference'),
			'semantic highlighting can be enabled without syntax coloring');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([
			syntaxHighlightingExtension, syntaxHighlightingOptions({ syntax: false, semantic: false }),
		]) });
		assert(!syntaxHost.querySelector('.cm-syntax-keyword, .cm-syntax-local-reference'),
			'disabling both highlighting categories removes their decorations');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure(syntaxHighlightingExtension) });
		syntaxView.dispatch({ changes: { from: 0, insert: ' ' } });
		assert(!syntaxHost.querySelector('.cm-syntax-keyword, .cm-syntax-type'),
			'syntax highlighting clears stale ranges on document edits');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([
			syntaxHighlightingExtension,
			syntaxHighlightingSource(state => {
				const from = state.doc.toString().indexOf('class');
				return from < 0 ? [] : [{ from, to: from + 5, kind: 'local-reference' }];
			}),
		]) });
		syntaxHost.style.setProperty('--croq-syntax-local-variable-color', '#234567');
		const reference = syntaxHost.querySelector('.cm-syntax-local-reference');
		assert(reference?.textContent === 'class' && getComputedStyle(reference).color === 'rgb(35, 69, 103)',
			'standalone syntax source supplies ranges and supports local-reference color');
		syntaxView.dispatch({ changes: { from: 1, to: 6, insert: 'other' } });
		assert(!syntaxHost.querySelector('.cm-syntax-local-reference'),
			'synchronous syntax source refreshes after edits');
		syntaxView.dispatch({
			changes: { from: 0, to: syntaxView.state.doc.length, insert: 'class Example' },
			userEvent: 'load',
			effects: syntaxCompartment.reconfigure([
				syntaxHighlightingExtension,
				syntaxHighlightingSource(state => {
					const ranges = [];
					for (const [text, kind] of [['class', 'keyword'], ['Example', 'type'], ['new', 'literal']]) {
						const from = state.doc.toString().indexOf(text);
						if (from >= 0) ranges.push({ from, to: from + text.length, kind });
					}
					return ranges;
				}, () => false, { retainOnEdit: true }),
			]),
		});
		syntaxView.dispatch({ effects: setSyntaxHighlights.of([
			{ from: 0, to: 5, kind: 'comment' }, { from: 6, to: 13, kind: 'local-reference' },
		]) });
		assert(syntaxHost.querySelector('.cm-syntax-comment')?.textContent === 'class' &&
			!syntaxHost.querySelector('.cm-syntax-keyword, .cm-syntax-type'),
			'current supplied syntax takes priority over an interim source');
		syntaxView.dispatch({ changes: { from: syntaxView.state.doc.length, insert: ' new' } });
		assert(syntaxHost.querySelector('.cm-syntax-comment')?.textContent === 'class' &&
			syntaxHost.querySelector('.cm-syntax-local-reference')?.textContent === 'Example' &&
			syntaxHost.querySelector('.cm-syntax-literal')?.textContent === 'new',
			'retained syntax survives edits while the interim source colors uncovered text');
		syntaxView.dispatch({ effects: setSyntaxHighlights.of([
			{ from: 0, to: 5, kind: 'keyword' }, { from: 6, to: 13, kind: 'type' },
		]) });
		assert(syntaxHost.querySelector('.cm-syntax-keyword')?.textContent === 'class' &&
			!syntaxHost.querySelector('.cm-syntax-comment, .cm-syntax-local-reference, .cm-syntax-literal'),
			'fresh supplied syntax replaces retained and interim decorations');
		syntaxView.dispatch({
			changes: { from: 0, to: syntaxView.state.doc.length, insert: 'class Example' },
			userEvent: 'load',
		});
		assert(syntaxHost.querySelector('.cm-syntax-keyword')?.textContent === 'class' &&
			syntaxHost.querySelector('.cm-syntax-type')?.textContent === 'Example',
			'loading clears retained syntax and restores the interim source');
		syntaxView.dispatch({
			changes: { from: 0, to: syntaxView.state.doc.length, insert: 'word\nold' },
			userEvent: 'load',
			effects: syntaxCompartment.reconfigure([
				syntaxHighlightingExtension,
				syntaxHighlightingSource(state => {
					const line = state.doc.line(1);
					return line.text.startsWith('//') ? [{ from: line.from, to: line.to, kind: 'comment' }] : [];
				}, () => false, { retainOnEdit: true, reconcileComments: state => state.doc.line(1).to }),
			]),
		});
		syntaxView.dispatch({ effects: setSyntaxHighlights.of([
			{ from: 0, to: 4, kind: 'keyword' }, { from: 5, to: 8, kind: 'comment' },
		]) });
		syntaxView.dispatch({ changes: { from: 0, insert: '//' } });
		assert([...syntaxHost.querySelectorAll('.cm-syntax-comment')].map(node => node.textContent).join('|') ===
			'//word|old' && !syntaxHost.querySelector('.cm-syntax-keyword'),
			'current comments override retained code without clearing comments beyond the parsed region');
		syntaxView.dispatch({ changes: { from: 0, to: 2 } });
		assert(syntaxHost.querySelector('.cm-syntax-keyword')?.textContent === 'word' &&
			syntaxHost.querySelector('.cm-syntax-comment')?.textContent === 'old',
			'removing a provisional comment restores retained code and preserves unparsed comments');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([]) });
		assert(!syntaxHost.querySelector('style'),
			'removing syntax highlighting removes its stylesheet');
		syntaxView.dispatch({
			changes: { from: 0, to: syntaxView.state.doc.length, insert: 'class Example' },
			userEvent: 'load',
		});
		syntaxView.dispatch({ effects: setCommonAnalysis.of({
			version: 1, sourceLength: 13, complete: true, structures: [], declarations: [],
			syntax: [{ from: 0, to: 5, kind: 'keyword' }], references: [
				{ from: 6, to: 13, role: 'definition', scope: 'unknown' },
			], sections: [],
		}) });
		const enabledSyntax = [
			syntaxHighlightingExtension, syntaxHighlightingOptions({ syntax: true, semantic: true }),
		];
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure(enabledSyntax) });
		const restoredKeyword = syntaxHost.querySelector('.cm-syntax-keyword')?.textContent;
		const restoredDefinition = syntaxHost.querySelector('.cm-syntax-definition')?.textContent;
		assert(restoredKeyword === 'class' && restoredDefinition === 'Example',
			`re-enabling syntax and semantic highlighting restores current common analysis immediately (${restoredKeyword}, ${restoredDefinition})`);
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([
			syntaxHighlightingExtension, syntaxHighlightingOptions({ syntax: false, semantic: true }),
		]) });
		assert(!syntaxHost.querySelector('.cm-syntax-keyword') && syntaxHost.querySelector('.cm-syntax-definition'),
			'semantic highlights restore independently from common analysis');
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure([]) });
		syntaxView.dispatch({ effects: syntaxCompartment.reconfigure(enabledSyntax) });
		assert(syntaxHost.querySelector('.cm-syntax-keyword')?.textContent === 'class' &&
			syntaxHost.querySelector('.cm-syntax-definition')?.textContent === 'Example',
			're-adding the extension reconstructs decorations from the existing common snapshot');
	} finally {
		syntaxView.destroy();
		syntaxHost.remove();
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
		supportsFunctionSections: true,
		extensions: [],
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
		const settings = {
			analysis: true, functionLineNumbers: true, functionScrollMarkers: false, completion: true,
			structureHighlight: true, declarationHighlight: true, syntaxHighlight: true,
			semanticHighlight: true, bracketMatching: true, lineWrapping: false, rulers: false,
			autoIndent: false, fontSize: 16, fontFamily: 'monospace', lineHeight: 165,
			disabled: false, readOnly: false,
		};
		const diagnostics = () => [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, severity: 'error', message: 'Generic diagnostic' }];
		const phrases = {};
		view.setOptions(settings, phrases, diagnostics);
		view.loadDocument('abc\ndef\nghi');
		view.view.focus();
		const activeLines = () => [...root.querySelectorAll('.cm-content .cm-activeLine')];
		const activeGutters = () => [...root.querySelectorAll('.cm-sectionNumbers .cm-activeLineGutter')];
		assert(activeLines().length === 1 && activeGutters().length === 1,
			'collapsed selection highlights the current line and section gutter');
		for (const selection of [
			EditorSelection.single(0, 2), EditorSelection.single(8, 1),
			EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.cursor(5)]),
		]) {
			view.view.dispatch({ selection });
			assert(!activeLines().length && !activeGutters().length,
				'any nonempty selection hides active-line and gutter highlighting');
		}
		view.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]) });
		assert(activeLines().length === 2 && activeGutters().length === 2,
			'multiple empty cursors highlight their respective lines and gutters');
		view.view.dispatch({ selection: { anchor: 4 } });
		assert(activeLines().length === 1 && activeLines()[0].textContent === 'def' && activeGutters().length === 1,
			'collapsing a selection restores the current line and gutter');
		view.setDefinitions(['opaque definition']);
		assert(definitions[0] === 'opaque definition', 'view forwards definitions without interpreting them');
		view.setCommonAnalysis(createCommonAnalysis({
			version: 1, sourceLength: 11, complete: true,
			structures: [{ kind: 'function', from: 0, to: 11, branches: [] }],
			declarations: [{ kind: 'variable', from: 4, to: 7, mutability: 'immutable', scope: 'lexical' }],
			syntax: [], references: [], sections: [{ kind: 'function', from: 4 }],
		}));
		assert(view.getSectionLineNumber(0).join() === '0,1' && view.getSectionLineNumber(2).join() === '1,2', 'view numbers sections from language-neutral data');
		assert(root.querySelector('.cm-function-number')?.textContent === '1', 'view renders section start markers');
		view.setOptions({ ...settings, functionLineNumbers: false }, phrases, diagnostics);
		assert(view.getSectionLineNumber(2).join() === '1,2' && root.querySelector('.cm-lineNumbers'),
			'section data remains available while ordinary numbering is displayed');
		view.setOptions(settings, phrases, diagnostics);
		assert(root.querySelector('.cm-function-number')?.textContent === '1',
			'switching back restores the current section numbering');
		await new Promise(resolve => setTimeout(resolve, 450));
		const canvas = root.querySelector('canvas');
		assert(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value),
			'view draws structure and declaration data from shared analysis');
		view.setOptions({ ...settings, functionScrollMarkers: true }, phrases, diagnostics);
		const scrollMarkers = root.querySelector('.cm-function-scroll-markers');
		const canvasAfterMarkerChange = root.querySelector('canvas');
		view.setOptions({ ...settings, functionScrollMarkers: true, fontSize: 18 }, phrases, diagnostics);
		assert(scrollMarkers && root.querySelector('.cm-function-scroll-markers') === scrollMarkers &&
			root.querySelector('canvas') === canvasAfterMarkerChange,
			`font-only settings preserve existing marker and canvas plugin instances (marker=${!!scrollMarkers}/${root.querySelector('.cm-function-scroll-markers') === scrollMarkers}, canvas=${root.querySelector('canvas') === canvasAfterMarkerChange})`);
		await new Promise(resolve => setTimeout(resolve, 200));
		assert(root.querySelector('.cm-lint-marker-error'), 'view renders generic diagnostics');
		view.view.dispatch({ selection: { anchor: 3 } });
		view.complete();
		await new Promise(resolve => setTimeout(resolve, 200));
		assert(root.querySelector('.cm-tooltip-autocomplete')?.textContent.includes('Generic candidate'), 'view displays generic completion candidates');
		view.closeCompletion();
		view.format();
		assert(view.view.state.doc.line(1).text === 'ABC', 'view applies language formatting result');
		view.setOptions({ ...settings, readOnly: true }, phrases, diagnostics);
		view.view.dispatch({ selection: { anchor: 7 } });
		view.format();
		assert(view.view.state.doc.line(2).text === 'def', 'read-only blocks language formatting edits');
		view.setCommonAnalysis(null);
		assert(view.getSectionLineNumber(2).join() === '0,3', 'clearing common analysis restores absolute numbering');
	} finally {
		view.destroy();
		root.remove();
	}
	assert(disposed, 'view disposes language session');
}
