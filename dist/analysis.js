// src/analysis/common-analysis.js
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
    if (!structureKinds.has(item.kind)) throw new TypeError("Invalid structure kind");
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
    if (!syntaxKinds.has(item.kind)) throw new TypeError("Invalid syntax kind");
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
    for (const range of ranges) Object.freeze(range);
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
  if (!Array.isArray(items)) throw new TypeError(`Common analysis ${label}s must be an array`);
  return items.map((item) => {
    if (!item || !Number.isInteger(item.from) || !Number.isInteger(item.to) || item.from < 0 || item.from >= item.to || item.to > sourceLength) {
      throw new RangeError(`Invalid common analysis ${label} range`);
    }
    return { from: item.from, to: item.to, ...copyClassification(item) };
  });
}
function copyPositions(items, sourceLength) {
  if (!Array.isArray(items)) throw new TypeError("Common analysis sections must be an array");
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
      if (value && next.version < value.version) continue;
      value = next;
    }
    return value;
  }
});
function mapAnalysis(analysis, transaction) {
  const mapRange = (range, discardInterior, preserveLayout) => {
    let affected = false;
    transaction.changes.iterChanges((from2, to2, newFrom, newTo) => {
      if (from2 === to2) {
        if (discardInterior && from2 > range.from && from2 < range.to && (!preserveLayout || !isSafeLayoutInsertion(transaction, from2, newFrom, newTo))) affected = true;
      } else if (from2 < range.to && to2 > range.from) {
        affected = true;
      }
    });
    if (affected) return null;
    const from = transaction.changes.mapPos(range.from, 1);
    const to = transaction.changes.mapPos(range.to, -1);
    return from < to ? { ...range, from, to } : null;
  };
  const mapRanges = (ranges, discardInterior, preserveLayout = false) => ranges.map((range) => mapRange(range, discardInterior, preserveLayout)).filter(Boolean);
  const structures = mapRanges(analysis.structures, true, true).map((item) => ({
    ...item,
    branches: item.branches.map((position) => transaction.changes.mapPos(position, 1)).filter((position) => position >= item.from && position <= item.to)
  }));
  const declarations = mapRanges(analysis.declarations, true);
  const syntax = mapRanges(analysis.syntax, true);
  const references = mapRanges(analysis.references, true);
  const sections = analysis.sections.filter((item) => {
    let affected = false;
    transaction.changes.iterChanges((from, to) => {
      if (from < to && from <= item.from && to > item.from) affected = true;
    });
    return !affected;
  }).map((item) => ({
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
function isSafeLayoutInsertion(transaction, from, newFrom, newTo) {
  const inserted = transaction.newDoc.sliceString(newFrom, newTo);
  if (!/^[ \t]*\n[ \t]*$/.test(inserted)) return false;
  const line = transaction.startState.doc.lineAt(from);
  if (/\/\/|\/\*|\*\//.test(line.text)) return false;
  const prefix = line.text.slice(0, from - line.from), suffix = line.text.slice(from - line.from);
  return !(/\/\/|\b(?:return|throw|break|continue|yield)\s*$/.test(prefix) && suffix.trim()) && !(/[\w$]$/.test(prefix) && /^[\w$]/.test(suffix));
}
export {
  commonAnalysisState,
  createCommonAnalysis,
  referencesFromSyntax,
  setCommonAnalysis
};
