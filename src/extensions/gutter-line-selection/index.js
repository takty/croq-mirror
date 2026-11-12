import { EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import cursorRight from './cursor-right.svg';
import cursorLine from './cursor-line.svg';
import { extensionStyles } from '../styles.js';
import css from './style.css';

export const setLineSelectionMode = StateEffect.define();

const lineSelectionMode = StateField.define({
	create: () => false,
	update(value, transaction) {
		if ((transaction.docChanged || transaction.selection || transaction.isUserEvent('load')) &&
			transaction.state.selection.main.empty) value = false;
		for (const effect of transaction.effects) {
			if (effect.is(setLineSelectionMode)) value = !!effect.value;
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
		this.view.dispatch({ effects: setLineSelectionMode.of(enabled) });
	}

	mouseDown(event) {
		const { view } = this;
		if (event.button !== 0 || !view.state.facet(EditorView.editable) || !event.target.closest('.cm-gutters')) return;
		if (event.target.closest('.cm-lint-marker')) return;
		const line = this.lineAt(event);
		if (line === null) return;
		event.preventDefault();
		this.down = line;
		if (event.shiftKey) {
			this.anchor ??= view.state.doc.lineAt(view.state.selection.main.head).number;
			this.setMode(false);
		} else if (!view.state.field(lineSelectionMode) || this.anchor === null) {
			this.anchor = line;
		}
		this.select(line);
		view.focus();
	}

	mouseMove(event) {
		if (this.down === null || event.buttons !== 1) return;
		const line = this.lineAt(event);
		if (line !== null) this.select(line);
	}

	mouseUp(event) {
		if (this.down !== null && !event.shiftKey && event.target.closest?.('.cm-gutters') && this.lineAt(event) === this.down) {
			this.setMode(true);
			this.anchor = this.down;
		}
		this.down = null;
	}

	destroy() {
		this.abort.abort();
	}
});

export const gutterLineSelection = [
	lineSelectionMode,
	gutterSelection,
	EditorView.editorAttributes.of({ class: 'cm-gutter-line-selection' }),
	extensionStyles(css
		.replace('./cursor-right.svg', `data:image/svg+xml;base64,${cursorRight}`)
		.replace('./cursor-line.svg', `data:image/svg+xml;base64,${cursorLine}`)),
];
