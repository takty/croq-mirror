// A complete, inert implementation of the language interface. This exercises
// the same coordinator/view paths as a language with syntax-aware services.
export const plainLanguage = {
	extensions: [],

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
			argumentHint() { return null; },
			destroy() {},
		};
	},

	presentation() {
		return { canIndent: false, lineNumbers: 'absolute', sectionStarts: [], decorations: [] };
	},
};
