import { bracketMatching } from '@codemirror/language';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { extensionStyles } from '../styles.js';
import css from './style.css';

const bracketGutterOverlay = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		this.overlay = view.dom.ownerDocument.createElement('div');
		this.overlay.className = 'cm-bracket-gutter-overlay';
		this.overlay.setAttribute('aria-hidden', 'true');
		view.dom.append(this.overlay);
		this.measure = { key: this, read: view => this.read(view), write: data => this.write(data) };
		this.onScroll = () => this.refresh();
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		this.refresh();
	}

	update() {
		this.refresh();
	}

	refresh() {
		this.view.requestMeasure(this.measure);
	}

	read(view) {
		const gutter = view.dom.querySelector('.cm-gutters');
		if (!gutter) return null;
		const window = view.dom.ownerDocument.defaultView;
		const editor = view.dom.getBoundingClientRect();
		const frame = view.scrollDOM.getBoundingClientRect();
		const gutterBox = gutter.getBoundingClientRect();
		const width = Math.min(gutterBox.width, parseFloat(window.getComputedStyle(gutter, '::after').width) || 0);
		const left = gutterBox.right - width;
		const marks = [];
		for (const bracket of view.contentDOM.querySelectorAll('.cm-matchingBracket')) {
			if (bracket.closest('.cm-activeLine, .cm-syntax-comment') || bracket.querySelector('.cm-syntax-comment')) {
				continue;
			}
			const box = bracket.getBoundingClientRect();
			const fontSize = window.getComputedStyle(bracket).fontSize;
			if (box.left < gutterBox.right || box.left - 0.75 * parseFloat(fontSize) >= gutterBox.right) continue;
			marks.push({ left: box.left - left, top: box.top - frame.top, width: box.width, height: box.height, fontSize });
		}
		return { left: left - editor.left, top: frame.top - editor.top, width, height: view.scrollDOM.clientHeight, marks };
	}

	write(data) {
		if (!data) {
			this.overlay.replaceChildren();
			return;
		}
		Object.assign(this.overlay.style, {
			left: data.left + 'px', top: data.top + 'px', width: data.width + 'px', height: data.height + 'px',
		});
		const marks = data.marks.map(mark => {
			const element = this.overlay.ownerDocument.createElement('span');
			element.className = 'cm-bracket-gutter-mark';
			Object.assign(element.style, {
				left: mark.left + 'px', top: mark.top + 'px', width: mark.width + 'px',
				height: mark.height + 'px', fontSize: mark.fontSize,
			});
			return element;
		});
		this.overlay.replaceChildren(...marks);
	}

	destroy() {
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.overlay.remove();
	}
});

export const bracketMatchingExtension = [
	bracketMatching(),
	bracketGutterOverlay,
	EditorView.editorAttributes.of({ class: 'cm-bracket-matching' }),
	extensionStyles(css),
];
