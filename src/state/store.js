// Application state with snapshot undo/redo.
//
// Model edits go through `commit()`, which snapshots the model first; UI-only
// state (selection, open tabs, current tool) changes through `set()` and is
// not undoable.

import { deepClone } from '../util.js';
import { createModel } from '../model/model.js';
import { validate } from '../model/validate.js';
import { hosted } from '../host.js';

const MAX_HISTORY = 100;
const AUTOSAVE_KEY = 'sysml-modeler:autosave';

export const store = {
  model: createModel('Untitled model'),
  ui: {
    openTabs: [],            // diagram ids, in tab order
    currentDiagramId: null,
    selection: null,         // { elementId?, symbolIds?: [], pathId?, relId? }
    tool: 'select',          // 'select' | 'node:<kind>' | 'path:<kind>'
    pending: null,           // in-progress path: { from: {symbolId|portKey}, cursor }
    views: {},               // diagramId → { scale, tx, ty }
    fileName: null,
    dirty: false,
    hint: '',
    leftTab: 'containment',
    rightTab: 'spec',
    bottomTab: 'checks',
    collapsed: {},           // elementId → true when its tree node is closed
  },
  issues: [],
  _undo: [],
  _redo: [],
  _subs: new Set(),
  _rev: 0,
};

export function subscribe(fn) { store._subs.add(fn); return () => store._subs.delete(fn); }
export const modelRevision = () => store._rev;

let emitQueued = false;
let emitLight = true;
/** Notify subscribers. `meta.light` marks a drag in progress: only the canvas redraws. */
export function emit(meta = {}) {
  emitLight = emitLight && !!meta.light;
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    const m = { light: emitLight };
    emitLight = true;
    for (const fn of store._subs) fn(store, m);
  });
}

/** Change UI-only state. */
export function set(patch) {
  Object.assign(store.ui, patch);
  emit();
}

function changed() {
  store._rev++;
  store.issues = validate(store.model);
  store.ui.dirty = true;
  repairUi();
  autosave();
}

/**
 * Apply an undoable change to the model. `fn` mutates the model in place. An
 * edit that throws leaves the model as it was, so a half-applied mutation can
 * never go live; the error is shown as a hint and re-thrown to the caller.
 */
export function commit(label, fn) {
  const before = deepClone(store.model);
  let result;
  try {
    result = fn(store.model);
  } catch (err) {
    store.model = before;
    store.ui.hint = err.message;
    emit();
    throw err;
  }
  store._undo.push({ label, model: before });
  if (store._undo.length > MAX_HISTORY) store._undo.shift();
  store._redo.length = 0;
  changed();
  emit();
  return result;
}

/** Like commit, but swallows the error after showing it. Returns undefined on failure. */
export function tryCommit(label, fn) {
  try { return commit(label, fn); } catch { return undefined; }
}

// A drag changes the model many times but is one undo step: `beginDrag`
// snapshots, `dragStep` mutates without history, `endDrag` records or discards.
let dragBefore = null;
export function beginDrag() { dragBefore = deepClone(store.model); }
export function dragStep(fn) { fn(store.model); store._rev++; emit({ light: true }); }
export function endDrag(label, moved) {
  if (dragBefore && moved) {
    store._undo.push({ label, model: dragBefore });
    store._redo.length = 0;
    changed();
  }
  dragBefore = null;
  emit();
}

export const canUndo = () => store._undo.length > 0;
export const canRedo = () => store._redo.length > 0;
export function undo() { step(store._undo, store._redo); }
export function redo() { step(store._redo, store._undo); }
function step(from, to) {
  const entry = from.pop();
  if (!entry) return;
  to.push({ label: entry.label, model: store.model });
  store.model = entry.model;
  store.ui.hint = '';
  changed();
  emit();
}

/** Close tabs and drop selection that point at things the model no longer holds. */
function repairUi() {
  const { ui, model } = store;
  ui.openTabs = ui.openTabs.filter((id) => model.diagrams[id]);
  if (!model.diagrams[ui.currentDiagramId]) ui.currentDiagramId = ui.openTabs[ui.openTabs.length - 1] || null;
  const sel = ui.selection;
  if (sel) {
    const d = model.diagrams[ui.currentDiagramId];
    if (sel.elementId && !model.elements[sel.elementId]) ui.selection = null;
    else if (sel.symbolIds && !(d?.symbols && sel.symbolIds.every((id) => d.symbols.some((s) => s.id === id)))) ui.selection = sel.elementId ? { elementId: sel.elementId } : null;
    else if (sel.pathId && !d?.paths?.some((p) => p.id === sel.pathId)) ui.selection = null;
  }
}

export function loadModel(model, fileName = null) {
  store.model = model;
  store._undo.length = 0;
  store._redo.length = 0;
  store._rev++;
  store.issues = validate(model);
  const first = Object.values(model.diagrams)[0];
  Object.assign(store.ui, {
    openTabs: first ? [first.id] : [], currentDiagramId: first?.id || null, selection: null, tool: 'select',
    pending: null, views: {}, fileName, dirty: false, hint: '', collapsed: {},
  });
  autosave();
  emit();
}

export function markSaved(fileName) {
  store.ui.dirty = false;
  if (fileName) store.ui.fileName = fileName;
  emit();
}

export function openDiagram(id) {
  if (!store.model.diagrams[id]) return;
  const { ui } = store;
  if (!ui.openTabs.includes(id)) ui.openTabs.push(id);
  ui.currentDiagramId = id;
  ui.tool = 'select';
  ui.pending = null;
  if (ui.selection?.symbolIds || ui.selection?.pathId) ui.selection = ui.selection.elementId ? { elementId: ui.selection.elementId } : null;
  emit();
}

export function closeTab(id) {
  const { ui } = store;
  const i = ui.openTabs.indexOf(id);
  if (i < 0) return;
  ui.openTabs.splice(i, 1);
  if (ui.currentDiagramId === id) ui.currentDiagramId = ui.openTabs[Math.min(i, ui.openTabs.length - 1)] || null;
  emit();
}

/** Select an element everywhere: tree, specification, and its symbol if the open diagram has one. */
export function selectElement(elementId, { reveal = false } = {}) {
  const { model, ui } = store;
  if (!model.elements[elementId]) return;
  const d = model.diagrams[ui.currentDiagramId];
  const sym = d?.symbols?.find((s) => s.elementId === elementId);
  ui.selection = { elementId, ...(sym ? { symbolIds: [sym.id] } : {}) };
  if (reveal) for (let e = model.elements[model.elements[elementId].ownerId]; e; e = model.elements[e.ownerId]) delete ui.collapsed[e.id];
  emit();
}

// In the macOS app each window is a document and the app saves it; one shared
// browser autosave would only make windows overwrite each other.
function autosave() {
  if (hosted) return;
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(store.model)); } catch { /* private mode, quota, or no localStorage */ }
}
export function readAutosave() {
  if (hosted) return null;
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch { return null; }
}
