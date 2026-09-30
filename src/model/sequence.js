// Sequence diagram geometry. Pure functions of the model, like layout.js:
// where each lifeline stands, where each message crosses, and how far each
// combined fragment reaches. Time runs down; the only thing a symbol stores
// for a lifeline is its x.

import { textWidth } from '../util.js';
import { MESSAGE_KINDS } from './types.js';
import { messagesOf, lifelinesOf, fragmentsOf, featureLabel } from './model.js';

export const SD = { top: 70, headH: 40, headMinW: 110, gap: 30, step: 42, selfW: 40, foot: 50, execW: 10, fragPad: 30 };

/** Everything the canvas needs to draw and hit-test one sequence diagram. */
export function sequenceScene(model, diagram) {
  const ctx = model.elements[diagram.contextId];
  const boxes = new Map();
  const lifelines = [];
  const drawn = new Map(); // lifeline id → lifeline record
  const syms = [...diagram.symbols].filter((s) => model.elements[s.elementId]?.kind === 'lifeline').sort((a, b) => a.x - b.x);
  const msgs = ctx ? messagesOf(model, ctx.id).filter((m) => syms.some((s) => s.elementId === m.fromId) && syms.some((s) => s.elementId === m.toId)) : [];
  const rowY = (i) => SD.top + SD.headH + SD.gap + i * SD.step;
  const bodyBottom = rowY(Math.max(msgs.length, 1)) + SD.foot;

  let edge = -Infinity;
  for (const s of syms) {
    const e = model.elements[s.elementId];
    const name = featureLabel(model, e);
    const w = Math.max(s.w || 0, SD.headMinW, Math.ceil(textWidth(name, 12.5) * 1.12 + 24));
    // Heads never overlap: a wide name pushes what stands to its right along, on screen only.
    const x = Math.max(s.x, edge + 24);
    edge = x + w;
    const box = { id: s.id, elementId: e.id, x, y: SD.top, w, h: SD.headH, minW: SD.headMinW, minH: SD.headH, content: { shape: 'lifeline', name, stereo: '', compartments: [], italic: false } };
    boxes.set(s.id, box);
    const cx = x + w / 2;
    const ll = { id: e.id, symbolId: s.id, name, cx, top: SD.top + SD.headH, bottom: bodyBottom, createdAt: null, destroyedAt: null, box };
    lifelines.push(ll);
    drawn.set(e.id, ll);
  }

  const messages = msgs.map((m, i) => {
    const from = drawn.get(m.fromId); const to = drawn.get(m.toId);
    const y = rowY(i);
    const self = from === to;
    const kind = MESSAGE_KINDS[m.msgKind] || MESSAGE_KINDS.sync;
    if (m.msgKind === 'create') { to.createdAt = y; to.box.y = y - SD.headH / 2; to.top = y + SD.headH / 2; }
    if (m.msgKind === 'destroy') to.destroyedAt = y;
    return { id: m.id, seq: m.seq, y, x1: from.cx, x2: to.cx, self, kind: m.msgKind || 'sync', line: kind.line, head: kind.head,
      label: `${m.seq}: ${m.name || ''}`.trim(), fromId: m.fromId, toId: m.toId };
  });
  // A created lifeline's head sits on its create message; nothing of it is drawn above.
  for (const ll of lifelines) if (ll.createdAt != null) { ll.top = ll.createdAt + SD.headH / 2; }

  const seqY = (seq) => { const m = messages.find((x) => x.seq === seq); return m ? m.y : rowY(Math.max(0, seq - 1)); };
  const fragments = ctx ? fragmentsOf(model, ctx.id).map((f) => {
    const covered = (f.coveredIds || []).map((id) => drawn.get(id)).filter(Boolean);
    const xs = (covered.length ? covered : lifelines).map((l) => l.cx);
    if (!xs.length) return null;
    const x = Math.min(...xs) - SD.fragPad - 30; const w = Math.max(...xs) - Math.min(...xs) + (SD.fragPad + 30) * 2;
    const y = seqY(f.fromSeq) - SD.fragPad; const h = seqY(Math.max(f.toSeq, f.fromSeq)) + SD.fragPad - y;
    const operands = (f.operands || []).map((op, i) => ({ guard: op.guard || '', y: i === 0 ? y : seqY(op.fromSeq || f.fromSeq) - SD.step / 2 }));
    return { id: f.id, operator: f.operator, x, y, w, h, operands, level: covered.length || lifelines.length };
  }).filter(Boolean).sort((a, b) => b.w * b.h - a.w * a.h) : [];

  const right = Math.max(...lifelines.map((l) => l.box.x + l.box.w), ...fragments.map((f) => f.x + f.w), 200);
  const frame = { x: 20, y: 20, w: Math.max(820, right + 40 - 20), h: Math.max(500, bodyBottom + 20) };
  const title = `sd [interaction] ${ctx?.name || ''} [${diagram.name}]`;
  return { kind: 'sd', boxes, lifelines, messages, fragments, frame, title, ports: [], routes: [], rowY, rows: msgs.length };
}

/** The message position a y on the canvas is nearest to, 1-based, for dropping a dragged message. */
export function seqAtY(scene, y) {
  const first = scene.rowY(0);
  return Math.max(1, Math.min(scene.rows + 1, Math.round((y - first) / SD.step) + 1));
}
