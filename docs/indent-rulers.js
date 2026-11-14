// .build/extensions/indent-rulers/index.js
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

// .build/extensions/indent-rulers/style.css
var style_default = ".cm-editor.cm-indent-rulers .cm-scroller {\r\n	z-index: var(--croq-indent-ruler-scroller-z-index, var(--croq-structure-scroller-z-index, auto));\r\n}\r\n\r\n.cm-editor.cm-indent-rulers .cm-content {\r\n	z-index: var(--croq-indent-ruler-content-z-index, var(--croq-structure-content-z-index, 1));\r\n}\r\n\r\n.cm-editor.cm-indent-rulers .cm-ruler-overlay {\r\n	position: var(--croq-indent-ruler-overlay-position, absolute);\r\n	z-index: var(--croq-indent-ruler-overlay-z-index, 0);\r\n	overflow: var(--croq-indent-ruler-overlay-overflow, hidden);\r\n	pointer-events: var(--croq-indent-ruler-pointer-events, none);\r\n}\r\n\r\n.cm-editor.cm-indent-rulers .cm-croq-rulers {\r\n	position: var(--croq-indent-ruler-container-position, absolute);\r\n	inset-block: var(--croq-indent-ruler-inset-block, 0);\r\n	right: var(--croq-indent-ruler-container-right, 0);\r\n}\r\n\r\n.cm-editor.cm-indent-rulers .cm-croq-rulers > span {\r\n	position: var(--croq-indent-ruler-position, absolute);\r\n	inset-block: var(--croq-indent-ruler-inset-block, 0);\r\n	left: calc(var(--croq-indent-ruler-column, var(--ruler-column)) * var(--ruler-character-width));\r\n	border-left: var(--croq-indent-ruler-width, 2px) var(--croq-indent-ruler-style, dashed)\r\n		var(--croq-indent-ruler-color, color-mix(in srgb, var(--croq-mirror-l-red, #e61e58) 15%, transparent));\r\n}\r\n";

// .build/extensions/indent-rulers/index.js
var columns = [4, 8, 12];
var rulerPlugin = ViewPlugin2.fromClass(class {
  constructor(view) {
    this.view = view;
    const document = view.dom.ownerDocument;
    this.overlay = document.createElement("div");
    this.overlay.className = "cm-ruler-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    this.ruler = document.createElement("div");
    this.ruler.className = "cm-croq-rulers";
    this.ruler.append(...columns.map((column) => {
      const rule = document.createElement("span");
      rule.style.setProperty("--ruler-column", column);
      return rule;
    }));
    this.overlay.append(this.ruler);
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
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      this.refresh();
    }
  }
  refresh() {
    this.view.requestMeasure(this.measure);
  }
  read(view) {
    const root = view.dom.getBoundingClientRect();
    const scroller = view.scrollDOM;
    const frame = scroller.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const line = view.contentDOM.querySelector(".cm-line");
    const lineStart = line ? line.getBoundingClientRect().left + parseFloat(view.dom.ownerDocument.defaultView.getComputedStyle(line).paddingLeft) : content.left;
    const left = Math.max(frame.left, content.left);
    return {
      left: left - root.left,
      top: frame.top - root.top,
      width: Math.max(0, Math.min(view.defaultCharacterWidth * 64, frame.left + scroller.clientWidth - left)),
      height: scroller.clientHeight,
      rulerX: lineStart - left,
      charWidth: view.defaultCharacterWidth
    };
  }
  write(data) {
    Object.assign(
      this.overlay.style,
      {
        left: data.left + "px",
        top: data.top + "px",
        width: data.width + "px",
        height: data.height + "px"
      }
    );
    this.ruler.style.left = data.rulerX + "px";
    this.ruler.style.setProperty("--ruler-character-width", data.charWidth + "px");
  }
  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.overlay.remove();
  }
});
var indentRulers = [
  rulerPlugin,
  EditorView2.editorAttributes.of({ class: "cm-indent-rulers" }),
  extensionStyles(style_default)
];
function refreshIndentRulers(view) {
  view.plugin(rulerPlugin)?.refresh();
}
export {
  indentRulers,
  refreshIndentRulers
};
