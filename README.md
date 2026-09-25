# SysML Modeler

A browser-based SysML modeling tool in the manner of Cameo Systems Modeler: one
model repository, many diagrams over it, a specification panel, live checks,
generated tables and matrices, XMI interchange, and export to SVG / PNG / PDF.

No build step, no package manager, no dependencies — plain ES modules and SVG,
styled with the shared `ui-kit` HUD theme.

## Running it

```bash
./serve.sh
```

Then open <http://localhost:8124>. (ES modules need `http://`; opening
`index.html` from the filesystem will not work.) The app opens on a worked
sample — a small electric vehicle. `File ▸ New model` starts an empty one. Work
is autosaved to the browser; `File ▸ Save` writes a `*.sysml.json` file.

```bash
node --test tests/
```

runs the model, validation, layout, JSON, XMI and table tests under Node.

## macOS app

```bash
macos/scripts/build-app.sh
```

builds `macos/build/SysML Modeler.app`: a native shell that hosts this same web
app, with document windows, a real menu bar, Finder file opening, native save
panels and vector PDF export. The shell is the shared `../shell-kit` package;
see [macos/README.md](macos/README.md).

## Shared kits

Sibling repos this app vendors, the suite convention: a copy lives here, and
each kit's `scripts/copy-into.mjs --check` (run by `macos/scripts/build-app.sh`)
reports drift.

| Kit | Copy here | What it is |
|---|---|---|
| `../ui-kit` | `ui-kit/` | the HUD interface: tokens, classes, fonts, theme picker |
| `../shell-kit` | `src/host.js` | the macOS shell (Swift, by path) and the page's bridge |
| `../sync-kit` | `sync-kit/` | record sync between devices, and the Portal session |

## Sync

One model is one record in workspace `sysml`:
`{ id, type: 'document', format: 'sysml-modeler', name, body, updatedAt, deletedAt, origin }`
— `id` is the model's root package id (the file carries it), `body` is exactly
what `File ▸ Save` writes, `origin` is a per-device id. `src/state/sync.js` is
the only module that imports sync-kit. Every committed edit is written to the
device's record store (IndexedDB `sysml-modeler`, `localStorage` where there is
none) and, when sync is on, sent shortly after; the model also syncs every 30 s,
when the window is focused, and after each save. A newer version of the open
model from another device replaces it only while nothing here is unsaved;
otherwise both timestamps are shown and you are asked. **Settings ▸ Models on
the shelf** lists every model the workspace holds, so a second device can open
what the first one made.

Two ways to reach a server — outside the Portal nothing changes:

- **Typed in.** Settings ▸ Sync: the server's origin (or workspace URL), a
  device token, and a switch. A paired Mac fills the first two in itself.
- **The Portal.** Served at `/sysml/` on the Portal's origin, the page reads
  its id from the injected `<meta name="toolkit-portal">`, asks `/auth/me`
  which workspace the session reaches, and syncs with the session cookie — no
  URL, no token; Settings says *Signed in via the toolkit*. The Portal's bar
  (`<sc-portal-bar>`) sits above the app, and a 401 turns the status readout
  and the bar into *Sign in*. `toolkit-app.json` is the contract the Portal
  builds from; `tests`, `doc`, `macos` and `serve.sh` stay out of its static set.

**Where the data lives.** Every committed edit is written to the record store
in IndexedDB (`sysml-modeler`) — there is no localStorage autosave any more; a
copy an older build left there is moved across once, and forgotten only after
it reads back. `localStorage` keeps settings, the device id and the theme.
On start and whenever sync is switched on the app asks the browser to keep the
origin's storage (`navigator.storage.persist()` — sync-kit has no persistence
helper yet); Settings ▸ Storage shows **Persisted** or **At risk** with the
advice (install the app from the browser menu; on iPhone add it to the Home
Screen), the local live/deleted counts and space, and the server's record count
from `/sync/health` beside them. Chrome grants persistence silently only to an
installed or otherwise engaged origin, so a plain tab reads *At risk* until then.

**Export and import.** `File ▸ Export everything` writes one JSON file
(`sysml-modeler-records`) of every record and tombstone on this device;
`File ▸ Import everything` merges one back by the same last-write-wins rule a
sync uses, so a copy can live anywhere without the server.

Every storage name carries the app prefix (`sysml-modeler:autosave`,
`sysml-modeler:sync`, `sysml-modeler:deviceId`, IndexedDB `sysml-modeler`),
because on the Portal nine apps share one origin.

Not split into per-element records yet. The containment tree — each element
exists once, and diagrams only point at elements — is what makes that the
natural next step.

## The idea it is built on

An element exists **once**, in the containment tree. A diagram holds *symbols*
that point at elements and *paths* that point at relationships:

- Rename a block and every diagram, compartment, table and matrix follows.
- `Delete` takes a symbol off the diagram. `Shift+Delete` deletes the element
  from the model — and with it every symbol of it, everywhere.
- Drag an element from the tree onto a diagram to show it there. Its
  relationships to whatever is already drawn come along.

Three kinds of edge are *derived* rather than stored, so they can never drift
from the structure they describe:

| Drawn as | Is really |
|---|---|
| Composition (filled diamond) | a **part property** of the whole, typed by the part's block |
| Reference (hollow diamond) | a **reference property** |
| Containment (⊕) | **ownership** in the containment tree |

Drawing a composition creates the part property; deleting the property removes
the line. The same part is what an internal block diagram shows as a box.

## What is in it

| Diagram | Nodes | Paths |
|---|---|---|
| Block definition (`bdd`) | block, value type, actor, package, note | composition, reference, association, generalization, dependency, allocate |
| Internal block (`ibd`) | part, reference, port (on parts and on the frame), note | connector |
| Requirement (`req`) | requirement, test case, block, package, note | containment, derive, satisfy, verify, refine, trace |
| Use case (`uc`) | actor, use case, subject (a block), note | association, include, extend, generalization |
| Package (`pkg`) | package, block, note | containment, dependency |

Generated views, computed from the model on every render and editable in place:

- **Requirement table** — id, name, text, owner, satisfied by, verified by,
  derived from. Gaps are highlighted. CSV export.
- **Dependency matrix** — any of satisfy / verify / derive / refine / allocate /
  trace / dependency between any two kinds of element. Click a cell to add or
  remove the relationship. Rows and columns with no mark are highlighted. CSV export.

Canvas: drag to move, corner handles to resize, double-click to rename, drag a
port along its border, drag the background or scroll to pan, `⌘`/`Ctrl`+scroll
to zoom, `Shift`+drag to marquee-select, arrows to nudge, `⌘Z` / `⇧⌘Z`.
Paths route orthogonally on their own and re-route as symbols move.

## Checks

The **Checks** panel re-runs on every edit; clicking a finding selects the
element and opens a diagram that shows it. Every `code` is a stable identifier.

| Code | Level | Rule |
|---|---|---|
| `name-empty` | error | An element has no name |
| `name-dup` | warning | Two siblings of the same kind share a name |
| `part-untyped` | error | A part or reference property has no block as its type |
| `value-untyped` | warning | A value property has no type |
| `port-untyped` | warning | A port has no type |
| `composition-cycle` | error | A block is, directly or indirectly, a part of itself |
| `gen-cycle` | error | A generalization chain loops back on itself |
| `req-id-missing` | error | A requirement has no id |
| `req-id-dup` | error | Two requirements share an id |
| `req-text-empty` | warning | A requirement has no text |
| `req-unsatisfied` | warning | A leaf requirement has no «satisfy» relationship |
| `req-unverified` | warning | A leaf requirement has no «verify» relationship |
| `rel-dangling` | error | A relationship points at an element that no longer exists |
| `rel-ends` | error | A relationship joins kinds of element it is not defined for |
| `rel-self` | warning | A relationship starts and ends on the same element |
| `rel-dup` | warning | The same relationship is recorded twice |
| `connector-incompatible` | warning | A connector joins ports whose types or directions do not match |
| `usecase-no-actor` | warning | A use case is associated with no actor |
| `actor-unused` | info | An actor takes part in no use case |
| `block-unused` | info | A block appears on no diagram and is used by no other element |
| `diagram-empty` | info | A diagram shows nothing |

The table lives in `src/model/validate.js` as `RULES`; `Help` prints it too.

## Files and interchange

- **`*.sysml.json`** — the native format: the model object as JSON. Loading
  repairs what it can (a symbol of a deleted element is dropped and reported)
  and refuses what it cannot, with a sentence that says why.
- **XMI export** — UML 2.5 XMI with SysML 1.x stereotype applications
  (`sysml:Block`, `sysml:Requirement` with `Id`/`Text`, `sysml:Satisfy`, …),
  the form Cameo / MagicDraw read. Parts and references are written as owned
  attributes *with* their associations, as those tools expect. XMI has no
  portable diagram format, so diagrams ride in an `xmi:Extension` that only
  this app reads; "model only" leaves it out.
- **XMI import** — a file written by this app round-trips losslessly through
  that extension. A file from another tool is mapped kind by kind (including
  the `<memberEnd xmi:idref="…"/>` child form Cameo writes); anything with no
  counterpart here — state machines, activities, parametrics — is counted in
  the import report rather than silently lost, and starter diagrams are laid
  out per package.
- **SVG / PNG / PDF** — always dark-on-white, whatever the screen palette.
  PDF goes through the browser's print dialog, which keeps it vector.
  `doc/sample-*.svg` are exports of the sample model.

## Layout of the code

```
src/model/types.js     the vocabulary: element, relationship and diagram kinds, who may own or join what
src/model/model.js     the repository: elements, relationships, diagrams, symbols, derived edges
src/model/validate.js  the checks
src/model/layout.js    symbol content and size, port placement, path routing — pure, DOM-free
src/model/sample.js    the worked example
src/state/store.js     state, snapshot undo/redo, autosave
src/state/actions.js   editing commands shared by canvas, tree, panels and menus
src/host.js            vendored from ../shell-kit: the page's half of the bridge to the macOS app (inert in a browser)
src/io/                json (native), xmi, exportImage
src/ui/                render (diagram → SVG markup), canvas, tree, spec, bottom, tables, toolbar, dialog
ui-kit/                a copy of the shared kit, as in IDEF0
macos/                 the macOS app: config + menu table on ../shell-kit's ToolkitShell, and its build script
```

`model/` and `io/` never touch the DOM, which is what lets the tests — and a
later command-line tool — run them under Node.

## Not yet

Activity, state machine, sequence and parametric diagrams; nested parts on an
ibd; manual bend points on paths (routing is automatic); item flows; a
command-line tool like IDEF0's. The app identity colour is set locally in
`src/styles.css`; it belongs in `ui-kit/tokens/tokens.json` once the shared kit
registers `sysml` as an app.
