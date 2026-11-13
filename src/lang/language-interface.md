# Internal language interface

This is an internal boundary, not a public language-plugin API. `src/index.js`
selects JavaScript by default, Java for `codeLanguage: 'java'`, or plain text for
`codeLanguage: null`. The code language is fixed at creation; the UI locale can
change at runtime.

## Ownership

- `index.js` owns editor lifecycle, document versions, worker scheduling, and
  rejection of stale asynchronous results. Public analysis snapshots retain
  their existing shape.
- A language module owns its parser, diagnostics, completion, formatting, and
  conversion from parser-specific results to common analysis data.
- `commonAnalysisState` owns the current shared data per editor. It maps ranges
  unaffected by edits as stale interim data, clears on document load, and only
  accepts results for the current document version.
- `Editor` owns the CodeMirror state, settings, and extension assembly. It
  publishes analysis through `setCommonAnalysis`; display extensions do not
  call a language module or inspect a parser tree.
- `structure-view` renders shared structures and declarations on a canvas.
  `structureViewOptions` independently enables either category.
- `syntax-highlighting` consumes common syntax and references while allowing
  synchronous language-provided interim syntax ranges.
- `function-line-numbers` and `function-scroll-markers` independently consume
  common function sections. They do not depend on one another.
- `bracket-matching` combines CodeMirror's standard bracket matching with the
  component's gutter indicators. It does not scan the whole document for
  unmatched brackets.
- `gutterLineSelection` and `indentRulers` handle their own display behavior.

The view never lets a language replace document text. It applies formatting
results through its own editing guards. Every language supplies the same
interface, including plain text. Plain text returns no analysis, no diagnostics,
and no completion or formatting result; it creates no worker.

## Language members

| Member | Contract |
| --- | --- |
| `extensions` | Language-specific CodeMirror syntax and synchronous interim sources; no display assembly |
| `supportsFunctionSections` | Whether the language can provide function or method section data |
| `supportsBracketMatching` | Whether the language supports the shared bracket-matching display |
| `createAnalysisClient()` | Returns `{ ready, request(text, version), destroy() }`; `request` resolves to a snapshot or null |
| `analysisData(analysis, state, version)` | Converts a parser snapshot into the shared analysis schema for this document |
| `diagnostics(text, locale, options)` | Returns `{ message, severity, from, to }[]`; severity is error or warning |
| `completionTrigger(key)` | Returns `null` or `{ delay, allowShort }` |
| `createCompletionSession()` | Creates per-editor completion state; callbacks use UTF-16 document offsets |
| `formatLine(text, options)` | Returns `null` or `{ text, indent }`; options contain `autoIndent`, `indentWithTabs`, and `tabSize` |

`formatLine` receives a line with a trailing newline. The view rejects multiline
results. An `indent` result requests CodeMirror indentation only when current,
complete common analysis permits it.

Completion sessions provide `setDefinitions(definitions)`,
`complete({ state, pos, allowShort }, callback)`, `argumentHint(state, pos)`, and
`destroy()`. Callbacks from replaced or destroyed engines must not publish old
candidates. Shared language objects hold no mutable per-editor state.

Argument hints return `null` or `{ pos, name, parameters, result, active }`; the
view renders them as a tooltip at the supplied document offset.

## Common analysis data

`analysisData()` returns a validated snapshot with `version`, `sourceLength`,
`complete`, `structures`, `declarations`, `syntax`, `references`, and `sections`.
All positions are zero-based UTF-16 offsets from the document start; ranges have
exclusive ends. `complete` indicates whether the source parse was complete.
An unavailable or incomplete category is represented with the best valid
partial data available, not parser-specific node names.

- Structures use the shared kinds `function`, `class`, `conditional`, and
  `loop`, with optional branch offsets.
- Declarations use `kind: 'variable'`, normalized mutability (`mutable`,
  `immutable`, or `unknown`), and scope (`function`, `lexical`, `member`,
  `parameter`, or `unknown`).
- Syntax ranges use shared classifications such as `keyword`, `comment`,
  `literal`, `type`, `definition`, and `variable-reference`.
- References distinguish definitions from references and mark lexical local
  references when known.
- Sections identify function or method starts by offset.

The shared snapshot lives in the per-editor `commonAnalysisState` field.
Unchanged ranges may be mapped across edits and marked `stale` until the next
version-checked worker result arrives. A document load clears the snapshot.
Disabling `analysis` clears parser data; changing display settings does not
schedule another parse. Public `getAnalysis()` and `analysis` event shapes do
not include the internal common snapshot and remain compatible.

The standalone `croq-mirror/analysis` export provides the state, effect, and
validator for composing the shared-data extensions outside the component. Each
standalone extension resolves this same package subpath so its state-field
identity remains consistent.

## Syntax source and brackets

The syntax extension can combine fresh shared ranges with a language-provided
synchronous source while asynchronous parsing is pending. JavaScript supplies
Lezer ranges; Java supplies CodeMirror syntax-tree ranges until Tree-sitter
results arrive. Both sources produce the shared extension's generic range
format. `syntaxHighlight` controls token coloring and `semanticHighlight`
controls definitions and references independently.

Bracket matching is not part of common analysis. CodeMirror's standard
`bracketMatching()` handles cursor-adjacent pairs, while the extension adds
gutter indicators for visible matched brackets. Whole-document unmatched
bracket reporting is outside this interface.
