// Wires the store to the panels and owns the global keyboard shortcuts.

import { el, clear } from './util.js';
import { store, subscribe, set, undo, redo, loadModel, markSaved, readAutosave, modelRevision } from './state/store.js';
import { currentDiagram, removeSelectionFromDiagram, deleteSelectionFromModel } from './state/actions.js';
import { sampleModel } from './model/sample.js';
import { parse, serialize } from './io/json.js';
import { createModel } from './model/model.js';
import { hosted, post, initHost } from './host.js';
import { initCanvas, initInlineEditor, drawCanvas, selectAll, nudge } from './ui/canvas.js';
import { SCREEN_CSS } from './ui/render.js';
import { renderTree } from './ui/tree.js';
import { renderSpec } from './ui/spec.js';
import { renderBottom, checkBadge } from './ui/bottom.js';
import { renderView } from './ui/tables.js';
import { initHeader, renderHeader, renderDocTabs, renderPalette, renderStatus, saveModel, openFile, loadText, COMMANDS } from './ui/toolbar.js';
import { modalOpen } from './ui/dialog.js';

const $ = (id) => document.getElementById(id);

function tabs(root, key, items) {
  clear(root);
  for (const [id, label, badge] of items) {
    root.append(el('button', { class: `sc-tab${store.ui[key] === id ? ' is-active' : ''}`, onclick: () => set({ [key]: id }) }, label,
      badge ? el('span', { class: `sc-badge${badge.alert ? ' sc-badge--alert' : ''}`, title: badge.title, text: badge.text }) : null));
  }
}

let viewKey = '';
function render(_, meta = {}) {
  drawCanvas();
  renderStatus($('statusbar'));
  if (meta.light) return;

  const d = currentDiagram();
  renderHeader();
  tabs($('left-tabs'), 'leftTab', [['containment', 'Containment'], ['diagrams', 'Diagrams']]);
  tabs($('right-tabs'), 'rightTab', [['spec', 'Specification'], ['symbol', 'Symbol']]);
  tabs($('bottom-tabs'), 'bottomTab', [['checks', 'Checks', checkBadge()], ['relations', 'Relations'], ['usages', 'Usages']]);
  renderTree($('tree'));
  renderSpec($('spec'));
  renderBottom($('bottom-body'));
  renderDocTabs($('doc-tabs'));
  renderPalette($('palette'));

  const view = $('view-wrap');
  const isView = !!d && !d.symbols;
  view.hidden = !isView;
  $('empty-state').hidden = !!d;
  // A table re-renders only when the model or the view changes, never for a selection, so typing in a cell is safe.
  const key = isView ? `${d.id}|${modelRevision()}` : '';
  if (isView && key !== viewKey) renderView(view, d);
  viewKey = key;
}

function onKey(e) {
  if (modalOpen()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); saveModel(); return; }
  if (mod && k === 'o') { e.preventDefault(); openFile(); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod && k === 'f') { e.preventDefault(); $('find').focus(); return; }
  if (e.key === 'Escape') { set({ tool: 'select', pending: null, hint: '' }); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (e.shiftKey || mod) deleteSelectionFromModel(); else if (store.ui.selection?.symbolIds || store.ui.selection?.pathId) removeSelectionFromDiagram();
    return;
  }
  const step = e.shiftKey ? 50 : 10;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && store.ui.selection?.symbolIds) { e.preventDefault(); nudge(...arrows[e.key]); }
}

// The macOS app keeps the document: tell it about every model change, and let
// its menu bar run the same commands the web menu bar does.
let postedRev = -1;
function reportToHost(_, meta = {}) {
  if (meta.light || postedRev === modelRevision()) return; // a drag reports once, when it ends
  postedRev = modelRevision();
  post({ type: 'changed', json: serialize(store.model), dirty: store.ui.dirty, name: store.model.name });
}

const TEXT_COMMANDS = { 'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.selectAll': 'selectAll' };
function hostCommand(id) {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  // ⌘Z in a text field means the text, not the model.
  if (typing && TEXT_COMMANDS[id]) { document.execCommand(TEXT_COMMANDS[id]); return; }
  if (modalOpen() && !id.startsWith('help.')) return;
  COMMANDS[id]?.();
}

function start() {
  document.head.append(el('style', { text: SCREEN_CSS }));
  initHeader($('header'));
  initCanvas();
  initInlineEditor();
  subscribe(render);
  document.addEventListener('keydown', onKey);

  if (hosted) {
    subscribe(reportToHost);
    loadModel(createModel('Untitled model'));
    initHost({ name: 'sysml', load: loadText, command: hostCommand, saved: (name) => markSaved(name) });
    return;
  }
  window.addEventListener('beforeunload', (e) => { if (store.ui.dirty) { e.preventDefault(); e.returnValue = ''; } });
  let model = null;
  const saved = readAutosave();
  if (saved) { try { model = parse(JSON.stringify(saved)).model; } catch { model = null; } }
  loadModel(model || sampleModel());
}

start();
