import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter } from '@codemirror/view';
import { extensionStyles } from '../styles.js';
import css from './style.css';

export const setSectionStarts = StateEffect.define();

export const sectionNumberState = StateField.define({
	create: () => [],
	update(value, transaction) {
		if (transaction.docChanged || transaction.isUserEvent('load')) value = [];
		for (const effect of transaction.effects) {
			if (!effect.is(setSectionStarts)) continue;
			const starts = effect.value;
			if (!Array.isArray(starts)) throw new TypeError('Section starts must be an array');
			for (let index = 0; index < starts.length; index++) {
				const line = starts[index];
				if (!Number.isInteger(line) || line < 0 || line >= transaction.state.doc.lines ||
					(index > 0 && line < starts[index - 1])) {
					throw new RangeError('Section starts must be ordered zero-based document lines');
				}
			}
			value = starts.slice();
		}
		return value;
	},
});

export function getSectionLineNumber(state, line) {
	if (!Number.isInteger(line) || line < 0 || line >= state.doc.lines) throw new RangeError('Invalid line');
	const starts = state.field(sectionNumberState);
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
			return sectionMode ? new LineNumber(...getSectionLineNumber(view.state, line - 1)) : new LineNumber(0, line);
		},
		lineMarkerChange: update => sectionMode &&
			update.startState.field(sectionNumberState) !== update.state.field(sectionNumberState),
		initialSpacer: view => new LineNumber(0, widestLineNumber(view.state.doc)),
		updateSpacer(spacer, { state }) {
			const number = widestLineNumber(state.doc);
			return spacer.line === number ? spacer : new LineNumber(0, number);
		},
	});
}

const scrollMarkers = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		this.dom = view.dom.ownerDocument.createElement('div');
		this.dom.className = 'cm-section-scroll-markers';
		this.dom.setAttribute('aria-hidden', 'true');
		view.dom.append(this.dom);
		this.measure = {
			key: this,
			read: view => {
				const root = view.dom.getBoundingClientRect();
				const frame = view.scrollDOM.getBoundingClientRect();
				const height = view.scrollDOM.clientHeight;
				const markers = view.scrollDOM.scrollHeight > height ? view.state.field(sectionNumberState).map(line => {
					const block = view.lineBlockAt(view.state.doc.line(line + 1).from);
					return (block.top + view.defaultLineHeight / 2) / Math.max(view.contentHeight, 1) * 100;
				}) : [];
				return { top: frame.top - root.top, height, markers };
			},
			write: data => {
				this.dom.style.top = data.top + 'px';
				this.dom.style.height = data.height + 'px';
				this.dom.replaceChildren(...data.markers.map(position => {
					const marker = this.dom.ownerDocument.createElement('span');
					marker.style.top = position + '%';
					return marker;
				}));
			},
		};
		this.onScroll = () => this.refresh();
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		this.refresh();
	}

	update(update) {
		if (update.docChanged || update.geometryChanged || update.viewportChanged ||
			update.startState.field(sectionNumberState) !== update.state.field(sectionNumberState)) this.refresh();
	}

	refresh() {
		this.view.requestMeasure(this.measure);
	}

	destroy() {
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.dom.remove();
	}
});

export const absoluteLineNumbers = numberGutter(false);

export const functionLineNumbers = [
	sectionNumberState,
	numberGutter(true),
	scrollMarkers,
	EditorView.editorAttributes.of({ class: 'cm-section-mode cm-function-line-numbers' }),
	extensionStyles(css),
];

export function refreshFunctionLineNumbers(view) {
	view.plugin(scrollMarkers)?.refresh();
}
