// src/extensions/syntax-highlighting/index.js
import { Facet, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView as EditorView2, ViewPlugin as ViewPlugin2 } from "@codemirror/view";
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

// src/extensions/syntax-highlighting/style.css
var style_default = ".cm-editor.cm-syntax-highlighting .cm-syntax-comment {\r\n	color: var(--croq-syntax-comment-color, var(--croq-mirror-l-gray, #777));\r\n	font-weight: var(--croq-syntax-comment-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-keyword {\r\n	color: var(--croq-syntax-keyword-color, var(--croq-mirror-l-bodybrown, #7c6a5a));\r\n	font-weight: var(--croq-syntax-keyword-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-operator {\r\n	font-weight: var(--croq-syntax-keyword-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-type {\r\n	color: var(--croq-syntax-type-color, var(--croq-mirror-l-blue, #2e449a));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-function {\r\n	color: var(--croq-syntax-function-color, var(--croq-mirror-l-turquoise, #005363));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting :where(.cm-syntax-definition) {\r\n	color: var(--croq-syntax-definition-color, inherit);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-definition {\r\n	font-weight: var(--croq-syntax-definition-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-property {\r\n	color: var(--croq-syntax-property-color, var(--croq-mirror-l-blue, #2e449a));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-variable {\r\n	color: var(--croq-syntax-variable-color, inherit);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-literal {\r\n	color: var(--croq-syntax-literal-color, var(--croq-mirror-l-orange, #f5a200));\r\n	font-weight: var(--croq-syntax-literal-font-weight, bold);\r\n	text-shadow: var(--croq-syntax-literal-text-shadow, var(--croq-mirror-l-yellow, #fdde00) 0 0 0.25em);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-activeLine .cm-syntax-literal {\r\n	text-shadow: none;\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-invalid {\r\n	text-decoration: var(--croq-syntax-invalid-decoration, underline wavy var(--croq-mirror-l-red, #e61e58));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting :is(.cm-syntax-local-variable, .cm-syntax-local-reference, .cm-syntax-local-reference .cm-syntax-variable) {\r\n	color: var(--croq-syntax-local-variable-color, hsl(86 60% 30%));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-variable-reference {\r\n	border-radius: var(--croq-syntax-reference-radius, 0 0.35em 0.35em 0);\r\n	box-shadow: var(--croq-syntax-reference-shadow, 0 2px 6px color-mix(in srgb, var(--croq-mirror-l-blue, #2e449a) 15%, transparent), 0 -1px 6px color-mix(in srgb, var(--croq-mirror-l-blue, #2e449a) 15%, transparent));\r\n	background-color: var(--croq-syntax-reference-background, color-mix(in srgb, var(--croq-mirror-color-editor, #fdfdf9) 95%, transparent));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-activeLine .cm-syntax-variable-reference {\r\n	border-radius: 0;\r\n	box-shadow: none;\r\n	background-color: transparent;\r\n}\r\n";

// src/extensions/syntax-highlighting/index.js
var syntaxKinds = /* @__PURE__ */ new Set([
  "comment",
  "keyword",
  "operator",
  "type",
  "function",
  "variable",
  "literal",
  "invalid",
  "property"
]);
var semanticKinds = /* @__PURE__ */ new Set([
  "definition",
  "local-variable",
  "local-reference",
  "variable-reference"
]);
var allKinds = /* @__PURE__ */ new Set([
  "comment",
  "keyword",
  "operator",
  "type",
  "function",
  "variable",
  "literal",
  "invalid",
  "definition",
  "property",
  "local-variable",
  "local-reference",
  "variable-reference"
]);
var setSyntaxHighlights = StateEffect.define();
var sourceFacet = Facet.define({ combine: (sources) => sources.at(-1) ?? null });
var displayOptions = Facet.define({ combine: (values) => values.at(-1) ?? { syntax: true, semantic: true } });
function syntaxHighlightingOptions(options) {
  if (!options || typeof options.syntax !== "boolean" || typeof options.semantic !== "boolean") {
    throw new TypeError("Syntax highlighting options must specify syntax and semantic");
  }
  return displayOptions.of(options);
}
function activeRanges(ranges, options) {
  return ranges.filter(({ kind }) => options.syntax && syntaxKinds.has(kind) || options.semantic && semanticKinds.has(kind));
}
function commonRanges(analysis, options) {
  const ranges = analysis.syntax.filter(({ kind }) => kind === "local-variable");
  if (options.syntax) ranges.push(...analysis.syntax.filter(({ kind }) => syntaxKinds.has(kind)));
  if (options.semantic) {
    for (const { from, to, role, scope } of analysis.references) {
      if (role === "definition") ranges.push({ from, to, kind: "definition" });
      else {
        ranges.push({ from, to, kind: "variable-reference" });
        if (scope === "local") ranges.push({ from, to, kind: "local-reference" });
      }
    }
  }
  return activeRanges(ranges, options);
}
function decorationsFor(ranges, doc, options) {
  return Decoration.set(activeRanges(ranges, options).map(({ from, to, kind }) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > doc.length || !allKinds.has(kind)) {
      throw new RangeError("Invalid syntax highlight range");
    }
    return Decoration.mark({ class: `cm-syntax-${kind}` }).range(from, to);
  }), true);
}
var syntaxHighlights = StateField.define({
  create: () => ({ decorations: Decoration.none, current: false, ranges: [] }),
  update(value, transaction) {
    if (transaction.isUserEvent("load")) {
      value = { decorations: Decoration.none, current: false, ranges: [] };
    } else if (transaction.docChanged) {
      const retain = transaction.state.facet(sourceFacet)?.retainOnEdit;
      value = {
        decorations: retain ? value.decorations.map(transaction.changes) : Decoration.none,
        current: false,
        ranges: retain ? value.ranges.map((range) => ({
          ...range,
          from: transaction.changes.mapPos(range.from, 1),
          to: transaction.changes.mapPos(range.to, -1)
        })).filter((range) => range.from < range.to) : []
      };
    }
    const common = transaction.state.field(commonAnalysisState, false);
    const commonChanged = transaction.startState.field(commonAnalysisState, false) !== common;
    const options = transaction.state.facet(displayOptions);
    if (commonChanged) {
      const ranges = common ? commonRanges(common, options) : [];
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: !!common && !common.stale,
        ranges
      };
    } else if (transaction.startState.facet(displayOptions) !== options) {
      const ranges = common ? commonRanges(common, options) : value.ranges;
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: value.current && !!common && !common.stale,
        ranges
      };
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setSyntaxHighlights)) continue;
      const ranges = effect.value;
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: ranges.length > 0,
        ranges: ranges.slice()
      };
    }
    return value;
  }
});
function syntaxHighlightingSource(analyze, needsRefresh = () => false, { retainOnEdit = false, reconcileComments = null } = {}) {
  return sourceFacet.of({ analyze, needsRefresh, retainOnEdit, reconcileComments });
}
function reconcileRetainedComments(decorations, ranges, doc, parsedTo) {
  if (!Number.isInteger(parsedTo) || parsedTo < 0 || parsedTo > doc.length) {
    throw new RangeError("Invalid parsed syntax extent");
  }
  const comments = [];
  for (const range of ranges.filter((range2) => range2.kind === "comment" && range2.from < parsedTo).sort((a, b) => a.from - b.from)) {
    const previous = comments.at(-1), to = Math.min(range.to, parsedTo);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, to);
    else comments.push({ from: range.from, to });
  }
  const retained = [];
  decorations.between(0, doc.length, (from, to, decoration) => {
    let low = 0, high = comments.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (comments[middle].to <= from) low = middle + 1;
      else high = middle;
    }
    if (decoration.spec.class === "cm-syntax-comment") {
      for (let i = low; i < comments.length && comments[i].from < to; i++) {
        const comment = comments[i];
        const start = Math.max(from, comment.from), end = Math.min(to, comment.to, parsedTo);
        if (start < end) retained.push(decoration.range(start, end));
      }
      if (to > parsedTo) retained.push(decoration.range(Math.max(from, parsedTo), to));
    } else {
      let start = from;
      for (let i = low; i < comments.length && comments[i].from < to; i++) {
        const comment = comments[i];
        if (comment.to <= start) continue;
        if (comment.from > start) retained.push(decoration.range(start, comment.from));
        start = Math.max(start, comment.to);
        if (start >= to) break;
      }
      if (start < to) retained.push(decoration.range(start, to));
    }
  });
  return Decoration.set(retained, true);
}
function sourceDecorations(state, source) {
  const supplied = state.field(syntaxHighlights);
  const common = state.field(commonAnalysisState, false);
  const options = state.facet(displayOptions);
  if (!source || common && !common.stale || source.retainOnEdit && supplied.current) return supplied.decorations;
  const ranges = source.analyze(state);
  if (!source.retainOnEdit) return decorationsFor(ranges, state.doc, options);
  const retained = source.reconcileComments ? reconcileRetainedComments(supplied.decorations, activeRanges(ranges, options), state.doc, source.reconcileComments(state)) : supplied.decorations;
  const uncovered = [];
  for (const range of activeRanges(ranges, options)) {
    let from = range.from;
    retained.between(range.from, range.to, (start, end) => {
      if (start > from) uncovered.push({ ...range, from, to: Math.min(start, range.to) });
      from = Math.max(from, end);
    });
    if (from < range.to) uncovered.push({ ...range, from, to: range.to });
  }
  return RangeSet.join([retained, decorationsFor(uncovered, state.doc, options)]);
}
var sourceHighlights = ViewPlugin2.fromClass(class {
  constructor(view) {
    const source = view.state.facet(sourceFacet);
    this.decorations = sourceDecorations(view.state, source);
  }
  update(update) {
    const source = update.state.facet(sourceFacet);
    if (source !== update.startState.facet(sourceFacet) || update.docChanged || source?.needsRefresh(update) || update.startState.field(syntaxHighlights) !== update.state.field(syntaxHighlights)) {
      this.decorations = sourceDecorations(update.state, source);
    }
  }
}, { decorations: (plugin) => plugin.decorations });
var syntaxHighlightingExtension = [
  syntaxHighlights,
  sourceHighlights,
  EditorView2.editorAttributes.of({ class: "cm-syntax-highlighting" }),
  extensionStyles(style_default)
];
export {
  setSyntaxHighlights,
  syntaxHighlightingExtension,
  syntaxHighlightingOptions,
  syntaxHighlightingSource
};
