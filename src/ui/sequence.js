// Sequence diagram → SVG markup, with the same classes render.js uses so the
// screen and the exports share one stylesheet.

import { escapeXml, textWidth } from '../util.js';
import { SD } from '../model/sequence.js';

const x = escapeXml;
const n = (v) => Math.round(v * 10) / 10;

function head(kind, tip, from) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x) * 180 / Math.PI;
  const t = `transform="translate(${n(tip.x)} ${n(tip.y)}) rotate(${n(ang)})"`;
  return kind === 'filled' ? `<path class="d-head filled" ${t} d="M-12 -5L0 0L-12 5Z"/>` : `<path class="d-head" ${t} d="M-11 -5L0 0L-11 5"/>`;
}

export function renderSequence(model, scene, selection = {}) {
  const selSyms = new Set(selection.symbolIds || []);
  const out = [];
  for (const f of scene.fragments) {
    const sel = selection.fragId === f.id ? ' is-sel' : '';
    const tabW = textWidth(f.operator, 11, true) + 22;
    out.push(`<g class="d-frag${sel}" data-frag="${f.id}"><rect class="d-frag-box" x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}"/>`
      + `<path class="d-frag-tab" d="M${n(f.x)} ${n(f.y)}h${n(tabW)}v14l-8 8H${n(f.x)}z"/><text class="d-mono" x="${n(f.x + 6)}" y="${n(f.y + 15)}">${x(f.operator)}</text>`);
    f.operands.forEach((op, i) => {
      if (i > 0) out.push(`<path class="d-frag-sep" d="M${n(f.x)} ${n(op.y)}H${n(f.x + f.w)}"/>`);
      if (op.guard) out.push(`<text class="d-mono" x="${n(f.x + (i === 0 ? tabW + 8 : 8))}" y="${n(op.y + 15)}">[${x(op.guard)}]</text>`);
    });
    out.push('</g>');
  }
  for (const l of scene.lifelines) {
    const b = l.box;
    const sel = selSyms.has(b.id);
    const end = l.destroyedAt ?? l.bottom;
    out.push(`<g class="d-sym${sel ? ' is-sel' : ''}" data-sym="${b.id}">`
      + `<path class="d-lifeline" d="M${n(l.cx)} ${n(l.top)}V${n(end)}"/>`
      + (l.destroyedAt != null ? `<path class="d-stick" d="M${n(l.cx - 9)} ${n(end - 9)}L${n(l.cx + 9)} ${n(end + 9)}M${n(l.cx + 9)} ${n(end - 9)}L${n(l.cx - 9)} ${n(end + 9)}"/>` : '')
      + `<g transform="translate(${n(b.x)} ${n(b.y)})"><rect class="d-shape" width="${n(b.w)}" height="${n(b.h)}"/>`
      + `<text class="d-name" x="${n(b.w / 2)}" y="${n(b.h / 2 + 5)}" text-anchor="middle" text-decoration="underline">${x(l.name)}</text>`
      + (sel ? `<rect class="d-selbox" x="-4" y="-4" width="${n(b.w + 8)}" height="${n(b.h + 8)}"/>` : '') + '</g></g>');
  }
  // Execution bars: a called lifeline is active from its call to the matching reply, or one row.
  for (const m of scene.messages) {
    if (m.kind !== 'sync') continue;
    const to = scene.lifelines.find((l) => l.id === m.toId);
    const reply = scene.messages.find((r) => r.seq > m.seq && r.kind === 'reply' && r.fromId === m.toId && r.toId === m.fromId);
    const bottom = reply ? reply.y : m.y + SD.step * 0.6;
    out.push(`<rect class="d-exec" x="${n(to.cx - SD.execW / 2)}" y="${n(m.y)}" width="${SD.execW}" height="${n(bottom - m.y)}"/>`);
  }
  for (const m of scene.messages) {
    const sel = selection.msgId === m.id ? ' is-sel' : '';
    const dash = m.line === 'dashed' ? ' dashed' : '';
    let d; let tip; let from; let lx; let anchor = 'middle';
    if (m.self) {
      d = `M${n(m.x1)} ${n(m.y)}H${n(m.x1 + SD.selfW)}V${n(m.y + SD.step / 2)}H${n(m.x1 + 6)}`;
      tip = { x: m.x1 + 6, y: m.y + SD.step / 2 }; from = { x: m.x1 + SD.selfW, y: tip.y };
      lx = m.x1 + SD.selfW + 8; anchor = 'start';
    } else {
      const dir = m.x2 > m.x1 ? 1 : -1;
      const x2 = m.kind === 'create' ? m.x2 - dir * (scene.lifelines.find((l) => l.id === m.toId).box.w / 2) : m.x2 - dir * (SD.execW / 2) * (m.kind === 'sync' ? 1 : 0);
      d = `M${n(m.x1)} ${n(m.y)}H${n(x2)}`;
      tip = { x: x2, y: m.y }; from = { x: m.x1, y: m.y };
      lx = (m.x1 + x2) / 2;
    }
    out.push(`<g class="d-msg${sel}" data-msg="${m.id}"><path class="d-hit" d="${d}"/><path class="d-line${dash}" d="${d}"/>${head(m.head, tip, from)}`
      + `<text class="d-mono" x="${n(lx)}" y="${n(m.y - 6)}" text-anchor="${anchor}">${x(m.label)}</text></g>`);
  }
  return out.join('');
}
