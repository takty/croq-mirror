import { EditorView, RectangleMarker, drawSelection, layer } from '@codemirror/view';
import { extensionStyles } from '../styles.js';
import css from './style.css';

const EPSILON = 0.01;

function rowAt(view, height) {
	const padding = view.documentPadding.top;
	const block = view.lineBlockAtHeight(Math.max(0, height - padding));
	const blockTop = padding + block.top;
	const lineHeight = view.defaultLineHeight;
	const offset = Math.max(0, Math.min(block.height - EPSILON, height - blockTop));
	const top = blockTop + Math.floor(offset / lineHeight) * lineHeight;
	return { top, bottom: Math.min(blockTop + block.height, top + lineHeight) };
}

function normalizedBands(view, markers) {
	const bands = [];
	for (const marker of markers) {
		let band = bands.find(item => Math.abs(item.top - marker.top) < EPSILON && Math.abs(item.height - marker.height) < EPSILON);
		if (!band) {
			band = { top: marker.top, height: marker.height, markers: [] };
			bands.push(band);
		}
		band.markers.push(marker);
	}
	bands.sort((a, b) => a.top - b.top);
	for (const band of bands) {
		if (band.height <= view.defaultLineHeight * 1.5) {
			const row = rowAt(view, band.top + band.height / 2);
			band.normalizedTop = row.top;
			band.normalizedBottom = row.bottom;
		} else {
			band.normalizedTop = band.top;
			band.normalizedBottom = band.top + band.height;
		}
	}
	for (let index = 0; index < bands.length; index++) {
		const band = bands[index];
		if (band.height <= view.defaultLineHeight * 1.5) continue;
		const previous = bands[index - 1];
		const next = bands[index + 1];
		if (previous) band.normalizedTop = previous.normalizedBottom;
		if (next) band.normalizedBottom = next.normalizedTop;
	}
	return bands;
}

function selectionMarkers(view) {
	const result = [];
	for (const range of view.state.selection.ranges) {
		if (range.empty) continue;
		const markers = RectangleMarker.forRange(view, 'cm-selectionBackground', range);
		for (const band of normalizedBands(view, markers)) {
			const height = Math.max(0, band.normalizedBottom - band.normalizedTop);
			for (const marker of band.markers) {
				result.push(new RectangleMarker(marker.className, marker.left, band.normalizedTop, marker.width, height));
			}
		}
	}
	return result;
}

const selectionLayer = layer({
	above: false,
	class: 'cm-full-line-selectionLayer',
	markers: selectionMarkers,
	update: update => update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
});

export function fullLineSelection(config) {
	return [
		drawSelection(config),
		selectionLayer,
		EditorView.editorAttributes.of({ class: 'cm-full-line-selection' }),
		extensionStyles(css),
	];
}
