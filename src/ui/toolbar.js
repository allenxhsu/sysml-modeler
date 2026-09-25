// Header (menus, find, undo/redo), document tabs, the tool palette and the status line.

import { el, clear, downloadText, slugify } from '../util.js';
import { store, set, undo, redo, canUndo, canRedo, loadModel, markSaved, openDiagram, closeTab, selectElement } from '../state/store.js';
import { createDiagram, currentDiagram, removeSelectionFromDiagram, deleteSelectionFromModel, hint } from '../state/actions.js';
import { DIAGRAM_KINDS, ELEMENT_KINDS, REL_KINDS, NODE_TOOL_LABELS, MATRIX_PRESETS } from '../model/types.js';
import { createModel, qualifiedName } from '../model/model.js';
import { sampleModel } from '../model/sample.js';
import { serialize, parse, FILE_EXT } from '../io/json.js';
import { exportXmi, importXmi } from '../io/xmi.js';
import { exportSvg, exportPng, printDiagrams } from '../io/exportImage.js';
import { showMenu, confirmDialog, showText, formDialog } from './dialog.js';
import { zoomFit, zoomBy, selectAll } from './canvas.js';
import { RULES } from '../model/validate.js';
import { hosted, post } from '../host.js';
import { settingsDialog } from './settings.js';
import { syncAfterSave, syncConfigured, exportEverything, importEverything } from '../state/sync.js';

// ---------------------------------------------------------------- file commands

async function guardDirty() {
  return !store.ui.dirty || confirmDialog('Discard unsaved changes?', 'The open model has changes that were not saved to a file.', 'Discard');
}

// Hosted, documents belong to the macOS app: new, open and save are its to do.
export async function newModel() {
  if (hosted) { post({ type: 'new' }); return; }
  if (await guardDirty()) loadModel(createModel('Untitled model'));
}
export async function openSample() { if (await guardDirty()) loadModel(sampleModel()); }

export function saveModel() {
  if (hosted) { post({ type: 'save' }); return; }
  const name = store.ui.fileName || `${slugify(store.model.name)}${FILE_EXT}`;
  downloadText(serialize(store.model), name, 'application/json');
  markSaved(name);
  syncAfterSave();
}

/** Put a file's text into this window: a native model, or XMI from another tool. */
export function loadText(text, fileName) {
  try {
    if (/\.(xmi|xml|uml)$/i.test(fileName || '') || text.trimStart().startsWith('<')) {
      const { model, report } = importXmi(text);
      loadModel(model, null);
      const skipped = Object.entries(report.skipped).map(([k, n]) => `  ${n} × ${k}`).join('\n');
      showText('XMI imported', `Source: ${report.source}\n${report.elements} elements, ${report.relationships} relationships, ${report.diagrams} diagrams.\n\n${skipped ? `Left out, because this app has no counterpart for them:\n${skipped}` : 'Nothing was left out.'}`);
    } else {
      const { model, repairs } = parse(text);
      loadModel(model, fileName);
      if (repairs.length) showText('The file was repaired while loading', repairs.join('\n'));
    }
    return true;
  } catch (err) {
    showText('The file could not be opened', err.message);
    return false;
  }
}

export async function openFile() {
  if (hosted) { post({ type: 'open' }); return; }
  if (!(await guardDirty())) return;
  const input = document.getElementById('file-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (file) loadText(await file.text(), file.name);
  };
  input.click();
}

/** Every record and tombstone on this device, as one file; and the way back in. */
async function exportAll() {
  const r = await exportEverything();
  if (r) hint(`Exported ${r.count} record${r.count === 1 ? '' : 's'} to ${r.name}.`);
}
function importAll() {
  const input = document.getElementById('file-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const t = await importEverything(await file.text());
      showText('Import finished', `${t.added} added, ${t.updated} updated, ${t.unchanged} already current${t.invalid ? `, ${t.invalid} skipped as not records` : ''}.\nThis device now holds ${t.total} records, tombstones included.`);
    } catch (err) {
      showText('The file could not be imported', err.message);
    }
  };
  input.click();
}

function exportXmiFile(includeDiagrams) {
  downloadText(exportXmi(store.model, { includeDiagrams }), `${slugify(store.model.name)}.xmi`, 'application/xml');
}

function canvasDiagrams() { return Object.values(store.model.diagrams).filter((d) => d.symbols); }
function withDiagram(fn) {
  const d = currentDiagram();
  if (!d?.symbols) { hint('Open a diagram first: tables and matrices export as CSV from their own toolbar.'); return; }
  Promise.resolve(fn(d)).catch((err) => showText('Export failed', err.message));
}

async function newMatrix() {
  const v = await formDialog('New dependency matrix', [{ key: 'relKind', label: 'Relationship', value: 'satisfy', options: Object.keys(MATRIX_PRESETS).map((k) => ({ value: k, label: REL_KINDS[k].label })) }]);
  if (!v) return;
  const p = MATRIX_PRESETS[v.relKind];
  createDiagram('matrix', store.ui.selection?.elementId, { name: `${REL_KINDS[v.relKind].label} matrix`, relKind: v.relKind, rowKind: p.rows, colKind: p.cols });
}

function appearance() { settingsDialog(); }

function help() {
  showText('Working with the modeler', [
    'THE MODEL AND ITS DIAGRAMS',
    'An element exists once, in the containment tree. A diagram shows symbols of elements:',
    'Delete takes a symbol off the diagram; Shift+Delete deletes the element from the model.',
    'Drag an element from the tree onto a diagram to show it there; its relationships to',
    'anything already drawn come along.',
    '',
    'DRAWING',
    'Pick a node tool, then click the canvas. Pick a path tool, then click source and target.',
    'Composition and Reference create the part / reference property they stand for.',
    'Double-click a symbol to rename it. Drag corners to resize. Drag a port along its border.',
    '',
    'MOVING AROUND',
    'Drag the background or scroll to pan, ⌘/Ctrl + scroll to zoom, Shift + drag to marquee-select.',
    '',
    'KEYS',
    '⌘Z / ⇧⌘Z undo, redo · ⌘S save · ⌘A select all · arrows nudge · Esc cancels a tool',
    '',
    'CHECKS',
    ...Object.entries(RULES).map(([code, [level, text]]) => `${code.padEnd(24)}${level.padEnd(9)}${text}`),
  ].join('\n'));
}

const newDiagram = (kind) => () => createDiagram(kind, store.ui.selection?.elementId);
const exportAllPdf = () => { try { printDiagrams(store.model, canvasDiagrams()); } catch (err) { showText('Export failed', err.message); } };

/** Every menu command by id. The web menu bar and the macOS menu bar both run these. */
export const COMMANDS = {
  'file.new': newModel, 'file.open': openFile, 'file.sample': openSample, 'file.save': saveModel,
  'file.exportXmi': () => exportXmiFile(true), 'file.exportXmiModel': () => exportXmiFile(false),
  'file.exportAll': exportAll, 'file.importAll': importAll,
  'edit.undo': undo, 'edit.redo': redo, 'edit.selectAll': selectAll,
  'edit.remove': removeSelectionFromDiagram, 'edit.delete': deleteSelectionFromModel,
  'view.zoomIn': () => zoomBy(1.25), 'view.zoomOut': () => zoomBy(0.8), 'view.zoomFit': zoomFit, 'view.appearance': appearance,
  'diagram.bdd': newDiagram('bdd'), 'diagram.ibd': newDiagram('ibd'), 'diagram.req': newDiagram('req'), 'diagram.uc': newDiagram('uc'), 'diagram.pkg': newDiagram('pkg'),
  'diagram.reqtable': newDiagram('reqtable'), 'diagram.matrix': newMatrix,
  'export.svg': () => withDiagram((d) => exportSvg(store.model, d)),
  'export.png': () => withDiagram((d) => exportPng(store.model, d)),
  'export.pdf': () => withDiagram((d) => printDiagrams(store.model, [d])),
  'export.pdfAll': exportAllPdf,
  'help.guide': help,
};
const run = (id) => COMMANDS[id];

const MENUS = {
  File: () => [
    { label: 'New model', run: run('file.new') }, { label: 'Open…', key: '⌘O', run: run('file.open') }, { label: 'Open the sample model', run: run('file.sample') }, '-',
    { label: 'Save', key: '⌘S', run: run('file.save') }, '-',
    { label: 'Import XMI…', run: run('file.open') },
    { label: 'Export XMI (model and diagrams)', run: run('file.exportXmi') },
    { label: 'Export XMI (model only, for other tools)', run: run('file.exportXmiModel') }, '-',
    { label: 'Export everything (all records)…', run: run('file.exportAll') },
    { label: 'Import everything…', run: run('file.importAll') },
  ],
  Edit: () => [
    { label: `Undo${canUndo() ? ` ${store._undo[store._undo.length - 1].label.toLowerCase()}` : ''}`, key: '⌘Z', disabled: !canUndo(), run: undo },
    { label: `Redo${canRedo() ? ` ${store._redo[store._redo.length - 1].label.toLowerCase()}` : ''}`, key: '⇧⌘Z', disabled: !canRedo(), run: redo }, '-',
    { label: 'Select all', key: '⌘A', run: run('edit.selectAll') },
    { label: 'Remove from diagram', key: 'Del', run: run('edit.remove') },
    { label: 'Delete from model', key: '⇧Del', danger: true, run: run('edit.delete') },
  ],
  View: () => [
    { label: 'Zoom in', run: run('view.zoomIn') }, { label: 'Zoom out', run: run('view.zoomOut') }, { label: 'Zoom to fit', run: run('view.zoomFit') }, '-',
    { label: 'Settings…', run: run('view.appearance') },
  ],
  Diagrams: () => [
    ...Object.entries(DIAGRAM_KINDS).filter(([, m]) => !m.view).map(([kind, m]) => ({ label: `New ${m.label.toLowerCase()}`, run: run(`diagram.${kind}`) })), '-',
    { label: 'New requirement table', run: run('diagram.reqtable') },
    { label: 'New dependency matrix…', run: run('diagram.matrix') },
  ],
  Export: () => [
    { label: 'This diagram as SVG', run: run('export.svg') },
    { label: 'This diagram as PNG', run: run('export.png') },
    { label: 'This diagram as PDF…', run: run('export.pdf') },
    { label: 'All diagrams as PDF…', run: run('export.pdfAll') },
  ],
  Help: () => [{ label: 'Working with the modeler', run: run('help.guide') }],
};

// ---------------------------------------------------------------- header

export function initHeader(root) {
  const menubar = el('nav', { class: 'menubar' }, ...Object.keys(MENUS).map((name) => el('button', {
    class: 'sc-button sc-button--ghost sc-button--sm', text: name,
    onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, MENUS[name]()); },
  })));
  const find = el('input', { class: 'sc-input find', placeholder: 'Find element', id: 'find', oninput: (e) => findResults(e.target), onkeydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); } e.stopPropagation(); } });
  root.append(
    el('span', { class: 'sc-brand-mark', text: 'SY' }), el('h1', { class: 'sc-header-title', text: 'SysML Modeler' }), menubar, el('span', { class: 'sc-spacer' }),
    el('span', { class: 'sc-mono sc-muted', id: 'file-name' }),
    el('span', { class: 'sc-resource', title: 'Model elements' }, el('span', { class: 'sc-resource-icon' }), el('span', { id: 'count-elements' })),
    el('span', { class: 'sc-resource sc-resource--alt', title: 'Diagrams' }, el('span', { class: 'sc-resource-icon' }), el('span', { id: 'count-diagrams' })),
    el('button', { class: 'sc-button sc-button--ghost sc-button--icon sc-button--sm', id: 'btn-undo', title: 'Undo', text: '↶', onclick: undo }),
    el('button', { class: 'sc-button sc-button--ghost sc-button--icon sc-button--sm', id: 'btn-redo', title: 'Redo', text: '↷', onclick: redo }),
    find);
}

function findResults(input) {
  const q = input.value.trim().toLowerCase();
  if (!q) return;
  const hits = Object.values(store.model.elements).filter((e) => `${e.name} ${e.reqId || ''} ${e.text || ''}`.toLowerCase().includes(q)).slice(0, 14);
  const r = input.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, hits.length
    ? hits.map((e) => ({ label: `${e.kind === 'requirement' ? `${e.reqId} ` : ''}${e.name}  ·  ${ELEMENT_KINDS[e.kind].label.toLowerCase()} in ${qualifiedName(store.model, e.ownerId) || '—'}`, run: () => { set({ leftTab: 'containment' }); selectElement(e.id, { reveal: true }); } }))
    : [{ note: 'Nothing in the model matches.' }]);
  input.focus();
}

export function renderHeader() {
  const { model, ui } = store;
  document.getElementById('file-name').textContent = `${ui.fileName || `${slugify(model.name)}${FILE_EXT}`}${ui.dirty ? ' •' : ''}`;
  document.getElementById('count-elements').textContent = Object.keys(model.elements).length;
  document.getElementById('count-diagrams').textContent = Object.keys(model.diagrams).length;
  document.getElementById('btn-undo').disabled = !canUndo();
  document.getElementById('btn-redo').disabled = !canRedo();
  document.title = `${model.name} — SysML Modeler`;
}

// ---------------------------------------------------------------- document tabs

export function renderDocTabs(root) {
  clear(root);
  const { model, ui } = store;
  for (const id of ui.openTabs) {
    const d = model.diagrams[id];
    if (!d) continue;
    root.append(el('button', { class: `sc-tab doc-tab${id === ui.currentDiagramId ? ' is-active' : ''}`, onclick: () => openDiagram(id), onauxclick: () => closeTab(id) },
      el('span', { text: `${d.name} · ${DIAGRAM_KINDS[d.kind].abbr}` }),
      el('span', { class: 'tab-close', title: 'Close', text: '×', onclick: (e) => { e.stopPropagation(); closeTab(id); } })));
  }
}

// ---------------------------------------------------------------- palette

export function renderPalette(root) {
  clear(root);
  const d = currentDiagram();
  root.hidden = !d?.symbols;
  if (root.hidden) return;
  const meta = DIAGRAM_KINDS[d.kind];
  const tool = (id, text, title) => el('button', {
    class: `sc-button sc-button--sm${store.ui.tool === id ? ' is-on' : ''}`, text, title,
    onclick: () => set({ tool: store.ui.tool === id ? 'select' : id, pending: null, hint: id.startsWith('path:') ? `${text}: click the element it starts from.` : id.startsWith('node:') ? `${text}: click where it should go.` : '' }),
  });
  root.append(el('div', { class: 'sc-label', text: 'Tools' }), tool('select', '↖ Select', 'Select and move (Esc)'),
    el('div', { class: 'sc-label', text: 'Nodes' }), ...meta.nodes.map((k) => tool(`node:${k}`, NODE_TOOL_LABELS[k] || ELEMENT_KINDS[k].label)),
    el('div', { class: 'sc-label', text: 'Paths' }), ...meta.paths.map((k) => tool(`path:${k}`, REL_KINDS[k].label)));
}

export function renderStatus(root) {
  clear(root);
  const { ui } = store;
  const d = currentDiagram();
  const [type, kind] = ui.tool.split(':');
  const toolName = type === 'select' ? 'select' : (NODE_TOOL_LABELS[kind] || ELEMENT_KINDS[kind]?.label || REL_KINDS[kind]?.label || kind);
  root.append(el('span', { class: 'status-tool', text: toolName }), el('span', { class: 'status-hint', text: ui.hint || '' }), el('span', { class: 'sc-spacer' }));
  if (d?.symbols) root.append(el('span', { text: `${d.symbols.length} symbols · ${d.paths.length} paths` }), el('span', { text: `zoom ${Math.round((ui.views[d.id]?.scale || 1) * 100)}%` }));
  root.append(el('span', { class: ui.dirty ? 'warn' : 'ok', text: ui.dirty ? '● unsaved' : '● saved' }));
  if (syncConfigured()) root.append(el('sc-sync-status', { 'no-button': '' }));
}
