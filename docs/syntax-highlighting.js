// .build/extensions/syntax-highlighting/index.js
import { Facet as Facet2, RangeSet, StateEffect as StateEffect2, StateField as StateField3 } from "@codemirror/state";
import { Decoration, EditorView as EditorView2, ViewPlugin as ViewPlugin2 } from "@codemirror/view";

// .build/analysis/lezer-analysis.js
import { Facet, StateField as StateField2 } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";

// .build/analysis/common-analysis.js
import { StateEffect, StateField } from "@codemirror/state";
var structureKinds = /* @__PURE__ */ new Set(["function", "class", "conditional", "loop"]);
var declarationMutabilities = /* @__PURE__ */ new Set(["mutable", "immutable", "unknown"]);
var declarationScopes = /* @__PURE__ */ new Set(["function", "lexical", "member", "parameter", "unknown"]);
var syntaxKinds = /* @__PURE__ */ new Set([
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
var referenceRoles = /* @__PURE__ */ new Set(["definition", "reference"]);
function referencesFromSyntax(syntax) {
  const references = /* @__PURE__ */ new Map();
  for (const { from, to, kind } of syntax) {
    const role = kind === "definition" ? "definition" : ["local-reference", "variable-reference"].includes(kind) ? "reference" : null;
    if (!role) continue;
    const key = `${role}:${from}:${to}`;
    const scope = kind === "local-reference" ? "local" : "unknown";
    const previous = references.get(key);
    if (!previous || scope === "local") references.set(key, { from, to, role, scope });
  }
  return [...references.values()];
}
function createCommonAnalysis(data) {
  if (!data || !Number.isInteger(data.version) || data.version < 0 || !Number.isInteger(data.sourceLength) || data.sourceLength < 0 || typeof data.complete !== "boolean") {
    throw new TypeError("Invalid common analysis metadata");
  }
  const structures = copyRanges(data.structures, data.sourceLength, "structure", (item) => {
    if (!structureKinds.has(item.kind)) {
      throw new TypeError("Invalid structure kind");
    }
    const branches = item.branches ?? [];
    if (!Array.isArray(branches) || branches.some((position) => !Number.isInteger(position) || position < item.from || position > item.to)) {
      throw new RangeError("Invalid structure branches");
    }
    return { kind: item.kind, branches: Object.freeze(branches.slice()) };
  });
  const declarations = copyRanges(data.declarations, data.sourceLength, "declaration", (item) => {
    if (item.kind !== "variable" || !declarationMutabilities.has(item.mutability) || !declarationScopes.has(item.scope)) {
      throw new TypeError("Invalid declaration classification");
    }
    return { kind: item.kind, mutability: item.mutability, scope: item.scope };
  });
  const syntax = copyRanges(data.syntax, data.sourceLength, "syntax", (item) => {
    if (!syntaxKinds.has(item.kind)) {
      throw new TypeError("Invalid syntax kind");
    }
    return { kind: item.kind };
  });
  const references = copyRanges(data.references, data.sourceLength, "reference", (item) => {
    if (!referenceRoles.has(item.role) || !["local", "unknown"].includes(item.scope)) {
      throw new TypeError("Invalid reference classification");
    }
    return { role: item.role, scope: item.scope };
  });
  const sections = copyPositions(data.sections, data.sourceLength);
  for (const ranges of [structures, declarations, syntax, references, sections]) {
    for (const range of ranges) {
      Object.freeze(range);
    }
    Object.freeze(ranges);
  }
  return Object.freeze({
    version: data.version,
    sourceLength: data.sourceLength,
    complete: data.complete,
    stale: data.stale === true,
    structures,
    declarations,
    syntax,
    references,
    sections
  });
}
function copyRanges(items, sourceLength, label, copyClassification) {
  if (!Array.isArray(items)) {
    throw new TypeError(`Common analysis ${label}s must be an array`);
  }
  return items.map((item) => {
    if (!item || !Number.isInteger(item.from) || !Number.isInteger(item.to) || item.from < 0 || item.from >= item.to || item.to > sourceLength) {
      throw new RangeError(`Invalid common analysis ${label} range`);
    }
    return { from: item.from, to: item.to, ...copyClassification(item) };
  });
}
function copyPositions(items, sourceLength) {
  if (!Array.isArray(items)) {
    throw new TypeError("Common analysis sections must be an array");
  }
  let previous = -1;
  return items.map((item) => {
    if (!item || item.kind !== "function" || !Number.isInteger(item.from) || item.from < 0 || item.from >= sourceLength || item.from < previous) {
      throw new RangeError("Invalid common analysis section");
    }
    previous = item.from;
    return { kind: item.kind, from: item.from };
  });
}
var setCommonAnalysis = StateEffect.define();
var commonAnalysisState = StateField.define({
  create: () => null,
  update(value, transaction) {
    if (transaction.isUserEvent("load")) value = null;
    else if (transaction.docChanged && value) value = mapAnalysis(value, transaction);
    for (const effect of transaction.effects) {
      if (!effect.is(setCommonAnalysis)) continue;
      if (effect.value === null) {
        value = null;
        continue;
      }
      const next = createCommonAnalysis(effect.value);
      if (next.sourceLength !== transaction.newDoc.length) {
        throw new RangeError("Common analysis does not match the document length");
      }
      if (value && (next.version < value.version || value.stale && next.version <= value.version)) {
        continue;
      }
      value = value ? reuseStructureRanges(value, next) : next;
    }
    return value;
  }
});
function reuseStructureRanges(previous, next) {
  const sameRanges = (before, after, sameDetails) => before.length === after.length && before.every((item, i) => {
    const other = after[i];
    return item.from === other.from && item.to === other.to && item.kind === other.kind && sameDetails(item, other);
  });
  const structures = sameRanges(previous.structures, next.structures, (a, b) => a.branches.length === b.branches.length && a.branches.every((offset, i) => offset === b.branches[i])) ? previous.structures : next.structures;
  const declarations = sameRanges(previous.declarations, next.declarations, (a, b) => a.mutability === b.mutability && a.scope === b.scope) ? previous.declarations : next.declarations;
  if (structures === next.structures && declarations === next.declarations) return next;
  return Object.freeze({ ...next, structures, declarations });
}
function mapAnalysis(analysis, transaction) {
  const changes = [];
  transaction.changes.iterChangedRanges((from, to) => {
    changes.push({ from, to });
  });
  const mapRange = (range, retainOnEdit) => {
    const affected = changes.some(({ from: from2, to: to2 }) => retainOnEdit ? from2 <= range.from && to2 >= range.to : from2 === to2 ? from2 >= range.from && from2 <= range.to : from2 < range.to && to2 > range.from);
    if (affected) return null;
    const from = transaction.changes.mapPos(range.from, 1);
    const to = transaction.changes.mapPos(range.to, -1);
    return from < to ? { ...range, from, to } : null;
  };
  const mapRanges = (ranges, retainOnEdit = false) => ranges.map((range) => mapRange(range, retainOnEdit)).filter(Boolean);
  const structures = mapRanges(analysis.structures, true).map((item) => ({
    ...item,
    branches: item.branches.map((position) => transaction.changes.mapPos(position, 1)).filter((position) => position >= item.from && position <= item.to)
  }));
  const declarations = mapRanges(analysis.declarations, true);
  const syntax = mapRanges(analysis.syntax);
  const references = mapRanges(analysis.references);
  const sections = analysis.sections.filter((item) => !changes.some(({ from, to }) => from <= item.from && to > item.from)).map((item) => ({
    ...item,
    from: transaction.changes.mapPos(item.from, 1)
  })).filter((item) => item.from < transaction.newDoc.length);
  return createCommonAnalysis({
    ...analysis,
    sourceLength: transaction.newDoc.length,
    stale: true,
    structures,
    declarations,
    syntax,
    references,
    sections
  });
}

// .build/analysis/lezer-analysis.js
var syntaxClassifier = Facet.define({ combine: (values) => values[0] });
var SEMANTIC_KINDS = /* @__PURE__ */ new Set(["definition", "local-reference", "variable-reference"]);
function readLezer(state, tree, classifier) {
  const ranges = [];
  const add = (from, to, kind) => {
    if (from < to) ranges.push({ from, to, kind });
  };
  highlightTree(tree, classifier.style, (from, to, classes) => {
    for (const kind of new Set(classes.split(" "))) {
      classifier.classify(tree, kind, from, to, add);
    }
  });
  classifier.collectInterimReferences?.(tree, state, add);
  return {
    syntax: ranges.filter((range) => !SEMANTIC_KINDS.has(range.kind)),
    references: referencesFromSyntax(ranges)
  };
}
function reconcile(interim, parsedTo, analysis) {
  if (!analysis) return interim;
  if (!analysis.stale) {
    return {
      syntax: analysis.syntax.length ? analysis.syntax : interim.syntax,
      references: analysis.references
    };
  }
  const retainedReferences = new Map(analysis.references.map((reference) => [
    referenceKey(reference),
    reference
  ]));
  return {
    syntax: [
      ...interim.syntax,
      ...analysis.syntax.flatMap((range) => {
        if (range.from >= parsedTo) {
          return [range];
        }
        if (range.kind === "comment" && range.to > parsedTo) {
          return [{ ...range, from: parsedTo }];
        }
        return [];
      })
    ],
    references: [
      ...interim.references.map((reference) => {
        const retained = retainedReferences.get(referenceKey(reference));
        return interim.classifiesLocalReferences ? reference : retained ?? reference;
      }),
      ...analysis.references.filter((reference) => reference.from >= parsedTo)
    ]
  };
}
function referenceKey({ from, to, role }) {
  return `${from}:${to}:${role}`;
}
function updateSyntax(state, previous) {
  const classifier = state.facet(syntaxClassifier);
  const tree = syntaxTree(state);
  const analysis = state.field(commonAnalysisState, false);
  const interim = previous?.tree === tree && previous.doc === state.doc && previous.classifier === classifier ? previous.interim : { ...readLezer(state, tree, classifier), classifiesLocalReferences: !!classifier.collectInterimReferences };
  if (previous?.interim === interim && previous.analysis === analysis) {
    return previous;
  }
  return {
    doc: state.doc,
    tree,
    classifier,
    interim,
    analysis,
    data: reconcile(interim, tree.length, analysis)
  };
}
var syntaxAnalysisState = StateField2.define({
  create: (state) => updateSyntax(state, null),
  update: (previous, transaction) => updateSyntax(transaction.state, previous)
});

// .build/extensions/syntax-highlighting/index.js
import { commonAnalysisState as commonAnalysisState2 } from "croq-mirror/analysis";

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

// .build/extensions/syntax-highlighting/style.css
var style_default = ".cm-editor.cm-syntax-highlighting .cm-syntax-comment {\r\n	color: var(--croq-syntax-comment-color, var(--croq-mirror-l-gray, #777));\r\n	font-weight: var(--croq-syntax-comment-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-keyword {\r\n	color: var(--croq-syntax-keyword-color, var(--croq-mirror-l-bodybrown, #7c6a5a));\r\n	font-weight: var(--croq-syntax-keyword-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-operator {\r\n	font-weight: var(--croq-syntax-keyword-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-type {\r\n	color: var(--croq-syntax-type-color, var(--croq-mirror-l-blue, #2e449a));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-function {\r\n	color: var(--croq-syntax-function-color, var(--croq-mirror-l-turquoise, #005363));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting :where(.cm-syntax-definition) {\r\n	color: var(--croq-syntax-definition-color, inherit);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-definition {\r\n	font-weight: var(--croq-syntax-definition-font-weight, bold);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-property {\r\n	color: var(--croq-syntax-property-color, var(--croq-mirror-l-blue, #2e449a));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-variable {\r\n	color: var(--croq-syntax-variable-color, inherit);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-literal {\r\n	color: var(--croq-syntax-literal-color, var(--croq-mirror-l-orange, #f5a200));\r\n	font-weight: var(--croq-syntax-literal-font-weight, bold);\r\n	text-shadow: var(--croq-syntax-literal-text-shadow, var(--croq-mirror-l-yellow, #fdde00) 0 0 0.25em);\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-activeLine .cm-syntax-literal {\r\n	text-shadow: none;\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-invalid {\r\n	text-decoration: var(--croq-syntax-invalid-decoration, underline wavy var(--croq-mirror-l-red, #e61e58));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting :is(.cm-syntax-local-variable, .cm-syntax-local-reference, .cm-syntax-local-reference .cm-syntax-variable) {\r\n	color: var(--croq-syntax-local-variable-color, hsl(86 60% 30%));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-syntax-variable-reference {\r\n	border-radius: var(--croq-syntax-reference-radius, 0 0.35em 0.35em 0);\r\n	box-shadow: var(--croq-syntax-reference-shadow, 0 2px 6px color-mix(in srgb, var(--croq-mirror-l-blue, #2e449a) 15%, transparent), 0 -1px 6px color-mix(in srgb, var(--croq-mirror-l-blue, #2e449a) 15%, transparent));\r\n	background-color: var(--croq-syntax-reference-background, color-mix(in srgb, var(--croq-mirror-color-editor, rgb(252.76 252.76 252.76)) 95%, transparent));\r\n}\r\n\r\n.cm-editor.cm-syntax-highlighting .cm-activeLine .cm-syntax-variable-reference {\r\n	border-radius: 0;\r\n	box-shadow: none;\r\n	background-color: transparent;\r\n}\r\n";

// .build/extensions/syntax-highlighting/index.js
var syntaxKinds2 = /* @__PURE__ */ new Set([
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
var setSyntaxHighlights = StateEffect2.define();
var sourceFacet = Facet2.define({ combine: (sources) => sources.at(-1) ?? null });
var displayOptions = Facet2.define({ combine: (values) => values.at(-1) ?? { syntax: true, semantic: true } });
function syntaxHighlightingOptions(options) {
  if (!options || typeof options.syntax !== "boolean" || typeof options.semantic !== "boolean") {
    throw new TypeError("Syntax highlighting options must specify syntax and semantic");
  }
  return displayOptions.of(options);
}
function activeRanges(ranges, options) {
  return ranges.filter(({ kind }) => options.syntax && syntaxKinds2.has(kind) || options.semantic && semanticKinds.has(kind));
}
function commonRanges(analysis, options) {
  const ranges = analysis.syntax.filter(({ kind }) => kind === "local-variable");
  if (options.syntax) {
    ranges.push(...analysis.syntax.filter(({ kind }) => syntaxKinds2.has(kind)));
  }
  if (options.semantic) {
    for (const { from, to, role, scope } of analysis.references) {
      if (role === "definition") {
        ranges.push({ from, to, kind: "definition" });
      } else {
        ranges.push({ from, to, kind: "variable-reference" });
        if (scope === "local") {
          ranges.push({ from, to, kind: "local-reference" });
        }
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
var syntaxHighlights = StateField3.define({
  create: () => ({ decorations: Decoration.none, current: false, explicit: false, ranges: [] }),
  update(value, transaction) {
    if (transaction.isUserEvent("load")) {
      value = { decorations: Decoration.none, current: false, explicit: false, ranges: [] };
    } else if (transaction.docChanged) {
      const retain = transaction.state.facet(sourceFacet)?.retainOnEdit;
      value = {
        decorations: retain ? value.decorations.map(transaction.changes) : Decoration.none,
        current: false,
        explicit: false,
        ranges: retain ? value.ranges.map((range) => ({
          ...range,
          from: transaction.changes.mapPos(range.from, 1),
          to: transaction.changes.mapPos(range.to, -1)
        })).filter((range) => range.from < range.to) : []
      };
    }
    const sharedSyntax = transaction.state.field(syntaxAnalysisState, false);
    const common = sharedSyntax ? null : transaction.state.field(commonAnalysisState2, false);
    const commonChanged = !sharedSyntax && transaction.startState.field(commonAnalysisState2, false) !== common;
    const options = transaction.state.facet(displayOptions);
    if (commonChanged) {
      const ranges = common ? commonRanges(common, options) : [];
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: !!common && !common.stale,
        explicit: false,
        ranges
      };
    } else if (transaction.startState.facet(displayOptions) !== options) {
      const ranges = common && !value.explicit ? commonRanges(common, options) : value.ranges;
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: value.explicit ? value.current : value.current && !!common && !common.stale,
        explicit: value.explicit,
        ranges
      };
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setSyntaxHighlights)) continue;
      const ranges = effect.value;
      value = {
        decorations: decorationsFor(ranges, transaction.newDoc, options),
        current: ranges.length > 0,
        explicit: true,
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
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, to);
    } else {
      comments.push({ from: range.from, to });
    }
  }
  const retained = [];
  decorations.between(0, doc.length, (from, to, decoration) => {
    let low = 0, high = comments.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (comments[middle].to <= from) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (decoration.spec.class === "cm-syntax-comment") {
      for (let i = low; i < comments.length && comments[i].from < to; i++) {
        const comment = comments[i];
        const start = Math.max(from, comment.from), end = Math.min(to, comment.to, parsedTo);
        if (start < end) {
          retained.push(decoration.range(start, end));
        }
      }
      if (to > parsedTo) {
        retained.push(decoration.range(Math.max(from, parsedTo), to));
      }
    } else {
      let start = from;
      for (let i = low; i < comments.length && comments[i].from < to; i++) {
        const comment = comments[i];
        if (comment.to <= start) continue;
        if (comment.from > start) {
          retained.push(decoration.range(start, comment.from));
        }
        start = Math.max(start, comment.to);
        if (start >= to) break;
      }
      if (start < to) {
        retained.push(decoration.range(start, to));
      }
    }
  });
  return Decoration.set(retained, true);
}
function sourceDecorations(state, source) {
  const supplied = state.field(syntaxHighlights);
  const common = state.field(commonAnalysisState2, false);
  const options = state.facet(displayOptions);
  if (supplied.explicit) return supplied.decorations;
  const sharedSyntax = state.field(syntaxAnalysisState, false);
  if (sharedSyntax) {
    return decorationsFor(commonRanges(sharedSyntax.data, options), state.doc, options);
  }
  if (common && !common.stale) {
    return supplied.current ? supplied.decorations : decorationsFor(commonRanges(common, options), state.doc, options);
  }
  if (!source || source.retainOnEdit && supplied.current) {
    return supplied.decorations;
  }
  const ranges = source.analyze(state);
  if (!source.retainOnEdit) {
    return decorationsFor(ranges, state.doc, options);
  }
  const retained = source.reconcileComments ? reconcileRetainedComments(supplied.decorations, activeRanges(ranges, options), state.doc, source.reconcileComments(state)) : supplied.decorations;
  const uncovered = [];
  for (const range of activeRanges(ranges, options)) {
    let from = range.from;
    retained.between(range.from, range.to, (start, end) => {
      if (start > from) {
        uncovered.push({ ...range, from, to: Math.min(start, range.to) });
      }
      from = Math.max(from, end);
    });
    if (from < range.to) {
      uncovered.push({ ...range, from, to: range.to });
    }
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
    if (source !== update.startState.facet(sourceFacet) || update.docChanged || source?.needsRefresh(update) || update.startState.field(syntaxHighlights) !== update.state.field(syntaxHighlights) || update.startState.field(syntaxAnalysisState, false) !== update.state.field(syntaxAnalysisState, false)) {
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
