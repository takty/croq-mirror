import { Facet, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { commonAnalysisState, referencesFromSyntax } from './common-analysis.js';

const syntaxClassifier = Facet.define({ combine: values => values[0] });
const SEMANTIC_KINDS = new Set(['definition', 'local-reference', 'variable-reference']);

export function lezerAnalysis(classifier) {
	return [syntaxClassifier.of(classifier), syntaxAnalysisState];
}

function readLezer(state, tree, classifier) {
	const ranges = [];
	const add = (from, to, kind) => {
		if (from < to) ranges.push({ from, to, kind });
	};
	highlightTree(tree, classifier.style, (from, to, classes) => {
		for (const kind of new Set(classes.split(' '))) {
			classifier.classify(tree, kind, from, to, add);
		}
	});
	classifier.collectInterimReferences?.(tree, state, add);
	return {
		syntax    : ranges.filter(range => !SEMANTIC_KINDS.has(range.kind)),
		references: referencesFromSyntax(ranges),
	};
}

function reconcile(interim, parsedTo, analysis) {
	if (!analysis) return interim;
	if (!analysis.stale) {
		return {
			syntax    : analysis.syntax.length ? analysis.syntax : interim.syntax,
			references: analysis.references
		};
	}
	const retainedReferences = new Map(analysis.references.map(reference => [
		referenceKey(reference), reference,
	]));
	return {
		syntax: [
			...interim.syntax,
			...analysis.syntax.flatMap(range => {
				if (range.from >= parsedTo) {
					return [range];
				}
				if (range.kind === 'comment' && range.to > parsedTo) {
					return [{ ...range, from: parsedTo }];
				}
				return [];
			}),
		],
		references: [
			...interim.references.map(reference => {
				const retained = retainedReferences.get(referenceKey(reference));
				// Prefer a fresh scope classification when the interim analyzer provides one.
				return interim.classifiesLocalReferences ? reference : (retained ?? reference);
			}),
			...analysis.references.filter(reference => reference.from >= parsedTo),
		],
	};
}

function referenceKey({ from, to, role }) {
	return `${from}:${to}:${role}`;
}

function updateSyntax(state, previous) {
	const classifier = state.facet(syntaxClassifier);
	const tree       = syntaxTree(state);
	const analysis   = state.field(commonAnalysisState, false);
	const interim    = previous?.tree === tree && previous.doc === state.doc && previous.classifier === classifier
		? previous.interim
		: { ...readLezer(state, tree, classifier), classifiesLocalReferences: !!classifier.collectInterimReferences };
	if (previous?.interim === interim && previous.analysis === analysis) {
		return previous;
	}
	return {
		doc: state.doc,
		tree,
		classifier,
		interim,
		analysis,
		data: reconcile(interim, tree.length, analysis),
	};
}

export const syntaxAnalysisState = StateField.define({
	create: state => updateSyntax(state, null),
	update: (previous, transaction) => updateSyntax(transaction.state, previous),
});
