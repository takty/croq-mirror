export function drawStructure(canvas, { width, height, charWidth, lineHeight, decorations }) {
	const scale = canvas.ownerDocument.defaultView.devicePixelRatio;
	const pixelsWide = Math.round(width * scale), pixelsHigh = Math.round(height * scale);
	if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
	if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
	const ctx = canvas.getContext('2d');
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	ctx.clearRect(0, 0, width, height);
	if (!width || !height) return;

	const padding = Math.min(3, lineHeight / 4);
	const band = lineHeight - padding * 2;
	for (const item of decorations) {
		const { start, end } = item;
		ctx.fillStyle = item.fill;
		if (item.kind === 'range') {
			const left = start.x + 4;
			const spine = Math.max(1, item.spine - 4);
			const top = start.y + padding;
			const bottom = end.y + padding;
			fill(ctx, left, top, spine, bottom - top + band, [band / 2, 0, 0, band / 2]);
			fill(ctx, left + spine, top, width / 2, band, [0, band / 2, band / 2, 0]);
			if (item.from.line !== item.to.line) {
				fill(ctx, left + spine, bottom, width / 2, band, [0, band / 2, band / 2, 0]);
			}
			for (const row of item.branchRows) {
				fill(ctx, left + spine, row + padding, Math.max(1, item.branchWidth - 4), band, [0, band / 2, band / 2, 0]);
			}
		} else {
			const x = start.x - 2;
			const tokenHeight = charWidth * 1.9;
			const y = start.y + (lineHeight - tokenHeight) / 2;
			const h = end.y - start.y + tokenHeight;
			if (fill(ctx, x, y, end.x - x + 4, h, [0, lineHeight / 4, lineHeight / 4, 0])) {
				ctx.strokeStyle = item.stroke;
				ctx.lineWidth = 0.5;
				ctx.stroke();
				ctx.lineWidth = charWidth * 0.35;
				ctx.beginPath();
				ctx.moveTo(x - ctx.lineWidth / 2, y - 0.5);
				ctx.lineTo(x - ctx.lineWidth / 2, y + h + 0.5);
				ctx.stroke();
			}
		}
	}
}

function fill(ctx, x, y, width, height, radii) {
	if (width <= 0 || height <= 0) return false;
	ctx.beginPath();
	ctx.roundRect(x, y, width, height, radii);
	ctx.fill();
	return true;
}
