// Editing commands. The canvas, the tree, the specification panel and the
// menus all go through these, so an edit behaves the same wherever it starts.

import { store, tryCommit, set, openDiagram, selectElement, emit } from './store.js';
import { ELEMENT_KINDS, REL_KINDS, DIAGRAM_KINDS, endsAllowed, canOwn, canOwnDiagram } from '../model/types.js';
import {
  addElement, addRelationship, addDiagram, addSymbol, addPath, removeElement, removeEdge, removeSymbol, removePath, removeDiagram,
  moveElement, owningPackage, uniqueName, findRelationship, canShow, symbolOf, features, resolveEdge,
} from '../model/model.js';

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1).replace(/\s+/g, '') : s);
export const currentDiagram = () => store.model.diagrams[store.ui.currentDiagramId] || null;

export function hint(text) { set({ hint: text }); }

// ---------------------------------------------------------------- elements

/** Where a new element of `kind` should live when it is created from `nearId`. */
function ownerFor(model, kind, nearId) {
  for (let e = model.elements[nearId]; e; e = model.elements[e.ownerId]) if (canOwn(e.kind, kind)) return e;
  return model.elements[model.rootId];
}

export function createElement(kind, nearId, props = {}) {
  const e = tryCommit(`Add ${ELEMENT_KINDS[kind].label.toLowerCase()}`, (m) => {
    const owner = ownerFor(m, kind, nearId || m.rootId);
    const base = props.name || (kind === 'property' ? lowerFirst(props.propKind || 'value') : ELEMENT_KINDS[kind].label);
    return addElement(m, kind, owner.id, { ...props, name: kind === 'comment' ? '' : uniqueName(m, owner.id, base) });
  });
  if (e) { delete store.ui.collapsed[e.ownerId]; selectElement(e.id, { reveal: true }); }
  return e;
}

export function updateElement(id, patch, label = 'Edit') {
  const e = store.model.elements[id];
  if (!e || Object.entries(patch).every(([k, v]) => e[k] === v)) return;
  tryCommit(label, (m) => {
    Object.assign(m.elements[id], patch);
    if (id === m.rootId && 'name' in patch) m.name = patch.name;
  });
}

export function updateRelationship(id, patch) {
  tryCommit('Edit relationship', (m) => Object.assign(m.relationships[id], patch));
}

export function deleteElement(id) {
  const e = store.model.elements[id];
  if (!e || id === store.model.rootId) return;
  tryCommit(`Delete ${e.name || ELEMENT_KINDS[e.kind].label.toLowerCase()}`, (m) => removeElement(m, id));
}

export function reparent(id, newOwnerId) {
  return tryCommit('Move', (m) => { if (!moveElement(m, id, newOwnerId)) throw new Error('Nothing to move.'); return true; });
}

// ---------------------------------------------------------------- diagrams

export function createDiagram(kind, nearId, props = {}) {
  const d = tryCommit(`New ${DIAGRAM_KINDS[kind].label.toLowerCase()}`, (m) => {
    let owner = m.elements[nearId] || m.elements[m.rootId];
    if (kind === 'ibd') {
      const ctx = m.elements[props.contextId || nearId];
      if (ctx?.kind !== 'block') throw new Error('An internal block diagram needs a block as its context. Select a block first.');
      owner = ctx;
      props = { ...props, contextId: ctx.id };
    } else {
      while (owner && !(canOwnDiagram(owner.kind) && owner.kind === 'package')) owner = m.elements[owner.ownerId];
      owner = owner || m.elements[m.rootId];
    }
    const base = props.name || (kind === 'ibd' ? `${owner.name} internals` : DIAGRAM_KINDS[kind].label);
    const taken = new Set(Object.values(m.diagrams).map((x) => x.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    const diagram = addDiagram(m, kind, owner.id, name, props);
    if (kind === 'ibd') {
      // Start with the parts already defined, the way Cameo's "display parts" does.
      features(m, owner.id, 'property').filter((p) => p.propKind !== 'value')
        .forEach((p, i) => addSymbol(m, diagram, p.id, 120 + (i % 3) * 260, 140 + Math.floor(i / 3) * 170));
    }
    return diagram;
  });
  if (d) { delete store.ui.collapsed[d.ownerId]; openDiagram(d.id); }
  return d;
}

export function renameDiagram(id, name) {
  if (!name.trim() || store.model.diagrams[id]?.name === name) return;
  tryCommit('Rename diagram', (m) => { m.diagrams[id].name = name.trim(); });
}
export function updateDiagram(id, patch) { tryCommit('Edit view', (m) => Object.assign(m.diagrams[id], patch)); }
export function deleteDiagram(id) { tryCommit('Delete diagram', (m) => removeDiagram(m, id)); }

// ---------------------------------------------------------------- on the canvas

/** Node tool click. `kind` is an element kind, or 'part' / 'refpart' on an ibd. */
export function createOnDiagram(kind, x, y, props = {}) {
  const d = currentDiagram();
  if (!d?.symbols) return null;
  const made = tryCommit(`Add ${kind}`, (m) => {
    const diagram = m.diagrams[d.id];
    let e;
    if (kind === 'part' || kind === 'refpart') {
      const ctx = m.elements[diagram.contextId];
      const type = m.elements[props.typeId];
      e = addElement(m, 'property', ctx.id, {
        propKind: kind === 'part' ? 'part' : 'reference', typeId: type?.id || null,
        name: uniqueName(m, ctx.id, type ? lowerFirst(type.name) : 'part'),
      });
    } else {
      const owner = ownerFor(m, kind, diagram.ownerId);
      e = addElement(m, kind, owner.id, { name: kind === 'comment' ? '' : uniqueName(m, owner.id, ELEMENT_KINDS[kind].label), ...props });
    }
    const s = addSymbol(m, diagram, e.id, x, y);
    return { e, s };
  });
  if (made) store.ui.selection = { elementId: made.e.id, symbolIds: [made.s.id] };
  set({ tool: 'select', ...(made ? { hint: '' } : {}) });
  return made;
}

export function createPort(ownerBlockId) {
  const owner = store.model.elements[ownerBlockId];
  if (owner?.kind !== 'block') { hint('That part has no block as its type, so it has nowhere to keep a port.'); return null; }
  const p = tryCommit('Add port', (m) => addElement(m, 'port', ownerBlockId, { name: uniqueName(m, ownerBlockId, 'p') }));
  set({ tool: 'select', ...(p ? { hint: '' } : {}) });
  if (p) selectElement(p.id);
  return p;
}

export function dropOnDiagram(elementId, x, y) {
  const d = currentDiagram();
  const e = store.model.elements[elementId];
  if (!d?.symbols || !e) return;
  if (!canShow(store.model, d, e)) {
    hint(d.kind === 'ibd'
      ? 'Only parts and references of the context block can be shown on this internal block diagram.'
      : `A ${ELEMENT_KINDS[e.kind].label.toLowerCase()} has no symbol of its own; it shows inside its owner.`);
    return;
  }
  if (symbolOf(d, elementId)) { selectElement(elementId); hint(`“${e.name}” is already on this diagram.`); return; }
  const s = tryCommit('Show on diagram', (m) => addSymbol(m, m.diagrams[d.id], elementId, x, y));
  if (s) { store.ui.selection = { elementId, symbolIds: [s.id] }; emit(); }
}

/**
 * Path tool: join two ends. An end is { elementId, portId? }; on an ibd
 * `elementId` is a part (null for the frame).
 */
export function connect(kind, from, to) {
  const d = currentDiagram();
  const k = REL_KINDS[kind];
  const made = tryCommit(`Add ${k.label.toLowerCase()}`, (m) => {
    const diagram = m.diagrams[d.id];
    if (kind === 'connector') {
      if (!from.elementId && !from.portId) throw new Error('A connector starts at a part or a port.');
      if (from.elementId === to.elementId && from.portId === to.portId) throw new Error('A connector needs two different ends.');
      const r = addRelationship(m, 'connector', from.elementId || null, to.elementId || null,
        { ownerId: diagram.contextId, sourcePortId: from.portId || null, targetPortId: to.portId || null });
      return addPath(diagram, r.id);
    }
    const s = m.elements[from.elementId];
    const t = m.elements[to.elementId];
    if (!endsAllowed(kind, s.kind, t.kind)) {
      throw new Error(`${k.label} cannot run from a ${ELEMENT_KINDS[s.kind].label.toLowerCase()} to a ${ELEMENT_KINDS[t.kind].label.toLowerCase()}.`);
    }
    if (kind === 'composition' || kind === 'reference') {
      const p = addElement(m, 'property', s.id, { propKind: kind === 'composition' ? 'part' : 'reference', typeId: t.id, name: uniqueName(m, s.id, lowerFirst(t.name) || 'part') });
      return addPath(diagram, p.id);
    }
    if (kind === 'containment') {
      if (t.ownerId !== s.id) moveElement(m, t.id, s.id);
      return addPath(diagram, `own:${t.id}`);
    }
    if (s.id === t.id && kind !== 'association') throw new Error(`${k.label} needs two different elements.`);
    const existing = findRelationship(m, kind, s.id, t.id);
    return addPath(diagram, (existing || addRelationship(m, kind, s.id, t.id)).id);
  });
  if (made) store.ui.selection = { pathId: made.id, refId: made.refId };
  set({ pending: null });
  return made;
}

/** Delete key: take the selection off the diagram, leaving the model alone. */
export function removeSelectionFromDiagram() {
  const d = currentDiagram();
  const sel = store.ui.selection;
  if (!d?.symbols || !sel) return;
  if (sel.pathId) {
    const edge = resolveEdge(store.model, sel.refId);
    if (edge?.kind === 'connector') { deleteSelectionFromModel(); return; }
    tryCommit('Remove path from diagram', (m) => removePath(m.diagrams[d.id], sel.pathId));
  } else if (sel.symbolIds?.length) {
    tryCommit('Remove from diagram', (m) => { for (const id of sel.symbolIds) removeSymbol(m, m.diagrams[d.id], id); });
  }
}

export function deleteSelectionFromModel() {
  const d = currentDiagram();
  const sel = store.ui.selection;
  if (!sel) return;
  if (sel.pathId) {
    const edge = resolveEdge(store.model, sel.refId);
    if (edge?.kind === 'containment') { hint('Containment is ownership: drag the element to another owner in the tree to change it.'); return; }
    tryCommit('Delete relationship', (m) => removeEdge(m, sel.refId));
  } else if (sel.portId) {
    deleteElement(sel.portId);
  } else if (sel.symbolIds?.length && d?.symbols) {
    const ids = sel.symbolIds.map((sid) => d.symbols.find((s) => s.id === sid)?.elementId).filter(Boolean);
    tryCommit('Delete from model', (m) => ids.forEach((id) => removeElement(m, id)));
  } else if (sel.elementId) {
    deleteElement(sel.elementId);
  }
}
