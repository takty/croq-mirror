import { EditorView, ViewPlugin } from '@codemirror/view';

export function extensionStyles(css) {
	return ViewPlugin.fromClass(class {
		constructor(view) {
			this.style = view.dom.ownerDocument.createElement('style');
			this.style.nonce = view.state.facet(EditorView.cspNonce);
			this.style.textContent = css;
			view.dom.append(this.style);
		}

		update(update) {
			if (update.startState.facet(EditorView.cspNonce) !== update.state.facet(EditorView.cspNonce)) {
				this.style.nonce = update.state.facet(EditorView.cspNonce);
			}
		}

		destroy() {
			this.style.remove();
		}
	});
}
