// Diagram → SVG markup. One renderer serves the screen and the exporters; the
// only difference is the colour set handed to `diagramCss`.

import { escapeXml, textWidth } from '../util.js';
import { REL_KINDS } from '../model/types.js';
import { measureAll, frameRect, frameTitle, portLayout, routeAll, edgeLabel, headHeight, PAD, LINE, PORT } from '../model/layout.js';

/** Everything the canvas needs to draw and hit-test one diagram. */
export function computeScene(model, diagram) {
  const boxes = measureAll(model, diagram);
  const frame = frameRect(diagram, boxes);
  const ports = portLayout(model, diagram, boxes, frame);
  const routes = routeAll(model, diagram, boxes, ports);
  return { boxes, frame, ports, routes, title: frameTitle(model, diagram) };
}

const SCREEN = {
  ink: 'var(--sc-text)', ink2: 'var(--sc-text-2)', ink3: 'var(--sc-text-3)', line: 'var(--sc-line-strong)',
  paper: 'var(--sc-sunken)', tab: 'var(--sc-panel)',
  a: 'var(--sc-accent)', aFill: 'rgb(var(--sc-accent-rgb) / 0.09)',
  b: 'var(--sc-accent-2)', bFill: 'rgb(var(--sc-accent-2-rgb) / 0.09)',
  c: 'var(--sc-app)', cFill: 'rgb(var(--sc-app-rgb) / 0.09)',
  n: 'var(--sc-text-3)', nFill: 'rgb(var(--sc-text-rgb, 200 210 220) / 0.05)',
  ui: 'var(--sc-font-ui)', display: 'var(--sc-font-display)', mono: 'var(--sc-font-mono)',
};
const PRINT = {
  ink: '#111418', ink2: '#2d343c', ink3: '#5b6470', line: '#111418',
  paper: '#ffffff', tab: '#ffffff',
  a: '#111418', aFill: '#f4f8fd', b: '#111418', bFill: '#fdf8ee', c: '#111418', cFill: '#fbf3f6', n: '#5b6470', nFill: '#fffbe6',
  ui: 'Helvetica, Arial, sans-serif', display: 'Helvetica, Arial, sans-serif', mono: 'Menlo, Consolas, monospace',
};

// Plain rules rather than custom properties: an exported SVG has to read
// correctly in viewers that do not resolve var().
const colour = (s, cls, c, f) => `${s}.d-sym${cls} .d-shape{fill:${f};stroke:${c}}\n${s}.d-sym${cls} .d-rule,${s}.d-sym${cls} .d-stick{stroke:${c}}`;

export function diagramCss(v, scope = '') {
  const s = scope ? `${scope} ` : '';
  return `
${s}text{font-family:${v.ui};font-size:12px;fill:${v.ink};dominant-baseline:auto}
${s}.d-mono{font-family:${v.mono};font-size:11px;fill:${v.ink2}}
${s}.d-name{font-family:${v.display};font-size:12.5px;font-weight:600;letter-spacing:.04em}
${s}.d-italic{font-style:italic}
${s}.d-comp{font-size:10.5px;font-style:italic;fill:${v.ink3}}
${s}.d-frame{fill:none;stroke:${v.line};stroke-width:1}
${s}.d-frame-tab{fill:${v.tab};stroke:${v.line};stroke-width:1}
${colour(s, '', v.a, v.aFill)}
${colour(s, '.c-b', v.b, v.bFill)}
${colour(s, '.c-c', v.c, v.cFill)}
${colour(s, '.c-n', v.n, v.nFill)}
${s}.d-shape{stroke-width:1.2}
${s}.d-shape.dashed{stroke-dasharray:6 4}
${s}.d-rule{stroke-width:.8;opacity:.55;fill:none}
${s}.d-stick{fill:none;stroke-width:1.5}
${s}.d-port{fill:${v.paper};stroke:${v.a};stroke-width:1.2}
${s}.d-port-dir{fill:${v.a};stroke:none}
${s}.d-line{fill:none;stroke:${v.ink2};stroke-width:1.2}
${s}.d-line.dashed{stroke-dasharray:6 4}
${s}.d-head{fill:none;stroke:${v.ink2};stroke-width:1.2}
${s}.d-head.filled{fill:${v.ink2}}
${s}.d-head.hollow{fill:${v.paper}}
${s}.d-hit{fill:none;stroke:transparent;stroke-width:12}
${s}.d-label-bg{fill:${v.paper};opacity:.85}
`;
}

export const SCREEN_CSS = diagramCss(SCREEN, '#canvas');
export const EXPORT_CSS = diagramCss(PRINT);

const COLOUR_CLASS = { requirement: 'c-b', testCase: 'c-b', actor: 'c-c', useCase: 'c-c', comment: 'c-n' };
const x = escapeXml;
const n = (v) => Math.round(v * 10) / 10;

function fit(text, width, size, mono) {
  if (textWidth(text, size, mono) <= width) return text;
  let s = String(text);
  while (s.length > 1 && textWidth(`${s}…`, size, mono) > width) s = s.slice(0, -1);
  return `${s}…`;
}

function symbolMarkup(model, box, selected, single) {
  const e = model.elements[box.elementId];
  const c = box.content;
  const { w, h } = box;
  const out = [];
  const name = (y, anchorX = w / 2, anchor = 'middle', max = w - PAD * 2) => `<text class="d-name${c.italic ? ' d-italic' : ''}" x="${n(anchorX)}" y="${y}" text-anchor="${anchor}">${x(fit(c.name, max, 12.5 * 1.12))}</text>`;

  switch (c.shape) {
    case 'actor': {
      const cx = w / 2;
      out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="transparent" stroke="none"/>`,
        `<circle class="d-stick" cx="${cx}" cy="12" r="9"/>`,
        `<path class="d-stick" d="M${cx} 21V50M${cx - 18} 31H${cx + 18}M${cx} 50L${cx - 15} 72M${cx} 50L${cx + 15} 72"/>`,
        name(h - 4, cx, 'middle', w + 40));
      break;
    }
    case 'usecase':
      out.push(`<ellipse class="d-shape" cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`, name(h / 2 + 4, w / 2, 'middle', w - 36));
      break;
    case 'subject':
      out.push(`<rect class="d-shape" width="${w}" height="${h}"/>`, name(20));
      break;
    case 'package': {
      const tw = Math.min(w - 20, Math.max(70, textWidth(c.name, 14) + 24));
      out.push(`<path class="d-shape" d="M0 0H${n(tw)}V20H0Z"/>`, `<rect class="d-shape" y="20" width="${w}" height="${h - 20}"/>`, name(14, 8, 'start', tw - 12));
      break;
    }
    case 'note': {
      out.push(`<path class="d-shape" d="M0 0H${w - 12}L${w} 12V${h}H0Z"/><path class="d-rule" d="M${w - 12} 0V12H${w}"/>`);
      c.compartments[0].lines.forEach((l, i) => out.push(`<text x="${PAD}" y="${PAD + 12 + i * LINE}">${x(l)}</text>`));
      break;
    }
    case 'part':
      out.push(`<rect class="d-shape${c.dashed ? ' dashed' : ''}" width="${w}" height="${h}"/>`, name(22));
      break;
    default: {
      out.push(`<rect class="d-shape" width="${w}" height="${h}"/>`);
      let y = 8;
      if (c.stereo) { y += 11; out.push(`<text class="d-mono" x="${w / 2}" y="${y}" text-anchor="middle">${x(c.stereo)}</text>`); y += 3; }
      out.push(name(y + 14));
      y = headHeight(c);
      for (const comp of c.compartments) {
        out.push(`<path class="d-rule" d="M0 ${y}H${w}"/>`);
        y += 6;
        if (comp.title) { out.push(`<text class="d-comp" x="${w / 2}" y="${y + 9}" text-anchor="middle">${x(comp.title)}</text>`); y += 13; }
        for (const l of comp.lines) { out.push(`<text x="${PAD}" y="${y + 12}">${x(fit(l, w - PAD * 2, 12))}</text>`); y += LINE; }
        y += 4;
      }
    }
  }
  if (selected) {
    out.push(`<rect class="d-selbox" x="-4" y="-4" width="${w + 8}" height="${h + 8}"/>`);
    if (single) for (const [k, hx, hy] of [['nw', 0, 0], ['ne', w, 0], ['sw', 0, h], ['se', w, h]]) out.push(`<rect class="d-handle" data-handle="${k}" x="${hx - 4}" y="${hy - 4}" width="8" height="8"/>`);
  }
  return `<g class="d-sym ${COLOUR_CLASS[e.kind] || ''}${selected ? ' is-sel' : ''}" data-sym="${box.id}" transform="translate(${box.x} ${box.y})">${out.join('')}</g>`;
}

function headMarkup(type, tip, from) {
  if (!type || type === 'none') return '';
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x) * 180 / Math.PI;
  const t = `transform="translate(${tip.x} ${tip.y}) rotate(${n(ang)})"`;
  switch (type) {
    case 'open': return `<path class="d-head" ${t} d="M-11 -5L0 0L-11 5"/>`;
    case 'triangle': return `<path class="d-head hollow" ${t} d="M-13 -7L0 0L-13 7Z"/>`;
    case 'diamond': return `<path class="d-head filled" ${t} d="M0 0L-9 -5L-18 0L-9 5Z"/>`;
    case 'diamond-open': return `<path class="d-head hollow" ${t} d="M0 0L-9 -5L-18 0L-9 5Z"/>`;
    case 'crosshair': return `<g ${t}><circle class="d-head hollow" cx="-7" cy="0" r="7"/><path class="d-head" d="M-14 0H0M-7 -7V7"/></g>`;
    default: return '';
  }
}

function pathMarkup(route, selected) {
  const k = REL_KINDS[route.edge.kind];
  const pts = route.points;
  if (pts.length < 2) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
  const out = [`<path class="d-hit" d="${d}"/>`, `<path class="d-line${k.line === 'dashed' ? ' dashed' : ''}" d="${d}"/>`];
  out.push(headMarkup(k.head, pts[pts.length - 1], pts[pts.length - 2]));
  out.push(headMarkup(k.tail, pts[0], pts[1]));

  const label = edgeLabel(route.edge);
  if (label) {
    const lw = textWidth(label, 11, true) + 8;
    const at = route.labelAt;
    const lx = at.vertical ? at.x + 6 + lw / 2 : at.x;
    const ly = at.vertical ? at.y + 4 : at.y - 7;
    out.push(`<rect class="d-label-bg" x="${n(lx - lw / 2)}" y="${n(ly - 11)}" width="${n(lw)}" height="15"/>`,
      `<text class="d-mono" x="${n(lx)}" y="${n(ly)}" text-anchor="middle">${x(label)}</text>`);
  }
  if (route.edge.derived && route.edge.kind !== 'containment') {
    // role name and multiplicity sit by the part end
    const tip = pts[pts.length - 1]; const prev = pts[pts.length - 2];
    const vertical = Math.abs(tip.x - prev.x) < 1;
    const back = 16;
    const bx = vertical ? tip.x : tip.x + (prev.x < tip.x ? -back : back);
    const by = vertical ? tip.y + (prev.y < tip.y ? -back : back + 8) : tip.y;
    const role = route.edge.label;
    const mult = route.edge.multiplicity;
    if (vertical) {
      if (role) out.push(`<text class="d-mono" x="${bx + 6}" y="${by}">${x(role)}</text>`);
      if (mult) out.push(`<text class="d-mono" x="${bx - 6}" y="${by}" text-anchor="end">${x(mult)}</text>`);
    } else {
      const anchor = prev.x < tip.x ? 'end' : 'start';
      if (role) out.push(`<text class="d-mono" x="${bx}" y="${by - 6}" text-anchor="${anchor}">${x(role)}</text>`);
      if (mult) out.push(`<text class="d-mono" x="${bx}" y="${by + 14}" text-anchor="${anchor}">${x(mult)}</text>`);
    }
  }
  return `<g class="d-path${selected ? ' is-sel' : ''}" data-path="${route.pathId}">${out.join('')}</g>`;
}

function portMarkup(p, selected) {
  const half = PORT / 2;
  const label = p.port.name || '';
  const inside = p.partId ? { l: 1, r: -1, t: 0, b: 0 }[p.side] : { l: 1, r: -1, t: 0, b: 0 }[p.side];
  let tx = p.x + inside * (half + 4);
  let ty = p.y + 4;
  let anchor = inside > 0 ? 'start' : 'end';
  if (p.side === 't' || p.side === 'b') { tx = p.x; ty = p.y + (p.side === 't' ? half + 13 : -half - 5); anchor = 'middle'; }
  const dir = p.port.direction;
  let arrow = '';
  if (dir === 'in' || dir === 'out') {
    // arrow points into the part for `in`, out of it for `out`
    const inwardAngle = { l: 0, r: 180, t: 90, b: 270 }[p.side];
    const ang = dir === 'in' ? inwardAngle : inwardAngle + 180;
    arrow = `<path class="d-port-dir" transform="translate(${p.x} ${p.y}) rotate(${ang})" d="M-3 -4L4 0L-3 4Z"/>`;
  }
  return `<g class="d-portg${selected ? ' is-sel' : ''}" data-port="${p.partId || ''}|${p.portId}">`
    + `<rect class="d-port" x="${n(p.x - half)}" y="${n(p.y - half)}" width="${PORT}" height="${PORT}"/>${arrow}`
    + `<text class="d-mono" x="${n(tx)}" y="${n(ty)}" text-anchor="${anchor}">${x(label)}</text></g>`;
}

/**
 * @param {{symbolIds?: string[], pathId?: string, portKey?: string}} selection
 * @returns {string} SVG markup (no outer <svg>)
 */
export function renderScene(model, scene, selection = {}) {
  const { frame } = scene;
  const tabW = textWidth(scene.title, 11, true) + 28;
  const selSyms = new Set(selection.symbolIds || []);
  const parts = [
    `<rect class="d-frame" x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}"/>`,
    `<path class="d-frame-tab" d="M${frame.x} ${frame.y}h${n(tabW)}v14l-10 10H${frame.x}z"/>`,
    `<text class="d-mono" x="${frame.x + 10}" y="${frame.y + 16}">${x(scene.title)}</text>`,
  ];
  const symbols = []; const front = [];
  const backdrop = (box) => box.content.shape === 'subject' || box.content.shape === 'package';
  for (const box of scene.boxes.values()) (selSyms.has(box.id) && !backdrop(box) ? front : symbols).push(symbolMarkup(model, box, selSyms.has(box.id), selSyms.size === 1));
  // Paths go above unselected symbols so a line crossing a use-case subject stays visible.
  parts.push(`<g class="d-symbols">${symbols.join('')}</g>`);
  parts.push(`<g class="d-paths">${scene.routes.map((r) => pathMarkup(r, selection.pathId === r.pathId)).join('')}</g>`);
  parts.push(front.join(''));
  parts.push(`<g class="d-ports">${scene.ports.map((p) => portMarkup(p, selection.portKey === `${p.partId || ''}|${p.portId}`)).join('')}</g>`);
  return parts.join('');
}

/** A standalone, print-coloured SVG document of one diagram. */
export function diagramToSvgString(model, diagram) {
  const scene = computeScene(model, diagram);
  const f = scene.frame;
  const m = 16;
  const vb = [f.x - m, f.y - m, f.w + m * 2, f.h + m * 2];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">`
    + `<style>${EXPORT_CSS}</style><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>${renderScene(model, scene)}</svg>`;
}

export function diagramSize(model, diagram) {
  const f = computeScene(model, diagram).frame;
  return { w: f.w + 32, h: f.h + 32 };
}
