// .build/extensions/function-line-numbers/index.js
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView as EditorView2, GutterMarker, ViewPlugin as ViewPlugin2, gutter } from "@codemirror/view";

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

// .build/extensions/function-line-numbers/style.css
var style_default = ".cm-editor.cm-function-line-numbers.cm-section-mode .cm-gutters::after {\r\n	content: var(--croq-function-gutter-edge-content, '');\r\n	width: var(--croq-function-gutter-edge-width, 16px);\r\n	background-color: var(--croq-function-gutter-edge-color, color-mix(in srgb, var(--croq-mirror-l-purple, #9a74a3) 25%, transparent));\r\n	background-image: var(--croq-function-gutter-edge-pattern, repeating-linear-gradient(\r\n		135deg, transparent, transparent var(--croq-function-stripe-width, 8px),\r\n		var(--croq-function-stripe-color, color-mix(in srgb, var(--croq-mirror-l-purple, #9a74a3) 15%, transparent)) var(--croq-function-stripe-width, 8px),\r\n		var(--croq-function-stripe-color, color-mix(in srgb, var(--croq-mirror-l-purple, #9a74a3) 15%, transparent)) calc(2 * var(--croq-function-stripe-width, 8px))\r\n	));\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers.cm-section-mode .cm-gutters:hover::after {\r\n	background-color: var(--croq-function-gutter-edge-hover-color, color-mix(in srgb, var(--croq-mirror-l-purple, #9a74a3) 45%, transparent));\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-sectionNumbers {\r\n	overflow: var(--croq-function-gutter-overflow, visible);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-sectionNumbers .cm-gutterElement {\r\n	position: var(--croq-function-gutter-item-position, relative);\r\n	min-width: var(--croq-function-gutter-min-width, 33px);\r\n	padding: var(--croq-function-gutter-item-padding, 0);\r\n	font-variant-numeric: var(--croq-function-number-font-variant, tabular-nums);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers :is(.cm-function-number, .cm-croq-line-number) {\r\n	display: var(--croq-function-number-display, block);\r\n	padding: var(--croq-function-number-padding, 0 7px 0 4px);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-function-number {\r\n	color: var(--croq-function-number-color, var(--croq-mirror-l-brown, #4e4138));\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-croq-line-number {\r\n	color: var(--croq-function-line-color, inherit);\r\n	text-align: var(--croq-function-line-align, right);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-sectionNumbers .cm-gutterElement:has(> .cm-function-even)::before {\r\n	content: var(--croq-function-alternate-content, '');\r\n	position: var(--croq-function-alternate-position, absolute);\r\n	inset: var(--croq-function-alternate-inset, 0 0 0 calc(-1 * var(--croq-mirror-lint-gutter-width, 0px)));\r\n	z-index: var(--croq-function-alternate-z-index, -1);\r\n	pointer-events: var(--croq-function-alternate-pointer-events, none);\r\n	background: var(--croq-function-alternate-background, color-mix(in srgb, var(--croq-mirror-l-lightgray, #e8e8e8) 75%, transparent));\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-activeLineGutter .cm-function-number {\r\n	color: var(--croq-function-active-number-color, inherit);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-section-scroll-markers {\r\n	position: var(--croq-function-scroll-track-position, absolute);\r\n	right: var(--croq-function-scroll-track-right, 0);\r\n	width: var(--croq-function-scroll-marker-track-width, 10px);\r\n	pointer-events: var(--croq-function-scroll-track-pointer-events, none);\r\n	z-index: var(--croq-function-scroll-marker-z-index, 3);\r\n}\r\n\r\n.cm-editor.cm-function-line-numbers .cm-section-scroll-markers > span {\r\n	position: var(--croq-function-scroll-marker-position, absolute);\r\n	inset-inline: var(--croq-function-scroll-marker-inset, 2px);\r\n	aspect-ratio: var(--croq-function-scroll-marker-aspect-ratio, 1);\r\n	border-radius: var(--croq-function-scroll-marker-radius, 50%);\r\n	background: var(--croq-function-scroll-marker-color, hsl(40 100% 50% / 75%));\r\n}\r\n";

// .build/extensions/function-line-numbers/index.js
var setSectionStarts = StateEffect.define();
var sectionNumberState = StateField.define({
  create: () => [],
  update(value, transaction) {
    if (transaction.docChanged || transaction.isUserEvent("load")) value = [];
    for (const effect of transaction.effects) {
      if (!effect.is(setSectionStarts)) continue;
      const starts = effect.value;
      if (!Array.isArray(starts)) throw new TypeError("Section starts must be an array");
      for (let index = 0; index < starts.length; index++) {
        const line = starts[index];
        if (!Number.isInteger(line) || line < 0 || line >= transaction.state.doc.lines || index > 0 && line < starts[index - 1]) {
          throw new RangeError("Section starts must be ordered zero-based document lines");
        }
      }
      value = starts.slice();
    }
    return value;
  }
});
function getSectionLineNumber(state, line) {
  if (!Number.isInteger(line) || line < 0 || line >= state.doc.lines) throw new RangeError("Invalid line");
  const starts = state.field(sectionNumberState);
  let low = 0, high = starts.length;
  while (low < high) {
    const middle = low + high >>> 1;
    if (starts[middle] <= line) low = middle + 1;
    else high = middle;
  }
  return [low, line - (starts[low - 1] ?? 0) + 1];
}
var LineNumber = class extends GutterMarker {
  constructor(section, line) {
    super();
    this.section = section;
    this.line = line;
  }
  eq(other) {
    return this.section === other.section && this.line === other.line;
  }
  toDOM(view) {
    const element = view.dom.ownerDocument.createElement("span");
    const start = this.section > 0 && this.line === 1;
    element.className = start ? "cm-function-number" : "cm-croq-line-number";
    element.classList.toggle("cm-function-even", this.section % 2 !== 0);
    element.textContent = start ? this.section : this.line;
    return element;
  }
};
function widestLineNumber(doc) {
  return "9".repeat(String(doc.lines).length);
}
function numberGutter(sectionMode) {
  return gutter({
    class: sectionMode ? "cm-sectionNumbers" : "cm-lineNumbers",
    lineMarker(view, block) {
      const line = view.state.doc.lineAt(block.from).number;
      return sectionMode ? new LineNumber(...getSectionLineNumber(view.state, line - 1)) : new LineNumber(0, line);
    },
    lineMarkerChange: (update) => sectionMode && update.startState.field(sectionNumberState) !== update.state.field(sectionNumberState),
    initialSpacer: (view) => new LineNumber(0, widestLineNumber(view.state.doc)),
    updateSpacer(spacer, { state }) {
      const number = widestLineNumber(state.doc);
      return spacer.line === number ? spacer : new LineNumber(0, number);
    }
  });
}
var scrollMarkers = ViewPlugin2.fromClass(class {
  constructor(view) {
    this.view = view;
    this.dom = view.dom.ownerDocument.createElement("div");
    this.dom.className = "cm-section-scroll-markers";
    this.dom.setAttribute("aria-hidden", "true");
    view.dom.append(this.dom);
    this.measure = {
      key: this,
      read: (view2) => {
        const root = view2.dom.getBoundingClientRect();
        const frame = view2.scrollDOM.getBoundingClientRect();
        const height = view2.scrollDOM.clientHeight;
        const markers = view2.scrollDOM.scrollHeight > height ? view2.state.field(sectionNumberState).map((line) => {
          const block = view2.lineBlockAt(view2.state.doc.line(line + 1).from);
          return (block.top + view2.defaultLineHeight / 2) / Math.max(view2.contentHeight, 1) * 100;
        }) : [];
        return { top: frame.top - root.top, height, markers };
      },
      write: (data) => {
        this.dom.style.top = data.top + "px";
        this.dom.style.height = data.height + "px";
        this.dom.replaceChildren(...data.markers.map((position) => {
          const marker = this.dom.ownerDocument.createElement("span");
          marker.style.top = position + "%";
          return marker;
        }));
      }
    };
    this.onScroll = () => this.refresh();
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.refresh();
  }
  update(update) {
    if (update.docChanged || update.geometryChanged || update.viewportChanged || update.startState.field(sectionNumberState) !== update.state.field(sectionNumberState)) this.refresh();
  }
  refresh() {
    this.view.requestMeasure(this.measure);
  }
  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }
});
var absoluteLineNumbers = numberGutter(false);
var functionLineNumbers = [
  sectionNumberState,
  numberGutter(true),
  scrollMarkers,
  EditorView2.editorAttributes.of({ class: "cm-section-mode cm-function-line-numbers" }),
  extensionStyles(style_default)
];
function refreshFunctionLineNumbers(view) {
  view.plugin(scrollMarkers)?.refresh();
}
export {
  absoluteLineNumbers,
  functionLineNumbers,
  getSectionLineNumber,
  refreshFunctionLineNumbers,
  sectionNumberState,
  setSectionStarts
};
