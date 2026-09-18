// The diagram canvas: draws the current diagram and turns pointer input into
// selection, moves, resizes, new elements and new paths.

import { clamp, snap } from '../util.js';
import { store, set, emit, tryCommit, beginDrag, dragStep, endDrag, modelRevision, selectElement } from '../state/store.js';
import {
  currentDiagram, createOnDiagram, createPort, dropOnDiagram, connect, hint,
  removeSelectionFromDiagram, deleteSelectionFromModel, updateElement, createDiagram,
} from '../state/actions.js';
import { computeScene, renderScene } from './render.js';
import { projectToBorder } from '../model/layout.js';
import { elementsOfKind, getSymbol, resolveEdge, addElement, owningPackage } from '../model/model.js';
import { REL_KINDS } from '../model/types.js';
import { pickOrCreate, showMenu, modalOpen } from './dialog.js';

export const DRAG_MIME = 'application/x-sysml-element';

let svg; let viewport; let content; let overlay; let wrap; let editor;
let scene = null;
let sceneKey = '';
let drag = null;
let lastDown = null;

export function initCanvas() {
  wrap = document.getElementById('canvas-wrap');
  svg = document.getElementById('canvas');
  editor = document.getElementById('inline-editor');
  svg.innerHTML = '<g id="viewport"><g id="d-content"></g><g id="d-overlay"></g></g>';
  viewport = svg.querySelector('#viewport');
  content = svg.querySelector('#d-content');
  overlay = svg.querySelector('#d-overlay');

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', onContextMenu);
  wrap.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  wrap.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id) return;
    e.preventDefault();
    const p = toModel(e);
    dropOnDiagram(id, snap(p.x - 60), snap(p.y - 20));
  });
  // Until the user pans or zooms, a diagram stays fitted to the pane as the window settles or resizes.
  new ResizeObserver(() => {
    const d = currentDiagram();
    if (d?.symbols && store.ui.views[d.id]?.auto) store.ui.views[d.id] = fitView(d);
    drawCanvas();
    renderStatusSoon();
  }).observe(wrap);
}

// ---------------------------------------------------------------- view

const renderStatusSoon = () => emit({ light: true }); // the status line shows the zoom

function view() {
  const d = currentDiagram();
  if (!d) return { scale: 1, tx: 0, ty: 0 };
  if (!store.ui.views[d.id]) store.ui.views[d.id] = fitView(d);
  return store.ui.views[d.id];
}

function fitView(d) {
  const f = computeScene(store.model, d).frame;
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return { scale: 1, tx: 20 - f.x, ty: 20 - f.y, auto: true };
  const scale = clamp(Math.min((r.width - 40) / f.w, (r.height - 40) / f.h), 0.3, 1);
  return { scale, tx: (r.width - f.w * scale) / 2 - f.x * scale, ty: (r.height - f.h * scale) / 2 - f.y * scale, auto: true };
}

export function zoomFit() { const d = currentDiagram(); if (d) { store.ui.views[d.id] = fitView(d); emit(); } }
export function zoomBy(factor, cx, cy) {
  const v = view();
  const r = wrap.getBoundingClientRect();
  const px = cx ?? r.width / 2; const py = cy ?? r.height / 2;
  const scale = clamp(v.scale * factor, 0.2, 3);
  v.tx = px - (px - v.tx) * (scale / v.scale);
  v.ty = py - (py - v.ty) * (scale / v.scale);
  v.scale = scale;
  v.auto = false;
  emit({ light: true });
}

function toModel(e) {
  const r = svg.getBoundingClientRect();
  const v = view();
  return { x: (e.clientX - r.left - v.tx) / v.scale, y: (e.clientY - r.top - v.ty) / v.scale };
}

// ---------------------------------------------------------------- draw

export function drawCanvas() {
  const d = currentDiagram();
  const isCanvas = !!d?.symbols;
  wrap.hidden = !isCanvas;
  if (!isCanvas) { scene = null; return; }
  const key = `${d.id}|${modelRevision()}`;
  if (key !== sceneKey || !scene) { scene = computeScene(store.model, d); sceneKey = key; }
  const v = view();
  viewport.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
  const sel = store.ui.selection || {};
  content.innerHTML = renderScene(store.model, scene, { symbolIds: sel.symbolIds, pathId: sel.pathId, portKey: sel.portKey });
  drawOverlay();
  svg.dataset.tool = store.ui.tool.split(':')[0];
}

function drawOverlay() {
  let html = '';
  const p = store.ui.pending;
  if (p?.cursor) html += `<path class="d-rubber" d="M${p.at.x} ${p.at.y}L${p.cursor.x} ${p.cursor.y}"/>`;
  if (drag?.type === 'marquee') {
    const m = drag.rect;
    html += `<rect class="d-marquee" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"/>`;
  }
  overlay.innerHTML = html;
}

// ---------------------------------------------------------------- hit testing

function hit(e) {
  // Pointer capture retargets click and dblclick to the <svg>, so ask the document instead.
  const t = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  const handle = t.closest?.('[data-handle]');
  const port = t.closest?.('[data-port]');
  const sym = t.closest?.('[data-sym]');
  const path = t.closest?.('[data-path]');
  if (handle && sym) return { type: 'handle', handle: handle.dataset.handle, symbolId: sym.dataset.sym };
  if (port) { const [partId, portId] = port.dataset.port.split('|'); return { type: 'port', partId: partId || null, portId, key: port.dataset.port }; }
  if (sym) return { type: 'symbol', symbolId: sym.dataset.sym };
  if (path) return { type: 'path', pathId: path.dataset.path };
  return { type: 'none' };
}

const boxOf = (symbolId) => scene?.boxes.get(symbolId);

// ---------------------------------------------------------------- pointer

function onPointerDown(e) {
  if (e.button === 2 || modalOpen()) return;
  commitInlineEdit();
  const d = currentDiagram();
  if (!d?.symbols) return;
  const h = hit(e);
  const p = toModel(e);
  const [toolType, toolKind] = store.ui.tool.split(':');
  svg.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.altKey) { startPan(e); return; }

  if (toolType === 'node') { placeNode(toolKind, h, p); return; }
  if (toolType === 'path') { pathClick(toolKind, h, p); return; }

  if (h.type === 'handle') {
    const box = boxOf(h.symbolId);
    beginDrag();
    drag = { type: 'resize', handle: h.handle, symbolId: h.symbolId, start: p, box: { ...box }, moved: false };
    return;
  }
  if (h.type === 'port') {
    const port = scene.ports.find((x) => `${x.partId || ''}|${x.portId}` === h.key);
    store.ui.selection = { elementId: h.portId, portId: h.portId, portKey: h.key };
    beginDrag();
    drag = { type: 'port', port, moved: false };
    emit();
    return;
  }
  if (h.type === 'symbol') {
    // Selecting redraws the canvas, which replaces the node under the pointer,
    // so the browser never fires `dblclick` here. Pair the presses ourselves.
    const now = performance.now();
    const twice = lastDown && lastDown.symbolId === h.symbolId && now - lastDown.t < 450;
    lastDown = { symbolId: h.symbolId, t: now };
    if (twice) { lastDown = null; svg.releasePointerCapture(e.pointerId); beginInlineEdit(h.symbolId); return; }
    const sym = getSymbol(d, h.symbolId);
    const cur = store.ui.selection?.symbolIds || [];
    let ids;
    if (e.shiftKey) ids = cur.includes(h.symbolId) ? cur.filter((x) => x !== h.symbolId) : [...cur, h.symbolId];
    else ids = cur.includes(h.symbolId) ? cur : [h.symbolId];
    store.ui.selection = ids.length ? { elementId: ids.length === 1 ? getSymbol(d, ids[0]).elementId : sym.elementId, symbolIds: ids } : null;
    beginDrag();
    drag = { type: 'move', start: p, ids, origin: new Map(ids.map((id) => { const s = getSymbol(d, id); return [id, { x: s.x, y: s.y }]; })), moved: false };
    emit();
    return;
  }
  if (h.type === 'path') {
    const path = d.paths.find((x) => x.id === h.pathId);
    const edge = resolveEdge(store.model, path.refId);
    store.ui.selection = { pathId: path.id, refId: path.refId, ...(edge?.derived && edge.kind !== 'containment' ? { elementId: path.refId } : {}) };
    emit();
    return;
  }
  if (e.shiftKey) { drag = { type: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } }; return; }
  startPan(e);
  drag.clearOnClick = true;
}

function startPan(e) {
  const v = view();
  drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty, moved: false };
}

function onPointerMove(e) {
  const p = toModel(e);
  if (store.ui.pending) { store.ui.pending.cursor = p; drawOverlay(); }
  if (!drag) return;
  const d = currentDiagram();
  switch (drag.type) {
    case 'pan': {
      const dx = e.clientX - drag.sx; const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const v = view();
      v.auto = false;
      v.tx = drag.tx + dx; v.ty = drag.ty + dy;
      viewport.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
      break;
    }
    case 'move': {
      const dx = p.x - drag.start.x; const dy = p.y - drag.start.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      dragStep((m) => {
        for (const id of drag.ids) {
          const s = getSymbol(m.diagrams[d.id], id); const o = drag.origin.get(id);
          s.x = snap(o.x + dx); s.y = snap(o.y + dy);
        }
      });
      break;
    }
    case 'resize': {
      const dx = p.x - drag.start.x; const dy = p.y - drag.start.y;
      drag.moved = true;
      const b = drag.box;
      dragStep((m) => {
        const s = getSymbol(m.diagrams[d.id], drag.symbolId);
        const west = drag.handle.includes('w'); const north = drag.handle.includes('n');
        const w = Math.max(b.minW, snap(b.w + (west ? -dx : dx)));
        const h = Math.max(b.minH, snap(b.h + (north ? -dy : dy)));
        s.w = w; s.h = h;
        if (west) s.x = b.x + b.w - w;
        if (north) s.y = b.y + b.h - h;
      });
      break;
    }
    case 'port': {
      const rect = drag.port.symbolId ? boxOf(drag.port.symbolId) : scene.frame;
      const pos = projectToBorder(rect, p.x, p.y);
      drag.moved = true;
      dragStep((m) => {
        const dg = m.diagrams[d.id];
        if (drag.port.symbolId) { const s = getSymbol(dg, drag.port.symbolId); s.ports = { ...(s.ports || {}), [drag.port.portId]: pos }; }
        else dg.framePorts = { ...(dg.framePorts || {}), [drag.port.portId]: pos };
      });
      break;
    }
    case 'marquee': {
      const s = drag.start;
      drag.rect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
      drawOverlay();
      break;
    }
    default:
  }
}

function onPointerUp() {
  if (!drag) return;
  const dr = drag;
  drag = null;
  const d = currentDiagram();
  if (dr.type === 'move') endDrag('Move', dr.moved);
  else if (dr.type === 'resize') endDrag('Resize', dr.moved);
  else if (dr.type === 'port') endDrag('Move port', dr.moved);
  else if (dr.type === 'marquee') {
    const r = dr.rect;
    const ids = [...scene.boxes.values()].filter((b) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h).map((b) => b.id);
    store.ui.selection = ids.length ? { elementId: getSymbol(d, ids[0]).elementId, symbolIds: ids } : null;
    emit();
  } else if (dr.type === 'pan' && !dr.moved && dr.clearOnClick) {
    store.ui.selection = null;
    emit();
  }
}

// ---------------------------------------------------------------- tools

async function placeNode(kind, h, p) {
  const d = currentDiagram();
  const x = snap(p.x - 60); const y = snap(p.y - 20);
  if (kind === 'port') {
    if (h.type === 'symbol') createPort(store.model.elements[store.model.elements[getSymbol(d, h.symbolId).elementId]?.typeId]?.id);
    else createPort(d.contextId);
    return;
  }
  if (kind === 'part' || kind === 'refpart') {
    const blocks = elementsOfKind(store.model, 'block').filter((b) => b.id !== d.contextId);
    const choice = await pickOrCreate(kind === 'part' ? 'New part' : 'New reference', 'Which block is it an instance of?', blocks.map((b) => ({ value: b.id, label: b.name })), 'New block');
    if (!choice) { set({ tool: 'select' }); return; }
    let typeId = choice.value;
    if (choice.create) {
      const blk = tryCommit('Add block', (m) => addElement(m, 'block', owningPackage(m, d.contextId).id, { name: choice.create }));
      typeId = blk?.id;
    }
    createOnDiagram(kind, x, y, { typeId });
    return;
  }
  createOnDiagram(kind, x, y);
}

function endOf(h) {
  const d = currentDiagram();
  if (h.type === 'port') return { elementId: h.partId, portId: h.portId };
  if (h.type === 'symbol' || h.type === 'handle') return { elementId: getSymbol(d, h.symbolId).elementId };
  return null;
}

function pathClick(kind, h, p) {
  const end = endOf(h);
  const pending = store.ui.pending;
  if (!end) {
    if (pending) set({ pending: null, hint: '' });
    else hint(`${REL_KINDS[kind].label}: click the element it starts from.`);
    return;
  }
  if (kind === 'connector' && h.type === 'symbol' && store.model.elements[end.elementId]?.kind !== 'property') { hint('A connector joins parts and ports.'); return; }
  if (!pending) {
    set({ pending: { from: end, at: p, cursor: p }, hint: `${REL_KINDS[kind].label}: now click the element it ends on. Esc cancels.` });
    return;
  }
  connect(kind, pending.from, end);
  if (store.ui.pending) set({ pending: null });
  set({ tool: 'select', hint: '' });
}

// ---------------------------------------------------------------- rename in place

function beginInlineEdit(symbolId) {
  const box = boxOf(symbolId);
  if (!box) return;
  const element = store.model.elements[box.elementId];
  const field = element.kind === 'comment' ? 'body' : 'name';
  const v = view();
  const top = box.content.shape === 'actor' ? box.y + box.h - 18 : box.content.shape === 'usecase' ? box.y + box.h / 2 - 12 : box.y + (box.content.stereo ? 20 : 6);
  Object.assign(editor.style, {
    left: `${box.x * v.scale + v.tx}px`, top: `${top * v.scale + v.ty}px`, width: `${Math.max(120, box.w * v.scale)}px`,
  });
  const input = editor.querySelector('input');
  input.value = element[field] || '';
  editor.hidden = false;
  editor.dataset.elementId = element.id;
  editor.dataset.field = field;
  // After this press's own mousedown has run, or its default action takes the focus straight back.
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function commitInlineEdit(cancel = false) {
  if (editor.hidden) return;
  editor.hidden = true;
  if (cancel) return;
  const value = editor.querySelector('input').value.trim();
  const { elementId, field } = editor.dataset;
  if (value || field === 'body') updateElement(elementId, { [field]: value }, 'Rename');
}

export function initInlineEditor() {
  const input = editor.querySelector('input');
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitInlineEdit();
    else if (e.key === 'Escape') commitInlineEdit(true);
  });
  input.addEventListener('blur', () => commitInlineEdit());
}

// ---------------------------------------------------------------- wheel, menu

function onWheel(e) {
  e.preventDefault();
  if (!currentDiagram()?.symbols) return;
  const r = svg.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) { zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); return; }
  const v = view();
  v.auto = false;
  v.tx -= e.deltaX; v.ty -= e.deltaY;
  viewport.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
}

function onContextMenu(e) {
  e.preventDefault();
  const d = currentDiagram();
  if (!d?.symbols) return;
  const h = hit(e);
  const items = [];
  if (h.type === 'symbol') {
    const sym = getSymbol(d, h.symbolId);
    const element = store.model.elements[sym.elementId];
    if (!(store.ui.selection?.symbolIds || []).includes(h.symbolId)) { store.ui.selection = { elementId: element.id, symbolIds: [h.symbolId] }; emit(); }
    items.push({ label: 'Select in containment tree', run: () => { set({ leftTab: 'containment' }); selectElement(element.id, { reveal: true }); } });
    if (element.kind === 'block') items.push({ label: 'New internal block diagram', run: () => createDiagram('ibd', element.id) });
    const typeId = element.kind === 'property' && element.typeId;
    if (typeId) items.push({ label: `Go to type “${store.model.elements[typeId].name}”`, run: () => selectElement(typeId, { reveal: true }) });
    items.push('-', { label: 'Remove from diagram', key: 'Del', run: removeSelectionFromDiagram }, { label: 'Delete from model', key: '⇧Del', danger: true, run: deleteSelectionFromModel });
  } else if (h.type === 'path') {
    const path = d.paths.find((x) => x.id === h.pathId);
    store.ui.selection = { pathId: path.id, refId: path.refId };
    emit();
    items.push({ label: 'Remove from diagram', key: 'Del', run: removeSelectionFromDiagram }, { label: 'Delete from model', key: '⇧Del', danger: true, run: deleteSelectionFromModel });
  } else if (h.type === 'port') {
    store.ui.selection = { elementId: h.portId, portId: h.portId, portKey: h.key };
    emit();
    items.push({ label: 'Delete port from model', danger: true, run: deleteSelectionFromModel });
  } else {
    items.push({ label: 'Zoom to fit', run: zoomFit }, { label: 'Select all', key: '⌘A', run: selectAll });
  }
  showMenu(e.clientX, e.clientY, items);
}

export function selectAll() {
  const d = currentDiagram();
  if (!d?.symbols?.length) return;
  store.ui.selection = { elementId: d.symbols[0].elementId, symbolIds: d.symbols.map((s) => s.id) };
  emit();
}

export function nudge(dx, dy) {
  const d = currentDiagram();
  const ids = store.ui.selection?.symbolIds;
  if (!d?.symbols || !ids?.length) return;
  tryCommit('Nudge', (m) => { for (const id of ids) { const s = getSymbol(m.diagrams[d.id], id); s.x += dx; s.y += dy; } });
}
