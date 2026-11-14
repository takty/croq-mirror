import { javascript, javascriptLanguage as javascriptSyntax } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { AnalysisClient } from '../../analysis-client.js';
import { lezerAnalysis } from '../../analysis/lezer-analysis.js';
import { closeBracketsFor } from '../close-brackets.js';
import { completionTrigger, createCompletionSession } from './completion.js';
import { diagnostics } from './diagnostics.js';
import { formatLine } from './formatting.js';
import { lezerSyntax } from './lezer-syntax.js';

// Internal language contract: see ../language-interface.md. No Editor private state
// crosses this boundary; the view applies returned data to its own document/UI.
export const javascriptLanguage = {
	supportsFunctionSections: true,
	supportsBracketMatching: true,
	extensions: [
		javascript(),
		EditorView.editorAttributes.of({ class: 'cm-javascript' }),
		lezerAnalysis(lezerSyntax),
	],
	closeBrackets: closeBracketsFor(javascriptSyntax, '`'),

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker.min.js', import.meta.url), { type: 'module' }));
	},

	diagnostics,

	completionTrigger,
	createCompletionSession,
	formatLine,
};
