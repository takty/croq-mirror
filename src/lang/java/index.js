import { java } from '@codemirror/lang-java';
import { AnalysisClient } from '../../analysis-client.js';
import { lezerAnalysis } from '../../analysis/lezer-analysis.js';
import { lezerSyntax } from './lezer-syntax.js';

export const javaLanguage = {
	supportsFunctionSections: true,
	supportsBracketMatching: true,
	extensions: [
		java(),
		lezerAnalysis(lezerSyntax),
	],

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker-java.min.js', import.meta.url), { type: 'module' }));
	},

	diagnostics() { return []; },
	completionTrigger() { return null; },
	formatLine() { return null; },

	createCompletionSession() {
		return {
			setDefinitions() {},
			complete(_options, callback) { callback(null); },
			argumentHint() { return null; },
			destroy() {},
		};
	},

};
