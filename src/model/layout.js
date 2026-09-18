// Diagram geometry: what a symbol says, how big that makes it, where ports
// sit, and how paths run. Pure functions of the model — the screen renderer,
// the SVG exporter and the canvas hit-testing all call the same code, so what
// is drawn is always what is measured.

import { textWidth, wrapText, clamp } from '../util.js';
import { ELEMENT_KINDS, REL_KINDS, DIAGRAM_KINDS } from './types.js';
import { features, featureLabel, resolveEdge, symbolOf } from './model.js';

export const PAD = 10;
export const LINE = 16;
export const PORT = 14;
const HEAD_STEREO = 14;
const HEAD_NAME = 18;

/**
 * What a symbol shows.
 * @returns {{shape, stereo, name, italic, compartments: {title, lines[]}[], dashed}}
 */
export function symbolContent(model, diagram, sym, width) {
  const e = model.elements[sym.elementId];
  const hide = sym.hide || {};
  const c = { shape: 'box', stereo: '', name: e.name || '', italic: false, compartments: [], dashed: false };
  const kind = ELEMENT_KINDS[e.kind];
  if (kind.stereotype) c.stereo = `«${kind.stereotype}»`;

  if (diagram.kind === 'ibd' && e.kind === 'property') {
    c.shape = 'part';
    c.name = featureLabel(model, e);
    c.dashed = e.propKind === 'reference';
    return c;
  }
  switch (e.kind) {
    case 'block': {
      c.italic = !!e.isAbstract;
      if (diagram.kind === 'uc') { c.shape = 'subject'; c.stereo = ''; break; }
      const groups = [
        ['values', features(model, e.id, 'property', 'value')],
        ['parts', features(model, e.id, 'property', 'part')],
        ['references', features(model, e.id, 'property', 'reference')],
        ['ports', features(model, e.id, 'port')],
        ['operations', features(model, e.id, 'operation')],
      ];
      for (const [title, list] of groups) {
        if (list.length && !hide[title]) c.compartments.push({ title, lines: list.map((f) => featureLabel(model, f)) });
      }
      break;
    }
    case 'valueType': {
      const lines = features(model, e.id, 'property').map((f) => featureLabel(model, f));
      if (e.unit) lines.unshift(`unit = ${e.unit}`);
      if (lines.length) c.compartments.push({ title: '', lines });
      break;
    }
    case 'requirement': {
      const lines = [`id = "${e.reqId || ''}"`];
      if (!hide.text && e.text) lines.push(...wrapText(`text = "${e.text}"`, width - PAD * 2, 12, 8));
      c.compartments.push({ title: '', lines });
      break;
    }
    case 'testCase':
      if (e.doc && !hide.doc) c.compartments.push({ title: '', lines: wrapText(e.doc, width - PAD * 2, 12, 5) });
      break;
    case 'package': c.shape = 'package'; break;
    case 'actor': c.shape = 'actor'; break;
    case 'useCase': c.shape = 'usecase'; break;
    case 'comment':
      c.shape = 'note';
      c.name = '';
      c.compartments.push({ title: '', lines: wrapText(e.body || 'Note', width - PAD * 2 - 8, 12, 14) });
      break;
    default:
  }
  return c;
}

const DEFAULT_W = { requirement: 240, comment: 180, package: 180, testCase: 180 };

/** The symbol's rectangle and content, with automatic minimum size applied. */
export function measure(model, diagram, sym) {
  const e = model.elements[sym.elementId];
  const wish = sym.w || DEFAULT_W[e.kind] || 0;
  let content = symbolContent(model, diagram, sym, Math.max(wish, 120));
  let minW;
  let minH;
  switch (content.shape) {
    case 'actor': minW = Math.max(60, textWidth(content.name, 12) + 8); minH = 92; break;
    case 'usecase': minW = Math.max(150, textWidth(content.name, 12.5) + 56); minH = 64; break;
    case 'subject': minW = 260; minH = 220; break;
    case 'package': minW = Math.max(160, textWidth(content.name, 13) + 40); minH = 96; break;
    case 'part': minW = Math.max(150, textWidth(content.name, 12.5) + PAD * 3); minH = 72; break;
    case 'note': minW = 120; minH = content.compartments[0].lines.length * LINE + PAD * 2; break;
    default: {
      minW = Math.max(130, textWidth(content.name, 13) * 1.12 + PAD * 3, textWidth(content.stereo, 11, true) + PAD * 2);
      for (const c of content.compartments) for (const l of c.lines) minW = Math.max(minW, textWidth(l, 12) + PAD * 2 + 4);
      minW = Math.min(minW, Math.max(wish, 360));
      minH = headHeight(content);
      for (const c of content.compartments) minH += compHeight(c);
      minH = Math.max(minH, 50);
    }
  }
  const w = Math.max(sym.w || 0, Math.ceil(minW), wish);
  if (w !== Math.max(wish, 120) && (e.kind === 'requirement' || e.kind === 'comment' || e.kind === 'testCase')) {
    content = symbolContent(model, diagram, sym, w);
    if (content.shape === 'note') minH = content.compartments[0].lines.length * LINE + PAD * 2;
    else { minH = headHeight(content); for (const c of content.compartments) minH += compHeight(c); }
  }
  const h = Math.max(sym.h || 0, Math.ceil(minH));
  return { id: sym.id, elementId: sym.elementId, x: sym.x, y: sym.y, w, h, minW: Math.ceil(minW), minH: Math.ceil(minH), content };
}

export const headHeight = (content) => 8 + (content.stereo ? HEAD_STEREO : 0) + HEAD_NAME + 6;
export const compHeight = (c) => 6 + (c.title ? 13 : 0) + c.lines.length * LINE + 4;

/** Measure every symbol once. Returns Map(symbolId → box). */
export function measureAll(model, diagram) {
  const boxes = new Map();
  for (const s of diagram.symbols) if (model.elements[s.elementId]) boxes.set(s.id, measure(model, diagram, s));
  return boxes;
}

export function frameRect(diagram, boxes) {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const b of boxes.values()) { x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); }
  if (!boxes.size) { x1 = 60; y1 = 70; x2 = 60; y2 = 70; }
  const x = Math.min(20, x1 - 50);
  const y = Math.min(20, y1 - 60);
  return { x, y, w: Math.max(820, x2 + 50 - x), h: Math.max(500, y2 + 50 - y) };
}

export function frameTitle(model, diagram) {
  const k = DIAGRAM_KINDS[diagram.kind];
  const ctx = model.elements[diagram.kind === 'ibd' ? diagram.contextId : diagram.ownerId];
  const ctxKind = ctx ? ELEMENT_KINDS[ctx.kind].label.toLowerCase() : 'package';
  return `${k.abbr} [${ctxKind}] ${ctx?.name || ''} [${diagram.name}]`;
}

// ---------------------------------------------------------------- ports (ibd)

const sidePoint = (r, side, t) => {
  if (side === 'l') return { x: r.x, y: r.y + r.h * t };
  if (side === 'r') return { x: r.x + r.w, y: r.y + r.h * t };
  if (side === 't') return { x: r.x + r.w * t, y: r.y };
  return { x: r.x + r.w * t, y: r.y + r.h };
};

/** Nearest border position of `rect` to a point → { side, t }. */
export function projectToBorder(rect, px, py) {
  const d = { l: Math.abs(px - rect.x), r: Math.abs(px - rect.x - rect.w), t: Math.abs(py - rect.y), b: Math.abs(py - rect.y - rect.h) };
  const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  const t = side === 'l' || side === 'r' ? (py - rect.y) / rect.h : (px - rect.x) / rect.w;
  return { side, t: clamp(Math.round(t * 20) / 20, 0.1, 0.9) };
}

function placePorts(ports, rect, stored, inward) {
  const auto = { l: [], r: [] };
  const sideOf = (p) => (p.direction === 'in' ? 'l' : p.direction === 'out' ? 'r' : inward ? 'l' : 'r');
  for (const p of ports) if (!stored?.[p.id]) auto[sideOf(p)].push(p);
  return ports.map((p) => {
    let pos = stored?.[p.id];
    if (!pos) {
      const side = auto.l.includes(p) ? 'l' : 'r';
      pos = { side, t: (auto[side].indexOf(p) + 1) / (auto[side].length + 1) };
    }
    const pt = sidePoint(rect, pos.side, pos.t);
    return { portId: p.id, side: pos.side, t: pos.t, x: pt.x, y: pt.y, port: p };
  });
}

/**
 * Port squares on an ibd: those of each part's type, on the part's border,
 * and those of the context block, on the frame.
 * @returns {{portId, partId|null, symbolId|null, side, x, y, port}[]}
 */
export function portLayout(model, diagram, boxes, frame) {
  if (diagram.kind !== 'ibd') return [];
  const out = [];
  for (const s of diagram.symbols) {
    const part = model.elements[s.elementId];
    const box = boxes.get(s.id);
    if (!box || part?.kind !== 'property' || !part.typeId) continue;
    for (const p of placePorts(features(model, part.typeId, 'port'), box, s.ports, false)) out.push({ ...p, partId: part.id, symbolId: s.id });
  }
  for (const p of placePorts(features(model, diagram.contextId, 'port'), frame, diagram.framePorts, true)) out.push({ ...p, partId: null, symbolId: null });
  return out;
}

// ---------------------------------------------------------------- routing

const HIERARCHICAL = new Set(['composition', 'generalization', 'containment']);

function gaps(a, b) {
  return {
    below: b.y - (a.y + a.h), above: a.y - (b.y + b.h),
    right: b.x - (a.x + a.w), left: a.x - (b.x + b.w),
  };
}

/** Which side of each rectangle a path leaves from. */
function chooseSides(a, b, kind) {
  const g = gaps(a, b);
  const v = Math.max(g.below, g.above);
  const h = Math.max(g.right, g.left);
  const min = 24;
  const vertical = v >= min && (HIERARCHICAL.has(kind) || v >= h || h < min);
  if (vertical) return g.below >= g.above ? ['b', 't'] : ['t', 'b'];
  if (h >= min) return g.right >= g.left ? ['r', 'l'] : ['l', 'r'];
  return null;
}

/**
 * Route every path on a diagram. Ends sharing a side are spread along it,
 * except the tails of hierarchical edges, which merge into one trunk.
 * @returns {{pathId, refId, edge, points[], labelAt, selfLoop}[]}
 */
export function routeAll(model, diagram, boxes, ports = []) {
  const routes = [];
  for (const p of diagram.paths) {
    const edge = resolveEdge(model, p.refId);
    if (!edge) continue;
    const ends = [endRect(diagram, boxes, ports, edge.sourceId, edge.sourcePortId), endRect(diagram, boxes, ports, edge.targetId, edge.targetPortId)];
    if (!ends[0] || !ends[1]) continue;
    routes.push({ pathId: p.id, refId: p.refId, edge, ends, sides: null, slots: [0.5, 0.5] });
  }

  const bySide = new Map();
  for (const r of routes) {
    const [a, b] = r.ends;
    if (a.key === b.key) { r.selfLoop = true; continue; }
    r.sides = (a.fixedSide || b.fixedSide) ? [a.fixedSide || opposite(b.fixedSide), b.fixedSide || opposite(a.fixedSide)] : chooseSides(a.rect, b.rect, r.edge.kind);
    if (!r.sides) continue;
    r.ends.forEach((end, i) => {
      if (end.fixedSide) return;
      const merge = HIERARCHICAL.has(r.edge.kind) && (r.edge.kind === 'generalization' ? i === 1 : i === 0);
      const key = `${end.key}|${r.sides[i]}`;
      if (!bySide.has(key)) bySide.set(key, []);
      const other = r.ends[1 - i].rect;
      bySide.get(key).push({ r, i, merge: merge ? r.edge.kind : null, sort: 'tb'.includes(r.sides[i]) ? other.x + other.w / 2 : other.y + other.h / 2 });
    });
  }
  for (const list of bySide.values()) {
    list.sort((p, q) => p.sort - q.sort);
    const slots = [];
    for (const item of list) {
      let slot = item.merge && slots.find((s) => s.merge === item.merge);
      if (!slot) { slot = { merge: item.merge, items: [] }; slots.push(slot); }
      slot.items.push(item);
    }
    slots.forEach((slot, n) => { for (const it of slot.items) it.r.slots[it.i] = (n + 1) / (slots.length + 1); });
  }

  return routes.map((r) => {
    const [a, b] = r.ends;
    let points;
    if (r.selfLoop) {
      const q = a.rect;
      points = [{ x: q.x + q.w, y: q.y + q.h * 0.3 }, { x: q.x + q.w + 36, y: q.y + q.h * 0.3 }, { x: q.x + q.w + 36, y: q.y + q.h + 28 }, { x: q.x + q.w * 0.7, y: q.y + q.h + 28 }, { x: q.x + q.w * 0.7, y: q.y + q.h }];
    } else if (!r.sides) {
      points = clipStraight(a.rect, b.rect);
    } else {
      const p1 = a.point || sidePoint(a.rect, r.sides[0], r.slots[0]);
      const p2 = b.point || sidePoint(b.rect, r.sides[1], r.slots[1]);
      points = ortho(p1, r.sides[0], p2, r.sides[1]);
    }
    return { pathId: r.pathId, refId: r.refId, edge: r.edge, points, labelAt: labelPoint(points) };
  });
}

const opposite = (s) => ({ l: 'r', r: 'l', t: 'b', b: 't' }[s]);

function endRect(diagram, boxes, ports, elementId, portId) {
  if (portId) {
    const p = ports.find((x) => x.portId === portId && x.partId === (elementId || null));
    if (!p) return null;
    // A frame port's connector runs inward; a part port's runs outward.
    const side = p.partId ? p.side : opposite(p.side);
    return { key: `port:${p.partId}:${p.portId}`, rect: { x: p.x - 1, y: p.y - 1, w: 2, h: 2 }, point: { x: p.x, y: p.y }, fixedSide: side };
  }
  const s = symbolOf(diagram, elementId);
  const box = s && boxes.get(s.id);
  return box ? { key: s.id, rect: box } : null;
}

function ortho(p1, s1, p2, s2) {
  const horizontal = (s) => s === 'l' || s === 'r';
  const stub = 18;
  const out = (p, s) => ({ x: p.x + (s === 'r' ? stub : s === 'l' ? -stub : 0), y: p.y + (s === 'b' ? stub : s === 't' ? -stub : 0) });
  const o1 = out(p1, s1);
  const o2 = out(p2, s2);
  let pts;
  if (horizontal(s1) && horizontal(s2)) {
    const mx = s1 === s2 ? (s1 === 'r' ? Math.max(o1.x, o2.x) : Math.min(o1.x, o2.x)) : (o1.x + o2.x) / 2;
    pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
  } else if (!horizontal(s1) && !horizontal(s2)) {
    const my = s1 === s2 ? (s1 === 'b' ? Math.max(o1.y, o2.y) : Math.min(o1.y, o2.y)) : (o1.y + o2.y) / 2;
    pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
  } else if (horizontal(s1)) pts = [p1, { x: p2.x, y: p1.y }, p2];
  else pts = [p1, { x: p1.x, y: p2.y }, p2];
  return simplify(pts);
}

function simplify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && i < pts.length - 1) continue;
    out.push(b);
  }
  return out.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

function clipStraight(a, b) {
  const c1 = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const c2 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return simplify([clip(a, c1, c2), clip(b, c2, c1)]);
}
function clip(r, from, to) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  if (!dx && !dy) return from;
  const tx = dx ? (r.w / 2) / Math.abs(dx) : Infinity;
  const ty = dy ? (r.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty, 1);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function labelPoint(points) {
  let best = 0; let len = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
    if (l > len) { len = l; best = i; }
  }
  const a = points[best]; const b = points[best + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vertical: Math.abs(a.x - b.x) < 1 };
}

/** The text a path carries at its middle. */
export function edgeLabel(edge) {
  const st = REL_KINDS[edge.kind]?.stereotype;
  return [st ? `«${st}»` : '', edge.derived && edge.kind !== 'containment' ? '' : edge.label].filter(Boolean).join(' ');
}
