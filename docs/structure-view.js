// .build/extensions/structure-view/index.js
import { StateEffect, StateField, countColumn } from "@codemirror/state";
import { EditorView as EditorView2, ViewPlugin as ViewPlugin2 } from "@codemirror/view";

// .build/extensions/styles.js
import { EditorView, ViewPlugin } from "@codemirror/view";
function extensionStyles(css) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.style = view.dom.ownerDocument.createElement("style");
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

// .build/extensions/structure-view/style.css
var style_default = ".cm-editor.cm-structure-view .cm-scroller {\r\n	z-index: var(--croq-structure-scroller-z-index, auto);\r\n}\r\n\r\n.cm-editor.cm-structure-view .cm-content {\r\n	z-index: var(--croq-structure-content-z-index, 1);\r\n}\r\n\r\n.cm-editor.cm-structure-view .cm-structure-overlay {\r\n	position: var(--croq-structure-overlay-position, absolute);\r\n	z-index: var(--croq-structure-overlay-z-index, 0);\r\n	overflow: var(--croq-structure-overlay-overflow, hidden);\r\n	pointer-events: var(--croq-structure-overlay-pointer-events, none);\r\n}\r\n\r\n.cm-editor.cm-structure-view .code-structure-view {\r\n	display: var(--croq-structure-canvas-display, block);\r\n	width: var(--croq-structure-canvas-width, 100%);\r\n	height: var(--croq-structure-canvas-height, 100%);\r\n}\r\n";

// .build/extensions/structure-view/index.js
var setStructure = StateEffect.define();
var structureField = StateField.define({
  create: () => [],
  update(value, transaction) {
    if (transaction.docChanged || transaction.isUserEvent("load")) value = [];
    for (const effect of transaction.effects) if (effect.is(setStructure)) value = effect.value;
    return value;
  }
});
var structurePlugin = ViewPlugin2.fromClass(class {
  constructor(view) {
    this.view = view;
    const document = view.dom.ownerDocument;
    this.overlay = document.createElement("div");
    this.overlay.className = "cm-structure-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "code-structure-view";
    this.overlay.append(this.canvas);
    view.dom.append(this.overlay);
    this.measure = {
      key: this,
      read: (view2) => this.read(view2),
      write: (data) => this.write(data)
    };
    this.onScroll = () => this.refresh();
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.refresh();
  }
  update(update) {
    if (update.docChanged || update.geometryChanged || update.viewportChanged || update.startState.field(structureField) !== update.state.field(structureField)) this.refresh();
  }
  refresh() {
    this.view.requestMeasure(this.measure);
  }
  read(view) {
    const root = view.dom.getBoundingClientRect();
    const scroller = view.scrollDOM;
    const frame = scroller.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const linePadding = parseFloat(view.dom.ownerDocument.defaultView.getComputedStyle(view.contentDOM).getPropertyValue("--croq-mirror-line-padding")) || 0;
    const left = Math.max(frame.left, content.left);
    const width = Math.max(0, Math.min(view.defaultCharacterWidth * 64, frame.left + scroller.clientWidth - left));
    const height = scroller.clientHeight;
    const { doc, tabSize } = view.state;
    const coords = (pos, side = 1) => {
      const line = doc.line(Math.max(1, Math.min(doc.lines, pos.line + 1)));
      const offset = line.from + Math.max(0, Math.min(line.length, pos.ch ?? 0));
      const measured = view.coordsAtPos(offset, side);
      const block = view.lineBlockAt(offset);
      const lineTop = view.documentTop + block.top - frame.top;
      if (measured) {
        const glyphTop = (measured.top + measured.bottom - view.defaultLineHeight) / 2 - frame.top;
        const row = Math.max(0, Math.round((glyphTop - lineTop) / view.defaultLineHeight));
        return { x: measured.left - left, y: lineTop + row * view.defaultLineHeight };
      }
      const columns = countColumn(doc.sliceString(block.from, offset), tabSize);
      return { x: content.left - left + linePadding + columns * view.defaultCharacterWidth, y: lineTop };
    };
    const decorations = view.state.field(structureField).map((item) => {
      const start = coords(item.from);
      const end = coords(item.to, -1);
      if (item.kind === "token") return { ...item, start, end };
      return {
        ...item,
        start,
        end,
        spine: coords({ ...item.from, ch: item.from.ch + item.spineChars + 1 }, -1).x - start.x - item.spineChars,
        branchWidth: coords({ ...item.from, ch: item.from.ch + item.branchChars + 1 }, -1).x - start.x - item.branchChars,
        branchRows: item.branches.map((branch) => coords(branch).y)
      };
    });
    return {
      left: left - root.left,
      top: frame.top - root.top,
      width,
      height,
      charWidth: view.defaultCharacterWidth,
      lineHeight: view.defaultLineHeight,
      decorations
    };
  }
  write(data) {
    Object.assign(this.overlay.style, { left: data.left + "px", top: data.top + "px", width: data.width + "px", height: data.height + "px" });
    drawStructure(this.canvas, data);
  }
  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.overlay.remove();
  }
});
var structureView = [
  structureField,
  structurePlugin,
  EditorView2.editorAttributes.of({ class: "cm-structure-view" }),
  extensionStyles(style_default)
];
function refreshStructure(view) {
  view.plugin(structurePlugin)?.refresh();
}
function drawStructure(canvas, { width, height, charWidth, lineHeight, decorations }) {
  const scale = canvas.ownerDocument.defaultView.devicePixelRatio;
  const pixelsWide = Math.round(width * scale), pixelsHigh = Math.round(height * scale);
  if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
  if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!width || !height) return;
  const padding = Math.min(3, lineHeight / 4);
  const band = lineHeight - padding * 2;
  for (const item of decorations) {
    const { start, end } = item;
    ctx.fillStyle = item.fill;
    if (item.kind === "range") {
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
export {
  refreshStructure,
  setStructure,
  structureView
};
