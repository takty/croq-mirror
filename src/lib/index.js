import { Editor } from './editor-view.js';
import { CodeMirror, lintEn, lintJa } from './vendor.js';
import { RESOURCES } from './defaults.js';
import { AnalysisClient } from './analysis-client.js';

// Default settings ------------------------------------------------------------

const mounted = new WeakSet();
const DEFAULT_SETTINGS = {
	language            : 'ja',
	fontFamily          : 'CroqInconsolata, "Hiragino Sans", "BIZ UDGothic", "Yu Gothic Medium", Meiryo, monospace',
	fontSize            : 16,
	lineHeight          : 165,
	lineWrapping        : false,
	functionLineNumbers : false,
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
	let view, client, observer, timer, destroyed = false;
	let settings = { ...DEFAULT_SETTINGS, ...options };
	let version      = 0;
	let analysis     = null;
	let loading      = false;
	let programmatic = false;
	let composing    = false;
	const listeners = new Map();
	const abort = new AbortController();
	const markers = new Map();
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
		markers.clear();
		listeners.clear();
		root.remove();
		mounted.delete(container);
	}
	try {
		client = new AnalysisClient(new Worker(new URL('./analysis-worker.min.js', import.meta.url), { type: 'module' }));
		await client.ready;
		const owner = {
			_res: { ...RESOURCES, editorPhrase: settings.language === 'ja' ? RESOURCES.editorPhrase : {} },
			executeCommand(command) {
				api.setSettings({ fontSize: Math.min(64, Math.max(10, settings.fontSize + (command === 'fontSizePlus' ? 2 : -2))) });
			},
		};
		view = new Editor(owner, root);
		const cm = view.getComponent();
		view.updateAutoComplete(initialDefinitions);
		const state = () => ({
			version,
			readOnly : settings.readOnly,
			disabled : settings.disabled,
			canUndo  : cm.historySize().undo > 0,
			canRedo  : cm.historySize().redo > 0,
		});

		function setFormatState() {
			view._autoFormat = settings.autoFormat && settings.formatting && !loading && !programmatic && !composing;
		}

		function setLint() {
			cm.setOption('lint', settings.diagnostics ? {
				options: { ...RESOURCES.jsHintOpt, indent: 1 },
				getAnnotations(text, options) {
					const lint = settings.language === 'ja' ? lintJa : lintEn;
					lint(text, options);
					return (lint.errors || []).filter(e => e && e.line > 0).map(e => ({
						message  : e.reason,
						severity : e.code?.startsWith('W') ? 'warning' : 'error',
						from     : CodeMirror.Pos(e.line - 1, Math.max(0, e.character - 1)),
						to       : CodeMirror.Pos(e.line - 1, Math.max(1, e.character)),
					}));
				},
			} : false);
		}

		function applySettings() {
			view._completion = settings.completion;
			if (!settings.completion || settings.disabled || settings.readOnly) cm.closeHint?.();
			setFormatState();
			view.autoIndentEnabled(settings.autoIndent);
			view.fontFamily(settings.fontFamily);
			view.fontSize(settings.fontSize);
			view.lineHeight(settings.lineHeight + '%');
			view.lineWrapping(settings.lineWrapping);
			view.rulerEnabled(settings.rulers);
			view.readOnly(settings.readOnly);
			view.enabled(!settings.disabled);
			root.inert = settings.disabled;
			root.setAttribute('aria-disabled', String(settings.disabled));
			if (settings.disabled) cm.getInputField().blur();
			cm.setOption('phrases', settings.language === 'ja' ? RESOURCES.editorPhrase : {});
			view.functionLineNumberEnabled(settings.analysis && settings.functionLineNumbers);
			setLint();
			view.refresh(true);
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
			const result = await client.request(cm.getValue(), version);
			if (!destroyed && result.version === version && settings.analysis) {
				analysis = structuredClone(result);
				view.setCodeStructureData(result);
				emit('analysis', result);
			}
			return structuredClone(result);
		}

		function clearMarkers() {
			for (const handle of markers.values()) cm.removeLineClass(handle, 'wrap', 'error-line');
			markers.clear();
		}
		cm.on('change', (_cm, change) => {
			version++;
			analysis = null;
			view.setCodeStructureData({});
			clearMarkers();
			schedule();
			if (!loading) emit('change', { origin: 'edit', source: change.origin, version, text: cm.getValue() });
		});
		cm.on('changes', () => {
			if (!loading) emit('state', state());
		});
		cm.on('cursorActivity', () => emit('selection', { ranges: cm.listSelections() }));
		cm.on('focus', () => emit('focus', {}));
		cm.on('blur', () => emit('blur', {}));
		root.addEventListener('compositionstart', () => {
			composing = true;
			setFormatState();
			clearTimeout(timer);
			cm.closeHint?.();
			view._elem.classList.add('ime');
		}, { signal: abort.signal });
		root.addEventListener('compositionend', () => {
			composing = false;
			setFormatState();
			view._elem.classList.remove('ime');
			schedule();
		}, { signal: abort.signal });
		// Search dialogs may still receive keyboard commands while the document is read-only.
		cm.on('beforeChange', (_cm, change) => {
			if (!loading && !programmatic && (settings.readOnly || settings.disabled)) change.cancel();
		});
		observer = new ResizeObserver(() => {
			if (!destroyed) view.refresh(true);
		});
		observer.observe(container);

		function edit(fn) {
			assertAlive();
			programmatic = true;
			setFormatState();
			try {
				cm.operation(fn);
			} finally {
				programmatic = false;
				setFormatState();
			}
		}
		// Public API ----------------------------------------------------------

		const api = {
			getValue() {
				assertAlive();
				return cm.getValue();
			},
			loadDocument(text) {
				assertAlive();
				loading = true;
				setFormatState();
				try {
					view.value(String(text));
					clearMarkers();
					analysis = null;
				} finally {
					loading = false;
					setFormatState();
				}
				emit('change', { origin: 'load', version, text: cm.getValue() });
				emit('state', state());
				schedule();
			},
			replaceDocument(text) {
				edit(() => {
					const last = cm.lastLine();
					cm.replaceRange(String(text), { line: 0, ch: 0 }, { line: last, ch: cm.getLine(last).length }, 'api');
				});
			},
			replaceRange(text, from, to = from) {
				edit(() => cm.replaceRange(String(text), from, to, 'api'));
			},
			getSelection() {
				assertAlive();
				return cm.getSelection();
			},
			setLineSelectionMode(enabled) {
				assertAlive();
				view.setLineSelectionMode(enabled);
			},
			replaceSelection(text) {
				edit(() => cm.replaceSelection(String(text), 'around', 'api'));
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
				settings = { ...settings, ...patch };
				if (!settings.analysis) {
					clearTimeout(timer);
					analysis = null;
					view.setCodeStructureData({});
				}
				applySettings();
				if (settings.analysis) schedule();
				emit('settings', settings);
				emit('state', state());
			},
			setDefinitions(defs) {
				assertAlive();
				if (!Array.isArray(defs)) throw new TypeError('definitions must be an array');
				cm.closeHint?.();
				view.updateAutoComplete(structuredClone(defs));
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
				const commands = ['undo', 'redo', 'selectAll', 'toggleComment', 'format', 'find', 'findNext', 'replace', 'complete'];
				if (!commands.includes(command)) throw new TypeError(`Unknown command: ${command}`);
				if (settings.disabled) return;
				if (settings.readOnly && ['undo', 'redo', 'toggleComment', 'format', 'replace', 'complete'].includes(command)) return;
				if (command === 'format' && !settings.formatting) return;
				if (command === 'complete') view._complete(cm, view._ternServer);
				else view[command]();
			},
			moveTo(position, { focus = true } = {}) {
				assertAlive();
				if (settings.disabled) return;
				cm.setCursor(position);
				cm.scrollIntoView(position, 32);
				if (focus) cm.focus();
			},
			highlightLine(line) {
				assertAlive();
				if (!Number.isInteger(line) || line < 0 || line > cm.lastLine()) throw new RangeError('Invalid line');
				const id = ++markerId;
				markers.set(id, cm.addLineClass(line, 'wrap', 'error-line'));
				return id;
			},
			clearHighlight(id) {
				assertAlive();
				const handle = markers.get(id);
				markers.delete(id);
				if (handle && ![...markers.values()].includes(handle)) cm.removeLineClass(handle, 'wrap', 'error-line');
			},
			getFunctionLineNumber(line) {
				assertAlive();
				if (!Number.isInteger(line) || line < 0 || line > cm.lastLine()) throw new RangeError('Invalid line');
				let number = 0,
					start = 0;
				for (const boundary of analysis?.fnStarts || []) {
					if (boundary > line) break;
					number++;
					start = boundary;
				}
				return [number, line - start + 1];
			},
			getCodeMirror() {
				assertAlive();
				return cm;
			},
			refresh() {
				assertAlive();
				view.refresh(true);
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
