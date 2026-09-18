// XMI interchange (UML 2.5 XMI with SysML 1.x stereotype applications), the
// form Cameo / MagicDraw read and write.
//
// Export writes the model — packages, blocks, value types, properties, ports,
// operations, requirements, actors, use cases and every relationship. XMI has
// no portable diagram format, so diagrams travel in an xmi:Extension that only
// this app reads; another tool ignores it and sees the model alone.
//
// Import reads that extension when present (a lossless round trip). A file
// from another tool has none, so its model is mapped kind by kind, anything
// this app has no counterpart for is counted in the report, and starter
// diagrams are laid out per package.

import { escapeXml, parseXml, xattr, uid } from '../util.js';
import { canOwn } from '../model/types.js';
import { createModel, addDiagram, addSymbol, children, features } from '../model/model.js';
import { measure } from '../model/layout.js';
import { parse as parseJson, serialize } from './json.js';

const NS = {
  xmi: 'http://www.omg.org/spec/XMI/20131001',
  uml: 'http://www.omg.org/spec/UML/20131001',
  sysml: 'http://www.omg.org/spec/SysML/20150709/SysML',
  StandardProfile: 'http://www.omg.org/spec/UML/20131001/StandardProfile',
};
const EXTENDER = 'SysML Modeler';
const ABSTRACTIONS = { satisfy: 'sysml:Satisfy', verify: 'sysml:Verify', deriveReqt: 'sysml:DeriveReqt', trace: 'sysml:Trace', allocate: 'sysml:Allocate', refine: 'StandardProfile:Refine' };

// ---------------------------------------------------------------- export

function bounds(mult) {
  const m = /^\s*(\d+|\*)\s*(?:\.\.\s*(\d+|\*))?\s*$/.exec(mult || '1');
  if (!m) return ['1', '1'];
  if (!m[2]) return m[1] === '*' ? ['0', '*'] : [m[1], m[1]];
  return [m[1], m[2]];
}

export function exportXmi(model, { includeDiagrams = true } = {}) {
  const a = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  const stereo = [];
  const rels = Object.values(model.relationships);
  const textTypes = new Map();
  const typeRef = (e) => {
    if (e.typeId) return e.typeId;
    if (!e.typeText) return undefined;
    if (!textTypes.has(e.typeText)) textTypes.set(e.typeText, `dt_${e.typeText.replace(/\W+/g, '_')}`);
    return textTypes.get(e.typeText);
  };
  const doc = (e, pad) => (e.doc ? `${pad}<ownedComment xmi:type="uml:Comment"${a({ 'xmi:id': `${e.id}_doc`, body: e.doc, annotatedElement: e.id })}/>\n` : '');
  const associations = [];

  const feature = (f, pad) => {
    if (f.kind === 'operation') {
      const ret = f.returnType ? `\n${pad}  <ownedParameter${a({ 'xmi:id': `${f.id}_ret`, name: 'return', direction: 'return' })}/>\n${pad}` : '';
      return `${pad}<ownedOperation xmi:type="uml:Operation"${a({ 'xmi:id': f.id, name: f.name })}>${ret}</ownedOperation>\n`;
    }
    const [lo, hi] = bounds(f.multiplicity);
    const isPort = f.kind === 'port';
    const linked = !isPort && f.propKind !== 'value' && f.typeId;
    if (linked) associations.push(f);
    if (isPort && f.direction !== 'inout') stereo.push(`<sysml:FlowPort${a({ 'xmi:id': `${f.id}_st`, base_Port: f.id, direction: f.direction })}/>`);
    let s = `${pad}<ownedAttribute xmi:type="uml:${isPort ? 'Port' : 'Property'}"${a({
      'xmi:id': f.id, name: f.name, type: typeRef(f), aggregation: isPort || f.propKind === 'part' ? 'composite' : undefined, association: linked ? `${f.id}_as` : undefined,
    })}>\n`;
    s += `${pad}  <lowerValue xmi:type="uml:LiteralInteger"${a({ 'xmi:id': `${f.id}_lo`, value: lo })}/>\n`;
    s += `${pad}  <upperValue xmi:type="uml:LiteralUnlimitedNatural"${a({ 'xmi:id': `${f.id}_hi`, value: hi })}/>\n`;
    if (f.defaultValue) s += `${pad}  <defaultValue xmi:type="uml:LiteralString"${a({ 'xmi:id': `${f.id}_dv`, value: f.defaultValue })}/>\n`;
    return `${s}${doc(f, `${pad}  `)}${pad}</ownedAttribute>\n`;
  };

  const element = (e, pad, tag = 'packagedElement') => {
    const kids = children(model, e.id);
    let inner = doc(e, `${pad}  `);
    let type;
    switch (e.kind) {
      case 'package': type = 'uml:Package'; break;
      case 'block': type = 'uml:Class'; stereo.push(`<sysml:Block${a({ 'xmi:id': `${e.id}_st`, base_Class: e.id })}/>`); break;
      case 'valueType': type = 'uml:DataType'; stereo.push(`<sysml:ValueType${a({ 'xmi:id': `${e.id}_st`, base_DataType: e.id, unit: e.unit })}/>`); break;
      case 'requirement': type = 'uml:Class'; stereo.push(`<sysml:Requirement${a({ 'xmi:id': `${e.id}_st`, base_Class: e.id, Id: e.reqId, Text: e.text })}/>`); break;
      case 'testCase': type = 'uml:Activity'; stereo.push(`<sysml:TestCase${a({ 'xmi:id': `${e.id}_st`, base_Behavior: e.id })}/>`); break;
      case 'actor': type = 'uml:Actor'; break;
      case 'useCase': type = 'uml:UseCase'; break;
      case 'comment': return `${pad}<ownedComment xmi:type="uml:Comment"${a({ 'xmi:id': e.id, body: e.body })}/>\n`;
      default: return '';
    }
    for (const r of rels) {
      if (r.sourceId !== e.id) continue;
      if (r.kind === 'generalization') inner += `${pad}  <generalization xmi:type="uml:Generalization"${a({ 'xmi:id': r.id, general: r.targetId })}/>\n`;
      else if (r.kind === 'include') inner += `${pad}  <include xmi:type="uml:Include"${a({ 'xmi:id': r.id, addition: r.targetId })}/>\n`;
      else if (r.kind === 'extend') inner += `${pad}  <extend xmi:type="uml:Extend"${a({ 'xmi:id': r.id, extendedCase: r.targetId })}/>\n`;
    }
    for (const k of kids) {
      if (k.kind === 'property' || k.kind === 'port' || k.kind === 'operation') inner += feature(k, `${pad}  `);
      else inner += element(k, `${pad}  `, e.kind === 'package' ? 'packagedElement' : 'nestedClassifier');
    }
    for (const r of rels) {
      if (r.kind !== 'connector' || r.ownerId !== e.id) continue;
      const end = (partId, portId, n) => `${pad}    <end xmi:type="uml:ConnectorEnd"${a({ 'xmi:id': `${r.id}_e${n}`, role: portId || partId, partWithPort: portId && partId ? partId : undefined })}/>\n`;
      inner += `${pad}  <ownedConnector xmi:type="uml:Connector"${a({ 'xmi:id': r.id, name: r.name })}>\n${end(r.sourceId, r.sourcePortId, 1)}${end(r.targetId, r.targetPortId, 2)}${pad}  </ownedConnector>\n`;
    }
    return `${pad}<${tag} xmi:type="${type}"${a({ 'xmi:id': e.id, name: e.name, isAbstract: e.isAbstract ? 'true' : undefined })}>\n${inner}${pad}</${tag}>\n`;
  };

  const root = model.elements[model.rootId];
  let body = doc(root, '    ');
  for (const k of children(model, root.id)) body += element(k, '    ');

  for (const f of associations) {
    body += `    <packagedElement xmi:type="uml:Association"${a({ 'xmi:id': `${f.id}_as`, memberEnd: `${f.id} ${f.id}_oe` })}>\n`
      + `      <ownedEnd xmi:type="uml:Property"${a({ 'xmi:id': `${f.id}_oe`, type: f.ownerId, association: `${f.id}_as` })}/>\n    </packagedElement>\n`;
  }
  for (const r of rels) {
    if (r.kind === 'association') {
      body += `    <packagedElement xmi:type="uml:Association"${a({ 'xmi:id': r.id, name: r.name, memberEnd: `${r.id}_a ${r.id}_b` })}>\n`
        + `      <ownedEnd xmi:type="uml:Property"${a({ 'xmi:id': `${r.id}_a`, type: r.sourceId, association: r.id })}/>\n`
        + `      <ownedEnd xmi:type="uml:Property"${a({ 'xmi:id': `${r.id}_b`, type: r.targetId, association: r.id })}/>\n    </packagedElement>\n`;
    } else if (r.kind === 'dependency' || ABSTRACTIONS[r.kind]) {
      body += `    <packagedElement xmi:type="uml:${r.kind === 'dependency' ? 'Dependency' : 'Abstraction'}"${a({ 'xmi:id': r.id, name: r.name, client: r.sourceId, supplier: r.targetId })}/>\n`;
      if (ABSTRACTIONS[r.kind]) stereo.push(`<${ABSTRACTIONS[r.kind]}${a({ 'xmi:id': `${r.id}_st`, base_Abstraction: r.id })}/>`);
    }
  }
  for (const [name, id] of textTypes) body += `    <packagedElement xmi:type="uml:DataType"${a({ 'xmi:id': id, name })}/>\n`;

  const ext = includeDiagrams
    ? `  <xmi:Extension extender="${EXTENDER}">\n    <model><![CDATA[${serialize(model).replace(/]]>/g, ']]]]><![CDATA[>')}]]></model>\n  </xmi:Extension>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xmi:XMI${Object.entries(NS).map(([p, u]) => ` xmlns:${p}="${u}"`).join('')}>\n`
    + `  <uml:Model${a({ 'xmi:id': root.id, name: root.name })}>\n${body}  </uml:Model>\n${stereo.map((s) => `  ${s}\n`).join('')}${ext}</xmi:XMI>\n`;
}

// ---------------------------------------------------------------- import

const STEREO_REL = { Satisfy: 'satisfy', Verify: 'verify', DeriveReqt: 'deriveReqt', Refine: 'refine', Trace: 'trace', Copy: 'trace', Allocate: 'allocate' };
const idrefs = (node, name) => {
  const out = (node.attrs[name] || '').split(/\s+/).filter(Boolean);
  for (const c of node.children) if (c.local === name) { const r = xattr(c, 'idref') || c.attrs.href?.split('#').pop(); if (r) out.push(r); }
  return out;
};
const xtype = (node) => (node.attrs['xmi:type'] || node.name).split(':').pop();

/**
 * @returns {{model, report: {source, elements, relationships, diagrams, skipped: Object<string, number>}}}
 */
export function importXmi(text, { ignoreExtension = false } = {}) {
  const doc = parseXml(text);
  const top = doc.local === 'XMI' ? doc.children : [doc];

  if (!ignoreExtension) {
    const ext = top.find((n) => n.local === 'Extension' && n.attrs.extender === EXTENDER);
    const blob = ext?.children.find((c) => c.local === 'model')?.text;
    if (blob) {
      const { model } = parseJson(blob);
      return { model, report: { source: EXTENDER, elements: Object.keys(model.elements).length, relationships: Object.keys(model.relationships).length, diagrams: Object.keys(model.diagrams).length, skipped: {} } };
    }
  }

  const umlRoot = top.find((n) => n.local === 'Model') || top.find((n) => n.local === 'Package');
  if (!umlRoot) throw new Error('The file holds no uml:Model. Export the model from your tool as UML 2.5 XMI.');

  // stereotype applications: base element id → [{ name, attrs }]
  const applied = new Map();
  for (const n of top) {
    if (n === umlRoot) continue;
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!k.startsWith('base_')) continue;
      if (!applied.has(v)) applied.set(v, []);
      applied.get(v).push({ name: n.local, attrs: n.attrs });
    }
  }
  const stereoOf = (id, test) => (applied.get(id) || []).find((s) => test(s.name));

  const model = createModel(umlRoot.attrs.name || 'Imported model');
  const rootId = model.rootId;
  const skipped = {};
  const skip = (what) => { skipped[what] = (skipped[what] || 0) + 1; };
  const idMap = new Map([[xattr(umlRoot, 'id'), rootId]]);
  const pendingProps = [];   // [element, xmiNode]
  const later = [];          // relationship builders, run once every element exists
  const endTypes = new Map(); // association end property id → type id

  const put = (kind, ownerId, node, props = {}) => {
    let owner = model.elements[ownerId];
    while (owner && !canOwn(owner.kind, kind)) owner = model.elements[owner.ownerId];
    const e = { id: uid(kind.slice(0, 2)), kind, name: node.attrs.name || '', ownerId: (owner || model.elements[rootId]).id, doc: '', ...props };
    model.elements[e.id] = e;
    const xid = xattr(node, 'id');
    if (xid) idMap.set(xid, e.id);
    return e;
  };

  const readComments = (node, e, asNotes) => {
    for (const c of node.children) {
      if (c.local !== 'ownedComment') continue;
      const body = c.attrs.body || c.children.find((x) => x.local === 'body')?.text || '';
      const about = idrefs(c, 'annotatedElement');
      if (!about.length || about.includes(xattr(node, 'id'))) { if (about.length || !asNotes) e.doc = e.doc ? `${e.doc}\n${body}` : body; else put('comment', e.id, c, { body, name: '' }); } else put('comment', e.id, c, { body, name: '' });
    }
  };

  const readFeatures = (node, e) => {
    for (const c of node.children) {
      if (c.local === 'ownedAttribute') {
        const isPort = xtype(c) === 'Port';
        const lower = c.children.find((x) => x.local === 'lowerValue')?.attrs.value;
        const upper = c.children.find((x) => x.local === 'upperValue')?.attrs.value;
        const lo = lower ?? (upper ? '0' : '1'); const hi = upper ?? '1';
        const f = put(isPort ? 'port' : 'property', e.id, c, {
          typeId: null, typeText: '', multiplicity: lo === hi ? lo : (lo === '0' && hi === '*' ? '*' : `${lo}..${hi}`),
          ...(isPort ? { direction: stereoOf(xattr(c, 'id'), (n) => n === 'FlowPort')?.attrs.direction || 'inout' } : { propKind: 'value', defaultValue: c.children.find((x) => x.local === 'defaultValue')?.attrs.value || '' }),
        });
        pendingProps.push([f, c]);
        endTypes.set(xattr(c, 'id'), c.attrs.type);
      } else if (c.local === 'ownedOperation') {
        const params = c.children.filter((x) => x.local === 'ownedParameter' && x.attrs.direction !== 'return').map((x) => x.attrs.name).filter(Boolean).join(', ');
        put('operation', e.id, c, { params, returnType: '' });
      } else if (c.local === 'ownedConnector') {
        const ends = c.children.filter((x) => x.local === 'end');
        if (ends.length === 2) later.push(() => connector(c, ends, e));
        else skip('Connector with other than two ends');
      }
    }
  };

  const connector = (c, ends, ctx) => {
    const resolve = (end) => {
      const role = idMap.get(idrefs(end, 'role')[0]);
      const part = idMap.get(idrefs(end, 'partWithPort')[0]);
      const r = model.elements[role];
      if (!r) return null;
      if (r.kind === 'port') return { partId: part || null, portId: r.id };
      return { partId: r.id, portId: null };
    };
    const [s, t] = ends.map(resolve);
    if (!s || !t) { skip('Connector with an unresolved end'); return; }
    const id = uid('rl');
    model.relationships[id] = { id, kind: 'connector', name: c.attrs.name || '', ownerId: ctx.id, sourceId: s.partId, sourcePortId: s.portId, targetId: t.partId, targetPortId: t.portId };
  };

  const rel = (kind, src, tgt, name = '') => later.push(() => {
    const s = idMap.get(src); const t = idMap.get(tgt);
    if (!model.elements[s] || !model.elements[t]) { skip(`${kind} with an end this app does not model`); return; }
    const id = uid('rl');
    model.relationships[id] = { id, kind, sourceId: s, targetId: t, name };
  });

  const readOwnedRels = (node) => {
    const me = xattr(node, 'id');
    for (const c of node.children) {
      if (c.local === 'generalization') idrefs(c, 'general').forEach((g) => rel('generalization', me, g));
      else if (c.local === 'include') idrefs(c, 'addition').forEach((g) => rel('include', me, g));
      else if (c.local === 'extend') idrefs(c, 'extendedCase').forEach((g) => rel('extend', me, g));
    }
  };

  const walk = (node, ownerId) => {
    for (const c of node.children) {
      if (c.local !== 'packagedElement' && c.local !== 'nestedClassifier' && c.local !== 'ownedBehavior') continue;
      const t = xtype(c);
      const xid = xattr(c, 'id');
      let e = null;
      if (t === 'Package' || t === 'Model' || t === 'Profile') {
        if (t === 'Profile') { skip('Profile'); continue; }
        e = put('package', ownerId, c);
        readComments(c, e, true);
        walk(c, e.id);
        continue;
      } else if (t === 'Class' || t === 'Component' || t === 'Interface') {
        const req = stereoOf(xid, (n) => /requirement$/i.test(n));
        if (req) e = put('requirement', ownerId, c, { reqId: req.attrs.Id ?? req.attrs.id ?? '', text: req.attrs.Text ?? req.attrs.text ?? '' });
        else { e = put('block', ownerId, c, { isAbstract: c.attrs.isAbstract === 'true' }); readFeatures(c, e); }
      } else if (t === 'DataType' || t === 'PrimitiveType' || t === 'Enumeration') {
        e = put('valueType', ownerId, c, { unit: stereoOf(xid, (n) => n === 'ValueType')?.attrs.unit || '' });
        readFeatures(c, e);
      } else if (t === 'Actor') e = put('actor', ownerId, c);
      else if (t === 'UseCase') e = put('useCase', ownerId, c);
      else if (stereoOf(xid, (n) => n === 'TestCase')) e = put('testCase', ownerId, c);
      else if (t === 'Association') {
        const ends = idrefs(c, 'memberEnd');
        for (const oe of c.children.filter((x) => x.local === 'ownedEnd')) endTypes.set(xattr(oe, 'id'), oe.attrs.type);
        later.push(() => {
          // An association with a navigable owned attribute is that attribute: a part or a reference.
          if (ends.some((id) => model.elements[idMap.get(id)]?.kind === 'property')) return;
          const [s, tt] = ends.map((id) => endTypes.get(id));
          if (ends.length === 2 && idMap.has(s) && idMap.has(tt)) { const id = uid('rl'); model.relationships[id] = { id, kind: 'association', sourceId: idMap.get(s), targetId: idMap.get(tt), name: c.attrs.name || '' }; } else skip('Association this app could not resolve');
        });
        continue;
      } else if (['Abstraction', 'Dependency', 'Realization', 'Usage'].includes(t)) {
        const st = (applied.get(xid) || []).map((s) => STEREO_REL[s.name]).find(Boolean);
        for (const s of idrefs(c, 'client')) for (const tt of idrefs(c, 'supplier')) rel(st || 'dependency', s, tt, c.attrs.name || '');
        continue;
      } else { skip(`uml:${t}`); continue; }

      readComments(c, e, false);
      readOwnedRels(c);
      walk(c, e.id);
    }
  };

  readComments(umlRoot, model.elements[rootId], true);
  walk(umlRoot, rootId);

  for (const [f, node] of pendingProps) {
    const typeId = idMap.get(node.attrs.type);
    const type = model.elements[typeId];
    if (type) f.typeId = typeId;
    else f.typeText = node.children.find((x) => x.local === 'type')?.attrs.href?.split('#').pop() || '';
    if (f.kind === 'property' && type?.kind === 'block') f.propKind = node.attrs.aggregation === 'composite' ? 'part' : 'reference';
  }
  later.forEach((fn) => fn());

  starterDiagrams(model);
  return {
    model,
    report: { source: xattr(doc, 'exporter') || top.find((n) => n.local === 'Documentation')?.attrs.exporter || 'XMI', elements: Object.keys(model.elements).length, relationships: Object.keys(model.relationships).length, diagrams: Object.keys(model.diagrams).length, skipped },
  };
}

// ---------------------------------------------------------------- starter diagrams

function starterDiagrams(model) {
  for (const pkg of Object.values(model.elements).filter((e) => e.kind === 'package')) {
    const kids = children(model, pkg.id);
    const deep = (kind) => kids.filter((k) => k.kind === kind).flatMap((k) => [k, ...descend(model, k, kind)]).map((k) => k.id);
    layoutInto(model, 'bdd', pkg, `${pkg.name} structure`, [...deep('block'), ...deep('valueType')]);
    layoutInto(model, 'req', pkg, `${pkg.name} requirements`, deep('requirement'));
    layoutInto(model, 'uc', pkg, `${pkg.name} use cases`, [...deep('actor'), ...deep('useCase')]);
  }
  for (const b of Object.values(model.elements).filter((e) => e.kind === 'block')) {
    const parts = features(model, b.id, 'property').filter((p) => p.propKind !== 'value');
    const wired = Object.values(model.relationships).some((r) => r.kind === 'connector' && r.ownerId === b.id);
    if (wired) layoutInto(model, 'ibd', b, `${b.name} internals`, parts.map((p) => p.id), { contextId: b.id });
  }
  if (Object.values(model.elements).some((e) => e.kind === 'requirement')) {
    addDiagram(model, 'reqtable', model.rootId, 'Requirement table');
    addDiagram(model, 'matrix', model.rootId, 'Satisfy matrix', { relKind: 'satisfy', rowKind: 'block', colKind: 'requirement' });
  }
}

const descend = (model, e, kind) => children(model, e.id).filter((k) => k.kind === kind).flatMap((k) => [k, ...descend(model, k, kind)]);

function layoutInto(model, kind, owner, name, ids, props = {}) {
  if (!ids.length) return;
  const d = addDiagram(model, kind, owner.id, name, props);
  let x = 70; let y = 80; let rowH = 0;
  for (const id of ids) {
    const s = addSymbol(model, d, id, x, y);
    const box = measure(model, d, s);
    if (x > 70 && x + box.w > 1150) { x = 70; y += rowH + 70; rowH = 0; s.x = x; s.y = y; }
    x += box.w + 70;
    rowH = Math.max(rowH, box.h);
  }
}
