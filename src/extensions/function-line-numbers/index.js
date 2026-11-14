import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { commonAnalysisState } from '../../analysis/common-analysis.js';
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
			if (!Array.isArray(starts)) {
				throw new TypeError('Section starts must be an array');
			}
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
	if (!Number.isInteger(line) || line < 0 || line >= state.doc.lines) {
		throw new RangeError('Invalid line');
	}
	const starts = sectionStarts(state);
	let low = 0, high = starts.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (starts[middle] <= line) low = middle + 1;
		else high = middle;
	}
	return [low, line - (starts[low - 1] ?? 0) + 1];
}

function sectionStarts(state) {
	const analysis = state.field(commonAnalysisState, false);
	return analysis
		? analysis.sections.map(section => state.doc.lineAt(section.from).number - 1)
		: state.field(sectionNumberState, false) ?? [];
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
			(update.startState.field(commonAnalysisState, false) !== update.state.field(commonAnalysisState, false) ||
				update.startState.field(sectionNumberState) !== update.state.field(sectionNumberState)),
		initialSpacer: view => new LineNumber(0, widestLineNumber(view.state.doc)),
		updateSpacer(spacer, { state }) {
			const number = widestLineNumber(state.doc);
			return spacer.line === number ? spacer : new LineNumber(0, number);
		},
	});
}

export const absoluteLineNumbers = numberGutter(false);

export const functionLineNumbers = [
	sectionNumberState,
	numberGutter(true),
	EditorView.editorAttributes.of({ class: 'cm-section-mode cm-function-line-numbers' }),
	extensionStyles(css),
];
