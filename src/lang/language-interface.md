# Internal language interface

This is an internal boundary, not a public plugin API. `src/index.js` selects
`javascriptLanguage` by default, `javaLanguage` for `codeLanguage: 'java'`, or
`plainLanguage` for `codeLanguage: null`.
The code language is selected at creation; display locale (`settings.language`,
ja/en, default en) is independent and can change at runtime.
Common implementation modules live directly in `src/`; JavaScript-specific
modules live in `src/lang/js/`, Java-specific modules in `src/lang/java/`, and
the inert implementation in `src/lang/plain/`. External library wrappers are generated in
`.build/lib/`. Splitting the vendor/build outputs is separate follow-up work.

## Ownership

- `index.js`: lifecycle, settings, document versions, analysis scheduling and
  rejection of stale results. Public analysis snapshots keep their original shape.
- Language module: syntax rules, diagnostics, completion engine and definitions,
  formatting rules, and conversion of analysis into presentation data.
- `Editor`: user events, disabled/read-only/IME guards, applying edits, completion
  menus and diagnostics display.
- `structureView`: an independent CodeMirror extension that receives decorations
  and draws them on a canvas; it does not obtain or interpret analysis results.
- `functionLineNumbers`: an independent CodeMirror extension that receives section
  start lines and renders numbering and scroll markers without performing analysis.
- `gutterLineSelection`: an independent CodeMirror extension that handles gutter
  selection gestures and the line-selection cursor.
- `indentRulers`: an independent CodeMirror extension for indentation guides.
- `syntaxHighlightingExtension`: an independent extension that accepts syntax
  ranges from a language adapter; Java supplies Tree-sitter results through
  `setSyntaxHighlights`, while JavaScript supplies its Lezer results using
  `syntaxHighlightingSource`.

The language module receives no `Editor` instance or private fields. It must not
replace document text; the view applies formatting results with its editing guards.
Every language supplies all methods, including plain text. The coordinator and
view call the same interface without checking service availability. Plain's
analysis client has an already-resolved `ready`, a `request` returning null, and
an inert `destroy`; it creates no worker. Its completion session invokes callbacks
with null and otherwise does nothing. Diagnostics return an empty array; formatting
and completion triggers return null. Common scheduling and event handling still run.
Null/empty results mean there is nothing to apply, not a missing service.

## Language methods

| Member | Contract |
| --- | --- |
| `extensions` | CodeMirror extensions for syntax, highlighting, and bracket behavior |
| `createAnalysisClient()` | Returns `{ ready, request(text, version), destroy() }`; the client owns any worker; request resolves to a snapshot or null |
| `diagnostics(text, locale, options)` | Returns `{ message, severity, from, to }[]`; severity is error/warning |
| `completionTrigger(key)` | Returns `null` or `{ delay, allowShort }`; the view owns the debounce timer and menu state |
| `createCompletionSession()` | Creates per-editor completion state; see below |
| `formatLine(text, options)` | Returns `null` to skip, or `{ text, indent }`; options contain `autoIndent`, `indentWithTabs`, `tabSize` |
| `presentation(analysis)` | Returns the display data below without mutating the public analysis result |

`formatLine` receives a line with a trailing newline, preserving the original
formatter behavior. The view rejects multiline results. `indent` requests the
existing CodeMirror indent operation, permitted only when `canIndent` is true.

A completion session provides `setDefinitions(definitions)`,
`complete({ state, pos, allowShort }, callback)`, `argumentHint(state, pos)` and `destroy()`.
Completion callbacks receive `null` or `{ from, to, list }` with UTF-16 document
offsets and items containing `text`, `displayText`, and optional `className` and `detail`.
The view uses CodeMirror's completion UI.
Callbacks from a replaced/destroyed engine must not publish old candidates.
The view owns and destroys the session. Shared language objects hold no mutable
per-editor state.

Argument hints return `null` or `{ pos, name, parameters, result, active }`.
The view renders that data as a tooltip at the supplied document offset.

## Presentation data

All internal display positions are **zero-based `{ line, ch }`**, with UTF-16
columns and exclusive ends. The JS adapter converts Acorn's one-based positions.
The public `getAnalysis()` result remains unchanged, including its original
coordinate conventions.

```js
{
  canIndent: true,
  lineNumbers: 'sections', // 'absolute' forces ordinary numbering; omission permits sections
  sectionStarts: [0, 12], // ordered zero-based section start lines
  decorations: [
    {
      kind: 'range', from, to, fill, opacity, // opacity is optional, default 1
      spineChars: 3, branchChars: 4,
      branches: [] // positions of intermediate range branches
    },
    { kind: 'token', from, to, fill, stroke }
  ]
}
```

Decorations are drawn in array order. The adapter chooses colors, ranges and
character spans; the structure extension resolves `var(--property, fallback)`
colors on repaint, converts positions to pixels and draws the shapes.
JavaScript and Java provide class ranges using `--croq-mirror-l-red` at 15% opacity.
Plain supplies `lineNumbers: 'absolute'` and empty decorations/section starts.
Java supplies method and lambda section starts and structural decorations from
Tree-sitter nodes. Neither the renderer nor section numbering reads `fnLocs`,
`ifLocs`, `constLocs` or any other JavaScript analysis field.

`setPresentation()` without an argument clears display data. Document edits and
disabling automatic analysis clear the data; explicit analysis while disabled
returns a snapshot without restoring the display.

The syntax highlighting extension accepts `{ from, to, kind }` ranges using
zero-based UTF-16 document offsets. The language adapter maps parser-specific
positions before supplying them. By default the extension clears those ranges
after document changes. Java opts into retaining mapped ranges between edits and
uses its CodeMirror syntax tree to color uncovered positions until the worker
returns fresh Tree-sitter token and lexical local-reference ranges. Loading a
document clears retained ranges. JavaScript sends its syntax and local-reference
ranges from its own synchronous Lezer analysis. Java diagnostics, completion, and
formatting are not implemented yet.
