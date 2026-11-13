# croq-mirror

A CodeMirror 6 editor component extracted from Croqujs.
See [spec.md](./spec.md) for the agreed specification. This repository can be built and used independently.

## Example

Run these commands from the repository root:

```sh
yarn install
yarn dev
```

Open the URL printed at startup to try an English-language editor and its controls.
The buttons belong to the example application, not to the component.
`yarn build` generates `dist/` and `docs/`. Serve the entire `dist/` directory over HTTP or HTTPS to use the component without a consumer-side build.
Serve the modules and worker from the same origin as the consuming page.
Keep `dist/` in version control so Git dependencies receive the built component.
Rebuild it with `node build.mjs` before committing component changes. Package archives
include `dist/`, the package metadata, README, and the root license.
Load the CSS in the consuming page. If you configure a Content Security Policy, allow the modules, worker, fonts, and inline styles set by the libraries.

```html
<link rel="stylesheet" href="./dist/croq-mirror.min.css">
<div id="editor" style="height: 480px"></div>
<script type="module">
import { createEditor } from './dist/croq-mirror.min.js';
const editor = await createEditor(document.querySelector('#editor'), {
    value: 'function greet() { console.log("Hello"); }',
    language: 'en',
});
const unsubscribe = editor.on('change', event => {
    if (event.origin === 'edit') console.log('modified', event.version);
});
const snapshot = await editor.analyzeNow();
// snapshot.text and snapshot.fnNames always describe the same version.
console.log(snapshot.version, snapshot.success, snapshot.fnNames);
// On cleanup: unsubscribe(); editor.destroy();
</script>
```

## Public API

Provide an empty container element in the current document.
Mounting a second editor in the same container is an error.
Initialization failures reject the promise and clean up resources and DOM elements created during initialization.

| API | Description |
| --- | --- |
| `await createEditor(container, options)` | Returns after the worker is ready and initial analysis has completed, if enabled |
| `getValue()` | Returns the document text |
| `loadDocument(text)` | Sets the text and resets history, cursor, analysis, and highlights |
| `replaceDocument(text)` | Replaces the entire document as an undoable edit |
| `replaceRange(text, from, to = from)` | Replaces a range as an undoable edit |
| `getSelection()` / `replaceSelection(text)` | Gets selected text or replaces it as an undoable edit |
| `setLineSelectionMode(enabled)` | Toggles line selection mode; the host can clear it before menu actions |
| `getSettings()` / `setSettings(patch)` | Gets settings or applies a partial update |
| `getState()` | Returns `version`, `readOnly`, `disabled`, `canUndo`, and `canRedo` |
| `execute(command)` | Executes one of the commands listed below |
| `setDefinitions(definitions)` | Replaces additional Tern definitions while retaining standard definitions; an empty array removes the additions |
| `getAnalysis()` | Returns the analyzed snapshot for the current version, or `null` |
| `await analyzeNow()` | Analyzes the text and version captured at the time of the call |
| `on(type, listener)` | Subscribes to an event and returns an unsubscribe function |
| `moveTo({line, ch}, {focus = true})` | Moves the cursor, scrolls into view, and optionally focuses the editor |
| `focus()` / `blur()` | Focuses or blurs the editor input; `focus()` does nothing when disabled and is allowed when read-only |
| `hasFocus()` | Returns whether the editor input has focus (not search fields or other component controls) |
| `getLineCount()` | Returns the number of document lines, including one line for an empty document |
| `highlightLine(line)` | Highlights a line and returns an ID for clearing it |
| `clearHighlight(id)` | Clears the specified highlight |
| `getFunctionLineNumber(line)` | Returns `[functionNumber, lineWithinFunction]`, or `[0, line + 1]` when analysis is unavailable |
| `refresh()` | Redraws the editor, for example after revealing a hidden container |
| `destroy()` | Releases resources and removes the DOM; safe to call repeatedly |

Commands: `undo`, `redo`, `cut`, `copy`, `paste`, `selectAll`, `toggleComment`, `format`, `find`, `findNext`, `replace`, `complete`.
Clipboard commands focus the target editor and call `document.execCommand`, retaining the original editor's behavior. Availability depends on the browser or Electron environment. Read-only editors allow `copy` but block `cut` and `paste`; disabled editors block all three.
`format` formats the current line or selected lines; it is not a dedicated whole-document formatting command.

Position APIs use **zero-based lines and UTF-16 columns** as `{line, ch}`. Replacement ranges exclude their end position.
`highlightLine` also uses zero-based line numbers. Document changes clear highlights automatically.
Host document APIs remain available when the editor is read-only or disabled; these settings restrict user interaction.

Editing commands invoked through `execute` do not run in read-only mode. When disabled, all commands and `moveTo` do nothing.
The current-line and gutter highlights are hidden while any selection range is
nonempty and return when all ranges are collapsed to cursors.
Operations after destruction throw errors.

### Settings

Initialization also accepts `value` and `definitions`.
Use `setDefinitions` to change additional definitions after initialization.

| Setting | Default | Description |
| --- | --- | --- |
| `language` | `'en'` | UI and diagnostic locale: `'ja'` or `'en'` |
| `codeLanguage` | `'javascript'` | Source language: `'javascript'`, `'java'`, or `null` for plain text; selected at creation |
| `fontFamily` | `monospace` | CSS font-family value; custom fonts must be provided by the host application |
| `fontSize` | `16` | 10-64 px |
| `lineHeight` | `165` | Positive percentage |
| `lineWrapping` | `false` | Line wrapping |
| `structureHighlight` | `true` | Canvas highlighting for functions, classes, branches, and loops |
| `declarationHighlight` | `true` | Canvas highlighting for variable declarations |
| `syntaxHighlight` | `true` | Syntax coloring for comments, keywords, literals, and related tokens |
| `semanticHighlight` | `true` | Semantic highlighting for definitions and variable references |
| `functionLineNumbers` | `false` | Per-function line numbers; ordinary line numbers when analysis is disabled |
| `functionScrollMarkers` | `false` | Independent function-position markers near the scrollbar |
| `bracketMatching` | `true` | CodeMirror matching-bracket highlighting and gutter indicators |
| `rulers` | `true` | Indentation guides |
| `autoIndent` | `true` | Indentation correction during formatting |
| `autoFormat` | `true` | Automatic formatting when editing and leaving a line |
| `formatting` | `true` | Enables formatting; false also disables explicit formatting |
| `completion` | `true` | Completion and argument hints |
| `diagnostics` | `true` | Static diagnostics |
| `analysis` | `true` | Automatic parsing and shared analysis data; disabling it hides analysis-based displays |
| `analysisDelay` | `600` | Automatic analysis delay in milliseconds, zero or greater |
| `readOnly` | `false` | Prevents editing while allowing selection, copying, and search |
| `disabled` | `false` | Stops user interaction; preserves the read-only setting when re-enabled |

Unknown setting names, invalid types, and out-of-range values throw errors. Settings are not persisted.
`codeLanguage` is independent of the UI locale. Omitting it retains JavaScript;
explicit `null` selects plain text without language-specific extensions.
Changing `codeLanguage` through `setSettings` throws; recreate the editor to change it.
Display settings can be changed independently at runtime and do not trigger a new
parse. The `analysis` setting controls worker parsing and shared data, while each
display setting controls only its corresponding presentation; synchronous
CodeMirror syntax sources may continue to provide interim coloring. Function
markers are independent of function line numbers.

```js
const editor = await createEditor(container, { codeLanguage: null });
// Plain text, English UI. Add language: 'ja' for a Japanese UI.
```

Java uses `web-tree-sitter` and the `tree-sitter-java` grammar in a browser
worker. The CodeMirror Java parser is also used for immediate bracket matching.
It supplies provisional syntax coloring during edits; existing Tree-sitter
highlights are mapped across edits until fresh analysis replaces them.
Its initial implementation provides syntax highlighting, including
Java 25 simple source files, structural highlighting for methods and common
control-flow blocks, variable declarations, local variable references, and
per-method/lambda line numbers. Local reference detection uses lexical scopes;
it does not resolve other classes' fields or full Java type information.
Java diagnostics, completion, and formatting are not implemented yet.

Plain text retains editing, undo/redo, search, and ordinary line numbers. It does
not create an analysis worker or completion engine. Diagnostics, formatting,
completion, structural decorations, function numbering and scroll markers have no effect,
even if their settings are true. Settings retain the requested values.
`getAnalysis()` and `await analyzeNow()` return `null`; no analysis events are
emitted. `setDefinitions()` accepts but does not use definitions in plain text.
Automatic bracket insertion and matching are disabled in this mode.
Internally, `src/lang/plain/index.js` implements the complete language interface
with inert methods, so the core follows the same call paths as JavaScript.
Analysis scheduling and diagnostic callbacks still run, returning no results;
no analysis worker or Tern server is created.

Custom automatic formatting is suspended during IME composition. Native IME interaction requires separate verification.
Trigger completion explicitly with Ctrl-Tab, Ctrl-\\, or `execute('complete')`.

### Events

| Event | Data |
| --- | --- |
| `change` | `{origin: 'load' or 'edit', version, text, source?}` |
| `state` | Same as `getState()` |
| `settings` | Settings snapshot |
| `selection` | `{ranges: [{anchor, head}, ...]}` |
| `analysis` | Analysis result described below |
| `focus`, `blur` | Empty object |
| `copy`, `cut` | `{text}`: selection at the time of the clipboard event, before cut processing; empty when nothing is selected. This notification does not confirm an OS clipboard write. |
| `error` | `{message}`, for example when automatic analysis fails |

Event data and analysis results are copied. Changes made by subscribers do not affect internal state.
Explicit analysis failures reject the returned promise.

### Analysis results

```js
{
  version, text, success,
  fnLocs, classLocs, fnStarts, ifLocs, forLocs, fnNames,
  varLocs, letLocs, constLocs
}
```

The existing analyzer's format is preserved. **Only analysis ranges use one-based lines and zero-based columns as `{line, column}`.**
Ranges are `[start, end]`, excluding the end position. `ifLocs` includes the start of the else branch as an additional element.
`classLocs` contains class declaration and expression ranges.
`fnStarts` contains zero-based lines delimiting function-number sections. `fnNames` contains names of functions, classes, and other constructs collected by the existing analyzer.
It is not a list of module exports or scope-resolved public symbols.
As in the original implementation, `forLocs` covers `ForStatement` nodes.

`success` is true when normal Acorn parsing succeeds, and false when tolerant parsing with acorn-loose is used.
This flag is independent of JSHint diagnostics. The AST is not exposed.
Parsing uses script mode, as in the original implementation; ES module source parsing is outside the current scope.

Immediately after editing, `getAnalysis()` returns `null`. Worker replies for older versions are not applied to the display or published as updates.
`analyzeNow()` returns the version captured at the time of the call, so its text and results remain consistent even if editing continues while it is pending.
When exporting, use the returned `text` rather than calling `getValue()` again after analysis.
Explicit `analyzeNow()` requests work even when automatic analysis is disabled, but their results are not applied to the display, stored snapshot, or update events.

### Structure display extension

The structure canvas is also available independently as a CodeMirror 6 extension.
The `croq-mirror/structure` entry point imports CodeMirror packages as external
dependencies, so use a bundler or an import map resolving the same CodeMirror
packages as the host editor. It neither parses the document nor performs analysis.

```js
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { structureView, setStructure } from 'croq-mirror/structure';

const view = new EditorView({
    state: EditorState.create({ doc: 'if (x) {\n  work();\n}', extensions: [structureView] }),
    parent: document.querySelector('#editor'),
});
view.dispatch({ effects: setStructure.of([{
    kind: 'range', from: { line: 0, ch: 0 }, to: { line: 2, ch: 1 },
    fill: 'hsla(150, 100%, 35%, 0.15)', spineChars: 3, branchChars: 4, branches: [],
}]) });
```

Positions are zero-based `{line, ch}` with UTF-16 columns and exclusive ends.
Supply ranges as above or tokens as `{kind: 'token', from, to, fill, stroke}`.
Colors can use `var(--property, fallback)` and are resolved against the editor
when the canvas is repainted. An optional `opacity` sets the canvas alpha
(default `1`). JavaScript and Java class ranges use `--croq-mirror-l-red` at
15% opacity and are drawn underneath their method decorations.
The caller supplies current data in drawing order and is responsible for rejecting
stale asynchronous analysis results. Treat the supplied array and its contents
as immutable after dispatch. Document changes or a `load` user event
clear the display by default; dispatch `setStructure.of([])` to clear it explicitly.
Standalone users can opt into `retainStructureOnEdit` (also exported by the
extension): it discards items spanning edited lines and maps other items to their
new positions. The component instead consumes its versioned common analysis,
which maps unaffected ranges as stale interim data until fresh analysis arrives.
Ordinary newline insertions and automatic
indentation preserve enclosing and shifted structures; splitting an identifier,
a line comment, or a restricted statement is treated more conservatively.
Edits to delimiters or comments also discard later items because their
interpretation may change.
This is a conservative heuristic, not a syntax analysis; other edits can also
affect syntax outside the edited lines. A `load` always clears retained data. The
extension owns and removes its canvas when the editor or extension is destroyed.

### Function line-number extension

`croq-mirror/function-line-numbers` provides a standalone CodeMirror extension.
Like the structure extension, it imports the host's CodeMirror packages as
external dependencies and does not parse the document.

```js
import { functionLineNumbers, setSectionStarts, getSectionLineNumber } from 'croq-mirror/function-line-numbers';

// Include functionLineNumbers in the editor's extensions, then supply section starts.
view.dispatch({ effects: setSectionStarts.of([0, 12]) });
console.log(getSectionLineNumber(view.state, 13)); // [2, 2]
```

Section starts are ordered zero-based document lines; the example requires at
least 14 lines. The result is `[sectionNumber, lineWithinSection]`, with section
number zero before the first start. Document edits or a `load` user event clear
the manually supplied starts; dispatch an empty array to clear them explicitly.
Removing the extension removes its gutter.

### Function scroll-marker extension

`croq-mirror/function-scroll-markers` renders function start positions beside
the scrollbar without adding a gutter or depending on the function-number
extension. In the component, `functionScrollMarkers` controls it independently
of `functionLineNumbers`. It reads shared analysis sections. Standalone users
can include the shared state and publish data with:

```js
import { commonAnalysisState, setCommonAnalysis } from 'croq-mirror/analysis';
import { functionScrollMarkers } from 'croq-mirror/function-scroll-markers';

// Include both in the editor extensions; publish validated common analysis
// with setCommonAnalysis.of(data) when the document's current analysis arrives.
```

### Gutter line-selection extension

`croq-mirror/gutter-line-selection` provides a standalone extension for
clicking, shift-clicking, and dragging in the gutter to select whole lines.
Install a gutter separately, for example CodeMirror's `lineNumbers()` or the
function line-number extension. The host can clear line-selection mode before
an action by dispatching `setLineSelectionMode.of(false)`.

```js
import { lineNumbers } from '@codemirror/view';
import { gutterLineSelection, setLineSelectionMode } from 'croq-mirror/gutter-line-selection';

// Include lineNumbers() and gutterLineSelection in the editor's extensions.
view.dispatch({ effects: setLineSelectionMode.of(false) });
```

The extension ignores lint markers and allows selection in read-only editors.
Setting `EditorView.editable` to false disables gutter interaction. Removing
the extension removes its event listeners and cursor styling.

### Syntax highlighting extension

`croq-mirror/syntax-highlighting` accepts syntax ranges produced by an external
parser. Ranges use zero-based UTF-16 document offsets and a semantic `kind`;
the extension does not parse the document. By default, document edits clear
supplied ranges.

```js
import { syntaxHighlightingExtension, setSyntaxHighlights } from 'croq-mirror/syntax-highlighting';

// Include syntaxHighlightingExtension in the editor's extensions.
view.dispatch({ effects: setSyntaxHighlights.of([
    { from: 0, to: 4, kind: 'keyword' },
    { from: 5, to: 11, kind: 'type' },
]) });
```

Supported kinds are `comment`, `keyword`, `operator`, `type`, `function`, `variable`,
`literal`, `invalid`, `definition`, `property`, `local-variable`,
`local-reference`, and `variable-reference`. Java's Tree-sitter worker supplies ranges through
`setSyntaxHighlights`. JavaScript supplies ranges from its Lezer tree through
`syntaxHighlightingSource(analyze, needsRefresh)`, which adds a synchronous
source to the same extension. The source callback receives an `EditorState`;
the optional `needsRefresh` receives a `ViewUpdate` for changes such as
incremental syntax-tree updates. Document edits always refresh the source.
Java uses `syntaxHighlightingSource(analyze, needsRefresh, { retainOnEdit: true })`
to keep previously supplied ranges mapped across edits and fill uncovered
positions from its CodeMirror syntax tree until the next worker result arrives.
Its `reconcileComments` option returns the end of the currently parsed document
and lets synchronous comment ranges override retained code styling (and vice
versa) within that parsed region. Retained ranges beyond it remain untouched.
These retained ranges can temporarily reflect an earlier semantic classification;
loading a document clears them. With automatic analysis disabled, only the
CodeMirror-based syntax coloring is available.
Removing the highlighting extension removes the source's decorations. Local
reference color can be customized with `--croq-syntax-local-variable-color`.
The background, shadow, and radius of variable references can be customized with
`--croq-syntax-reference-background`, `--croq-syntax-reference-shadow`, and
`--croq-syntax-reference-radius`. Comments, keywords/operators, definitions,
and literals are bold by default. Literals also have a text shadow; both literal
text shadows and variable-reference backgrounds/shadows are hidden on the
active line. Font weights and literal shadows can be customized with
`--croq-syntax-comment-font-weight`, `--croq-syntax-keyword-font-weight`,
`--croq-syntax-definition-font-weight`, `--croq-syntax-literal-font-weight`, and
`--croq-syntax-literal-text-shadow`.

The component's `syntaxHighlight` and `semanticHighlight` settings independently
toggle token coloring and definition/reference decoration.

### Bracket matching extension

`croq-mirror/bracket-matching` combines CodeMirror's `bracketMatching()` with
the component's gutter indicators for matching brackets. The `bracketMatching`
setting toggles both together; it does not scan the whole document for unmatched
brackets.

### Indentation ruler extension

`croq-mirror/indent-rulers` provides standalone guides at character columns 4,
8, and 12. Include `indentRulers` in the editor's extensions; removing it
removes the guides and their stylesheet. The guides follow scrolling, editor
geometry and font metrics, and are clipped to the visible area and an overlay
up to 64 character widths wide. As with the component, columns use the editor's default
character width and are intended for monospaced fonts.

```js
import { indentRulers } from 'croq-mirror/indent-rulers';
```

Individual guide columns can be changed through CSS, for example:

```css
#editor .cm-croq-rulers > span:nth-child(1) { --croq-indent-ruler-column: 2; }
```

### Extension styling

Each extension keeps its CSS in its own source directory. The build embeds it
in the extension's JavaScript; installing or removing the extension installs
or removes its scoped stylesheet automatically. `EditorView.cspNonce` is used
for the stylesheet when provided. Set custom properties on an editor or an
ancestor to change its appearance without affecting other editors:

```css
#editor {
    --croq-function-number-color: #284f9e;
    --croq-function-scroll-marker-color: #284f9e;
    --croq-gutter-cursor: crosshair;
}
```

| Extension | Custom properties |
| --- | --- |
| Structure | `--croq-structure-scroller-z-index`, `--croq-structure-content-z-index`, `--croq-structure-overlay-z-index`, `--croq-structure-overlay-position`, `--croq-structure-overlay-overflow`, `--croq-structure-overlay-pointer-events`, `--croq-structure-canvas-display`, `--croq-structure-canvas-width`, `--croq-structure-canvas-height` |
| Function numbers | `--croq-function-number-color`, `--croq-function-active-number-color`, `--croq-function-line-color`, `--croq-function-number-padding`, `--croq-function-number-display`, `--croq-function-number-font-variant`, `--croq-function-line-align`, `--croq-function-gutter-min-width`, `--croq-function-gutter-overflow`, `--croq-function-gutter-item-position`, `--croq-function-gutter-item-padding` |
| Function gutter edge | `--croq-function-gutter-edge-content`, `--croq-function-gutter-edge-width`, `--croq-function-gutter-edge-color`, `--croq-function-gutter-edge-hover-color`, `--croq-function-gutter-edge-pattern`, `--croq-function-stripe-width`, `--croq-function-stripe-color` |
| Function highlighting | `--croq-function-alternate-background`, `--croq-function-alternate-content`, `--croq-function-alternate-position`, `--croq-function-alternate-inset`, `--croq-function-alternate-z-index`, `--croq-function-alternate-pointer-events`, `--croq-function-lint-gutter-width` (component), `--croq-mirror-lint-gutter-width` (standalone) |
| Function scroll markers | `--croq-function-scroll-marker-track-width`, `--croq-function-scroll-track-position`, `--croq-function-scroll-track-right`, `--croq-function-scroll-track-pointer-events`, `--croq-function-scroll-marker-inset`, `--croq-function-scroll-marker-radius`, `--croq-function-scroll-marker-color`, `--croq-function-scroll-marker-position`, `--croq-function-scroll-marker-aspect-ratio`, `--croq-function-scroll-marker-z-index` |
| Gutter selection | `--croq-gutter-cursor`, `--croq-gutter-line-selection-cursor` (complete CSS `cursor` values) |
| Syntax highlighting | `--croq-syntax-comment-color`, `--croq-syntax-comment-font-weight`, `--croq-syntax-keyword-color`, `--croq-syntax-keyword-font-weight`, `--croq-syntax-type-color`, `--croq-syntax-function-color`, `--croq-syntax-definition-color`, `--croq-syntax-definition-font-weight`, `--croq-syntax-property-color`, `--croq-syntax-variable-color`, `--croq-syntax-local-variable-color`, `--croq-syntax-reference-background`, `--croq-syntax-reference-shadow`, `--croq-syntax-reference-radius`, `--croq-syntax-literal-color`, `--croq-syntax-literal-font-weight`, `--croq-syntax-literal-text-shadow`, `--croq-syntax-invalid-decoration` |
| Indentation rulers | `--croq-indent-ruler-column` (unitless character column), `--croq-indent-ruler-width`, `--croq-indent-ruler-style`, `--croq-indent-ruler-color`, `--croq-indent-ruler-scroller-z-index`, `--croq-indent-ruler-content-z-index`, `--croq-indent-ruler-overlay-position`, `--croq-indent-ruler-overlay-z-index`, `--croq-indent-ruler-overlay-overflow`, `--croq-indent-ruler-pointer-events`, `--croq-indent-ruler-container-position`, `--croq-indent-ruler-container-right`, `--croq-indent-ruler-position`, `--croq-indent-ruler-inset-block` |

Defaults are specified in each extension's `style.css`, including fallbacks to
the component's existing color variables. These properties can be changed at
runtime; changing layout or pointer-event properties may affect functionality.
Structure shapes are painted on a canvas; their fill and stroke colors are
supplied in the structure data and may reference CSS custom properties. Positions calculated
by the extensions are applied directly and are not CSS custom properties.

## Sources and build

`src/index.js` is the component's public API entry point. Common implementation modules (`editor-view.js` and `analysis-client.js`) live directly in `src/`. `src/analysis/` defines and manages shared parser data. `src/extensions/` contains the structure view, syntax highlighting, function line numbers, function scroll markers, bracket matching, gutter line selection, and indentation rulers. Whitespace highlighting is built into the editor and styled in `src/styles/index.css`. `src/lang/js/` and `src/lang/java/` contain language-specific parsers and adapters, and `src/lang/language-interface.md` describes the internal language contract. `src/styles/` contains the theme, and `dist/` the distribution. External library wrappers are generated in `.build/lib/` during the build.
`build.mjs` wraps dependency browser builds in ES modules without adding globals to window.
It organizes library preparation, JavaScript bundling, styles, and licenses into separate steps, using `tasks.mjs` for package resolution and file copying/writing.
`src/styles/index.css` imports `variables.css`; both scope their rules to the component. The build bundles these files into the distributed stylesheet. CodeMirror 6 installs its base styles when an editor is mounted.
It uses esbuild to bundle and minify JavaScript and minify CSS. Intermediate modules are generated in `.build/`, outside the distribution.
Each component build replaces `dist/` to remove obsolete output files.

The distribution contains:

- `croq-mirror.min.js`: the editor and its dependencies
- `analysis-worker.min.js`: the analysis worker and its parser dependencies
- `analysis-worker-java.min.js`, `web-tree-sitter.wasm`, `tree-sitter-java.wasm`: the Java parser worker and WebAssembly runtimes
- `croq-mirror.min.css`: the combined, scoped editor styles
- `analysis.js`, `structure-view.js`, `syntax-highlighting.js`, `function-line-numbers.js`, `function-scroll-markers.js`, `bracket-matching.js`, `gutter-line-selection.js`, `indent-rulers.js`: standalone extensions with external CodeMirror dependencies
- JavaScript source maps for debugging; these are not required at runtime
- `licenses/`: third-party licenses

Keep the worker beside the main JavaScript file when deploying. Cursor SVGs remain editable in `src/extensions/gutter-line-selection/` and are embedded as data URLs in the extension's JavaScript; no separate cursor files are distributed.
No font files or `@font-face` declarations are bundled. The host application can load its own fonts and select them using `fontFamily`; search input fonts can be set with `--croq-mirror-font-console` on `.croq-mirror`.
English and Japanese JSHint implementations are retained as separate functions. CodeMirror styles and the theme are scoped to the component root.
Editor UI text is maintained separately in `src/res/lang.en.json` and `src/res/lang.ja.json`.
Default JSHint and formatting options are stored as data in `src/res/defaults.json`.
The build bundles these resources into the main JavaScript file, so no additional runtime requests or distribution files are required.
Diagnostic messages remain supplied by the English and Japanese JSHint dependencies.
CodeMirror extensions render completion, argument hints, and diagnostic popups within the component.

```sh
yarn build         # Build the component and example
yarn docs          # Rebuild the component and example
yarn preview       # Preview the generated docs
yarn test          # Run analysis tests
yarn test:browser  # Build and test the component and example in Chrome
```

Example sources live in `src/_docs/`, and generated files in `docs/`.
The example uses Klales for base styling, with local CSS for its layout.
Vite copies `dist/` into `docs/` as public assets. Serve `docs/` alone to include the worker, fonts, and licenses.
The example loads the distributed modules unchanged. Relative URLs support deployment under a subdirectory.
Run `node build.mjs` to build only the component.
There are no references or dependencies on the Croqujs repository.

The original source license is in `LICENSE`, and bundled library licenses are in `dist/licenses/`.
Fonts and cursors were inherited from the original repository; asset-specific rights still require verification before third-party distribution.

## Verification scope

`test/browser.html` contains browser contract tests. Results are recorded in `test/chrome-result.json` and `test/edge-result.json`.
Headless tests use Chrome by default. Pass an Edge or other Chromium-based browser executable as the first argument to use it instead.
Firefox and Safari support is a requirement, but has not been verified in this environment.
Native Japanese IME input, the OS clipboard, mouse-based line selection, screen readers, and precise visual equivalence with the original editor remain unverified.
