// A complete, inert implementation of the language interface. This exercises
// the same coordinator/view paths as a language with syntax-aware services.
export const plainLanguage = {
	supportsFunctionSections: false,
	supportsBracketMatching: false,
	extensions: [],
	closeBrackets() { return []; },

	createAnalysisClient() {
		return {
			ready: Promise.resolve(),
			async request() { return null; },
			destroy() {},
		};
	},

	diagnostics() { return []; },
	completionTrigger: null,
	createCompletionSession: null,
	formatLine: null,

};
