// Native file format: the model as JSON, `*.sysml.json`.

import { FORMAT, FORMAT_VERSION, ELEMENT_KINDS, REL_KINDS, DIAGRAM_KINDS } from '../model/types.js';
import { pruneDiagram } from '../model/model.js';

export const FILE_EXT = '.sysml.json';

export function serialize(model) {
  return JSON.stringify({ ...model, format: FORMAT, version: FORMAT_VERSION }, null, 2);
}

/**
 * Parse and repair. Anything structurally unusable throws with a sentence the
 * user can act on; anything merely stale (a symbol of a deleted element, an
 * unknown relationship kind) is dropped and reported in `repairs`.
 * @returns {{model, repairs: string[]}}
 */
export function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(`The file is not valid JSON (${err.message}).`); }
  if (!data || data.format !== FORMAT) throw new Error('This is not a SysML Modeler file.');
  if (data.version > FORMAT_VERSION) throw new Error(`The file was written by a newer version of SysML Modeler (format ${data.version}).`);
  if (!data.elements || !data.elements[data.rootId]) throw new Error('The file has no root package.');

  const repairs = [];
  const model = {
    format: FORMAT, version: FORMAT_VERSION, name: data.name || data.elements[data.rootId].name || 'Untitled model',
    rootId: data.rootId, elements: {}, relationships: {}, diagrams: {},
  };
  for (const [id, e] of Object.entries(data.elements)) {
    if (!ELEMENT_KINDS[e.kind]) { repairs.push(`Dropped element “${e.name}” of unknown kind ${e.kind}.`); continue; }
    model.elements[id] = { ...e, id, name: e.name ?? '', doc: e.doc ?? '' };
  }
  for (const e of Object.values(model.elements)) {
    if (e.id !== model.rootId && !model.elements[e.ownerId]) {
      repairs.push(`“${e.name}” had lost its owner and was moved to the root package.`);
      e.ownerId = model.rootId;
    }
    if (e.typeId && !model.elements[e.typeId]) e.typeId = null;
  }
  model.elements[model.rootId].ownerId = null;

  for (const [id, r] of Object.entries(data.relationships || {})) {
    if (!REL_KINDS[r.kind] || REL_KINDS[r.kind].derived) { repairs.push(`Dropped a relationship of unknown kind ${r.kind}.`); continue; }
    model.relationships[id] = { ...r, id, name: r.name ?? '' };
  }
  for (const [id, d] of Object.entries(data.diagrams || {})) {
    if (!DIAGRAM_KINDS[d.kind] || !model.elements[d.ownerId]) { repairs.push(`Dropped diagram “${d.name}”.`); continue; }
    const diagram = { ...d, id };
    if (!DIAGRAM_KINDS[d.kind].view) {
      diagram.symbols = Array.isArray(d.symbols) ? d.symbols : [];
      diagram.paths = Array.isArray(d.paths) ? d.paths : [];
      const before = diagram.symbols.length + diagram.paths.length;
      pruneDiagram(model, diagram);
      const lost = before - diagram.symbols.length - diagram.paths.length;
      if (lost) repairs.push(`Diagram “${d.name}”: removed ${lost} symbol${lost === 1 ? '' : 's'} or paths whose element no longer exists.`);
    }
    model.diagrams[id] = diagram;
  }
  return { model, repairs };
}
