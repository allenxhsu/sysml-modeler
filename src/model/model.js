// The model repository.
//
// An element exists once, in `model.elements`; diagrams hold *symbols* that
// point at elements and *paths* that point at edges. Removing a symbol never
// touches the element. Removing an element removes every symbol of it.
//
//   model    { format, version, name, rootId, elements{}, relationships{}, diagrams{} }
//   element  { id, kind, name, ownerId, doc, …kind-specific }
//   rel      { id, kind, sourceId, targetId, name }        (+ sourcePortId/targetPortId/ownerId on a connector)
//   diagram  { id, kind, name, ownerId, contextId?, symbols[], paths[] }   or a generated view
//   symbol   { id, elementId, x, y, w, h, hide{} }
//   path     { id, refId }
//
// Three kinds of edge are *derived* rather than stored, so they cannot drift
// from the structure they describe: a part property is its composition, a
// reference property is its reference association, and ownership is its
// containment. `resolveEdge` hides the difference from the diagram code.

import { uid } from '../util.js';
import { FORMAT, FORMAT_VERSION, ELEMENT_KINDS, REL_KINDS, DIAGRAM_KINDS, canOwn, canOwnDiagram } from './types.js';

export function createModel(name = 'Untitled model') {
  const root = { id: uid('pk'), kind: 'package', name, ownerId: null, doc: '' };
  return { format: FORMAT, version: FORMAT_VERSION, name, rootId: root.id, elements: { [root.id]: root }, relationships: {}, diagrams: {} };
}

// ---------------------------------------------------------------- queries

export const getElement = (model, id) => model.elements[id] || null;
export const isFeature = (e) => !!ELEMENT_KINDS[e?.kind]?.feature;

export function children(model, ownerId) {
  return Object.values(model.elements).filter((e) => e.ownerId === ownerId);
}
export function diagramsOf(model, ownerId) {
  return Object.values(model.diagrams).filter((d) => d.ownerId === ownerId);
}
export function features(model, ownerId, kind, propKind) {
  return children(model, ownerId).filter((e) => e.kind === kind && (!propKind || e.propKind === propKind));
}
export function elementsOfKind(model, kind) {
  return Object.values(model.elements).filter((e) => e.kind === kind).sort(byName);
}
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });

export function ownerChain(model, id) {
  const chain = [];
  const seen = new Set();
  for (let e = model.elements[id]; e && !seen.has(e.id); e = model.elements[e.ownerId]) { chain.unshift(e); seen.add(e.id); }
  return chain;
}
export const qualifiedName = (model, id) => ownerChain(model, id).map((e) => e.name || '?').join('::');
export const isAncestor = (model, ancestorId, id) => ownerChain(model, id).some((e) => e.id === ancestorId);

/** Nearest package at or above `id`. New elements drawn on a diagram land there. */
export function owningPackage(model, id) {
  const chain = ownerChain(model, id);
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i].kind === 'package') return chain[i];
  return model.elements[model.rootId];
}

export function typeLabel(model, e) {
  if (!e) return '';
  const t = e.typeId && model.elements[e.typeId];
  return t ? t.name : (e.typeText || '');
}

/** "name : Type [mult] = default" as it reads in a compartment. */
export function featureLabel(model, e) {
  if (e.kind === 'operation') return `${e.name || ''}(${e.params || ''})${e.returnType ? ` : ${e.returnType}` : ''}`;
  const type = typeLabel(model, e);
  let s = e.name || '';
  if (e.kind === 'port' && e.direction && e.direction !== 'inout') s = `${e.direction} ${s}`;
  if (type) s += ` : ${type}`;
  if (e.multiplicity && e.multiplicity !== '1') s += ` [${e.multiplicity}]`;
  if (e.defaultValue) s += ` = ${e.defaultValue}`;
  return s;
}

export function uniqueName(model, ownerId, base) {
  const taken = new Set(children(model, ownerId).map((e) => e.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function nextReqId(model, parentId) {
  const parent = model.elements[parentId];
  if (parent?.kind === 'requirement' && parent.reqId) {
    const n = children(model, parentId).filter((e) => e.kind === 'requirement').length + 1;
    return `${parent.reqId}.${n}`;
  }
  let max = 0;
  for (const e of Object.values(model.elements)) {
    const m = e.kind === 'requirement' && /^R(\d+)$/.exec(e.reqId || '');
    if (m) max = Math.max(max, +m[1]);
  }
  return `R${max + 1}`;
}

// ---------------------------------------------------------------- edges

/**
 * @returns {{id, kind, sourceId, targetId, label, derived, sourcePortId?, targetPortId?}|null}
 */
export function resolveEdge(model, refId) {
  const r = model.relationships[refId];
  if (r) return { ...r, label: r.name || '', derived: false };
  if (refId.startsWith('own:')) {
    const child = model.elements[refId.slice(4)];
    if (!child || !child.ownerId) return null;
    return { id: refId, kind: 'containment', sourceId: child.ownerId, targetId: child.id, label: '', derived: true };
  }
  const p = model.elements[refId];
  if (p?.kind === 'property' && (p.propKind === 'part' || p.propKind === 'reference') && p.typeId && model.elements[p.typeId]) {
    return {
      id: refId, kind: p.propKind === 'part' ? 'composition' : 'reference', sourceId: p.ownerId, targetId: p.typeId,
      label: p.name || '', multiplicity: p.multiplicity || '1', derived: true,
    };
  }
  return null;
}

/** Every edge (stored or derived) with `elementId` at one end. */
export function edgesOf(model, elementId) {
  const out = [];
  for (const r of Object.values(model.relationships)) {
    if (r.kind !== 'connector' && (r.sourceId === elementId || r.targetId === elementId)) out.push(r.id);
  }
  for (const e of Object.values(model.elements)) {
    if (e.kind === 'property' && e.typeId && (e.propKind === 'part' || e.propKind === 'reference')
      && (e.ownerId === elementId || e.typeId === elementId)) out.push(e.id);
  }
  return out;
}

export function relationsOf(model, elementId) {
  return edgesOf(model, elementId).map((id) => resolveEdge(model, id)).filter(Boolean).map((edge) => {
    const outgoing = edge.sourceId === elementId;
    return { edge, outgoing, other: model.elements[outgoing ? edge.targetId : edge.sourceId] };
  });
}

export function findRelationship(model, kind, sourceId, targetId) {
  return Object.values(model.relationships).find((r) => r.kind === kind && r.sourceId === sourceId && r.targetId === targetId) || null;
}

// ---------------------------------------------------------------- element edits

const DEFAULTS = {
  block: () => ({ isAbstract: false }),
  valueType: () => ({ unit: '' }),
  requirement: () => ({ reqId: '', text: '' }),
  comment: () => ({ body: '' }),
  property: () => ({ propKind: 'value', typeId: null, typeText: '', multiplicity: '1', defaultValue: '' }),
  port: () => ({ typeId: null, typeText: '', direction: 'inout', multiplicity: '1' }),
  operation: () => ({ params: '', returnType: '' }),
};

export function addElement(model, kind, ownerId, props = {}) {
  if (!ELEMENT_KINDS[kind]) throw new Error(`Unknown element kind "${kind}".`);
  const owner = model.elements[ownerId];
  if (!owner) throw new Error('The owner no longer exists.');
  if (!canOwn(owner.kind, kind)) throw new Error(`A ${ELEMENT_KINDS[owner.kind].label.toLowerCase()} cannot own a ${ELEMENT_KINDS[kind].label.toLowerCase()}.`);
  const e = { id: uid(kind.slice(0, 2)), kind, name: '', ownerId, doc: '', ...(DEFAULTS[kind]?.() || {}), ...props };
  if (kind === 'requirement' && !e.reqId) e.reqId = nextReqId(model, ownerId);
  model.elements[e.id] = e;
  return e;
}

export function moveElement(model, id, newOwnerId) {
  const e = model.elements[id];
  const owner = model.elements[newOwnerId];
  if (!e || !owner || id === model.rootId) return false;
  if (e.ownerId === newOwnerId) return false;
  if (!canOwn(owner.kind, e.kind)) throw new Error(`A ${ELEMENT_KINDS[owner.kind].label.toLowerCase()} cannot own a ${ELEMENT_KINDS[e.kind].label.toLowerCase()}.`);
  if (isAncestor(model, id, newOwnerId)) throw new Error('An element cannot be moved inside itself.');
  e.ownerId = newOwnerId;
  return true;
}

/** Remove an element, everything it owns, and every trace of them on diagrams. */
export function removeElement(model, id) {
  if (id === model.rootId || !model.elements[id]) return;
  const doomed = new Set();
  const walk = (eid) => { doomed.add(eid); for (const c of children(model, eid)) walk(c.id); };
  walk(id);

  for (const d of Object.values(model.diagrams)) {
    if (doomed.has(d.ownerId) || doomed.has(d.contextId)) delete model.diagrams[d.id];
  }
  for (const r of Object.values(model.relationships)) {
    if ([r.sourceId, r.targetId, r.sourcePortId, r.targetPortId, r.ownerId].some((x) => x && doomed.has(x))) delete model.relationships[r.id];
  }
  for (const eid of doomed) delete model.elements[eid];
  for (const e of Object.values(model.elements)) if (e.typeId && doomed.has(e.typeId)) e.typeId = null;
  for (const d of Object.values(model.diagrams)) pruneDiagram(model, d);
}

export function addRelationship(model, kind, sourceId, targetId, props = {}) {
  const k = REL_KINDS[kind];
  if (!k || k.derived) throw new Error(`"${kind}" is not a stored relationship kind.`);
  const r = { id: uid('rl'), kind, sourceId, targetId, name: '', ...props };
  model.relationships[r.id] = r;
  return r;
}

export function removeRelationship(model, id) {
  delete model.relationships[id];
  for (const d of Object.values(model.diagrams)) pruneDiagram(model, d);
}

/**
 * Delete whatever an edge stands for. A composition or reference goes by
 * deleting its property; containment cannot be deleted, only re-parented.
 */
export function removeEdge(model, refId) {
  if (model.relationships[refId]) removeRelationship(model, refId);
  else if (model.elements[refId]?.kind === 'property') removeElement(model, refId);
}

// ---------------------------------------------------------------- diagrams

export function addDiagram(model, kind, ownerId, name, props = {}) {
  if (!DIAGRAM_KINDS[kind]) throw new Error(`Unknown diagram kind "${kind}".`);
  const owner = model.elements[ownerId];
  if (!owner || !canOwnDiagram(owner.kind)) throw new Error('A diagram needs a package or a block to live in.');
  const d = { id: uid('dg'), kind, name: name || DIAGRAM_KINDS[kind].label, ownerId, ...props };
  if (!DIAGRAM_KINDS[kind].view) { d.symbols = []; d.paths = []; }
  if (kind === 'ibd') d.contextId = props.contextId || ownerId;
  model.diagrams[d.id] = d;
  return d;
}

export const removeDiagram = (model, id) => { delete model.diagrams[id]; };
export const symbolOf = (diagram, elementId) => diagram.symbols?.find((s) => s.elementId === elementId) || null;
export const getSymbol = (diagram, symbolId) => diagram.symbols?.find((s) => s.id === symbolId) || null;

/** Can `element` be shown on `diagram` at all? */
export function canShow(model, diagram, element) {
  if (!element || !diagram.symbols) return false;
  if (diagram.kind === 'ibd') {
    return element.kind === 'comment' || (element.kind === 'property' && element.propKind !== 'value' && element.ownerId === diagram.contextId);
  }
  return !isFeature(element) && element.id !== model.rootId;
}

export function addSymbol(model, diagram, elementId, x, y) {
  const existing = symbolOf(diagram, elementId);
  if (existing) return existing;
  const s = { id: uid('sy'), elementId, x: Math.round(x), y: Math.round(y), w: 0, h: 0 };
  diagram.symbols.push(s);
  showEdgesFor(model, diagram, elementId);
  return s;
}

/** Add a path for every edge between `elementId` and whatever else is already drawn. */
export function showEdgesFor(model, diagram, elementId) {
  if (diagram.kind === 'ibd') {
    for (const r of Object.values(model.relationships)) {
      if (r.kind !== 'connector' || r.ownerId !== diagram.contextId) continue;
      const ok = (pid) => !pid || symbolOf(diagram, pid);
      if ((r.sourceId === elementId || r.targetId === elementId) && ok(r.sourceId) && ok(r.targetId)) addPath(diagram, r.id);
    }
    return;
  }
  const allowed = DIAGRAM_KINDS[diagram.kind].paths;
  for (const refId of edgesOf(model, elementId)) {
    const edge = resolveEdge(model, refId);
    if (edge && allowed.includes(edge.kind) && symbolOf(diagram, edge.sourceId) && symbolOf(diagram, edge.targetId)) addPath(diagram, refId);
  }
  if (allowed.includes('containment')) {
    const e = model.elements[elementId];
    if (e.ownerId && symbolOf(diagram, e.ownerId)) addPath(diagram, `own:${e.id}`);
    for (const c of children(model, elementId)) if (symbolOf(diagram, c.id)) addPath(diagram, `own:${c.id}`);
  }
}

export function addPath(diagram, refId) {
  const existing = diagram.paths.find((p) => p.refId === refId);
  if (existing) return existing;
  const p = { id: uid('pa'), refId };
  diagram.paths.push(p);
  return p;
}

export function removeSymbol(model, diagram, symbolId) {
  diagram.symbols = diagram.symbols.filter((s) => s.id !== symbolId);
  pruneDiagram(model, diagram);
}
export function removePath(diagram, pathId) {
  diagram.paths = diagram.paths.filter((p) => p.id !== pathId);
}

/** Drop symbols whose element is gone and paths that lost an end. */
export function pruneDiagram(model, diagram) {
  if (!diagram.symbols) return;
  diagram.symbols = diagram.symbols.filter((s) => canShow(model, diagram, model.elements[s.elementId]));
  diagram.paths = diagram.paths.filter((p) => {
    const edge = resolveEdge(model, p.refId);
    if (!edge) return false;
    const ok = (id) => (diagram.kind === 'ibd' && !id) || symbolOf(diagram, id);
    return ok(edge.sourceId) && ok(edge.targetId);
  });
}

/** Diagrams that show `elementId`, as a symbol or (for a feature) through its owner. */
export function usages(model, elementId) {
  const e = model.elements[elementId];
  if (!e) return [];
  return Object.values(model.diagrams).filter((d) => d.symbols && (
    symbolOf(d, elementId)
    || (isFeature(e) && symbolOf(d, e.ownerId))
    || (e.kind === 'port' && d.symbols.some((s) => model.elements[s.elementId]?.typeId === e.ownerId))
    || d.contextId === elementId
  ));
}

/** Place symbols on a grid. Used for imported models, which arrive without diagrams. */
export function gridLayout(model, diagram, elementIds, { cols = 4, dx = 260, dy = 200, x0 = 60, y0 = 70 } = {}) {
  elementIds.forEach((id, i) => addSymbol(model, diagram, id, x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy));
}
