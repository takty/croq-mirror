import { EditorView, ViewPlugin } from '@codemirror/view';
import { extensionStyles } from '../styles.js';
import css from './style.css';

const columns = [4, 8, 12];

const rulerPlugin = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		const document = view.dom.ownerDocument;
		this.overlay = document.createElement('div');
		this.overlay.className = 'cm-ruler-overlay';
		this.overlay.setAttribute('aria-hidden', 'true');
		this.ruler = document.createElement('div');
		this.ruler.className = 'cm-croq-rulers';
		this.ruler.append(...columns.map(column => {
			const rule = document.createElement('span');
			rule.style.setProperty('--ruler-column', column);
			return rule;
		}));
		this.overlay.append(this.ruler);
		view.dom.append(this.overlay);
		this.measure = {
			key: this,
			read: view => this.read(view),
			write: data => this.write(data),
		};
		this.onScroll = () => this.refresh();
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		this.refresh();
	}

	update(update) {
		if (update.docChanged || update.geometryChanged || update.viewportChanged) this.refresh();
	}

	refresh() {
		this.view.requestMeasure(this.measure);
	}

	read(view) {
		const root = view.dom.getBoundingClientRect();
		const scroller = view.scrollDOM;
		const frame = scroller.getBoundingClientRect();
		const content = view.contentDOM.getBoundingClientRect();
		const line = view.contentDOM.querySelector('.cm-line');
		const lineStart = line
			? line.getBoundingClientRect().left + parseFloat(view.dom.ownerDocument.defaultView.getComputedStyle(line).paddingLeft)
			: content.left;
		const left = Math.max(frame.left, content.left);
		return {
			left: left - root.left,
			top: frame.top - root.top,
			width: Math.max(0, Math.min(view.defaultCharacterWidth * 64, frame.left + scroller.clientWidth - left)),
			height: scroller.clientHeight,
			rulerX: lineStart - left,
			charWidth: view.defaultCharacterWidth,
		};
	}

	write(data) {
		Object.assign(this.overlay.style, { left: data.left + 'px', top: data.top + 'px', width: data.width + 'px', height: data.height + 'px' });
		this.ruler.style.left = data.rulerX + 'px';
		this.ruler.style.setProperty('--ruler-character-width', data.charWidth + 'px');
	}

	destroy() {
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.overlay.remove();
	}
});

export const indentRulers = [
	rulerPlugin,
	EditorView.editorAttributes.of({ class: 'cm-indent-rulers' }),
	extensionStyles(css),
];

export function refreshIndentRulers(view) {
	view.plugin(rulerPlugin)?.refresh();
}
