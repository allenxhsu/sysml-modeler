import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, addElement, addDiagram, addSymbol, messagesOf, moveMessageTo, renumberMessages, removeElement } from '../src/model/model.js';
import { sequenceScene, seqAtY, SD } from '../src/model/sequence.js';
import { sampleModel } from '../src/model/sample.js';
import { validate } from '../src/model/validate.js';
import { diagramToSvgString } from '../src/ui/render.js';
import { exportXmi, importXmi } from '../src/io/xmi.js';
import { parseXml } from '../src/util.js';

function interaction() {
  const m = createModel('T');
  const a = addElement(m, 'block', m.rootId, { name: 'A' });
  const ia = addElement(m, 'interaction', m.rootId, { name: 'I' });
  const l1 = addElement(m, 'lifeline', ia.id, { name: 'x', representsId: a.id });
  const l2 = addElement(m, 'lifeline', ia.id, { name: 'y' });
  const l3 = addElement(m, 'lifeline', ia.id, { name: 'z' });
  const m1 = addElement(m, 'message', ia.id, { name: 'one', fromId: l1.id, toId: l2.id });
  const m2 = addElement(m, 'message', ia.id, { name: 'two', fromId: l2.id, toId: l2.id });
  const m3 = addElement(m, 'message', ia.id, { name: 'three', msgKind: 'create', fromId: l2.id, toId: l3.id });
  const d = addDiagram(m, 'sd', ia.id, 'd', { contextId: ia.id });
  addSymbol(m, d, l2.id, 300, 0); addSymbol(m, d, l1.id, 60, 0); addSymbol(m, d, l3.id, 540, 0);
  return { m, ia, d, l1, l2, l3, m1, m2, m3 };
}

test('messages number themselves and can be moved in time', () => {
  const { m, ia, l1, m1, m2, m3 } = interaction();
  assert.deepEqual(messagesOf(m, ia.id).map((x) => [x.name, x.seq]), [['one', 1], ['two', 2], ['three', 3]]);
  const frag = addElement(m, 'fragment', ia.id, { operator: 'loop', operands: [{ guard: 'x' }], coveredIds: [l1.id], fromSeq: 1, toSeq: 2 });
  assert.ok(moveMessageTo(m, m3.id, 1));
  assert.deepEqual(messagesOf(m, ia.id).map((x) => x.name), ['three', 'one', 'two']);
  assert.deepEqual([frag.fromSeq, frag.toSeq], [2, 3], 'the fragment still spans one and two');
  removeElement(m, m1.id);
  assert.deepEqual(messagesOf(m, ia.id).map((x) => [x.name, x.seq]), [['three', 1], ['two', 2]]);
  assert.equal(moveMessageTo(m, m2.id, 99), true);
  assert.deepEqual(messagesOf(m, ia.id).map((x) => x.seq), [1, 2]);
});

test('the scene orders lifelines by x and messages by time; a self-message and a create are special', () => {
  const { m, d, l1, l2, l3 } = interaction();
  const s = sequenceScene(m, d);
  assert.deepEqual(s.lifelines.map((l) => l.id), [l1.id, l2.id, l3.id]);
  assert.deepEqual(s.messages.map((x) => x.seq), [1, 2, 3]);
  assert.ok(s.messages[0].y < s.messages[1].y && s.messages[1].y < s.messages[2].y);
  assert.equal(s.messages[1].self, true);
  const created = s.lifelines.find((l) => l.id === l3.id);
  assert.equal(created.createdAt, s.messages[2].y, 'a created lifeline starts at its create message');
  assert.ok(created.box.y > SD.top);
  assert.equal(seqAtY(s, s.messages[1].y), 2);
  assert.equal(s.frame.h >= s.lifelines[0].bottom, true);
});

test('a lifeline that loses what it represents, and a message that loses a lifeline', () => {
  const { m, ia, l1, l2 } = interaction();
  const a = m.elements[l1.representsId];
  removeElement(m, a.id);
  assert.equal(m.elements[l1.id].representsId, null);
  removeElement(m, l2.id);
  assert.deepEqual(messagesOf(m, ia.id).map((x) => x.name), [], 'every message touching the lost lifeline went with it');
  const codes = validate(m).map((i) => i.code);
  assert.ok(codes.includes('lifeline-unrepresented'));
});

test('the sample sequence diagram renders and exports, with its fragments', () => {
  const m = sampleModel();
  const sd = Object.values(m.diagrams).find((d) => d.kind === 'sd');
  const s = sequenceScene(m, sd);
  assert.equal(s.lifelines.length, 4);
  assert.equal(s.messages.length, 7);
  assert.equal(s.fragments.length, 2);
  const loop = s.fragments.find((f) => f.operator === 'loop');
  assert.ok(loop.y < s.messages[3].y && loop.y + loop.h > s.messages[5].y, 'the loop spans messages 4 to 6');
  const svg = diagramToSvgString(m, sd);
  assert.doesNotThrow(() => parseXml(svg));
  assert.ok(svg.includes('until full') && svg.includes('4: startCharging'));
  assert.deepEqual(validate(m).filter((i) => i.level === 'error'), []);
});

test('xmi: an interaction round-trips model-only, with lifelines, message ends and fragment guards', () => {
  const m = sampleModel();
  const { model: back, report } = importXmi(exportXmi(m, { includeDiagrams: false }));
  assert.deepEqual(report.skipped, {});
  const shape = (mm) => {
    const ia = Object.values(mm.elements).find((e) => e.kind === 'interaction');
    const name = (id) => mm.elements[id]?.name || null;
    return {
      lifelines: Object.values(mm.elements).filter((e) => e.kind === 'lifeline' && e.ownerId === ia.id).map((l) => [l.name, name(l.representsId)]).sort(),
      messages: messagesOf(mm, ia.id).map((x) => [x.seq, x.name, x.msgKind, name(x.fromId), name(x.toId)]),
      fragments: Object.values(mm.elements).filter((e) => e.kind === 'fragment' && e.ownerId === ia.id).map((f) => [f.operator, f.operands.map((o) => o.guard), f.coveredIds.map(name).sort()]).sort(),
    };
  };
  assert.deepEqual(shape(back), shape(m));
  assert.ok(Object.values(back.diagrams).some((d) => d.kind === 'sd'), 'an imported interaction gets a starter sequence diagram');
});
