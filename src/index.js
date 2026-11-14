import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Editor, offsetAt, positionAt } from './editor-view.js';
import { javascriptLanguage } from './lang/js/index.js';
import { javaLanguage } from './lang/java/index.js';
import { plainLanguage } from './lang/plain/index.js';
import english from './res/lang.en.json';
import japanese from './res/lang.ja.json';

// Default settings ------------------------------------------------------------

const mounted = new WeakSet();
const LANGUAGES = { en: english, ja: japanese };
const DEFAULT_SETTINGS = {
	language            : 'en',
	codeLanguage        : 'javascript',
	fontFamily          : 'monospace',
	fontSize            : 16,
	lineHeight          : 165,
	lineWrapping        : false,
	structureHighlight  : true,
	declarationHighlight: true,
	syntaxHighlight     : true,
	semanticHighlight   : true,
	functionLineNumbers : false,
	functionScrollMarkers: false,
	bracketMatching     : true,
	rulers              : true,
	autoIndent          : true,
	autoFormat          : true,
	formatting          : true,
	completion          : true,
	diagnostics         : true,
	analysis            : true,
	analysisDelay       : 600,
	readOnly            : false,
	disabled            : false,
};

function validate(options) {
	for (const [key, value] of Object.entries(options)) {
		if (!(key in DEFAULT_SETTINGS)) throw new TypeError(`Unknown setting: ${key}`);
		if (key === 'codeLanguage') {
			if (value !== null && !['javascript', 'java'].includes(value)) throw new TypeError('codeLanguage must be javascript, java, or null');
			continue;
		}
		if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new TypeError(`Invalid setting: ${key}`);
		if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`Invalid number: ${key}`);
	}
	if (options.language !== undefined && !['ja', 'en'].includes(options.language)) throw new TypeError('language must be ja or en');
	if (options.analysisDelay < 0 || options.lineHeight <= 0) throw new RangeError('Invalid delay or line height');
	if (options.fontSize !== undefined && (options.fontSize < 10 || options.fontSize > 64)) throw new RangeError('fontSize must be between 10 and 64');
}

// Editor lifecycle ------------------------------------------------------------

/** Creates an editor in an empty, sized container. See README.md for the API contract. */
export async function createEditor(container, { value = '', definitions = [], ...options } = {}) {
	if (!container || container.nodeType !== 1 || container.ownerDocument !== document) throw new TypeError('A container in the current document is required');
	if (mounted.has(container) || container.childNodes.length) throw new Error('Container must be empty and unoccupied');
	validate(options);
	const initialDefinitions = structuredClone(definitions);
	if (!Array.isArray(initialDefinitions)) throw new TypeError('definitions must be an array');
	mounted.add(container);
	const root = document.createElement('div');
	root.className = 'croq-mirror';
	container.append(root);
	const language = options.codeLanguage === null ? plainLanguage : options.codeLanguage === 'java' ? javaLanguage : javascriptLanguage;
	let view, client, observer, timer, destroyed = false;
	let settings = { ...DEFAULT_SETTINGS, ...options };
	const diagnosticSource = text => language.diagnostics(text, settings.language);
	let version      = 0;
	let analysis     = null;
	let loading      = false;
	let programmatic = false;
	let composing    = false;
	const listeners = new Map();
	const abort = new AbortController();
	let markerId = 0;

	function assertAlive() {
		if (destroyed) throw new Error('Editor destroyed');
	}

	function emit(type, data) {
		for (const listener of listeners.get(type) || []) {
			try {
				listener(structuredClone(data));
			} catch (error) {
				console.error('croq-mirror event listener failed', error);
			}
		}
	}

	function dispose() {
		if (destroyed) return;
		destroyed = true;
		clearTimeout(timer);
		abort.abort();
		observer?.disconnect();
		client?.destroy();
		view?.destroy();
		listeners.clear();
		root.remove();
		mounted.delete(container);
	}
	try {
		client = language.createAnalysisClient();
		await client.ready;
		view = new Editor({
			language,
			phrases: LANGUAGES[settings.language].editorPhrase,
			allowChanges: () => loading || programmatic || (!settings.readOnly && !settings.disabled),
			onUpdate: handleUpdate,
			onFontSizeChange(delta) {
				api.setSettings({ fontSize: Math.min(64, Math.max(10, settings.fontSize + delta)) });
			},
		}, root);
		const cm = view.view;
		view.setDefinitions(initialDefinitions);
		const state = () => ({
			version,
			readOnly : settings.readOnly,
			disabled : settings.disabled,
			canUndo  : view.historySize().undo > 0,
			canRedo  : view.historySize().redo > 0,
		});

		function setFormatState() {
			view.autoFormat = settings.autoFormat && settings.formatting && !loading && !programmatic && !composing;
		}

		function applySettings() {
			setFormatState();
			if (settings.disabled) cm.contentDOM.blur();
			root.inert = settings.disabled;
			root.setAttribute('aria-disabled', String(settings.disabled));
			view.setOptions(settings, LANGUAGES[settings.language].editorPhrase, settings.diagnostics ? diagnosticSource : null);
		}

		function schedule() {
			clearTimeout(timer);
			if (!settings.analysis || composing || destroyed) return;
			timer = setTimeout(() => {
				requestAnalysis().catch(error => {
					if (!destroyed) emit('error', { message: error.message });
				});
			}, settings.analysisDelay);
		}
		async function requestAnalysis() {
			assertAlive();
			const result = await client.request(cm.state.doc.toString(), version);
			if (result === null) return null;
			if (!destroyed && result.version === version && settings.analysis) {
				view.setCommonAnalysis({ ...result.commonAnalysis, version });
				const snapshot = publicAnalysis(result);
				analysis = structuredClone(snapshot);
				emit('analysis', snapshot);
			}
			return structuredClone(publicAnalysis(result));
		}

		function handleUpdate(before, transactions) {
			const transaction = transactions.at(-1);
			if (!transaction) return;
			const changed = transaction.docChanged || transaction.isUserEvent('load');
			const { doc, selection } = transaction.state;
			if (changed) {
				version++;
				analysis = null;
				schedule();
				if (!loading) emit('change', { origin: 'edit', source: changeSource(transaction), version, text: doc.toString() });
			}
			if (changed && !loading) emit('state', state());
			if (changed || !selection.eq(before.selection)) {
				emit('selection', { ranges: selection.ranges.map(({ anchor, head }) => ({
					anchor: positionAt(doc, anchor), head: positionAt(doc, head),
				})) });
			}
		}
		for (const type of ['focus', 'blur']) {
			cm.contentDOM.addEventListener(type, () => emit(type, {}), { signal: abort.signal });
		}
		for (const type of ['copy', 'cut']) {
			cm.contentDOM.addEventListener(type, () => emit(type, { text: selectionText() }), { signal: abort.signal, capture: true });
		}
		function selectionText() {
			const { doc, selection } = cm.state;
			return selection.ranges.map(({ from, to }) => doc.sliceString(from, to)).join('\n');
		}
		root.addEventListener('compositionstart', () => {
			composing = true;
			setFormatState();
			clearTimeout(timer);
			view.closeCompletion();
			view.composing = true;
			cm.dom.classList.add('ime');
		}, { signal: abort.signal });
		root.addEventListener('compositionend', () => {
			composing = false;
			setFormatState();
			view.composing = false;
			cm.dom.classList.remove('ime');
			schedule();
		}, { signal: abort.signal });
		observer = new ResizeObserver(() => {
			if (!destroyed) view.refresh();
		});
		observer.observe(container);

		function edit(fn) {
			assertAlive();
			programmatic = true;
			setFormatState();
			try {
				fn();
			} finally {
				programmatic = false;
				setFormatState();
			}
		}
		// Public API ----------------------------------------------------------

		const api = {
			getValue() {
				assertAlive();
				return cm.state.doc.toString();
			},
			getLineCount() {
				assertAlive();
				return cm.state.doc.lines;
			},
			loadDocument(text) {
				assertAlive();
				loading = true;
				setFormatState();
				try {
					view.loadDocument(String(text));
				} finally {
					loading = false;
					setFormatState();
				}
				emit('change', { origin: 'load', version, text: cm.state.doc.toString() });
				emit('state', state());
				schedule();
			},
			replaceDocument(text) {
				edit(() => cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: String(text) }, userEvent: 'api' }));
			},
			replaceRange(text, from, to = from) {
				edit(() => {
					const start = offsetAt(cm.state.doc, from), end = offsetAt(cm.state.doc, to);
					cm.dispatch({ changes: { from: Math.min(start, end), to: Math.max(start, end), insert: String(text) }, userEvent: 'api' });
				});
			},
			getSelection() {
				assertAlive();
				return selectionText();
			},
			setLineSelectionMode(enabled) {
				assertAlive();
				view.setLineSelectionMode(enabled);
			},
			replaceSelection(text) {
				edit(() => {
					const { state } = cm;
					const insert = state.toText(String(text));
					cm.dispatch(state.changeByRange(range => ({
						changes: { from: range.from, to: range.to, insert },
						range: EditorSelection.range(range.from, range.from + insert.length),
					})), { userEvent: 'api' });
				});
			},
			getState() {
				assertAlive();
				return state();
			},
			getSettings() {
				assertAlive();
				return { ...settings };
			},
			setSettings(patch) {
				assertAlive();
				validate(patch);
				if ('codeLanguage' in patch && patch.codeLanguage !== settings.codeLanguage) {
					throw new TypeError('codeLanguage can only be selected when creating an editor');
				}
				const wasAnalyzing = settings.analysis;
				const delayChanged = Object.hasOwn(patch, 'analysisDelay') && patch.analysisDelay !== settings.analysisDelay;
				settings = { ...settings, ...patch };
				if (!settings.analysis) {
					clearTimeout(timer);
					analysis = null;
					view.setCommonAnalysis(null);
				}
				applySettings();
				if (settings.analysis && (!wasAnalyzing || delayChanged)) schedule();
				emit('settings', settings);
				emit('state', state());
			},
			setDefinitions(defs) {
				assertAlive();
				if (!Array.isArray(defs)) throw new TypeError('definitions must be an array');
				view.setDefinitions(structuredClone(defs));
			},
			getAnalysis() {
				assertAlive();
				return structuredClone(analysis);
			},
			analyzeNow() {
				clearTimeout(timer);
				return requestAnalysis();
			},
			on(type, listener) {
				assertAlive();
				if (typeof listener !== 'function') throw new TypeError('listener must be a function');
				if (!listeners.has(type)) listeners.set(type, new Set());
				listeners.get(type).add(listener);
				return () => listeners.get(type)?.delete(listener);
			},
			execute(command) {
				assertAlive();
				const commands = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'toggleComment', 'format', 'find', 'findNext', 'replace', 'complete'];
				if (!commands.includes(command)) throw new TypeError(`Unknown command: ${command}`);
				if (settings.disabled) return;
				if (settings.readOnly && ['undo', 'redo', 'cut', 'paste', 'toggleComment', 'format', 'replace', 'complete'].includes(command)) return;
				if (['cut', 'copy', 'paste'].includes(command)) {
					cm.focus();
					document.execCommand(command);
					return;
				}
				if (command === 'format' && !settings.formatting) return;
				view[command]();
			},
			focus() {
				assertAlive();
				if (!settings.disabled) cm.focus();
			},
			blur() {
				assertAlive();
				cm.contentDOM.blur();
			},
			hasFocus() {
				assertAlive();
				return cm.hasFocus;
			},
			moveTo(position, { focus = true } = {}) {
				assertAlive();
				if (settings.disabled) return;
				const anchor = offsetAt(cm.state.doc, position);
				cm.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { yMargin: 32 }) });
				if (focus) cm.focus();
			},
			highlightLine(line) {
				assertAlive();
				if (!Number.isInteger(line) || line < 0 || line >= cm.state.doc.lines) throw new RangeError('Invalid line');
				const id = ++markerId;
				view.highlightLine(id, line);
				return id;
			},
			clearHighlight(id) {
				assertAlive();
				view.clearHighlight(id);
			},
			getFunctionLineNumber(line) {
				assertAlive();
				if (!Number.isInteger(line) || line < 0 || line >= cm.state.doc.lines) throw new RangeError('Invalid line');
				return view.getSectionLineNumber(line);
			},
			refresh() {
				assertAlive();
				view.refresh();
			},
			destroy: dispose,
		};
		applySettings();
		api.loadDocument(value);
		if (settings.analysis) await api.analyzeNow();
		return api;
	} catch (error) {
		dispose();
		throw error;
	}
}

function publicAnalysis(result) {
	if (!Object.hasOwn(result, 'commonAnalysis')) return result;
	const snapshot = { ...result };
	delete snapshot.commonAnalysis;
	return snapshot;
}

function changeSource(transaction) {
	for (const event of ['api', 'undo', 'redo']) if (transaction.isUserEvent(event)) return event;
	if (transaction.isUserEvent('format')) return 'format';
	if (transaction.isUserEvent('input.paste')) return 'paste';
	if (transaction.isUserEvent('delete.cut')) return 'cut';
	if (transaction.isUserEvent('input.complete')) return 'complete';
	if (transaction.isUserEvent('input')) return '+input';
	if (transaction.isUserEvent('delete')) return '+delete';
}
