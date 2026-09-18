// Generated views: the requirement table and the dependency matrix. Both are
// live — they are computed from the model on every render and edit it in place.

import { el, clear, toCsv, downloadText, slugify } from '../util.js';
import { store, selectElement, tryCommit } from '../state/store.js';
import { updateElement, createElement } from '../state/actions.js';
import { REL_KINDS, ELEMENT_KINDS, endsAllowed } from '../model/types.js';
import { elementsOfKind, findRelationship, addRelationship, removeRelationship, qualifiedName, ownerChain } from '../model/model.js';

export function renderView(root, diagram) {
  // Editing a cell re-renders the table; put the caret back in the cell the user moved to.
  const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
  const scroll = root.querySelector('.view-scroll');
  const pos = scroll ? [scroll.scrollLeft, scroll.scrollTop] : null;
  clear(root);
  if (diagram.kind === 'reqtable') reqTable(root, diagram);
  else matrix(root, diagram);
  if (pos) root.querySelector('.view-scroll')?.scrollTo(pos[0], pos[1]);
  if (focusKey) root.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

// ---------------------------------------------------------------- requirement table

const byReqId = (a, b) => (a.reqId || '').localeCompare(b.reqId || '', undefined, { numeric: true });

export function reqTableRows(model) {
  const rels = Object.values(model.relationships);
  const names = (kind, id, end) => rels.filter((r) => r.kind === kind && r[end] === id).map((r) => model.elements[end === 'targetId' ? r.sourceId : r.targetId]?.name).filter(Boolean).join(', ');
  return elementsOfKind(model, 'requirement').sort(byReqId).map((r) => ({
    element: r, id: r.reqId, name: r.name, text: r.text, owner: model.elements[r.ownerId]?.name || '',
    satisfiedBy: names('satisfy', r.id, 'targetId'), verifiedBy: names('verify', r.id, 'targetId'), derivedFrom: names('deriveReqt', r.id, 'sourceId'),
  }));
}

function reqTable(root, diagram) {
  const { model } = store;
  const rows = reqTableRows(model);
  const cell = (r, key, fieldName) => el('td', {}, el('input', {
    class: 'cell-input', value: r[key] || '', dataset: { key: `${r.element.id}:${key}` }, onchange: (e) => updateElement(r.element.id, { [fieldName]: e.target.value.trim() }),
    onfocus: () => selectElement(r.element.id),
  }));
  root.append(viewHead(diagram.name, `${rows.length} requirement${rows.length === 1 ? '' : 's'}`, [
    ['+ Requirement', () => createElement('requirement', diagram.ownerId)],
    ['Export CSV', () => downloadText(toCsv([['Id', 'Name', 'Text', 'Owner', 'Satisfied by', 'Verified by', 'Derived from'], ...rows.map((r) => [r.id, r.name, r.text, r.owner, r.satisfiedBy, r.verifiedBy, r.derivedFrom])]), `${slugify(diagram.name)}.csv`, 'text/csv')],
  ]));
  if (!rows.length) { root.append(el('p', { class: 'empty', text: 'The model holds no requirements yet.' })); return; }
  root.append(el('div', { class: 'view-scroll' }, el('table', { class: 'sc-table grid-table' },
    el('thead', {}, el('tr', {}, ...['Id', 'Name', 'Text', 'Owner', 'Satisfied by', 'Verified by', 'Derived from'].map((h) => el('th', { text: h })))),
    el('tbody', {}, ...rows.map((r) => el('tr', { class: store.ui.selection?.elementId === r.element.id ? 'is-active' : '' },
      cell(r, 'id', 'reqId'), cell(r, 'name', 'name'), el('td', { class: 'wide' }, el('textarea', { class: 'cell-input', rows: 2, dataset: { key: `${r.element.id}:text` }, onchange: (e) => updateElement(r.element.id, { text: e.target.value }), onfocus: () => selectElement(r.element.id) }, r.text || '')),
      el('td', { class: 'sc-muted', text: r.owner }), gap(r.satisfiedBy), gap(r.verifiedBy), el('td', { text: r.derivedFrom })))))));
}

const gap = (text) => el('td', { class: text ? '' : 'is-gap', text: text || '— none —' });

// ---------------------------------------------------------------- matrix

export function matrixData(model, diagram) {
  const rows = elementsOfKind(model, diagram.rowKind);
  const cols = elementsOfKind(model, diagram.colKind);
  if (diagram.colKind === 'requirement') cols.sort(byReqId);
  if (diagram.rowKind === 'requirement') rows.sort(byReqId);
  const has = (r, c) => !!findRelationship(model, diagram.relKind, r.id, c.id);
  return { rows, cols, has };
}

const short = (e) => (e.kind === 'requirement' ? `${e.reqId} ${e.name}` : e.name);

function matrix(root, diagram) {
  const { model } = store;
  const k = REL_KINDS[diagram.relKind];
  const { rows, cols, has } = matrixData(model, diagram);
  const allowed = endsAllowed(diagram.relKind, diagram.rowKind, diagram.colKind);
  const toggle = (r, c) => tryCommit(`Toggle ${k.label.toLowerCase()}`, (m) => {
    const existing = findRelationship(m, diagram.relKind, r.id, c.id);
    if (existing) removeRelationship(m, existing.id);
    else addRelationship(m, diagram.relKind, r.id, c.id);
  });
  let count = 0;
  for (const r of rows) for (const c of cols) if (has(r, c)) count++;

  root.append(viewHead(diagram.name, `${k.label}: ${ELEMENT_KINDS[diagram.rowKind].label.toLowerCase()}s ↗ ${ELEMENT_KINDS[diagram.colKind].label.toLowerCase()}s · ${count} relationship${count === 1 ? '' : 's'}`, [
    ['Export CSV', () => downloadText(toCsv([['', ...cols.map(short)], ...rows.map((r) => [short(r), ...cols.map((c) => (has(r, c) ? 'x' : ''))])]), `${slugify(diagram.name)}.csv`, 'text/csv')],
  ]));
  if (!allowed) root.append(el('div', { class: 'sc-alert sc-alert--warning', text: `${k.label} is not defined from a ${ELEMENT_KINDS[diagram.rowKind].label.toLowerCase()} to a ${ELEMENT_KINDS[diagram.colKind].label.toLowerCase()}. Change the rows or columns in the specification panel.` }));
  if (!rows.length || !cols.length) { root.append(el('p', { class: 'empty', text: 'Nothing to cross yet: the model has no elements of the row or the column kind.' })); return; }

  const pkg = (e) => ownerChain(model, e.id).slice(1, -1).map((x) => x.name).join('::');
  root.append(el('div', { class: 'view-scroll' }, el('table', { class: 'sc-table matrix' },
    el('thead', {}, el('tr', {}, el('th', { class: 'corner', text: `${k.stereotype ? `«${k.stereotype}»` : k.label}  row → column` }),
      ...cols.map((c) => el('th', { class: `col-head${rows.some((r) => has(r, c)) ? '' : ' is-gap'}`, title: qualifiedName(model, c.id), onclick: () => selectElement(c.id, { reveal: true }) }, el('span', { text: short(c) }))))),
    el('tbody', {}, ...rows.map((r) => {
      const empty = !cols.some((c) => has(r, c));
      return el('tr', {}, el('th', { class: `row-head${empty ? ' is-gap' : ''}`, title: qualifiedName(model, r.id), onclick: () => selectElement(r.id, { reveal: true }) }, short(r), el('span', { class: 'sc-faint', text: pkg(r) ? `  ${pkg(r)}` : '' })),
        ...cols.map((c) => el('td', { class: `mcell${has(r, c) ? ' is-on' : ''}${r.id === c.id ? ' is-self' : ''}`, title: `${short(r)} → ${short(c)}`, onclick: () => allowed && r.id !== c.id && toggle(r, c) }, has(r, c) ? '↗' : '')));
    })))));
  root.append(el('p', { class: 'empty', text: 'Click a cell to add or remove the relationship. A highlighted row or column header has no mark at all: a gap in coverage.' }));
}

function viewHead(title, sub, actions) {
  return el('div', { class: 'view-head' },
    el('div', {}, el('div', { class: 'sc-display', text: title }), el('div', { class: 'sc-muted', text: sub })),
    el('span', { class: 'sc-spacer' }),
    ...actions.map(([text, run]) => el('button', { class: 'sc-button sc-button--sm', text, onclick: run })));
}
