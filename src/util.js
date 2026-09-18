// Small shared helpers. Nothing here knows about SysML.

import { hosted, saveViaHost } from './host.js';

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const snap = (v, grid = 10) => Math.round(v / grid) * grid;

export function deepClone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

function build(node, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) node.style.setProperty(p, val); else node.style[p] = val; }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && !(node instanceof SVGElement) && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** `el('div', { class: 'x', onclick }, child, 'text')` */
export function el(tag, attrs = {}, ...children) {
  return build(document.createElement(tag), attrs, children);
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function downloadBlob(blob, filename) {
  // A web view has no downloads folder; the macOS app shows a save panel instead.
  if (hosted) { saveViaHost(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function slugify(s) {
  return String(s || 'untitled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

/**
 * Approximate rendered width. The diagram sizes its own symbols, and the same
 * numbers have to come out in the browser, in an exported SVG and under Node
 * (tests, a future CLI), so this never touches the DOM.
 */
export function textWidth(text, fontSize = 12, mono = false) {
  let w = 0;
  for (const ch of String(text)) {
    if (mono) w += 0.6; // wide enough for the Menlo / Consolas fallback in exports
    else if ('il.,:;|!\'j'.includes(ch)) w += 0.3;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch === ' ') w += 0.3;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.56;
  }
  return w * fontSize;
}

/** Greedy word wrap against `textWidth`. */
export function wrapText(text, width, fontSize = 12, maxLines = 12) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, fontSize) > width) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{0,2}$/, '')}…`;
  }
  return lines;
}

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

// ---------------------------------------------------------------------------
// A small XML reader. DOMParser only exists in the browser; XMI import is
// also exercised from Node, so it parses into plain objects instead:
//   { name, local, attrs: { 'xmi:id': … }, children: [], text }
// ---------------------------------------------------------------------------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

export function parseXml(src) {
  const root = { name: '#doc', local: '#doc', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length < 2 || top.name !== m[2]) throw new Error(`XML is not well formed: unexpected </${m[2]}>.`);
      stack.pop();
    } else if (m[3]) {
      const node = { name: m[3], local: m[3].split(':').pop(), attrs: {}, children: [], text: '' };
      const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[4]))) node.attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] && m[6].trim()) top.text += unescapeXml(m[6]);
  }
  if (stack.length !== 1) throw new Error(`XML is not well formed: <${stack[stack.length - 1].name}> is never closed.`);
  if (!root.children.length) throw new Error('The file holds no XML element.');
  return root.children[0];
}

/** Attribute by local name, ignoring its namespace prefix (`xmi:id` ≡ `id`). */
export function xattr(node, local) {
  if (local in node.attrs) return node.attrs[local];
  for (const k of Object.keys(node.attrs)) if (k.split(':').pop() === local) return node.attrs[k];
  return undefined;
}
