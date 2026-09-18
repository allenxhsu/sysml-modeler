// Model checks. Every finding carries a stable `code`, so the Checks panel,
// tests and any later command-line tool can key off it instead of the text.
//
//   issue { code, level: 'error'|'warning'|'info', message, elementId?, relId?, diagramId? }

import { ELEMENT_KINDS, REL_KINDS, endsAllowed } from './types.js';
import { children, symbolOf, typeLabel, isFeature } from './model.js';

export const RULES = {
  'name-empty':            ['error',   'An element has no name'],
  'name-dup':              ['warning', 'Two siblings of the same kind share a name'],
  'part-untyped':          ['error',   'A part or reference property has no block as its type'],
  'value-untyped':         ['warning', 'A value property has no type'],
  'port-untyped':          ['warning', 'A port has no type'],
  'composition-cycle':     ['error',   'A block is, directly or indirectly, a part of itself'],
  'gen-cycle':             ['error',   'A generalization chain loops back on itself'],
  'req-id-missing':        ['error',   'A requirement has no id'],
  'req-id-dup':            ['error',   'Two requirements share an id'],
  'req-text-empty':        ['warning', 'A requirement has no text'],
  'req-unsatisfied':       ['warning', 'A leaf requirement has no «satisfy» relationship'],
  'req-unverified':        ['warning', 'A leaf requirement has no «verify» relationship'],
  'rel-dangling':          ['error',   'A relationship points at an element that no longer exists'],
  'rel-ends':              ['error',   'A relationship joins kinds of element it is not defined for'],
  'rel-self':              ['warning', 'A relationship starts and ends on the same element'],
  'rel-dup':               ['warning', 'The same relationship is recorded twice'],
  'connector-incompatible':['warning', 'A connector joins ports whose types or directions do not match'],
  'usecase-no-actor':      ['warning', 'A use case is associated with no actor'],
  'actor-unused':          ['info',    'An actor takes part in no use case'],
  'block-unused':          ['info',    'A block appears on no diagram and is used by no other element'],
  'diagram-empty':         ['info',    'A diagram shows nothing'],
};

export function validate(model) {
  const issues = [];
  const add = (code, message, where = {}) => issues.push({ code, level: RULES[code][0], message, ...where });
  const els = Object.values(model.elements);
  const rels = Object.values(model.relationships);
  const label = (e) => `${ELEMENT_KINDS[e.kind].label} “${e.name || 'unnamed'}”`;

  // names
  for (const e of els) {
    if (e.kind === 'comment') continue;
    if (!(e.name || '').trim()) add('name-empty', `${ELEMENT_KINDS[e.kind].label} in “${model.elements[e.ownerId]?.name || model.name}” has no name`, { elementId: e.id });
  }
  const seen = new Map();
  for (const e of els) {
    if (!e.name || e.kind === 'comment') continue;
    const key = `${e.ownerId}|${e.kind}|${e.name}`;
    if (seen.has(key)) add('name-dup', `${label(e)} appears twice in “${model.elements[e.ownerId]?.name || ''}”`, { elementId: e.id });
    seen.set(key, e);
  }

  // features
  for (const e of els) {
    if (e.kind === 'property') {
      const t = model.elements[e.typeId];
      if (e.propKind === 'value') { if (!typeLabel(model, e)) add('value-untyped', `Value “${e.name}” of ${model.elements[e.ownerId]?.name} has no type`, { elementId: e.id }); }
      else if (!t || t.kind !== 'block') add('part-untyped', `${e.propKind === 'part' ? 'Part' : 'Reference'} “${e.name}” of ${model.elements[e.ownerId]?.name} has no block as its type`, { elementId: e.id });
    } else if (e.kind === 'port' && !typeLabel(model, e)) {
      add('port-untyped', `Port “${e.name}” of ${model.elements[e.ownerId]?.name} has no type`, { elementId: e.id });
    }
  }

  // cycles
  const partsOf = (id) => children(model, id).filter((p) => p.kind === 'property' && p.propKind === 'part' && p.typeId).map((p) => p.typeId);
  const generalOf = (id) => rels.filter((r) => r.kind === 'generalization' && r.sourceId === id).map((r) => r.targetId);
  for (const e of els) {
    if (isFeature(e)) continue;
    if (e.kind === 'block' && reaches(e.id, e.id, partsOf)) add('composition-cycle', `Block “${e.name}” is a part of itself`, { elementId: e.id });
    if (reaches(e.id, e.id, generalOf)) add('gen-cycle', `${label(e)} is its own ancestor`, { elementId: e.id });
  }

  // requirements
  const reqs = els.filter((e) => e.kind === 'requirement');
  const ids = new Map();
  for (const r of reqs) {
    const rid = (r.reqId || '').trim();
    if (!rid) add('req-id-missing', `Requirement “${r.name}” has no id`, { elementId: r.id });
    else if (ids.has(rid)) add('req-id-dup', `Requirements “${ids.get(rid).name}” and “${r.name}” share the id ${rid}`, { elementId: r.id });
    else ids.set(rid, r);
    if (!(r.text || '').trim()) add('req-text-empty', `${rid || 'Requirement'} “${r.name}” has no text`, { elementId: r.id });
    const leaf = !children(model, r.id).some((c) => c.kind === 'requirement');
    if (!leaf) continue;
    if (!rels.some((x) => x.kind === 'satisfy' && x.targetId === r.id)) add('req-unsatisfied', `${rid} “${r.name}” is satisfied by nothing`, { elementId: r.id });
    if (!rels.some((x) => x.kind === 'verify' && x.targetId === r.id)) add('req-unverified', `${rid} “${r.name}” has no «verify» relationship`, { elementId: r.id });
  }

  // relationships
  const relKeys = new Set();
  for (const r of rels) {
    if (r.kind === 'connector') { checkConnector(model, r, add); continue; }
    const s = model.elements[r.sourceId];
    const t = model.elements[r.targetId];
    const name = REL_KINDS[r.kind]?.label || r.kind;
    if (!s || !t) { add('rel-dangling', `${name} has lost ${!s ? 'its source' : 'its target'}`, { relId: r.id, elementId: (s || t)?.id }); continue; }
    if (!endsAllowed(r.kind, s.kind, t.kind)) add('rel-ends', `${name} cannot run from a ${ELEMENT_KINDS[s.kind].label.toLowerCase()} to a ${ELEMENT_KINDS[t.kind].label.toLowerCase()} (“${s.name}” → “${t.name}”)`, { relId: r.id, elementId: s.id });
    if (s.id === t.id && r.kind !== 'association') add('rel-self', `${name} on “${s.name}” points back at itself`, { relId: r.id, elementId: s.id });
    const key = `${r.kind}|${r.sourceId}|${r.targetId}`;
    if (relKeys.has(key)) add('rel-dup', `${name} from “${s.name}” to “${t.name}” is recorded twice`, { relId: r.id, elementId: s.id });
    relKeys.add(key);
  }

  // use cases
  const assoc = rels.filter((r) => r.kind === 'association');
  const kindOf = (id) => model.elements[id]?.kind;
  for (const e of els) {
    if (e.kind === 'useCase') {
      const hasActor = assoc.some((r) => (r.sourceId === e.id && kindOf(r.targetId) === 'actor') || (r.targetId === e.id && kindOf(r.sourceId) === 'actor'));
      const reached = rels.some((r) => (r.kind === 'include' && r.targetId === e.id) || (r.kind === 'extend' && r.sourceId === e.id) || (r.kind === 'generalization' && r.sourceId === e.id));
      if (!hasActor && !reached) add('usecase-no-actor', `Use case “${e.name}” is associated with no actor`, { elementId: e.id });
    } else if (e.kind === 'actor') {
      if (!rels.some((r) => r.sourceId === e.id || r.targetId === e.id)) add('actor-unused', `Actor “${e.name}” takes part in no use case`, { elementId: e.id });
    } else if (e.kind === 'block') {
      const drawn = Object.values(model.diagrams).some((d) => d.symbols && (symbolOf(d, e.id) || d.contextId === e.id));
      const used = els.some((x) => x.typeId === e.id) || rels.some((r) => r.sourceId === e.id || r.targetId === e.id);
      if (!drawn && !used) add('block-unused', `Block “${e.name}” appears on no diagram and nothing refers to it`, { elementId: e.id });
    }
  }

  for (const d of Object.values(model.diagrams)) {
    if (d.symbols && !d.symbols.length) add('diagram-empty', `Diagram “${d.name}” shows nothing`, { diagramId: d.id });
  }

  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

function reaches(from, goal, next) {
  const seen = new Set();
  const stack = [...next(from)];
  while (stack.length) {
    const id = stack.pop();
    if (id === goal) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return false;
}

function checkConnector(model, r, add) {
  const ends = [[r.sourceId, r.sourcePortId], [r.targetId, r.targetPortId]];
  for (const [partId, portId] of ends) {
    if ((partId && !model.elements[partId]) || (portId && !model.elements[portId]) || (!partId && !portId)) {
      add('rel-dangling', 'Connector has lost one of its ends', { relId: r.id, elementId: r.ownerId });
      return;
    }
  }
  const a = model.elements[r.sourcePortId];
  const b = model.elements[r.targetPortId];
  if (!a || !b) return;
  const where = { relId: r.id, elementId: a.id };
  // A port on the frame faces inward, so its direction reads the other way round.
  const dir = (port, partId) => (partId ? port.direction : { in: 'out', out: 'in' }[port.direction] || 'inout');
  const da = dir(a, r.sourceId);
  const db = dir(b, r.targetId);
  if (da !== 'inout' && da === db) add('connector-incompatible', `Ports “${a.name}” and “${b.name}” are both ${da}`, where);
  const ta = typeLabel(model, a);
  const tb = typeLabel(model, b);
  if (ta && tb && ta !== tb) add('connector-incompatible', `Port “${a.name}” is typed ${ta} but “${b.name}” is typed ${tb}`, where);
}

export function issueCounts(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.level]++;
  return c;
}
