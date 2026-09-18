// Graphic export: SVG, PNG, and PDF via the browser's own print engine
// (which keeps the PDF vector — no third-party PDF library needed).
// Exports are always drawn dark-on-white, whatever the screen palette is.

import { downloadBlob, downloadText, slugify, escapeXml } from '../util.js';
import { diagramToSvgString, diagramSize, EXPORT_CSS } from '../ui/render.js';
import { hosted, post } from '../host.js';

const fileBase = (model, diagram) => `${slugify(model.name)}-${slugify(diagram.name)}`;

export function exportSvg(model, diagram) {
  const name = `${fileBase(model, diagram)}.svg`;
  downloadText(diagramToSvgString(model, diagram), name, 'image/svg+xml');
  return name;
}

export async function exportPng(model, diagram, scale = 2) {
  const { w, h } = diagramSize(model, diagram);
  const blob = await rasterize(diagramToSvgString(model, diagram), w * scale, h * scale);
  const name = `${fileBase(model, diagram)}.png`;
  downloadBlob(blob, name);
  return name;
}

function rasterize(svgText, w, h) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas produced no image.'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The diagram could not be rasterised.')); };
    img.src = url;
  });
}

/**
 * Open a print window holding one page per diagram, each page sized to its
 * diagram. "Save as PDF" in the print dialog produces a vector document.
 */
export function printDiagrams(model, diagrams) {
  if (hosted) {
    // A web view cannot open a print window; the macOS app renders each page to PDF itself.
    post({
      type: 'pdf', name: `${slugify(model.name)}${diagrams.length === 1 ? `-${slugify(diagrams[0].name)}` : ''}.pdf`,
      pages: diagrams.map((d) => ({ ...diagramSize(model, d), svg: diagramToSvgString(model, d).replace(/^<\?xml[^>]*\?>\s*/, '') })),
    });
    return;
  }
  const pages = diagrams.map((d, i) => {
    const { w, h } = diagramSize(model, d);
    const body = diagramToSvgString(model, d).replace(/^<\?xml[^>]*\?>\s*/, '');
    return `<style>@page p${i} { size: ${w}px ${h}px; margin: 0; } .p${i} { page: p${i}; width: ${w}px; height: ${h}px; }</style><section class="page p${i}">${body}</section>`;
  }).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeXml(model.name)}</title>
<style>
html,body{margin:0;padding:0;background:#fff}
.page{page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
svg{display:block;width:100%;height:100%}
${EXPORT_CSS}
</style></head><body>${pages}
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),250)})<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) throw new Error('The browser blocked the print window. Allow pop-ups for this page and try again.');
  w.document.open();
  w.document.write(html);
  w.document.close();
}
