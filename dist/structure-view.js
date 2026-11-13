// src/extensions/structure-view/index.js
import { Facet, StateEffect, StateField, countColumn } from "@codemirror/state";
import { EditorView as EditorView2, ViewPlugin as ViewPlugin2 } from "@codemirror/view";
import { commonAnalysisState } from "croq-mirror/analysis";

// src/extensions/styles.js
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

// src/extensions/structure-view/style.css
var style_default = ".cm-editor.cm-structure-view .cm-scroller {\r\n	z-index: var(--croq-structure-scroller-z-index, auto);\r\n}\r\n\r\n.cm-editor.cm-structure-view .cm-content {\r\n	z-index: var(--croq-structure-content-z-index, 1);\r\n}\r\n\r\n.cm-editor.cm-structure-view .cm-structure-overlay {\r\n	position: var(--croq-structure-overlay-position, absolute);\r\n	z-index: var(--croq-structure-overlay-z-index, 0);\r\n	overflow: var(--croq-structure-overlay-overflow, hidden);\r\n	pointer-events: var(--croq-structure-overlay-pointer-events, none);\r\n}\r\n\r\n.cm-editor.cm-structure-view .code-structure-view {\r\n	display: var(--croq-structure-canvas-display, block);\r\n	width: var(--croq-structure-canvas-width, 100%);\r\n	height: var(--croq-structure-canvas-height, 100%);\r\n}\r\n";

// src/extensions/structure-view/index.js
var setStructure = StateEffect.define();
var retainOnEditFacet = Facet.define({ combine: (values) => values.some(Boolean) });
var displayOptions = Facet.define({ combine: (values) => values.at(-1) ?? { structures: true, declarations: true } });
var retainStructureOnEdit = retainOnEditFacet.of(true);
function structureViewOptions(options) {
  if (!options || typeof options.structures !== "boolean" || typeof options.declarations !== "boolean") {
    throw new TypeError("Structure view options must specify structures and declarations");
  }
  return displayOptions.of(options);
}
function mapUnchangedStructure(items, transaction) {
  const oldDoc = transaction.startState.doc, newDoc = transaction.newDoc;
  const affected = [];
  let unsafeFrom = Infinity;
  transaction.changes.iterChanges((from, to, newFrom, newTo) => {
    const first = oldDoc.lineAt(from).number - 1, last = oldDoc.lineAt(to).number - 1;
    const removed = oldDoc.sliceString(from, to), inserted = newDoc.sliceString(newFrom, newTo);
    const changed = removed + inserted;
    const oldContext = oldDoc.sliceString(Math.max(0, from - 1), Math.min(oldDoc.length, to + 1));
    const newContext = newDoc.sliceString(Math.max(0, newFrom - 1), Math.min(newDoc.length, newTo + 1));
    const line = oldDoc.lineAt(from);
    const prefix = line.text.slice(0, from - line.from), suffix = line.text.slice(from - line.from);
    const newlineInsertion = from === to && /^[ \t\n]*\n[ \t\n]*$/.test(inserted) && !(/\/\/|\b(?:return|throw|break|continue|yield)\s*$/.test(prefix) && suffix.trim()) && !(/[\w$]$/.test(prefix) && /^[\w$]/.test(suffix));
    const indentation = transaction.isUserEvent("format") && /^[ \t]*$/.test(changed) && /^[ \t]*$/.test(line.text.slice(0, to - line.from));
    const layoutOnly = newlineInsertion || indentation;
    affected.push({ first, last, from, to, layoutOnly });
    if (!layoutOnly && /[()[\]{}/*'"`\\\n;:,?]/.test(changed) || /\/\/|\/\*|\*\//.test(oldContext + "\n" + newContext)) {
      unsafeFrom = Math.min(unsafeFrom, first);
    }
    if (!layoutOnly && /\b(?:else|catch|finally|while)\b/.test(line.text + "\n" + newDoc.lineAt(newFrom).text)) {
      let preceding = first;
      while (preceding > 0 && !oldDoc.line(preceding).text.trim()) preceding--;
      unsafeFrom = Math.min(unsafeFrom, Math.max(0, preceding - 1));
    }
  });
  const offset = (position) => {
    const line = oldDoc.line(Math.max(1, Math.min(oldDoc.lines, position.line + 1)));
    return line.from + Math.max(0, Math.min(line.length, position.ch ?? 0));
  };
  const mapPosition = (position, assoc) => {
    const mapped = transaction.changes.mapPos(offset(position), assoc);
    const line = newDoc.lineAt(mapped);
    return { line: line.number - 1, ch: mapped - line.from };
  };
  return items.filter((item) => item.to.line < unsafeFrom && !affected.some(({ first, last, from, to, layoutOnly }) => {
    if (!layoutOnly) return item.from.line <= last && item.to.line >= first;
    if (item.kind !== "token") return false;
    const start = offset(item.from), end = offset(item.to);
    return from < end && to > start || from === to && from > start && from < end;
  })).map((item) => ({
    ...item,
    from: mapPosition(item.from, 1),
    to: mapPosition(item.to, -1),
    ...item.kind === "range" ? { branches: item.branches.map((branch) => mapPosition(branch, 1)) } : {}
  }));
}
var structureField = StateField.define({
  create: () => [],
  update(value, transaction) {
    if (transaction.isUserEvent("load")) value = [];
    else if (transaction.docChanged) value = transaction.state.facet(retainOnEditFacet) ? mapUnchangedStructure(value, transaction) : [];
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
    if (update.docChanged || update.geometryChanged || update.viewportChanged || update.startState.field(structureField) !== update.state.field(structureField) || update.startState.field(commonAnalysisState, false) !== update.state.field(commonAnalysisState, false) || update.startState.facet(displayOptions) !== update.state.facet(displayOptions)) this.refresh();
  }
  refresh() {
    this.view.requestMeasure(this.measure);
  }
  read(view) {
    const root = view.dom.getBoundingClientRect();
    const scroller = view.scrollDOM;
    const frame = scroller.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const window = view.dom.ownerDocument.defaultView;
    const colors = window.getComputedStyle(view.dom);
    const resolveColor = (value) => {
      const match = /^var\(\s*(--[\w-]+)\s*,\s*(.+)\)$/.exec(value);
      return match ? colors.getPropertyValue(match[1]).trim() || match[2] : value;
    };
    const linePadding = parseFloat(window.getComputedStyle(view.contentDOM).getPropertyValue("--croq-mirror-line-padding")) || 0;
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
    const analysis = view.state.field(commonAnalysisState, false);
    const options = view.state.facet(displayOptions);
    const source = analysis ? commonDecorations(analysis, doc, options) : view.state.field(structureField);
    const decorations = source.map((item) => {
      const start = coords(item.from);
      const end = coords(item.to, -1);
      const fill2 = resolveColor(item.fill);
      if (item.kind === "token") return { ...item, fill: fill2, stroke: resolveColor(item.stroke), start, end };
      return {
        ...item,
        fill: fill2,
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
function commonDecorations(analysis, doc, options) {
  const colors = {
    class: ["var(--croq-mirror-l-red, #e61e58)", 0.15],
    function: ["hsla(40, 100%, 50%, 0.15)"],
    conditional: ["hsla(150, 100%, 35%, 0.15)"],
    loop: ["hsla(190, 90%, 50%, 0.20)"]
  };
  const position = (offset) => {
    const line = doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const decorations = [];
  if (options.structures) {
    for (const item of analysis.structures) {
      const [fill2, opacity] = colors[item.kind];
      decorations.push({
        kind: "range",
        from: position(item.from),
        to: position(item.to),
        fill: fill2,
        ...opacity === void 0 ? {} : { opacity },
        spineChars: 3,
        branchChars: 4,
        branches: item.branches.map(position)
      });
    }
  }
  if (options.declarations) {
    for (const item of analysis.declarations) {
      const colors2 = item.scope === "function" ? ["hsla(0, 0%, 97%, 1)", "hsla(0, 0%, 69%, 0.75)"] : item.mutability === "immutable" ? ["hsla(240, 75%, 97%, 1)", "hsla(240, 75%, 65%, 0.75)"] : ["hsla(205, 100%, 97%, 1)", "hsla(205, 100%, 52%, 0.75)"];
      decorations.push({
        kind: "token",
        from: position(item.from),
        to: position(item.to),
        fill: colors2[0],
        stroke: colors2[1]
      });
    }
  }
  return decorations;
}
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
    ctx.globalAlpha = item.opacity ?? 1;
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
    ctx.globalAlpha = 1;
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
  retainStructureOnEdit,
  setStructure,
  structureView,
  structureViewOptions
};
