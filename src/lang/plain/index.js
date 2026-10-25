// A complete, inert implementation of the language interface. This exercises
// the same coordinator/view paths as a language with syntax-aware services.
export const plainLanguage = {
	mode: 'text/plain',
	modeOptions: {},
	autoCloseBrackets: false,
	matchBrackets: false,

	createAnalysisClient() {
		return {
			ready: Promise.resolve(),
			async request() { return null; },
			destroy() {},
		};
	},

	diagnostics() { return []; },
	completionTrigger() { return null; },
	formatLine() { return null; },

	createCompletionSession() {
		return {
			setDefinitions() {},
			complete(_options, callback) { callback(null); },
			updateArgumentHints() {},
			destroy() {},
		};
	},

	presentation() {
		return { canIndent: false, lineNumbers: 'absolute', sectionStarts: [], decorations: [] };
	},
};
