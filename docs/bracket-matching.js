// .build/extensions/bracket-matching/index.js
import { bracketMatching } from "@codemirror/language";
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

// .build/extensions/bracket-matching/style.css
var style_default = ".cm-editor.cm-bracket-matching :is(.cm-matchingBracket, .cm-bracket-gutter-mark) {\r\n	background: transparent;\r\n	color: inherit;\r\n	font-weight: bold;\r\n	position: relative;\r\n	isolation: isolate;\r\n}\r\n\r\n.cm-editor.cm-bracket-matching .cm-bracket-gutter-overlay {\r\n	position: absolute;\r\n	z-index: 4;\r\n	overflow: hidden;\r\n	pointer-events: none;\r\n}\r\n\r\n.cm-editor.cm-bracket-matching .cm-bracket-gutter-mark { position: absolute; }\r\n\r\n.cm-editor.cm-bracket-matching :is(.cm-matchingBracket, .cm-bracket-gutter-mark)::before {\r\n	content: '';\r\n	position: absolute;\r\n	z-index: -1;\r\n	top: -0.45em;\r\n	left: -0.75em;\r\n	right: -0.75em;\r\n	bottom: -0.45em;\r\n	border-radius: 50%;\r\n	border: 0.5em solid color-mix(in srgb, var(--croq-mirror-l-yellow) 65%, transparent);\r\n}\r\n\r\n.cm-editor.cm-bracket-matching .cm-activeLine .cm-matchingBracket::before {\r\n	top: 0;\r\n	left: 0.05em;\r\n	right: 0.05em;\r\n	bottom: 0;\r\n	border-radius: 0.25em;\r\n	border: none;\r\n	background-color: color-mix(in srgb, var(--croq-mirror-l-yellow) 65%, transparent);\r\n}\r\n\r\n.cm-editor.cm-bracket-matching :is(\r\n	.cm-syntax-comment .cm-matchingBracket,\r\n	.cm-matchingBracket.cm-syntax-comment,\r\n	.cm-matchingBracket:has(.cm-syntax-comment)\r\n)::before {\r\n	content: none;\r\n}\r\n";

// .build/extensions/bracket-matching/index.js
var bracketGutterOverlay = ViewPlugin2.fromClass(class {
  constructor(view) {
    this.view = view;
    this.overlay = view.dom.ownerDocument.createElement("div");
    this.overlay.className = "cm-bracket-gutter-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    view.dom.append(this.overlay);
    this.measure = { key: this, read: (view2) => this.read(view2), write: (data) => this.write(data) };
    this.onScroll = () => this.refresh();
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.refresh();
  }
  update() {
    this.refresh();
  }
  refresh() {
    this.view.requestMeasure(this.measure);
  }
  read(view) {
    const gutter = view.dom.querySelector(".cm-gutters");
    if (!gutter) return null;
    const window = view.dom.ownerDocument.defaultView;
    const editor = view.dom.getBoundingClientRect();
    const frame = view.scrollDOM.getBoundingClientRect();
    const gutterBox = gutter.getBoundingClientRect();
    const width = Math.min(gutterBox.width, parseFloat(window.getComputedStyle(gutter, "::after").width) || 0);
    const left = gutterBox.right - width;
    const marks = [];
    for (const bracket of view.contentDOM.querySelectorAll(".cm-matchingBracket")) {
      if (bracket.closest(".cm-activeLine, .cm-syntax-comment") || bracket.querySelector(".cm-syntax-comment")) {
        continue;
      }
      const box = bracket.getBoundingClientRect();
      const fontSize = window.getComputedStyle(bracket).fontSize;
      if (box.left < gutterBox.right || box.left - 0.75 * parseFloat(fontSize) >= gutterBox.right) {
        continue;
      }
      marks.push({ left: box.left - left, top: box.top - frame.top, width: box.width, height: box.height, fontSize });
    }
    return {
      left: left - editor.left,
      top: frame.top - editor.top,
      width,
      height: view.scrollDOM.clientHeight,
      marks
    };
  }
  write(data) {
    if (!data) {
      this.overlay.replaceChildren();
      return;
    }
    Object.assign(
      this.overlay.style,
      {
        left: data.left + "px",
        top: data.top + "px",
        width: data.width + "px",
        height: data.height + "px"
      }
    );
    const marks = data.marks.map((mark) => {
      const element = this.overlay.ownerDocument.createElement("span");
      element.className = "cm-bracket-gutter-mark";
      Object.assign(
        element.style,
        {
          left: mark.left + "px",
          top: mark.top + "px",
          width: mark.width + "px",
          height: mark.height + "px",
          fontSize: mark.fontSize
        }
      );
      return element;
    });
    this.overlay.replaceChildren(...marks);
  }
  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.overlay.remove();
  }
});
var bracketMatchingExtension = [
  bracketMatching(),
  bracketGutterOverlay,
  EditorView2.editorAttributes.of({ class: "cm-bracket-matching" }),
  extensionStyles(style_default)
];
export {
  bracketMatchingExtension
};
