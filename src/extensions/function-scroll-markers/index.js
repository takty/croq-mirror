import { EditorView, ViewPlugin } from '@codemirror/view';
import { commonAnalysisState } from '../../analysis/common-analysis.js';
import { extensionStyles } from '../styles.js';
import css from './style.css';

function sectionStarts(state) {
	const analysis = state.field(commonAnalysisState, false);
	return analysis?.sections.map(section => state.doc.lineAt(section.from).number - 1) ?? [];
}

const scrollMarkers = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		this.dom = view.dom.ownerDocument.createElement('div');
		this.dom.className = 'cm-function-scroll-markers';
		this.dom.setAttribute('aria-hidden', 'true');
		view.dom.append(this.dom);
		this.measure = {
			key: this,
			read: view => {
				const root = view.dom.getBoundingClientRect();
				const scroller = view.scrollDOM;
				const frame = scroller.getBoundingClientRect();
				const style = scroller.ownerDocument.defaultView.getComputedStyle(scroller);
				const borderLeft = parseFloat(style.borderLeftWidth);
				const borderRight = parseFloat(style.borderRightWidth);
				const scrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth - Math.round(borderLeft + borderRight));
				// Overlay scrollbars reserve no space. Keep a track at the scrollport edge in that case.
				const trackWidth = scrollbarWidth || 10;
				const scrollbarOnLeft = scroller.clientLeft > Math.round(borderLeft);
				const edge = scrollbarOnLeft ? frame.left + borderLeft : frame.right - borderRight;
				const center = edge + (scrollbarOnLeft ? trackWidth : -trackWidth) / 2;
				const centerInset = root.left + view.dom.clientLeft + view.dom.clientWidth - center;
				const height = scroller.clientHeight;
				const markers = scroller.scrollHeight > height ? sectionStarts(view.state).map(line => {
					const block = view.lineBlockAt(view.state.doc.line(line + 1).from);
					return (block.top + view.defaultLineHeight / 2) / Math.max(view.contentHeight, 1) * 100;
				}) : [];
				return { top: frame.top - root.top, height, centerInset, trackWidth, markers };
			},
			write: data => {
				this.dom.style.top = data.top + 'px';
				this.dom.style.height = data.height + 'px';
				this.dom.style.setProperty('--croq-function-scrollbar-center-inset', `${data.centerInset}px`);
				this.dom.style.setProperty('--croq-function-scrollbar-width', `${data.trackWidth}px`);
				this.dom.replaceChildren(...data.markers.map(position => {
					const marker = this.dom.ownerDocument.createElement('span');
					marker.style.top = position + '%';
					return marker;
				}));
			},
		};
		this.onScroll = () => this.refresh();
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		this.refresh();
	}

	update(update) {
		if (update.docChanged || update.geometryChanged || update.viewportChanged ||
			update.startState.field(commonAnalysisState, false) !== update.state.field(commonAnalysisState, false)) this.refresh();
	}

	refresh() {
		this.view.requestMeasure(this.measure);
	}

	destroy() {
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.dom.remove();
	}
});

export const functionScrollMarkers = [
	scrollMarkers,
	EditorView.editorAttributes.of({ class: 'cm-function-scroll-markers' }),
	extensionStyles(css),
];

export function refreshFunctionScrollMarkers(view) {
	view.plugin(scrollMarkers)?.refresh();
}
