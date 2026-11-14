// .build/extensions/gutter-line-selection/index.js
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import { EditorView as EditorView2, ViewPlugin as ViewPlugin2 } from "@codemirror/view";

// .build/extensions/gutter-line-selection/cursor-right.svg
var cursor_right_default = "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeD0iMHB4IiB5PSIwcHgiDQoJIHdpZHRoPSIzMnB4IiBoZWlnaHQ9IjMycHgiIHZpZXdCb3g9IjAgMCAzMiAzMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMzIgMzI7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxwb2x5Z29uIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBwb2ludHM9IjIyLDggMjEsMjMuMiAxOS42LDIzLjYgMTcuNCwyMC4zIDE0LjcsMjUuNiAxMiwyNC4yIDE0LjcsMTguOSAxMC43LDE5LjEgMTAuMywxNy43Ii8+DQo8L3N2Zz4NCg==";

// .build/extensions/gutter-line-selection/cursor-line.svg
var cursor_line_default = "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeD0iMHB4IiB5PSIwcHgiDQoJIHdpZHRoPSIzMnB4IiBoZWlnaHQ9IjMycHgiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZW5hYmxlLWJhY2tncm91bmQ9Im5ldyAwIDAgMzIgMzIiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPHJlY3QgeD0iNSIgeT0iNyIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHdpZHRoPSIxMiIgaGVpZ2h0PSIzIi8+DQo8cmVjdCB4PSI1IiB5PSIxMyIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHdpZHRoPSIxMiIgaGVpZ2h0PSIzIi8+DQo8cG9seWdvbiBmaWxsPSIjZmZmIiBzdHJva2U9IiMwMDAiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgcG9pbnRzPSIyMiw4IDIxLDIzLjIgMTkuNiwyMy42IDE3LjQsMjAuMyAxNC43LDI1LjYgMTIsMjQuMiANCgkxNC43LDE4LjkgMTAuNywxOS4xIDEwLjMsMTcuNyAiLz4NCjwvc3ZnPg0K";

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

// .build/extensions/gutter-line-selection/style.css
var style_default = '.cm-editor.cm-gutter-line-selection :is(.cm-lineNumbers, .cm-sectionNumbers) {\r\n	cursor: var(--croq-gutter-cursor, url("./cursor-right.svg") 22 8, pointer);\r\n}\r\n\r\n.cm-editor.cm-gutter-line-selection.line-selection-mode :is(.cm-lineNumbers, .cm-sectionNumbers) {\r\n	cursor: var(--croq-gutter-line-selection-cursor, url("./cursor-line.svg") 22 8, pointer);\r\n}\r\n';

// .build/extensions/gutter-line-selection/index.js
var setEasyLineSelectionMode = StateEffect.define();
var setLineSelectionMode = setEasyLineSelectionMode;
var lineSelectionMode = StateField.define({
  create: () => false,
  update(value, transaction) {
    if (transaction.docChanged || transaction.isUserEvent("load") || transaction.selection && transaction.state.selection.main.empty) value = false;
    for (const effect of transaction.effects) {
      if (effect.is(setEasyLineSelectionMode)) value = !!effect.value;
    }
    return value;
  },
  provide: (field) => EditorView2.editorAttributes.from(field, (enabled) => enabled ? { class: "line-selection-mode" } : {})
});
var gutterSelection = ViewPlugin2.fromClass(class {
  constructor(view) {
    this.view = view;
    this.anchor = null;
    this.down = null;
    this.dragged = false;
    this.abort = new AbortController();
    const listen = (target, type, listener) => target.addEventListener(type, listener, { signal: this.abort.signal });
    listen(view.dom, "mousedown", (event) => this.mouseDown(event));
    listen(view.dom, "mousemove", (event) => this.mouseMove(event));
    listen(view.dom.ownerDocument.defaultView, "mouseup", (event) => this.mouseUp(event));
    listen(view.dom.ownerDocument.defaultView, "blur", () => this.setMode(false));
  }
  lineAt(event) {
    const { view } = this;
    const position = view.posAtCoords({
      x: view.contentDOM.getBoundingClientRect().left + 2,
      y: event.clientY
    }, false);
    return position === null ? null : view.state.doc.lineAt(position).number;
  }
  select(line) {
    const { view, anchor } = this;
    const { doc } = view.state;
    const from = doc.line(Math.min(anchor, doc.lines));
    const to = doc.line(line);
    const tail = (row) => Math.min(doc.length, row.to + 1);
    view.dispatch({
      selection: anchor <= line ? EditorSelection.single(from.from, tail(to)) : EditorSelection.single(tail(from), to.from),
      userEvent: "select.pointer"
    });
  }
  setMode(enabled) {
    if (this.view.state.field(lineSelectionMode, false) !== void 0) {
      this.view.dispatch({ effects: setEasyLineSelectionMode.of(enabled) });
    }
  }
  update(update) {
    if (update.docChanged || update.transactions.some((transaction) => transaction.isUserEvent("load"))) {
      this.anchor = null;
      this.down = null;
    } else if (update.selectionSet && update.state.selection.main.empty) {
      this.anchor = null;
    }
  }
  mouseDown(event) {
    const { view } = this;
    if (event.button !== 0 || !view.state.facet(EditorView2.editable) || !event.target.closest(".cm-gutters")) return;
    if (event.target.closest(".cm-lint-marker")) return;
    const line = this.lineAt(event);
    if (line === null) return;
    event.preventDefault();
    this.down = line;
    this.dragged = false;
    if (event.shiftKey) {
      this.anchor ??= view.state.doc.lineAt(view.state.selection.main.head).number;
      this.setMode(false);
    } else if (!view.state.field(lineSelectionMode, false) || this.anchor === null) {
      this.anchor = line;
    }
    this.select(line);
    view.focus();
  }
  mouseMove(event) {
    if (this.down === null || event.buttons !== 1) return;
    const line = this.lineAt(event);
    if (line !== null) {
      if (!this.dragged && line !== this.down) {
        this.dragged = true;
        if (!event.shiftKey) this.anchor = this.down;
        this.setMode(false);
      }
      this.select(line);
    }
  }
  mouseUp(event) {
    if (this.down !== null && !this.dragged && !event.shiftKey && !this.view.state.field(lineSelectionMode, false) && event.target.closest?.(".cm-gutters") && this.lineAt(event) === this.down) {
      this.setMode(true);
      this.anchor = this.down;
    }
    this.down = null;
  }
  destroy() {
    this.abort.abort();
  }
});
var standardGutterLineSelection = [
  gutterSelection,
  EditorView2.editorAttributes.of({ class: "cm-gutter-line-selection" }),
  extensionStyles(style_default.replace("./cursor-right.svg", `data:image/svg+xml;base64,${cursor_right_default}`).replace("./cursor-line.svg", `data:image/svg+xml;base64,${cursor_line_default}`))
];
var easyLineSelection = [
  standardGutterLineSelection,
  lineSelectionMode,
  EditorView2.editorAttributes.of({ class: "cm-easy-line-selection" })
];
var gutterLineSelection = easyLineSelection;
export {
  easyLineSelection,
  gutterLineSelection,
  setEasyLineSelectionMode,
  setLineSelectionMode,
  standardGutterLineSelection
};
