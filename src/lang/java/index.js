import { java, javaLanguage as javaSyntax } from '@codemirror/lang-java';
import { EditorView } from '@codemirror/view';
import { AnalysisClient } from '../../analysis-client.js';
import { lezerAnalysis } from '../../analysis/lezer-analysis.js';
import { closeBracketsFor } from '../close-brackets.js';
import { completionTrigger, createCompletionSession } from './completion.js';
import { formatLine } from './formatting.js';
import { lezerSyntax } from './lezer-syntax.js';

export const javaLanguage = {
	supportsFunctionSections: true,
	supportsBracketMatching: true,
	extensions: [
		java(),
		EditorView.editorAttributes.of({ class: 'cm-java' }),
		lezerAnalysis(lezerSyntax),
	],
	closeBrackets: closeBracketsFor(javaSyntax),

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker-java.min.js', import.meta.url), { type: 'module' }));
	},

	diagnostics(text, locale, _options, client) {
		return client.request(text, undefined, locale);
	},
	completionTrigger,
	createCompletionSession,
	formatLine,
};
