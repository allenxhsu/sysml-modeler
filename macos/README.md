# SysML Modeler for macOS

A native shell around the [web app](../README.md). The model, the diagrams and
every editing rule stay in `../src` — one codebase, so the Mac app and the
browser can never disagree about a diagram.

The shell itself — documents, the menu bar, save panels, PDF, the `WKWebView`
and the message channel — is the shared **ToolkitShell** package in
[`../../shell-kit`](../../shell-kit/README.md), which this repo depends on by
path. What is left here is the app: `App.swift` (a `ShellConfig` and an empty
`WebDocument` subclass), `MainMenu.swift` (the menu table), the test that
checks the menu against the page, and the bundle script. The page's half of
the bridge, `src/host.js`, is a vendored copy of `shell-kit/js/host.js`;
`build-app.sh` refuses to bundle a stale copy.

(IDEF0's Mac app is a full Swift port of its model layer. This one is not; if a
`sysml` command-line tool is wanted later, the DOM-free `src/model` and
`src/io` are the part to port.)

## Requirements

macOS 14 and a Swift 6 toolchain (Xcode 16 or later, or matching command-line
tools). No other dependencies.

## Building the app

```bash
macos/scripts/build-app.sh
```

produces `macos/build/SysML Modeler.app` (under 1 MB), ad-hoc signed so a
locally built copy launches without Gatekeeper friction. `CONFIG=debug`,
`OUT_DIR=…` and `VERSION=…` steer it, as in IDEF0. The script first runs the
kits' copy checks (`ui-kit`, `shell-kit`, `sync-kit` — skipped while a kit has
no copy script yet), then copies `index.html`, `src/` and the parts of
`ui-kit/` the page loads into the bundle, so **rebuild after changing the web
app**. To refresh the vendored bridge: `node ../shell-kit/scripts/copy-into.mjs src/host.js`.

The app has to run as a bundle: `NSDocument` reads the document types it can
open from `Info.plist`. Under `swift run` the window still comes up — it serves
the web app straight from the repository — but Open and Save are not available.

```bash
cd macos && swift test
```

checks that every menu command id exists in the page's `COMMANDS` table and
that the kit serves this repository. The shell's own rules (path guard, MIME
types, save names, XML sniffing, menu helpers) are tested in shell-kit.

## How the two halves meet

The page is served from a custom scheme, `sysml-app://app/…` — ES modules will
not load from `file://`, and a real origin also gives the page its own
`localStorage`, where the shared appearance preference lives.

`src/host.js` is the page's half of the bridge; shell-kit's
`EditorWindowController.swift` is the app's.

| Page → app | |
|---|---|
| `ready` | the page is up; the app hands it the file the document read |
| `changed` `{json, dirty, name}` | sent after every model edit (once per drag). The document keeps the JSON, so saving never has to ask the page and wait |
| `saveFile` `{name, base64}` | an export (SVG, PNG, XMI, CSV): the app shows a save panel |
| `pdf` `{name, pages: [{svg, w, h}]}` | the app renders each SVG in an offscreen web view and joins the pages with PDFKit — vector, one page per diagram, each page the size of its diagram |
| `new` `open` `save` | the page's own shortcuts, forwarded to AppKit |

| App → page | |
|---|---|
| `sysmlHost.load(text, name)` | a `.sysml.json` model, or XMI |
| `sysmlHost.command(id)` | a menu command — the same ids the web menu bar runs |
| `sysmlHost.saved(name)` | the document was written; the page clears its unsaved mark |

Hosted, the page hides its HTML menu bar, does not use the browser autosave
(each window is a document, and the app saves it), and suppresses the web
view's own context menu, whose Reload would discard the window's model.

## Files

`File ▸ Open` reads a `.sysml.json` model or an XMI file (`.xmi`, `.uml`,
`.xml`). XMI always arrives as a new, untitled, unsaved document — it is never
written back over the file it came from; use `File ▸ Export ▸ XMI` for that.
The app only *writes* `.sysml.json`, and suggests the same
`model-name.sysml.json` the web app gives its downloads.

It registers as an **Alternate** handler for `public.json` and `public.xml`: it
can open either, but macOS will not make it the default opener for all JSON.
Choose it per file with Finder's *Open With*.

## Keys

`⌘Z` / `⇧⌘Z` undo and redo the model — or the text, while a text field has the
caret. `⌘A` likewise. Delete and Shift+Delete are handled by the page and
deliberately have no menu key equivalent, which would take the key away from
text fields. `⌘+` `⌘-` `⌘0` zoom; `⌘,` opens Appearance; `⇧⌘E` exports the
open diagram as PDF.
