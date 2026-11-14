import { EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import cursorRight from './cursor-right.svg';
import cursorLine from './cursor-line.svg';
import { extensionStyles } from '../styles.js';
import css from './style.css';

export const setEasyLineSelectionMode = StateEffect.define();
export const setLineSelectionMode = setEasyLineSelectionMode;

const lineSelectionMode = StateField.define({
	create: () => false,
	update(value, transaction) {
		if (transaction.docChanged || transaction.isUserEvent('load') ||
			(transaction.selection && transaction.state.selection.main.empty)) value = false;
		for (const effect of transaction.effects) {
			if (effect.is(setEasyLineSelectionMode)) value = !!effect.value;
		}
		return value;
	},
	provide: field => EditorView.editorAttributes.from(field, enabled => enabled ? { class: 'line-selection-mode' } : {}),
});

const gutterSelection = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		this.anchor = null;
		this.down = null;
		this.dragged = false;
		this.abort = new AbortController();
		const listen = (target, type, listener) => target.addEventListener(type, listener, { signal: this.abort.signal });
		listen(view.dom, 'mousedown', event => this.mouseDown(event));
		listen(view.dom, 'mousemove', event => this.mouseMove(event));
		listen(view.dom.ownerDocument.defaultView, 'mouseup', event => this.mouseUp(event));
		listen(view.dom.ownerDocument.defaultView, 'blur', () => this.setMode(false));
	}

	lineAt(event) {
		const { view } = this;
		const position = view.posAtCoords({
			x: view.contentDOM.getBoundingClientRect().left + 2,
			y: event.clientY,
		}, false);
		return position === null ? null : view.state.doc.lineAt(position).number;
	}

	select(line) {
		const { view, anchor } = this;
		const { doc } = view.state;
		const from = doc.line(Math.min(anchor, doc.lines));
		const to = doc.line(line);
		const tail = row => Math.min(doc.length, row.to + 1);
		view.dispatch({
			selection: anchor <= line ? EditorSelection.single(from.from, tail(to)) : EditorSelection.single(tail(from), to.from),
			userEvent: 'select.pointer',
		});
	}

	setMode(enabled) {
		if (this.view.state.field(lineSelectionMode, false) !== undefined) {
			this.view.dispatch({ effects: setEasyLineSelectionMode.of(enabled) });
		}
	}

	update(update) {
		if (update.docChanged || update.transactions.some(transaction => transaction.isUserEvent('load'))) {
			this.anchor = null;
			this.down = null;
		} else if (update.selectionSet && update.state.selection.main.empty) {
			this.anchor = null;
		}
	}

	mouseDown(event) {
		const { view } = this;
		if (event.button !== 0 || !view.state.facet(EditorView.editable) || !event.target.closest('.cm-gutters')) return;
		if (event.target.closest('.cm-lint-marker')) return;
		const line = this.lineAt(event);
		if (line === null) return;
		event.preventDefault();
		this.down = line;
		this.dragged = false;
		if (event.shiftKey) {
			this.anchor ??= view.state.doc.lineAt(view.state.selection.main.head).number;
			this.setMode(false);
		} else if (!view.state.field(lineSelectionMode, false) || this.anchor === null) {
			this.anchor = line;
		}
		this.select(line);
		view.focus();
	}

	mouseMove(event) {
		if (this.down === null || event.buttons !== 1) return;
		const line = this.lineAt(event);
		if (line !== null) {
			if (!this.dragged && line !== this.down) {
				this.dragged = true;
				if (!event.shiftKey) this.anchor = this.down;
				this.setMode(false);
			}
			this.select(line);
		}
	}

	mouseUp(event) {
		if (this.down !== null && !this.dragged && !event.shiftKey &&
			!this.view.state.field(lineSelectionMode, false) &&
			event.target.closest?.('.cm-gutters') && this.lineAt(event) === this.down) {
			this.setMode(true);
			this.anchor = this.down;
		}
		this.down = null;
	}

	destroy() {
		this.abort.abort();
	}
});

export const standardGutterLineSelection = [
	gutterSelection,
	EditorView.editorAttributes.of({ class: 'cm-gutter-line-selection' }),
	extensionStyles(css
		.replace('./cursor-right.svg', `data:image/svg+xml;base64,${cursorRight}`)
		.replace('./cursor-line.svg', `data:image/svg+xml;base64,${cursorLine}`)),
];

export const easyLineSelection = [
	standardGutterLineSelection,
	lineSelectionMode,
	EditorView.editorAttributes.of({ class: 'cm-easy-line-selection' }),
];

export const gutterLineSelection = easyLineSelection;
