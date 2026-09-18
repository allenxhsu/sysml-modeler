// Bottom panel: Checks, and the relations / usages of the selected element.

import { el, clear } from '../util.js';
import { store, openDiagram, selectElement, emit } from '../state/store.js';
import { REL_KINDS, DIAGRAM_KINDS, ELEMENT_KINDS } from '../model/types.js';
import { relationsOf, usages, symbolOf } from '../model/model.js';
import { issueCounts } from '../model/validate.js';

const TINT = { error: 'var(--sc-danger)', warning: 'var(--sc-warning)', info: 'var(--sc-info)' };

export function renderBottom(root) {
  clear(root);
  const tab = store.ui.bottomTab;
  if (tab === 'checks') checks(root);
  else if (tab === 'relations') relations(root);
  else usagesTab(root);
}

export function checkBadge() {
  const c = issueCounts(store.issues);
  return { text: String(c.error + c.warning), alert: c.error > 0, title: `${c.error} errors, ${c.warning} warnings, ${c.info} notes` };
}

/** Select the offending element and bring up a diagram that shows it. */
function goTo(issue) {
  const { model, ui } = store;
  if (issue.diagramId) { openDiagram(issue.diagramId); return; }
  const id = issue.elementId;
  if (!id || !model.elements[id]) return;
  const e = model.elements[id];
  const shownAs = ELEMENT_KINDS[e.kind].feature ? e.ownerId : id;
  const current = model.diagrams[ui.currentDiagramId];
  if (!(current?.symbols && (symbolOf(current, id) || symbolOf(current, shownAs)))) {
    const d = usages(model, id)[0];
    if (d) openDiagram(d.id);
  }
  ui.leftTab = 'containment';
  selectElement(id, { reveal: true });
}

function checks(root) {
  if (!store.issues.length) { root.append(el('p', { class: 'empty', text: 'No findings. The model passes every check.' })); return; }
  root.append(el('table', { class: 'sc-table compact' }, el('tbody', {}, ...store.issues.map((i) => el('tr', { class: 'clickable', onclick: () => goTo(i) },
    el('td', {}, el('span', { class: 'sc-pill', style: { '--tint': TINT[i.level] }, text: i.level })),
    el('td', { class: 'sc-mono', text: i.code }),
    el('td', { text: i.message }))))));
}

function selected() { return store.model.elements[store.ui.selection?.elementId] || null; }

function relations(root) {
  const e = selected();
  if (!e) { root.append(el('p', { class: 'empty', text: 'Select an element to list its relationships.' })); return; }
  const rels = relationsOf(store.model, e.id);
  if (!rels.length) { root.append(el('p', { class: 'empty', text: `“${e.name}” has no relationships.` })); return; }
  root.append(el('table', { class: 'sc-table compact' }, el('tbody', {}, ...rels.map((r) => el('tr', { class: 'clickable', onclick: () => r.other && selectElement(r.other.id, { reveal: true }) },
    el('td', { class: 'sc-mono', text: REL_KINDS[r.edge.kind].label }),
    el('td', { text: r.outgoing ? `${e.name}  →  ${r.other?.name}` : `${r.other?.name}  →  ${e.name}` }),
    el('td', { class: 'sc-muted', text: r.edge.label || '' }))))));
}

function usagesTab(root) {
  const e = selected();
  if (!e) { root.append(el('p', { class: 'empty', text: 'Select an element to list the diagrams that show it.' })); return; }
  const list = usages(store.model, e.id);
  if (!list.length) { root.append(el('p', { class: 'empty', text: `No diagram shows “${e.name}”.` })); return; }
  root.append(el('table', { class: 'sc-table compact' }, el('tbody', {}, ...list.map((d) => el('tr', { class: 'clickable', onclick: () => { openDiagram(d.id); selectElement(e.id); emit(); } },
    el('td', { class: 'sc-mono', text: DIAGRAM_KINDS[d.kind].abbr }), el('td', { text: d.name }), el('td', { class: 'sc-muted', text: store.model.elements[d.ownerId]?.name || '' }))))));
}
