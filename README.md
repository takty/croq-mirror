# croq-mirror

A CodeMirror 5 editor component extracted from Croqujs.
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
| `highlightLine(line)` | Highlights a line and returns an ID for clearing it |
| `clearHighlight(id)` | Clears the specified highlight |
| `getFunctionLineNumber(line)` | Returns `[functionNumber, lineWithinFunction]`, or `[0, line + 1]` when analysis is unavailable |
| `getCodeMirror()` | Returns the CodeMirror 5 instance; direct access is outside future compatibility guarantees |
| `refresh()` | Redraws the editor, for example after revealing a hidden container |
| `destroy()` | Releases resources and removes the DOM; safe to call repeatedly |

Commands: `undo`, `redo`, `selectAll`, `toggleComment`, `format`, `find`, `findNext`, `replace`, `complete`.
`format` formats the current line or selected lines; it is not a dedicated whole-document formatting command.

Position APIs use **zero-based lines and UTF-16 columns** as `{line, ch}`. Replacement ranges exclude their end position.
`highlightLine` also uses zero-based line numbers. Document changes clear highlights automatically.
Host document APIs remain available when the editor is read-only or disabled; these settings restrict user interaction.
Editing commands invoked through `execute` do not run in read-only mode. When disabled, all commands and `moveTo` do nothing.
Operations after destruction throw errors. Do not use a previously obtained CodeMirror instance after destruction.

### Settings

Initialization also accepts `value` and `definitions`.
Use `setDefinitions` to change additional definitions after initialization.

| Setting | Default | Description |
| --- | --- | --- |
| `language` | `'ja'` | `'ja'` or `'en'` |
| `fontFamily` | Bundled fonts with Japanese font fallbacks | CSS font-family value |
| `fontSize` | `16` | 10-64 px |
| `lineHeight` | `165` | Positive percentage |
| `lineWrapping` | `false` | Line wrapping |
| `functionLineNumbers` | `false` | Per-function line numbers; ordinary line numbers when analysis is disabled |
| `rulers` | `true` | Indentation guides |
| `autoIndent` | `true` | Indentation correction during formatting |
| `autoFormat` | `true` | Automatic formatting when editing and leaving a line |
| `formatting` | `true` | Enables formatting; false also disables explicit formatting |
| `completion` | `true` | Completion and argument hints |
| `diagnostics` | `true` | Static diagnostics |
| `analysis` | `true` | Automatic structural analysis and display |
| `analysisDelay` | `600` | Automatic analysis delay in milliseconds, zero or greater |
| `readOnly` | `false` | Prevents editing while allowing selection, copying, and search |
| `disabled` | `false` | Stops user interaction; preserves the read-only setting when re-enabled |

Unknown setting names, invalid types, and out-of-range values throw errors. Settings are not persisted.
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
| `error` | `{message}`, for example when automatic analysis fails |

Event data and analysis results are copied. Changes made by subscribers do not affect internal state.
Explicit analysis failures reject the returned promise.

### Analysis results

```js
{
  version, text, success,
  fnLocs, fnStarts, ifLocs, forLocs, fnNames,
  varLocs, letLocs, constLocs
}
```

The existing analyzer's format is preserved. **Only analysis ranges use one-based lines and zero-based columns as `{line, column}`.**
Ranges are `[start, end]`, excluding the end position. `ifLocs` includes the start of the else branch as an additional element.
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

## Sources and build

`src/lib/` contains component sources, `src/styles/` the theme, `src/assets/` assets inherited from Croqujs, and `dist/` the distribution.
`build.mjs` wraps dependency browser builds in ES modules without adding globals to window.
It uses esbuild to bundle and minify JavaScript and minify CSS. Intermediate modules are generated in `.build/`, outside the distribution.
Each component build replaces `dist/` to remove obsolete output files.

The distribution contains:

- `croq-mirror.min.js`: the editor and its dependencies
- `analysis-worker.min.js`: the analysis worker and its parser dependencies
- `croq-mirror.min.css`: the combined, scoped editor styles
- JavaScript source maps for debugging; these are not required at runtime
- `assets/`: fonts and cursor images
- `licenses/`: third-party licenses

Keep the worker beside the main JavaScript file, and preserve the relative asset paths when deploying.
English and Japanese JSHint implementations are retained as separate functions. CodeMirror styles and the theme are scoped to the component root.
Completion and diagnostic popups are also contained within the component. Tern tooltip positioning is adjusted during the build.

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
