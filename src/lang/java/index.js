import { java } from '@codemirror/lang-java';
import { syntaxTree } from '@codemirror/language';
import { AnalysisClient } from '../../analysis-client.js';
import { syntaxHighlightingSource } from '../../extensions/syntax-highlighting/index.js';
import { adaptJavaAnalysis } from './analysis-adapter.js';
import { analyzeEditorSyntax } from './editor-syntax-analysis.js';

export const javaLanguage = {
	supportsFunctionSections: true,
	supportsBracketMatching: true,
	extensions: [
		java(),
		syntaxHighlightingSource(analyzeEditorSyntax,
			update => syntaxTree(update.startState) !== syntaxTree(update.state),
			{ retainOnEdit: true, reconcileComments: state => syntaxTree(state).length }),
	],

	createAnalysisClient() {
		return new AnalysisClient(new Worker(new URL('./analysis-worker-java.min.js', import.meta.url), { type: 'module' }));
	},

	analysisData(analysis, _state, version) {
		return adaptJavaAnalysis(analysis, version);
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
