// Right panel: the specification of whatever is selected — an element, a
// relationship, or (with nothing selected) the open diagram — plus the
// per-symbol display options.

import { el, clear } from '../util.js';
import { store, set, openDiagram, selectElement, tryCommit } from '../state/store.js';
import { updateElement, updateRelationship, updateDiagram, renameDiagram, createElement, deleteElement, reparent, currentDiagram, deleteSelectionFromModel } from '../state/actions.js';
import { ELEMENT_KINDS, REL_KINDS, DIAGRAM_KINDS, PROP_KINDS, PORT_DIRECTIONS, MATRIX_PRESETS, canOwn } from '../model/types.js';
import { features, featureLabel, qualifiedName, relationsOf, usages, elementsOfKind, resolveEdge, getSymbol, isAncestor } from '../model/model.js';
import { icon } from './tree.js';

const field = (label, control) => el('label', { class: 'sc-field' }, el('span', { class: 'sc-label', text: label }), control);

function textInput(key, value, onchange, attrs = {}) {
  return el('input', { class: 'sc-input', type: 'text', value: value || '', dataset: { key }, onchange: (e) => onchange(e.target.value), ...attrs });
}
function textArea(key, value, onchange, rows = 3) {
  return el('textarea', { class: 'sc-textarea', rows, dataset: { key }, onchange: (e) => onchange(e.target.value) }, value || '');
}
function select(key, options, value, onchange) {
  return el('select', { class: 'sc-select', dataset: { key }, onchange: (e) => onchange(e.target.value) },
    ...options.map((o) => el('option', { value: o.value, text: o.label, selected: o.value === (value ?? '') })));
}
function check(key, label, checked, onchange) {
  return el('label', { class: 'check-row' }, el('input', { type: 'checkbox', class: 'sc-check', checked, dataset: { key }, onchange: (e) => onchange(e.target.checked) }), el('span', { text: label }));
}
const section = (title) => el('div', { class: 'sc-section-title', text: title });
const link = (text, run, cls = '') => el('button', { class: `link ${cls}`, text, onclick: run });

export function renderSpec(root) {
  // Re-rendering replaces the inputs; put the caret back where the user left it.
  const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
  clear(root);
  const { model, ui } = store;
  const sel = ui.selection;
  const d = currentDiagram();

  if (ui.rightTab === 'symbol') symbolTab(root, d, sel);
  else if (sel?.refId && model.relationships[sel.refId]) relationshipSpec(root, model.relationships[sel.refId]);
  else if (sel?.elementId && model.elements[sel.elementId]) elementSpec(root, model.elements[sel.elementId]);
  else if (sel?.refId?.startsWith('own:')) root.append(el('p', { class: 'empty', text: 'Containment is ownership. Drag the element onto another owner in the containment tree to change it.' }));
  else if (d) diagramSpec(root, d);
  else root.append(el('p', { class: 'empty', text: 'Select an element to see its specification.' }));

  if (focusKey) root.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

function head(kindLabel, title, sub) {
  return el('div', { class: 'sc-panel sc-brackets spec-head' },
    el('span', { class: 'sc-label', text: kindLabel }), el('div', { class: 'sc-display', text: title || '—' }), el('span', { class: 'sc-mono sc-faint', text: sub || '' }));
}

// ---------------------------------------------------------------- element

function elementSpec(root, e) {
  const { model } = store;
  const kind = ELEMENT_KINDS[e.kind];
  const up = (patch) => updateElement(e.id, patch);
  const kindLabel = kind.stereotype ? `«${kind.stereotype}»` : e.kind === 'property' ? `${PROP_KINDS[e.propKind]} property` : kind.label;
  root.append(head(kindLabel, e.kind === 'comment' ? 'Note' : e.name, qualifiedName(model, e.id)));

  if (e.kind !== 'comment') root.append(field('Name', textInput('name', e.name, (v) => v.trim() && up({ name: v.trim() }))));

  if (e.id !== model.rootId) {
    const owners = Object.values(model.elements).filter((o) => canOwn(o.kind, e.kind) && !isAncestor(model, e.id, o.id))
      .map((o) => ({ value: o.id, label: qualifiedName(model, o.id) })).sort((a, b) => a.label.localeCompare(b.label));
    root.append(field('Owner', select('owner', owners, e.ownerId, (v) => reparent(e.id, v))));
  }

  switch (e.kind) {
    case 'block': root.append(check('abstract', 'Is abstract', !!e.isAbstract, (v) => up({ isAbstract: v }))); break;
    case 'valueType': root.append(field('Unit', textInput('unit', e.unit, (v) => up({ unit: v.trim() }), { placeholder: 'kilogram' }))); break;
    case 'requirement':
      root.append(field('Id', textInput('reqId', e.reqId, (v) => up({ reqId: v.trim() }))), field('Text', textArea('text', e.text, (v) => up({ text: v }), 5)));
      break;
    case 'comment': root.append(field('Body', textArea('body', e.body, (v) => up({ body: v }), 5))); break;
    case 'property': propertyFields(root, e, up); break;
    case 'port':
      typeFields(root, e, up, ['block', 'valueType']);
      root.append(field('Direction', select('direction', PORT_DIRECTIONS.map((x) => ({ value: x, label: x })), e.direction, (v) => up({ direction: v }))));
      break;
    case 'operation':
      root.append(field('Parameters', textInput('params', e.params, (v) => up({ params: v }), { placeholder: 'distance : km' })), field('Returns', textInput('returnType', e.returnType, (v) => up({ returnType: v.trim() }))));
      break;
    default:
  }
  root.append(field('Documentation', textArea('doc', e.doc, (v) => up({ doc: v }))));

  if (e.kind === 'block' || e.kind === 'valueType') featureLists(root, e);
  if (e.kind === 'requirement') {
    root.append(section('Nested requirements'));
    featureRows(root, features(model, e.id, 'requirement'));
    root.append(addButton('+ Nested requirement', () => createElement('requirement', e.id)));
  }

  if (!kind.feature) {
    const rels = relationsOf(model, e.id);
    root.append(section('Relations'));
    if (!rels.length) root.append(el('p', { class: 'empty', text: 'None.' }));
    for (const r of rels) {
      const k = REL_KINDS[r.edge.kind];
      root.append(el('div', { class: 'rel' },
        el('span', { class: 'sc-pill', style: { '--tint': k.stereotype ? 'var(--sc-accent-2)' : 'var(--sc-accent)' }, text: k.stereotype || k.label.toLowerCase() }),
        el('span', { class: 'sc-faint', text: r.outgoing ? '→' : '←' }),
        link(r.other?.name || '?', () => r.other && selectElement(r.other.id, { reveal: true }))));
    }
  }

  const used = usages(model, e.id);
  root.append(section('Used on'));
  if (!used.length) root.append(el('p', { class: 'empty', text: 'No diagram shows it. Drag it from the tree onto one.' }));
  for (const dg of used) root.append(el('div', { class: 'rel' }, icon('dg'), link(dg.name, () => { openDiagram(dg.id); selectElement(e.id); }), el('span', { class: 'sc-faint sc-mono', text: DIAGRAM_KINDS[dg.kind].abbr })));

  if (e.id !== model.rootId) root.append(el('button', { class: 'sc-button sc-button--danger sc-button--sm spec-delete', text: 'Delete from model', onclick: () => deleteElement(e.id) }));
}

function propertyFields(root, e, up) {
  root.append(field('Kind', select('propKind', Object.entries(PROP_KINDS).map(([value, label]) => ({ value, label })), e.propKind, (v) => up({ propKind: v, ...(v === 'value' ? {} : { typeText: '' }) }))));
  typeFields(root, e, up, e.propKind === 'value' ? ['valueType', 'block'] : ['block']);
  root.append(field('Multiplicity', textInput('multiplicity', e.multiplicity, (v) => up({ multiplicity: v.trim() || '1' }), { placeholder: '1, 0..1, 1..*' })));
  if (e.propKind === 'value') root.append(field('Default value', textInput('defaultValue', e.defaultValue, (v) => up({ defaultValue: v.trim() }))));
}

function typeFields(root, e, up, kinds) {
  const { model } = store;
  const options = [{ value: '', label: '— none —' }];
  for (const k of kinds) for (const t of elementsOfKind(model, k)) if (t.id !== e.ownerId || k !== 'block') options.push({ value: t.id, label: `${t.name}  ‹${ELEMENT_KINDS[k].label.toLowerCase()}›` });
  const row = el('div', { class: 'type-row' }, select('typeId', options, e.typeId || '', (v) => up({ typeId: v || null, typeText: '' })));
  if (e.typeId) row.append(el('button', { class: 'sc-button sc-button--ghost sc-button--sm', text: 'Go to', onclick: () => selectElement(e.typeId, { reveal: true }) }));
  root.append(field('Type', row));
  if (!e.typeId && kinds.includes('valueType')) root.append(field('…or a type by name', textInput('typeText', e.typeText, (v) => up({ typeText: v.trim() }), { placeholder: 'Real' })));
}

function featureRows(root, list) {
  if (!list.length) return;
  root.append(el('div', { class: 'feature-list' }, ...list.map((f) => el('div', { class: 'feature-row' },
    icon(f.kind === 'property' ? `pr-${f.propKind}` : ELEMENT_KINDS[f.kind].icon),
    link(f.kind === 'requirement' ? `${f.reqId} ${f.name}` : featureLabel(store.model, f), () => selectElement(f.id, { reveal: true }), 'grow'),
    el('button', { class: 'sc-button sc-button--ghost sc-button--icon sc-button--sm', title: 'Delete', text: '×', onclick: () => deleteElement(f.id) })))));
}
const addButton = (text, run) => el('button', { class: 'sc-button sc-button--ghost sc-button--sm', text, onclick: run });

function featureLists(root, e) {
  const { model } = store;
  root.append(section('Properties'));
  featureRows(root, features(model, e.id, 'property'));
  const adders = el('div', { class: 'adders' }, addButton('+ Value', () => createElement('property', e.id, { propKind: 'value' })));
  if (e.kind === 'block') {
    adders.append(addButton('+ Part', () => createElement('property', e.id, { propKind: 'part' })), addButton('+ Reference', () => createElement('property', e.id, { propKind: 'reference' })));
  }
  root.append(adders);
  if (e.kind !== 'block') return;
  root.append(section('Ports'));
  featureRows(root, features(model, e.id, 'port'));
  root.append(el('div', { class: 'adders' }, addButton('+ Port', () => createElement('port', e.id, { name: 'p' }))));
  root.append(section('Operations'));
  featureRows(root, features(model, e.id, 'operation'));
  root.append(el('div', { class: 'adders' }, addButton('+ Operation', () => createElement('operation', e.id, { name: 'operation' }))));
}

// ---------------------------------------------------------------- relationship

function relationshipSpec(root, r) {
  const { model } = store;
  const k = REL_KINDS[r.kind];
  const endName = (id, portId) => [model.elements[id]?.name, model.elements[portId]?.name].filter(Boolean).join('.') || (r.kind === 'connector' ? 'frame' : '?');
  root.append(head(k.stereotype ? `«${k.stereotype}»` : k.label, `${endName(r.sourceId, r.sourcePortId)} → ${endName(r.targetId, r.targetPortId)}`, k.label));
  root.append(field('Name', textInput('relname', r.name, (v) => updateRelationship(r.id, { name: v.trim() }))));
  root.append(section('Ends'));
  for (const [lbl, id] of [['Source', r.sourcePortId || r.sourceId], ['Target', r.targetPortId || r.targetId]]) {
    root.append(el('div', { class: 'rel' }, el('span', { class: 'sc-label', text: lbl }), id ? link(model.elements[id]?.name || '?', () => selectElement(id, { reveal: true })) : el('span', { class: 'sc-faint', text: 'diagram frame' })));
  }
  if (!['connector', 'association'].includes(r.kind)) {
    root.append(addButton('⇄ Reverse direction', () => tryCommit('Reverse', (m) => { const x = m.relationships[r.id]; [x.sourceId, x.targetId] = [x.targetId, x.sourceId]; })));
  }
  root.append(el('button', { class: 'sc-button sc-button--danger sc-button--sm spec-delete', text: 'Delete from model', onclick: deleteSelectionFromModel }));
}

// ---------------------------------------------------------------- diagram

function diagramSpec(root, d) {
  const { model } = store;
  const meta = DIAGRAM_KINDS[d.kind];
  root.append(head(meta.abbr, d.name, meta.label));
  root.append(field('Name', textInput('dname', d.name, (v) => renameDiagram(d.id, v))));
  root.append(el('div', { class: 'rel' }, el('span', { class: 'sc-label', text: d.kind === 'ibd' ? 'Context' : 'Owner' }), link(model.elements[d.contextId || d.ownerId]?.name, () => selectElement(d.contextId || d.ownerId, { reveal: true }))));
  if (d.kind === 'matrix') {
    const kinds = Object.entries(ELEMENT_KINDS).filter(([, v]) => !v.feature).map(([value, v]) => ({ value, label: `${v.label}s` }));
    root.append(
      field('Relationship', select('relKind', Object.keys(MATRIX_PRESETS).map((value) => ({ value, label: REL_KINDS[value].label })), d.relKind, (v) => updateDiagram(d.id, { relKind: v, rowKind: MATRIX_PRESETS[v].rows, colKind: MATRIX_PRESETS[v].cols }))),
      field('Rows (source)', select('rowKind', kinds, d.rowKind, (v) => updateDiagram(d.id, { rowKind: v }))),
      field('Columns (target)', select('colKind', kinds, d.colKind, (v) => updateDiagram(d.id, { colKind: v }))));
  }
  if (d.symbols) root.append(el('p', { class: 'empty', text: `${d.symbols.length} symbol${d.symbols.length === 1 ? '' : 's'}, ${d.paths.length} path${d.paths.length === 1 ? '' : 's'}. Pick a tool from the palette, or drag elements in from the containment tree.` }));
}

// ---------------------------------------------------------------- symbol options

function symbolTab(root, d, sel) {
  const sym = d?.symbols && sel?.symbolIds?.length === 1 && getSymbol(d, sel.symbolIds[0]);
  if (!sym) { root.append(el('p', { class: 'empty', text: 'Select one symbol on a diagram to change how it is drawn there. These options never change the model.' })); return; }
  const e = store.model.elements[sym.elementId];
  root.append(head('Symbol', e.name || 'Note', `on ${d.name}`));
  const edit = (fn) => tryCommit('Symbol options', (m) => fn(getSymbol(m.diagrams[d.id], sym.id)));
  const groups = e.kind === 'block' && d.kind !== 'uc' && d.kind !== 'ibd' ? ['values', 'parts', 'references', 'ports', 'operations'] : e.kind === 'requirement' ? ['text'] : [];
  if (groups.length) root.append(section('Compartments'));
  for (const g of groups) root.append(check(`hide-${g}`, `Show ${g}`, !sym.hide?.[g], (v) => edit((s) => { s.hide = { ...(s.hide || {}), [g]: !v }; })));
  root.append(section('Size'), el('div', { class: 'adders' }, addButton('Fit to content', () => edit((s) => { s.w = 0; s.h = 0; }))));
  if (sym.ports && Object.keys(sym.ports).length) root.append(el('div', { class: 'adders' }, addButton('Reset port positions', () => edit((s) => { delete s.ports; }))));
  const edge = resolveEdge(store.model, sym.elementId);
  if (edge) root.append(el('p', { class: 'empty', text: 'This part is also the composition drawn on block definition diagrams.' }));
}

export function setRightTab(tab) { set({ rightTab: tab }); }
