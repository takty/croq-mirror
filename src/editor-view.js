import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, Text, Transaction, countColumn } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter, highlightWhitespace, keymap, showTooltip } from '@codemirror/view';
import {
	cursorDocEnd, cursorDocStart, cursorLineDown, cursorLineEnd, cursorLineStart, cursorLineUp,
	defaultKeymap, deleteLine, history, historyKeymap, indentLess, insertTab,
	redo, redoDepth, redoSelection, selectAll, selectDocEnd, selectDocStart, selectLineDown,
	selectLineEnd, selectLineStart, selectLineUp, toggleComment, undo, undoDepth,
} from '@codemirror/commands';
import { getIndentation, indentUnit } from '@codemirror/language';
import { acceptCompletion, autocompletion, closeBracketsKeymap, closeCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { forceLinting, lintGutter, linter, setDiagnostics } from '@codemirror/lint';
import { closeSearchPanel, findNext, findPrevious, highlightSelectionMatches, openSearchPanel, search, searchKeymap, searchPanelOpen } from '@codemirror/search';

import { drawStructure } from './structure-view.js';

const TAB_SIZE = 4;
const RULER_COLUMNS = [4, 8, 12];
const legacyKeymap = [
	{ key: 'Mod-d', run: deleteLine, preventDefault: true },
	{ win: 'Ctrl-Shift-z', run: redo, preventDefault: true },
	{ mac: 'Cmd-y', run: redo, preventDefault: true },
	{ key: 'Mod-Shift-u', run: redoSelection, preventDefault: true },
	{ win: 'Alt-ArrowLeft', linux: 'Alt-ArrowLeft', run: cursorLineStart, shift: selectLineStart },
	{ win: 'Alt-ArrowRight', linux: 'Alt-ArrowRight', run: cursorLineEnd, shift: selectLineEnd },
	{ win: 'Ctrl-ArrowUp', linux: 'Ctrl-ArrowUp', run: cursorLineUp, shift: selectLineUp },
	{ win: 'Ctrl-ArrowDown', linux: 'Ctrl-ArrowDown', run: cursorLineDown, shift: selectLineDown },
	{ mac: 'Ctrl-ArrowUp', run: cursorDocStart, shift: selectDocStart },
	{ mac: 'Ctrl-ArrowDown', run: cursorDocEnd, shift: selectDocEnd },
];
const setPresentation = StateEffect.define();
const setArgumentHint = StateEffect.define();
const addHighlight = StateEffect.define();
const removeHighlight = StateEffect.define();
const hasNoSelection = view => view.state.selection.ranges.every(range => range.empty);

const presentationField = StateField.define({
	create: () => null,
	update(value, transaction) {
		if (transaction.docChanged || transaction.isUserEvent('load')) value = null;
		for (const effect of transaction.effects) if (effect.is(setPresentation)) value = effect.value;
		return value;
	},
});

const highlightField = StateField.define({
	create: () => new Map(),
	update(value, transaction) {
		let next = transaction.docChanged || transaction.isUserEvent('load') ? new Map() : value;
		for (const effect of transaction.effects) {
			if (effect.is(addHighlight)) {
				if (next === value) next = new Map(value);
				next.set(effect.value.id, effect.value.position);
			} else if (effect.is(removeHighlight) && next.has(effect.value)) {
				if (next === value) next = new Map(value);
				next.delete(effect.value);
			}
		}
		return next;
	},
	provide: field => EditorView.decorations.from(field, markers => Decoration.set(
		[...new Set(markers.values())].map(position => Decoration.line({ class: 'error-line' }).range(position)),
		true,
	)),
});

const argumentHintField = StateField.define({
	create: () => null,
	update(value, transaction) {
		if (transaction.docChanged || transaction.selection || transaction.isUserEvent('load')) value = null;
		for (const effect of transaction.effects) if (effect.is(setArgumentHint)) value = effect.value;
		return value;
	},
	provide: field => showTooltip.from(field),
});

const sections = data => data?.sectionStarts || [];

function sectionNumber(starts, line) {
	let low = 0, high = starts.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (starts[middle] <= line) low = middle + 1;
		else high = middle;
	}
	return [low, line - (starts[low - 1] ?? 0) + 1];
}

class LineNumber extends GutterMarker {
	constructor(section, line) {
		super();
		this.section = section;
		this.line = line;
	}

	eq(other) {
		return this.section === other.section && this.line === other.line;
	}

	toDOM(view) {
		const element = view.dom.ownerDocument.createElement('span');
		const start = this.section > 0 && this.line === 1;
		element.className = start ? 'cm-function-number' : 'cm-croq-line-number';
		element.classList.toggle('cm-function-even', this.section % 2 !== 0);
		element.textContent = start ? this.section : this.line;
		return element;
	}
}

function widestLineNumber(doc) {
	return '9'.repeat(String(doc.lines).length);
}

function numberGutter(sectionMode) {
	return gutter({
		class: sectionMode ? 'cm-sectionNumbers' : 'cm-lineNumbers',
		lineMarker(view, block) {
			const line = view.state.doc.lineAt(block.from).number;
			return sectionMode
				? new LineNumber(...sectionNumber(sections(view.state.field(presentationField)), line - 1))
				: new LineNumber(0, line);
		},
		lineMarkerChange: update => sectionMode && update.startState.field(presentationField) !== update.state.field(presentationField),
		initialSpacer: view => new LineNumber(0, widestLineNumber(view.state.doc)),
		updateSpacer(spacer, { state }) {
			const number = widestLineNumber(state.doc);
			return spacer.line === number ? spacer : new LineNumber(0, number);
		},
	});
}

const absoluteGutter = numberGutter(false);
const sectionGutter = [numberGutter(true), EditorView.editorAttributes.of({ class: 'cm-section-mode' })];

export function offsetAt(doc, { line, ch }) {
	const row = doc.line(Math.max(1, Math.min(doc.lines, line + 1)));
	return row.from + Math.max(0, Math.min(row.length, ch ?? 0));
}

export function positionAt(doc, offset) {
	const line = doc.lineAt(offset);
	return { line: line.number - 1, ch: offset - line.from };
}

export class Editor {
	constructor({ language, phrases, onFontSizeChange, onUpdate, allowChanges = () => true }, parent) {
		this.language = language;
		this.enabled = true;
		this.readOnly = false;
		this.phrases = phrases;
		this.autoFormat = false;
		this.autoIndent = false;
		this.completion = true;
		this.rulers = true;
		this.sectionNumbers = false;
		this.changedLine = null;
		this.abort = new AbortController();
		this.session = language.createCompletionSession();
		this.history = new Compartment();
		this.options = {
			phrases: new Compartment(),
			wrapping: new Compartment(),
			numbers: new Compartment(),
			access: new Compartment(),
			diagnostics: new Compartment(),
		};
		const customKeys = [
			{ key: 'Ctrl-\\', run: () => this.complete() },
			{ key: 'Ctrl-Tab', run: () => this.complete() },
			{ key: 'Ctrl-g', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
			{ key: 'Cmd-g', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
			{ key: 'Ctrl-Shift-f', mac: 'Cmd-Alt-f', run: () => this.replace(), preventDefault: true },
			{ key: 'Tab', run: acceptCompletion },
			{ key: 'Tab', run: view => !view.state.readOnly && insertTab(view), shift: indentLess },
		];
		this.view = new EditorView({
			parent,
			extensions: [
				this.options.phrases.of(EditorState.phrases.of(phrases)),
				this.options.wrapping.of([]),
				this.options.access.of([]),
				this.options.diagnostics.of([]),
				language.extensions,
				EditorState.tabSize.of(TAB_SIZE),
				indentUnit.of('\t'),
				EditorState.allowMultipleSelections.of(true),
				EditorState.transactionFilter.of(transaction => !transaction.docChanged || allowChanges() ? transaction : []),
				this.history.of(history({ newGroupDelay: 200 })),
				Prec.high(keymap.of([...customKeys, ...legacyKeymap])),
				keymap.of([...closeBracketsKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
				drawSelection({ cursorBlinkRate: 530 }),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				highlightSelectionMatches(),
				highlightWhitespace(),
				EditorView.scrollMargins.of(() => ({ top: 32, bottom: 32 })),
				EditorView.contentAttributes.of({ spellcheck: 'false' }),
				EditorView.domEventHandlers({
					copy: (_event, view) => hasNoSelection(view),
					cut: (_event, view) => hasNoSelection(view),
				}),
				presentationField,
				highlightField,
				argumentHintField,
				lintGutter(),
				this.options.numbers.of(absoluteGutter),
				search({ top: true }),
				autocompletion({
					activateOnTyping: false,
					override: [context => this.completeAt(context)],
					icons: false,
					addToOptions: [{
						position: 10,
						render: (completion, _state, view) => {
							if (!completion.className) return null;
							const icon = view.dom.ownerDocument.createElement('span');
							icon.className = completion.className;
							return icon;
						},
					}],
				}),
				EditorView.updateListener.of(update => {
					if (update.geometryChanged || update.viewportChanged || update.docChanged) this.refresh();
				}),
			],
			dispatchTransactions: (transactions, view) => {
				const before = view.state;
				view.update(transactions);
				onUpdate?.(before, transactions);
				if (transactions.some(transaction => transaction.docChanged || transaction.selection || transaction.isUserEvent('load'))) {
					this.afterEdit(transactions);
				}
			},
		});

		this.overlay = document.createElement('div');
		this.overlay.className = 'cm-structure-overlay';
		this.overlay.setAttribute('aria-hidden', 'true');
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'code-structure-view';
		this.overlay.append(this.canvas);
		this.view.dom.append(this.overlay);
		this.ruler = document.createElement('div');
		this.ruler.className = 'cm-croq-rulers';
		this.ruler.setAttribute('aria-hidden', 'true');
		this.ruler.append(...RULER_COLUMNS.map(column => {
			const rule = document.createElement('span');
			rule.style.setProperty('--ruler-column', column);
			return rule;
		}));
		this.overlay.append(this.ruler);
		this.scrollMarkers = document.createElement('div');
		this.scrollMarkers.className = 'cm-section-scroll-markers';
		this.scrollMarkers.setAttribute('aria-hidden', 'true');
		this.view.dom.append(this.scrollMarkers);
		this.measure = {
			key: this,
			read: view => this.measureStructure(view),
			write: measurement => this.paintStructure(measurement),
		};
		this.listen(this.view.scrollDOM, 'scroll', () => this.refresh(), { passive: true });
		this.listen(this.view.dom, 'wheel', event => {
			if (this.enabled && event.ctrlKey) onFontSizeChange(event.deltaY > 0 ? -2 : 2);
		}, { passive: true });
		this.listen(this.view.contentDOM, 'keypress', event => this.scheduleCompletion(event));
		this.listen(this.view.contentDOM, 'mousemove', () => { this.view.contentDOM.style.cursor = ''; });
		this.initGutterSelection();
		this.refresh();
	}

	listen(target, type, handler, options = {}) {
		target.addEventListener(type, handler, { ...options, signal: this.abort.signal });
	}

	initGutterSelection() {
		let anchor = null, down = null;
		const view = this.view;
		const lineAt = event => view.state.doc.lineAt(view.posAtCoords({
			x: view.contentDOM.getBoundingClientRect().left + 2,
			y: event.clientY,
		}, false)).number;
		const select = line => {
			const { doc } = view.state;
			const from = doc.line(Math.min(anchor, doc.lines));
			const to = doc.line(line);
			const tail = row => Math.min(doc.length, row.to + 1);
			view.dispatch({
				selection: anchor <= line ? EditorSelection.single(from.from, tail(to)) : EditorSelection.single(tail(from), to.from),
				userEvent: 'select.pointer',
			});
		};
		this.listen(view.dom, 'mousedown', event => {
			if (event.button !== 0 || !this.enabled || !event.target.closest('.cm-gutters')) return;
			if (event.target.closest('.cm-lint-marker')) return;
			event.preventDefault();
			down = lineAt(event);
			if (event.shiftKey) {
				anchor ??= view.state.doc.lineAt(view.state.selection.main.head).number;
				this.setLineSelectionMode(false);
			} else if (!this.lineSelection || anchor === null) {
				anchor = down;
			}
			select(down);
			view.focus();
		});
		this.listen(view.dom, 'mousemove', event => {
			if (down !== null && event.buttons === 1) select(lineAt(event));
		});
		this.listen(window, 'mouseup', event => {
			if (down !== null && !event.shiftKey && event.target.closest?.('.cm-gutters') && lineAt(event) === down) {
				this.setLineSelectionMode(true);
				anchor = down;
			}
			down = null;
		});
		this.listen(window, 'blur', () => this.setLineSelectionMode(false));
	}

	setLineSelectionMode(enabled) {
		this.lineSelection = enabled;
		this.view.dom.classList.toggle('line-selection-mode', enabled);
	}

	setOptions(settings, phrases, diagnosticSource) {
		const view = this.view;
		const reopenSearch = searchPanelOpen(view.state) && (this.phrases !== phrases || this.readOnly !== settings.readOnly);
		if (reopenSearch) closeSearchPanel(view);
		this.phrases = phrases;
		this.enabled = !settings.disabled;
		this.readOnly = settings.readOnly;
		this.autoIndent = settings.autoIndent;
		this.completion = settings.completion;
		this.rulers = settings.rulers;
		this.sectionNumbers = settings.analysis && settings.functionLineNumbers
			&& this.language.presentation().lineNumbers !== 'absolute';
		view.dom.style.fontFamily = settings.fontFamily;
		view.dom.style.fontSize = settings.fontSize + 'px';
		view.dom.style.lineHeight = settings.lineHeight + '%';
		if (!this.canComplete()) this.closeCompletion();
		view.dispatch({ effects: [
			this.options.phrases.reconfigure(EditorState.phrases.of(phrases)),
			this.options.wrapping.reconfigure(settings.lineWrapping ? EditorView.lineWrapping : []),
			this.options.numbers.reconfigure(this.sectionNumbers ? sectionGutter : absoluteGutter),
			this.options.access.reconfigure([
				EditorState.readOnly.of(this.readOnly || !this.enabled),
				EditorView.editable.of(this.enabled),
				EditorView.contentAttributes.of({ 'aria-readonly': String(this.readOnly || !this.enabled) }),
			]),
			this.options.diagnostics.reconfigure(diagnosticSource ? linter(stateView => {
				const { doc } = stateView.state;
				return diagnosticSource(doc.toString()).filter(item => item.from.line < doc.lines).map(item => {
					const from = offsetAt(doc, item.from);
					return { from, to: Math.max(from, offsetAt(doc, item.to)), severity: item.severity, message: item.message };
				});
			}, { delay: 500, needsRefresh: update => update.startState.facet(EditorState.phrases) !== update.state.facet(EditorState.phrases) }) : []),
		] });
		if (diagnosticSource) forceLinting(view);
		else view.dispatch(setDiagnostics(view.state, []));
		if (reopenSearch && this.enabled) openSearchPanel(view);
		this.refresh();
	}

	canComplete() {
		return this.completion && this.enabled && !this.readOnly && !this.composing && !this.view.compositionStarted;
	}

	scheduleCompletion(event) {
		clearTimeout(this.completionTimer);
		if (!this.canComplete() || event.isComposing || event.key.length !== 1) return;
		const trigger = this.language.completionTrigger(event.key);
		if (trigger) {
			this.completionTimer = setTimeout(() => {
				this.allowShort = trigger.allowShort || completionStatus(this.view.state) === 'active';
				if (this.view.hasFocus) this.complete();
			}, trigger.delay);
		}
	}

	complete() {
		if (!this.canComplete()) return false;
		return startCompletion(this.view);
	}

	closeCompletion() {
		clearTimeout(this.completionTimer);
		closeCompletion(this.view);
		if (this.view.state.field(argumentHintField)) this.view.dispatch({ effects: setArgumentHint.of(null) });
	}

	completeAt(context) {
		if (!this.canComplete()) return null;
		const snapshot = { state: context.state, pos: context.pos, allowShort: this.allowShort };
		return new Promise(resolve => {
			this.session.complete(snapshot, result => {
				if (!result || context.aborted || !this.canComplete()) return resolve(null);
				resolve({
					from: result.from,
					to: result.to,
					filter: false,
					options: result.list.map(item => ({
						label: item.text,
						displayLabel: item.displayText,
						className: item.className,
						detail: item.detail,
					})),
				});
			});
		});
	}

	setDefinitions(definitions) {
		this.closeCompletion();
		this.session.setDefinitions(definitions);
	}

	updateArgumentHint() {
		if (!this.canComplete() || !this.view.state.selection.main.empty) return;
		const { state } = this.view;
		const hint = this.session.argumentHint(state, state.selection.main.head);
		if (!hint) return;
		this.view.dispatch({ effects: setArgumentHint.of({
			pos: hint.pos,
			above: true,
			create: () => {
				const dom = document.createElement('div');
				dom.className = 'cm-tern-arguments';
				dom.append(hint.name + '(');
				hint.parameters.forEach((parameter, index) => {
					if (index) dom.append(', ');
					const span = document.createElement(index === hint.active ? 'strong' : 'span');
					span.textContent = parameter;
					dom.append(span);
				});
				dom.append(')' + hint.result);
				return { dom };
			},
		}) });
	}

	afterEdit(transactions) {
		if (this.abort.signal.aborted) return;
		const transaction = transactions.at(-1);
		const { view } = this;
		if (view.state !== transaction.state) return;
		if (view.state.selection.main.empty) this.setLineSelectionMode(false);
		if (view.hasFocus) {
			view.contentDOM.style.cursor = 'none';
			clearTimeout(this.pointerTimer);
			this.pointerTimer = setTimeout(() => { view.contentDOM.style.cursor = ''; }, 500);
		}
		const head = view.state.doc.lineAt(view.state.selection.main.head).number;
		if (transaction.docChanged) {
			this.changedLine = null;
			if (this.autoFormat && transaction.isUserEvent('input') && !view.compositionStarted) {
				const lines = new Set();
				transaction.changes.iterChanges((_from, _to, start, end) => {
					const first = view.state.doc.lineAt(start).number;
					const last = view.state.doc.lineAt(end).number;
					for (let line = first; line < last; line++) lines.add(line);
					if (head === last) this.changedLine = last;
				});
				this.formatLines(lines);
			} else if (this.autoFormat && transaction.isUserEvent('delete') && !view.compositionStarted) {
				this.changedLine = head;
			}
		} else if (this.autoFormat && this.changedLine !== null && head !== this.changedLine && view.state.selection.main.empty) {
			const line = this.changedLine;
			this.changedLine = null;
			this.formatLines([line]);
		}
		this.updateArgumentHint();
	}

	formatLines(lines, collapse = false) {
		if (!this.enabled || this.readOnly) return;
		const { view } = this;
		const { state } = view;
		const changes = [];
		let formatted = state;
		for (const number of lines) {
			const line = state.doc.line(number);
			if (!line.length) continue;
			const result = this.language.formatLine(line.text + '\n', {
				autoIndent: this.autoIndent,
				indentWithTabs: true,
				tabSize: TAB_SIZE,
			});
			if (!result || /[\r\n]/.test(result.text)) continue;
			let text = result.text;
			if (result.indent && state.field(presentationField)?.canIndent) {
				const row = formatted.doc.line(number);
				const candidate = formatted.update({ changes: { from: row.from, to: row.to, insert: text } }).state;
				const indent = getIndentation(candidate, row.from);
				if (indent !== null) text = '\t'.repeat(Math.floor(indent / TAB_SIZE)) + ' '.repeat(indent % TAB_SIZE) + text.trimStart();
				formatted = formatted.update({ changes: { from: row.from, to: row.to, insert: text } }).state;
			}
			if (text !== line.text) {
				const start = sharedPrefix(line.text, text);
				const suffix = sharedSuffix(line.text, text, start);
				changes.push({ from: line.from + start, to: line.to - suffix, insert: text.slice(start, text.length - suffix) });
			}
		}
		if (!changes.length && !collapse) return;
		const selection = state.selection.main;
		const changeSet = state.changes(changes);
		view.dispatch({
			changes: changeSet,
			selection: collapse ? { anchor: changeSet.mapPos(selection.to) } : undefined,
			userEvent: 'format',
		});
	}

	format() {
		const { doc, selection } = this.view.state;
		const { from, to } = selection.main;
		const first = doc.lineAt(from).number;
		const last = doc.lineAt(to > from ? to - 1 : to).number;
		this.formatLines(Array.from({ length: last - first + 1 }, (_, index) => first + index), true);
	}

	loadDocument(text) {
		const { state } = this.view;
		this.closeCompletion();
		this.changedLine = null;
		this.view.dispatch({
			changes: { from: 0, to: state.doc.length, insert: Text.of(text.split(/\r\n?|\n/)) },
			selection: { anchor: 0 },
			annotations: Transaction.addToHistory.of(false),
			userEvent: 'load',
			scrollIntoView: true,
			effects: this.history.reconfigure([]),
		});
		this.view.dispatch({ effects: this.history.reconfigure(history({ newGroupDelay: 200 })) });
	}

	setPresentation(data) {
		this.view.dispatch({ effects: setPresentation.of(data ?? null) });
		this.refresh();
	}

	getSectionLineNumber(line) {
		return sectionNumber(sections(this.view.state.field(presentationField)), line);
	}

	highlightLine(id, line) {
		this.view.dispatch({ effects: addHighlight.of({ id, position: this.view.state.doc.line(line + 1).from }) });
	}

	clearHighlight(id) {
		this.view.dispatch({ effects: removeHighlight.of(id) });
	}

	historySize() {
		return { undo: undoDepth(this.view.state), redo: redoDepth(this.view.state) };
	}

	undo() { undo(this.view); }
	redo() { redo(this.view); }
	selectAll() { selectAll(this.view); }
	toggleComment() { toggleComment(this.view); }
	find() { openSearchPanel(this.view); }
	findNext() { this.searchAgain(this.view, findNext); }
	replace() {
		if (!this.enabled || this.readOnly) return false;
		openSearchPanel(this.view);
		this.view.dom.querySelector('.cm-search input[name="replace"]')?.focus();
		return true;
	}

	searchAgain(view, command) {
		return command(view);
	}

	refresh() {
		if (this.measure) this.view.requestMeasure(this.measure);
	}

	measureStructure(view) {
		const root = view.dom.getBoundingClientRect();
		const scroller = view.scrollDOM;
		const frame = scroller.getBoundingClientRect();
		const content = view.contentDOM.getBoundingClientRect();
		const linePadding = parseFloat(getComputedStyle(view.contentDOM).getPropertyValue('--croq-mirror-line-padding')) || 0;
		const left = Math.max(frame.left, content.left);
		const width = Math.max(0, Math.min(view.defaultCharacterWidth * 64, frame.left + scroller.clientWidth - left));
		const height = scroller.clientHeight;
		const data = view.state.field(presentationField);
		const { doc, tabSize } = view.state;
		const coords = (pos, side = 1) => {
			const offset = offsetAt(doc, pos);
			const measured = view.coordsAtPos(offset, side);
			const block = view.lineBlockAt(offset);
			const lineTop = view.documentTop + block.top - frame.top;
			if (measured) {
				const glyphTop = (measured.top + measured.bottom - view.defaultLineHeight) / 2 - frame.top;
				const row = Math.max(0, Math.round((glyphTop - lineTop) / view.defaultLineHeight));
				return { x: measured.left - left, y: lineTop + row * view.defaultLineHeight };
			}
			const columns = countColumn(doc.sliceString(block.from, offset), tabSize);
			return { x: content.left - left + linePadding + columns * view.defaultCharacterWidth, y: lineTop };
		};
		const decorations = (data?.decorations || []).map(item => {
			const start = coords(item.from);
			const end = coords(item.to, -1);
			if (item.kind === 'token') return { ...item, start, end };
			return {
				...item, start, end,
				spine: coords({ ...item.from, ch: item.from.ch + item.spineChars + 1 }, -1).x - start.x - item.spineChars,
				branchWidth: coords({ ...item.from, ch: item.from.ch + item.branchChars + 1 }, -1).x - start.x - item.branchChars,
				branchRows: item.branches.map(branch => coords(branch).y),
			};
		});
		const markers = this.sectionNumbers && scroller.scrollHeight > height ? sections(data).map(line => {
			const block = view.lineBlockAt(doc.line(line + 1).from);
			return (block.top + view.defaultLineHeight / 2) / Math.max(view.contentHeight, 1) * 100;
		}) : [];
		return {
			left: left - root.left, top: frame.top - root.top, width, height,
			rulerX: content.left - left + linePadding,
			charWidth: view.defaultCharacterWidth, lineHeight: view.defaultLineHeight,
			decorations, markers,
		};
	}

	paintStructure(data) {
		Object.assign(this.overlay.style, { left: data.left + 'px', top: data.top + 'px', width: data.width + 'px', height: data.height + 'px' });
		drawStructure(this.canvas, data);
		this.ruler.hidden = !this.rulers;
		this.ruler.style.left = data.rulerX + 'px';
		this.ruler.style.setProperty('--ruler-character-width', data.charWidth + 'px');
		this.scrollMarkers.style.top = data.top + 'px';
		this.scrollMarkers.style.height = data.height + 'px';
		this.scrollMarkers.replaceChildren(...data.markers.map(position => {
			const marker = document.createElement('span');
			marker.style.top = position + '%';
			return marker;
		}));
	}

	destroy() {
		this.abort.abort();
		clearTimeout(this.completionTimer);
		clearTimeout(this.pointerTimer);
		this.session.destroy();
		this.view.destroy();
	}
}

function sharedPrefix(before, after) {
	let index = 0;
	while (index < before.length && index < after.length && before[index] === after[index]) index++;
	return index;
}

function sharedSuffix(before, after, prefix) {
	let length = 0;
	while (length < before.length - prefix && length < after.length - prefix && before.at(-length - 1) === after.at(-length - 1)) length++;
	return length;
}
