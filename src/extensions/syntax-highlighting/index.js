import { Facet, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { extensionStyles } from '../styles.js';
import css from './style.css';

const kinds = new Set([
	'comment', 'keyword', 'operator', 'type', 'function', 'variable', 'literal', 'invalid',
	'definition', 'property', 'local-variable', 'local-reference', 'variable-reference',
]);

export const setSyntaxHighlights = StateEffect.define();
const sourceFacet = Facet.define({ combine: sources => sources.at(-1) ?? null });

function decorationsFor(ranges, doc) {
	return Decoration.set(ranges.map(({ from, to, kind }) => {
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to ||
			to > doc.length || !kinds.has(kind)) {
			throw new RangeError('Invalid syntax highlight range');
		}
		return Decoration.mark({ class: `cm-syntax-${kind}` }).range(from, to);
	}), true);
}

const syntaxHighlights = StateField.define({
	create: () => ({ decorations: Decoration.none, current: false }),
	update(value, transaction) {
		if (transaction.isUserEvent('load')) {
			value = { decorations: Decoration.none, current: false };
		} else if (transaction.docChanged) {
			const retain = transaction.state.facet(sourceFacet)?.retainOnEdit;
			value = { decorations: retain ? value.decorations.map(transaction.changes) : Decoration.none, current: false };
		}
		for (const effect of transaction.effects) {
			if (!effect.is(setSyntaxHighlights)) continue;
			value = { decorations: decorationsFor(effect.value, transaction.newDoc), current: effect.value.length > 0 };
		}
		return value;
	},
});

export function syntaxHighlightingSource(analyze, needsRefresh = () => false, { retainOnEdit = false, reconcileComments = null } = {}) {
	return sourceFacet.of({ analyze, needsRefresh, retainOnEdit, reconcileComments });
}

function reconcileRetainedComments(decorations, ranges, doc, parsedTo) {
	if (!Number.isInteger(parsedTo) || parsedTo < 0 || parsedTo > doc.length) {
		throw new RangeError('Invalid parsed syntax extent');
	}
	const comments = [];
	for (const range of ranges.filter(range => range.kind === 'comment' && range.from < parsedTo)
		.sort((a, b) => a.from - b.from)) {
		const previous = comments.at(-1), to = Math.min(range.to, parsedTo);
		if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, to);
		else comments.push({ from: range.from, to });
	}
	const retained = [];
	decorations.between(0, doc.length, (from, to, decoration) => {
		let low = 0, high = comments.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (comments[middle].to <= from) low = middle + 1;
			else high = middle;
		}
		if (decoration.spec.class === 'cm-syntax-comment') {
			for (let i = low; i < comments.length && comments[i].from < to; i++) {
				const comment = comments[i];
				const start = Math.max(from, comment.from), end = Math.min(to, comment.to, parsedTo);
				if (start < end) retained.push(decoration.range(start, end));
			}
			if (to > parsedTo) retained.push(decoration.range(Math.max(from, parsedTo), to));
		} else {
			let start = from;
			for (let i = low; i < comments.length && comments[i].from < to; i++) {
				const comment = comments[i];
				if (comment.to <= start) continue;
				if (comment.from > start) retained.push(decoration.range(start, comment.from));
				start = Math.max(start, comment.to);
				if (start >= to) break;
			}
			if (start < to) retained.push(decoration.range(start, to));
		}
	});
	return Decoration.set(retained, true);
}

function sourceDecorations(state, source) {
	const supplied = state.field(syntaxHighlights);
	if (!source || (source.retainOnEdit && supplied.current)) return supplied.decorations;
	const ranges = source.analyze(state);
	if (!source.retainOnEdit) return RangeSet.join([supplied.decorations, decorationsFor(ranges, state.doc)]);
	const retained = source.reconcileComments
		? reconcileRetainedComments(supplied.decorations, ranges, state.doc, source.reconcileComments(state))
		: supplied.decorations;
	const uncovered = [];
	for (const range of ranges) {
		let from = range.from;
		retained.between(range.from, range.to, (start, end) => {
			if (start > from) uncovered.push({ ...range, from, to: Math.min(start, range.to) });
			from = Math.max(from, end);
		});
		if (from < range.to) uncovered.push({ ...range, from, to: range.to });
	}
	return RangeSet.join([retained, decorationsFor(uncovered, state.doc)]);
}

const sourceHighlights = ViewPlugin.fromClass(class {
	constructor(view) {
		const source = view.state.facet(sourceFacet);
		this.decorations = sourceDecorations(view.state, source);
	}

	update(update) {
		const source = update.state.facet(sourceFacet);
		if (source !== update.startState.facet(sourceFacet) || update.docChanged || source?.needsRefresh(update) ||
			update.startState.field(syntaxHighlights) !== update.state.field(syntaxHighlights)) {
			this.decorations = sourceDecorations(update.state, source);
		}
	}
}, { decorations: plugin => plugin.decorations });

export const syntaxHighlightingExtension = [
	syntaxHighlights,
	sourceHighlights,
	EditorView.editorAttributes.of({ class: 'cm-syntax-highlighting' }),
	extensionStyles(css),
];
