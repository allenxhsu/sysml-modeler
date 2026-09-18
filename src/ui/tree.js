// Left panel: the containment tree (the model itself) and a flat diagram list.

import { el, clear } from '../util.js';
import { store, set, emit, openDiagram, selectElement } from '../state/store.js';
import { createElement, createDiagram, deleteElement, deleteDiagram, renameDiagram, updateElement, reparent } from '../state/actions.js';
import { ELEMENT_KINDS, DIAGRAM_KINDS, PROP_KINDS, canOwn, canOwnDiagram } from '../model/types.js';
import { children, diagramsOf, featureLabel, isFeature } from '../model/model.js';
import { showMenu, promptText, confirmDialog } from './dialog.js';
import { DRAG_MIME } from './canvas.js';

const KIND_ORDER = ['package', 'block', 'valueType', 'requirement', 'testCase', 'actor', 'useCase', 'comment', 'property', 'port', 'operation'];

export function renderTree(root) {
  clear(root);
  const { model, ui } = store;
  if (ui.leftTab === 'diagrams') { renderDiagramList(root); return; }
  const walk = (e, depth) => {
    const kids = children(model, e.id).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const diagrams = diagramsOf(model, e.id);
    const open = !ui.collapsed[e.id];
    root.append(elementRow(e, depth, kids.length + diagrams.length > 0, open));
    if (!open) return;
    for (const d of diagrams) root.append(diagramRow(d, depth + 1));
    for (const k of kids) walk(k, depth + 1);
  };
  walk(model.elements[model.rootId], 0);
}

export const icon = (cls) => el('span', { class: `ic ic-${cls}` });

function label(e) {
  if (isFeature(e)) return featureLabel(store.model, e);
  if (e.kind === 'requirement') return `${e.reqId || '?'} ${e.name}`;
  if (e.kind === 'comment') return (e.body || 'Note').slice(0, 40);
  return e.name || `(unnamed ${ELEMENT_KINDS[e.kind].label.toLowerCase()})`;
}

function elementRow(e, depth, hasKids, open) {
  const { ui, model } = store;
  const iconCls = e.kind === 'property' ? `pr-${e.propKind}` : ELEMENT_KINDS[e.kind].icon;
  const row = el('div', {
    class: `sc-list-item tree-row${ui.selection?.elementId === e.id ? ' is-active' : ''}`,
    style: { '--d': depth }, draggable: e.id !== model.rootId, title: ELEMENT_KINDS[e.kind].label,
    onclick: () => selectElement(e.id),
    ondblclick: () => rename(e),
    oncontextmenu: (ev) => { ev.preventDefault(); selectElement(e.id); elementMenu(ev, e); },
    ondragstart: (ev) => { ev.dataTransfer.setData(DRAG_MIME, e.id); ev.dataTransfer.effectAllowed = 'copyMove'; },
    ondragover: (ev) => { if (ev.dataTransfer.types.includes(DRAG_MIME)) { ev.preventDefault(); row.classList.add('is-drop'); } },
    ondragleave: () => row.classList.remove('is-drop'),
    ondrop: (ev) => {
      ev.preventDefault();
      row.classList.remove('is-drop');
      const id = ev.dataTransfer.getData(DRAG_MIME);
      if (id && id !== e.id) reparent(id, e.id);
    },
  },
  el('span', { class: 'tw', text: hasKids ? (open ? '▾' : '▸') : '', onclick: (ev) => { ev.stopPropagation(); ui.collapsed[e.id] = open; emit(); } }),
  icon(iconCls), el('span', { class: 'tree-label', text: label(e) }));
  return row;
}

function diagramRow(d, depth) {
  const { ui } = store;
  return el('div', {
    class: `sc-list-item tree-row${ui.currentDiagramId === d.id ? ' is-open' : ''}`, style: { '--d': depth },
    title: DIAGRAM_KINDS[d.kind].label,
    onclick: () => openDiagram(d.id),
    oncontextmenu: (ev) => { ev.preventDefault(); diagramMenu(ev, d); },
  }, el('span', { class: 'tw' }), icon(DIAGRAM_KINDS[d.kind].view ? 'tb' : 'dg'), el('span', { class: 'tree-label', text: d.name }),
  el('span', { class: 'sc-faint sc-mono', text: DIAGRAM_KINDS[d.kind].abbr }));
}

function renderDiagramList(root) {
  const all = Object.values(store.model.diagrams);
  if (!all.length) { root.append(el('p', { class: 'empty', text: 'No diagrams yet. Use Diagrams ▸ New to add one.' })); return; }
  for (const [kind, meta] of Object.entries(DIAGRAM_KINDS)) {
    const list = all.filter((d) => d.kind === kind);
    if (!list.length) continue;
    root.append(el('div', { class: 'sc-section-title list-title', text: `${meta.label}s` }));
    for (const d of list) root.append(diagramRow(d, 0));
  }
}

async function rename(e) {
  if (e.kind === 'comment') return;
  const name = await promptText(`Rename ${ELEMENT_KINDS[e.kind].label.toLowerCase()}`, 'The new name shows on every diagram that uses this element.', e.name);
  if (name && name.trim()) updateElement(e.id, { name: name.trim() }, 'Rename');
}

function elementMenu(ev, e) {
  const items = [];
  for (const kind of Object.keys(ELEMENT_KINDS)) {
    if (!canOwn(e.kind, kind)) continue;
    if (kind === 'property') for (const [pk, plabel] of Object.entries(PROP_KINDS)) items.push({ label: `New ${plabel.toLowerCase()} property`, run: () => createElement('property', e.id, { propKind: pk }) });
    else items.push({ label: `New ${ELEMENT_KINDS[kind].label.toLowerCase()}`, run: () => createElement(kind, e.id) });
  }
  if (canOwnDiagram(e.kind)) {
    items.push('-');
    for (const [kind, meta] of Object.entries(DIAGRAM_KINDS)) {
      if ((kind === 'ibd') !== (e.kind === 'block')) continue;
      items.push({ label: `New ${meta.label.toLowerCase()}`, run: () => createDiagram(kind, e.id) });
    }
  }
  if (e.id !== store.model.rootId) {
    items.push('-', { label: 'Rename…', run: () => rename(e) }, {
      label: 'Delete from model', danger: true, run: async () => {
        const owned = children(store.model, e.id).length;
        if (!owned || await confirmDialog(`Delete “${e.name}”?`, `It owns ${owned} element${owned === 1 ? '' : 's'}, which go with it, along with every symbol on every diagram.`)) deleteElement(e.id);
      },
    });
  } else items.push('-', { label: 'Rename model…', run: () => rename(e) });
  showMenu(ev.clientX, ev.clientY, items);
}

function diagramMenu(ev, d) {
  showMenu(ev.clientX, ev.clientY, [
    { label: 'Open', run: () => openDiagram(d.id) },
    { label: 'Rename…', run: async () => { const n = await promptText('Rename diagram', '', d.name); if (n) renameDiagram(d.id, n); } },
    '-',
    { label: 'Delete diagram', danger: true, run: async () => { if (await confirmDialog(`Delete diagram “${d.name}”?`, 'The elements it shows stay in the model.')) deleteDiagram(d.id); } },
  ]);
}

export function setLeftTab(tab) { set({ leftTab: tab }); }
