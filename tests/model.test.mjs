// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createModel, addElement, addRelationship, addDiagram, addSymbol, addPath, removeElement, removeSymbol, removeEdge,
  moveElement, resolveEdge, edgesOf, usages, symbolOf, nextReqId, canShow, qualifiedName,
} from '../src/model/model.js';
import { endsAllowed, canOwn } from '../src/model/types.js';
import { validate, RULES } from '../src/model/validate.js';
import { sampleModel } from '../src/model/sample.js';
import { computeScene, diagramToSvgString } from '../src/ui/render.js';
import { serialize, parse } from '../src/io/json.js';
import { exportXmi, importXmi } from '../src/io/xmi.js';
import { parseXml } from '../src/util.js';
import { reqTableRows, matrixData } from '../src/ui/tables.js';

function twoBlocks() {
  const m = createModel('T');
  const a = addElement(m, 'block', m.rootId, { name: 'A' });
  const b = addElement(m, 'block', m.rootId, { name: 'B' });
  return { m, a, b };
}
const codes = (m) => validate(m).map((i) => i.code);

test('an element lives once; removing a symbol leaves it, removing it clears every symbol', () => {
  const { m, a, b } = twoBlocks();
  const d1 = addDiagram(m, 'bdd', m.rootId, 'one');
  const d2 = addDiagram(m, 'bdd', m.rootId, 'two');
  const s1 = addSymbol(m, d1, a.id, 0, 0);
  addSymbol(m, d2, a.id, 0, 0);
  addSymbol(m, d2, b.id, 200, 0);
  assert.equal(addSymbol(m, d1, a.id, 50, 50), s1, 'one symbol per element per diagram');
  assert.equal(usages(m, a.id).length, 2);

  removeSymbol(m, d1, s1.id);
  assert.ok(m.elements[a.id]);
  assert.equal(usages(m, a.id).length, 1);

  removeElement(m, a.id);
  assert.equal(symbolOf(d2, a.id), null);
  assert.ok(symbolOf(d2, b.id));
});

test('a part property is its own composition edge', () => {
  const { m, a, b } = twoBlocks();
  const part = addElement(m, 'property', a.id, { name: 'b', propKind: 'part', typeId: b.id, multiplicity: '2' });
  const edge = resolveEdge(m, part.id);
  assert.deepEqual([edge.kind, edge.sourceId, edge.targetId, edge.multiplicity, edge.derived], ['composition', a.id, b.id, '2', true]);
  assert.deepEqual(edgesOf(m, b.id), [part.id]);

  const d = addDiagram(m, 'bdd', m.rootId, 'd');
  addSymbol(m, d, a.id, 0, 0);
  addSymbol(m, d, b.id, 0, 300);
  assert.equal(d.paths.length, 1, 'the composition is drawn as soon as both ends are on the diagram');

  removeEdge(m, part.id);
  assert.equal(m.elements[part.id], undefined);
  assert.equal(d.paths.length, 0);
});

test('deleting a type clears it from properties and drops dependent relationships and diagrams', () => {
  const { m, a, b } = twoBlocks();
  const part = addElement(m, 'property', a.id, { name: 'b', propKind: 'part', typeId: b.id });
  const r = addElement(m, 'requirement', m.rootId, { name: 'R' });
  addRelationship(m, 'satisfy', b.id, r.id);
  addDiagram(m, 'ibd', b.id, 'inside b', { contextId: b.id });
  removeElement(m, b.id);
  assert.equal(m.elements[part.id].typeId, null);
  assert.equal(Object.keys(m.relationships).length, 0);
  assert.equal(Object.keys(m.diagrams).length, 0);
  assert.ok(codes(m).includes('part-untyped'));
});

test('ownership rules', () => {
  const { m, a, b } = twoBlocks();
  assert.throws(() => addElement(m, 'block', a.id, { name: 'nested' }), /cannot own/);
  assert.ok(canOwn('requirement', 'requirement'));
  const p = addElement(m, 'package', m.rootId, { name: 'P' });
  const q = addElement(m, 'package', p.id, { name: 'Q' });
  assert.throws(() => moveElement(m, p.id, q.id), /inside itself/);
  assert.ok(moveElement(m, b.id, q.id));
  assert.equal(qualifiedName(m, b.id), 'T::P::Q::B');
});

test('requirement ids number themselves', () => {
  const m = createModel('T');
  const r1 = addElement(m, 'requirement', m.rootId, { name: 'a' });
  const r2 = addElement(m, 'requirement', m.rootId, { name: 'b' });
  const r11 = addElement(m, 'requirement', r1.id, { name: 'c' });
  assert.deepEqual([r1.reqId, r2.reqId, r11.reqId], ['R1', 'R2', 'R1.1']);
  assert.equal(nextReqId(m, m.rootId), 'R3');
});

test('relationship end rules', () => {
  assert.ok(endsAllowed('satisfy', 'block', 'requirement'));
  assert.ok(!endsAllowed('satisfy', 'requirement', 'block'));
  assert.ok(!endsAllowed('generalization', 'block', 'actor'));
  assert.ok(endsAllowed('containment', 'requirement', 'requirement'));
  assert.ok(!endsAllowed('containment', 'requirement', 'block'));
});

test('an ibd shows only parts of its context', () => {
  const { m, a, b } = twoBlocks();
  const part = addElement(m, 'property', a.id, { name: 'b', propKind: 'part', typeId: b.id });
  const value = addElement(m, 'property', a.id, { name: 'v', propKind: 'value' });
  const foreign = addElement(m, 'property', b.id, { name: 'x', propKind: 'part', typeId: a.id });
  const d = addDiagram(m, 'ibd', a.id, 'inside', { contextId: a.id });
  assert.ok(canShow(m, d, part));
  assert.ok(!canShow(m, d, value));
  assert.ok(!canShow(m, d, foreign));
  assert.ok(!canShow(m, d, b));
});

test('validation: each rule fires on a model built to break it', () => {
  const { m, a, b } = twoBlocks();
  addElement(m, 'property', a.id, { name: 'b', propKind: 'part', typeId: b.id });
  addElement(m, 'property', b.id, { name: 'a', propKind: 'part', typeId: a.id });
  addElement(m, 'property', a.id, { name: 'v', propKind: 'value' });
  addElement(m, 'property', a.id, { name: 'loose', propKind: 'part' });
  addElement(m, 'port', a.id, { name: 'p' });
  addElement(m, 'block', m.rootId, { name: 'A' });
  addElement(m, 'block', m.rootId, { name: '' });
  addRelationship(m, 'generalization', a.id, b.id);
  addRelationship(m, 'generalization', b.id, a.id);
  const r = addElement(m, 'requirement', m.rootId, { name: 'R', reqId: 'X' });
  addElement(m, 'requirement', m.rootId, { name: 'S', reqId: 'X', text: 't' });
  addElement(m, 'requirement', m.rootId, { name: 'N', reqId: ' ', text: 't' });
  addRelationship(m, 'satisfy', r.id, a.id);
  addRelationship(m, 'trace', a.id, a.id);
  addRelationship(m, 'dependency', a.id, b.id);
  addRelationship(m, 'dependency', a.id, b.id);
  const ghost = addRelationship(m, 'dependency', a.id, b.id);
  ghost.targetId = 'gone';
  addElement(m, 'useCase', m.rootId, { name: 'U' });
  addElement(m, 'actor', m.rootId, { name: 'Act' });
  addDiagram(m, 'bdd', m.rootId, 'empty');
  const pin = addElement(m, 'port', a.id, { name: 'i', direction: 'in', typeText: 'X' });
  const pin2 = addElement(m, 'port', b.id, { name: 'j', direction: 'in', typeText: 'Y' });
  addRelationship(m, 'connector', 'x', 'y', { ownerId: a.id, sourcePortId: pin.id, targetPortId: pin2.id });
  m.elements.x = { id: 'x', kind: 'property', propKind: 'part', name: 'x', ownerId: a.id, typeId: b.id };
  m.elements.y = { id: 'y', kind: 'property', propKind: 'part', name: 'y', ownerId: a.id, typeId: b.id };

  const found = new Set(codes(m));
  const expected = Object.keys(RULES).filter((c) => c !== 'block-unused');
  for (const code of expected) assert.ok(found.has(code), `expected ${code}`);
  for (const i of validate(m)) assert.equal(i.level, RULES[i.code][0]);
});

test('the sample model has no errors and draws every path it declares', () => {
  const m = sampleModel();
  assert.deepEqual(validate(m).filter((i) => i.level === 'error'), []);
  for (const d of Object.values(m.diagrams)) {
    if (!d.symbols) continue;
    const scene = computeScene(m, d);
    assert.equal(scene.routes.length, d.paths.length, d.name);
    for (const r of scene.routes) for (const p of r.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), d.name);
    const svg = diagramToSvgString(m, d);
    assert.doesNotThrow(() => parseXml(svg), d.name);
    assert.ok(!svg.includes('var(--'), 'exports carry no screen tokens');
  }
});

test('ibd: ports sit on part borders and connectors end on them', () => {
  const m = sampleModel();
  const ibd = Object.values(m.diagrams).find((d) => d.kind === 'ibd');
  const scene = computeScene(m, ibd);
  assert.equal(scene.ports.length, 4);
  const framePort = scene.ports.find((p) => !p.partId);
  assert.equal(framePort.x, scene.frame.x, 'an `in` port of the context sits on the left edge of the frame');
  for (const r of scene.routes) {
    const ends = [r.points[0], r.points[r.points.length - 1]];
    for (const e of ends) assert.ok(scene.ports.some((p) => Math.abs(p.x - e.x) < 1 && Math.abs(p.y - e.y) < 1));
  }
});

test('json round trip is lossless; stale references are repaired, not fatal', () => {
  const m = sampleModel();
  assert.deepEqual(parse(serialize(m)).model, m);

  const broken = JSON.parse(serialize(m));
  const bdd = Object.values(broken.diagrams).find((d) => d.kind === 'bdd');
  bdd.symbols.push({ id: 'sy_x', elementId: 'nope', x: 0, y: 0, w: 0, h: 0 });
  const { model, repairs } = parse(JSON.stringify(broken));
  assert.equal(model.diagrams[bdd.id].symbols.length, bdd.symbols.length - 1);
  assert.equal(repairs.length, 1);
  assert.throws(() => parse('{"format":"other"}'), /not a SysML Modeler file/);
});

test('xmi: model-only export re-imports to the same model content', () => {
  const m = sampleModel();
  const xmi = exportXmi(m, { includeDiagrams: false });
  assert.doesNotThrow(() => parseXml(xmi));
  const { model: back, report } = importXmi(xmi);
  assert.deepEqual(report.skipped, {});

  const shape = (mm) => Object.values(mm.elements).map((e) => {
    const t = mm.elements[e.typeId];
    return [qualifiedName(mm, e.id), e.kind, e.propKind || '', t ? t.name : e.typeText || '', e.multiplicity || '', e.direction || '', e.reqId || '', e.text || '', e.doc || '', e.defaultValue || ''].join('|');
  }).sort();
  assert.deepEqual(shape(back), shape(m));

  const name = (mm, id) => (id ? qualifiedName(mm, id) : 'frame');
  const rels = (mm) => Object.values(mm.relationships).map((r) => [r.kind, name(mm, r.sourceId), name(mm, r.sourcePortId), name(mm, r.targetId), name(mm, r.targetPortId)].join('|')).sort();
  assert.deepEqual(rels(back), rels(m));
  assert.ok(Object.values(back.diagrams).some((d) => d.kind === 'ibd'), 'a wired block gets a starter ibd');
  assert.deepEqual(validate(back).filter((i) => i.level === 'error'), []);
});

test('xmi: with the extension, diagrams survive too', () => {
  const m = sampleModel();
  assert.deepEqual(importXmi(exportXmi(m)).model, m);
});

test('xmi: a Cameo-style file with idref children and unknown content imports with a report', () => {
  const xmi = `<?xml version="1.0"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20150709/SysML">
  <xmi:Documentation exporter="MagicDraw UML" exporterVersion="19.0"/>
  <uml:Model xmi:id="m" name="Pump">
    <packagedElement xmi:type="uml:Class" xmi:id="sys" name="Pump system">
      <ownedAttribute xmi:type="uml:Property" xmi:id="p1" name="pump" aggregation="composite" type="pump" association="as1"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="p2" name="flow"><type href="http://www.omg.org/spec/SysML/20150709/PrimitiveValueTypes#Real"/></ownedAttribute>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="pump" name="Pump"><generalization xmi:type="uml:Generalization" xmi:id="g1"><general xmi:idref="sys"/></generalization></packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="rq" name="Flow rate"/>
    <packagedElement xmi:type="uml:Association" xmi:id="as1"><memberEnd xmi:idref="p1"/><memberEnd xmi:idref="oe1"/><ownedEnd xmi:type="uml:Property" xmi:id="oe1" type="sys" association="as1"/></packagedElement>
    <packagedElement xmi:type="uml:Abstraction" xmi:id="ab1"><client xmi:idref="pump"/><supplier xmi:idref="rq"/></packagedElement>
    <packagedElement xmi:type="uml:StateMachine" xmi:id="sm1" name="Modes"/>
  </uml:Model>
  <sysml:Block xmi:id="b1" base_Class="sys"/><sysml:Block xmi:id="b2" base_Class="pump"/>
  <sysml:Requirement xmi:id="r1" base_Class="rq" Id="FR-1" Text="Deliver 20 l/min &amp; more."/>
  <sysml:Satisfy xmi:id="s1" base_Abstraction="ab1"/>
</xmi:XMI>`;
  const { model, report } = importXmi(xmi);
  const byName = (n) => Object.values(model.elements).find((e) => e.name === n);
  assert.equal(byName('Flow rate').kind, 'requirement');
  assert.equal(byName('Flow rate').text, 'Deliver 20 l/min & more.');
  assert.equal(byName('pump').propKind, 'part');
  assert.equal(byName('flow').typeText, 'Real');
  assert.deepEqual(Object.values(model.relationships).map((r) => r.kind).sort(), ['generalization', 'satisfy']);
  assert.deepEqual(report.skipped, { 'uml:StateMachine': 1 });
  assert.equal(report.source, 'MagicDraw UML');
  const bdd = Object.values(model.diagrams).find((d) => d.kind === 'bdd');
  assert.equal(bdd.paths.length, 2, 'composition and generalization are drawn on the starter bdd');
});

test('tables: requirement rows and matrix cells come from the model', () => {
  const m = sampleModel();
  const rows = reqTableRows(m);
  assert.deepEqual(rows.map((r) => r.id), ['R1', 'R1.1', 'R2', 'R3']);
  assert.equal(rows[0].satisfiedBy, 'Vehicle');
  assert.equal(rows[0].verifiedBy, 'Range test');
  assert.equal(rows[1].derivedFrom, 'Max range');
  const matrix = Object.values(m.diagrams).find((d) => d.kind === 'matrix');
  const { rows: r, cols, has } = matrixData(m, matrix);
  const marks = r.flatMap((a) => cols.filter((c) => has(a, c)).map((c) => `${a.name}>${c.reqId}`)).sort();
  assert.deepEqual(marks, ['Battery>R1.1', 'Vehicle>R1', 'Vehicle>R2']);
});
