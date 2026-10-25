# croq-mirror Editor Component Specification

## 1. Purpose and scope

Extract the editor features in Croqujs into an independent editor component that runs in ordinary browsers.

The following describes the original extraction phase. For the current standalone repository layout and build commands, see [README.md](./README.md).

- Create the component in `croqujs/src/croq-mirror`.
- Do not modify the separate `croq-mirror` repository during that phase.
- Do not create Git commits.
- First create the component and browser example inside the new directory.
- Integrate it into the existing Croqujs application as a separate phase after standalone verification. Changes to existing files belong to that later phase.

## 2. Technology and supported environments

- Use CodeMirror 5 for the initial version.
- Consider migrating to CodeMirror 6 after extraction and integration into Croqujs are complete.
- Do not depend on Electron or Node.js runtime APIs.
- Target desktop Chrome, Edge, Firefox, and Safari.
- Assume pages are served over HTTP or HTTPS. Direct use through `file://` is not guaranteed.
- Use ES modules and provide a built component and CSS. Consumers must not require a dedicated build environment.
- Support multiple editors on one page, with independent documents, settings, events, and analysis results.

## 3. Features and responsibility boundaries

The component includes:

- Text editing, selection, cursor operations, and undo/redo
- Search, replacement, and comment toggling
- Tern completion and argument hints
- Diagnostics through JSHint and the Japanese educational JSHint variant
- Formatting with js-beautify
- Parsing with Acorn-related libraries and worker management
- Existing editor features such as structure visualization, per-function line numbers, and line selection
- Externally requested navigation, line highlighting, and highlight clearing

Completion, diagnostics, formatting, and analysis can each be enabled or disabled independently.

The host application is responsible for:

- Loading and saving files, running programs, and exporting
- Electron integration, window operations, screen capture, and copying images
- Toolbars, menus, settings screens, dialogs, and output panes
- Receiving, interpreting, and displaying runtime errors
- Persisting settings
- Application-specific clipboard operations, such as clipboard inspection and image copying

UI directly associated with editing, such as completion lists, diagnostics, and search fields, belongs to the component. Keep surrounding application UI outside it wherever possible.

## 4. Appearance and settings

- Preserve the current Croqujs design as the default.
- Prevent component styles from affecting other editors or the host page.
- Allow external configuration of fonts, font size, line height, wrapping, and similar options.
- Let the host container determine width and height, and respond to container resizing.
- Do not include split panes or resize handles.
- Allow Japanese or English localization per editor, covering search-field text and diagnostic messages.
- Provide APIs to read and update settings, plus change notifications. The host handles saving and restoring them.

## 5. Document operations and editing state

Use separate APIs for loading a document and applying edits.

| Operation | Behavior |
| --- | --- |
| Load document | Sets the text and resets editing history, cursor, and previous analysis results |
| Apply edit | Creates a change that can be undone |

Change notifications must distinguish document loading from editing.

Read-only and disabled are separate states.

| State | Behavior |
| --- | --- |
| Read-only | Prevents user edits while allowing selection, copying, and search |
| Disabled | Stops user interaction, including editing, selection, and focus acquisition |

When re-enabling interaction, restore the existing read-only setting.

## 6. Completion, formatting, and clipboard

### Completion

In addition to standard JavaScript and browser definitions, allow the host to supply additional definitions.

- Accept and replace them both during and after initialization.
- Manage additional definitions separately for each editor.

### Formatting

Preserve the current Croqujs automatic formatting behavior as the default.

- Allow automatic formatting to be disabled.
- Keep explicit API-triggered formatting available when automatic formatting is disabled.

### Clipboard

- Support ordinary keyboard copy, cut, and paste operations.
- Provide APIs to get and replace selected text.
- Expose `cut`, `copy`, and `paste` through `execute(command)`, focusing the editor and using `document.execCommand` as in the original editor.
- Block all three commands when disabled; allow only `copy` when read-only.
- Leave clipboard inspection, menu state, and image copying to the host.

## 7. Analysis and exposed results

Enable analysis by default and run it automatically after edits. The component owns scheduling, execution, workers, and stored results.

Ordinary editing remains available when analysis is disabled. Stop analysis-dependent displays, such as structure visualization and per-function line numbers.

Expose the following capabilities:

- Retrieve the latest analysis result
- Receive notifications when analysis results change
- Request analysis explicitly and await completion
- Retrieve source text and analysis results for the same document version

Results include the document version and parsing success status. Do not treat results for an old document version as results for the current version.

Expose structural information and function names, not the full Acorn AST. Document coordinate conventions and result formats when defining the API.

Croqujs uses this public API to reuse analysis results for operations such as exporting.

## 8. Public API and lifecycle

The public API includes:

- Document loading, text retrieval, and undoable edits
- Getting and replacing selected text
- Editing commands
- Reading and changing display settings
- Read-only and disabled state control
- State queries, including undo/redo availability
- Content, settings, and state change notifications
- Additional completion definition configuration
- Analysis result retrieval, update notifications, and explicit requests
- Navigation by line and column
- Line highlighting and clearing
- Access to the CodeMirror instance for extensions
- Destruction

Initialization is asynchronous and returns an instance after required setup is complete. Initialization failures must be observable by the caller.

Provide `destroy()` to release owned DOM elements, events, timers, workers, and completion servers. Allow recreation in the same container.

Provide ordinary operations through the croq-mirror API. Direct CodeMirror access is an extension mechanism tied to CodeMirror 5; compatibility is not guaranteed for a future migration to CodeMirror 6.

## 9. Standalone verification and integration

Use the browser example to verify:

- Operation without Electron or Node.js runtime APIs
- Editing, search, completion, diagnostics, formatting, and structure visualization
- Japanese text input and undo/redo
- Independence of multiple editors with different settings and languages
- Matching document and analysis versions
- Read-only and disabled states, including restoration
- Adaptation to container resizing
- Destruction and recreation
- External navigation and line highlighting

Record verification results by browser and identify unverified environments explicitly.

After standalone verification, connect the component to Croqujs and verify existing feature integration and operation in Electron.
