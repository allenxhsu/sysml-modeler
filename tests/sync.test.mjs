// The sync module's pure parts. Everything that needs a browser is exercised by hand, in the README's checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module reads localStorage lazily and touches window only inside initSync, so it loads under Node.
const sync = await import('../src/state/sync.js');
const { decideRemote, workspaceUrl, STORAGE_PREFIX, SETTINGS_KEY, DEVICE_KEY, DB_NAME, WORKSPACE, APP_ID } = sync;
import { readFileSync } from 'node:fs';

test('a newer model replaces the open one only while nothing is unsaved', () => {
  const remote = { id: 'pk_1', type: 'document', updatedAt: 5, deletedAt: null, body: '{}', name: 'x' };
  assert.deepEqual(decideRemote({ dirty: false, applied: [remote], modelId: 'pk_1' }), { action: 'take', remote });
  assert.deepEqual(decideRemote({ dirty: true, applied: [remote], modelId: 'pk_1' }), { action: 'ask', remote });
  assert.equal(decideRemote({ dirty: false, applied: [remote], modelId: 'pk_2' }).action, 'ignore');
  assert.equal(decideRemote({ dirty: false, applied: [{ ...remote, deletedAt: 9 }], modelId: 'pk_1' }).action, 'ignore');
  assert.equal(decideRemote({ dirty: false, applied: [{ ...remote, type: 'person' }], modelId: 'pk_1' }).action, 'ignore');
});

test('a pasted origin becomes the workspace URL; a workspace URL is kept', () => {
  assert.equal(workspaceUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/w/sysml');
  assert.equal(workspaceUrl('https://toolkit.example/w/sysml'), 'https://toolkit.example/w/sysml');
  assert.equal(workspaceUrl('https://toolkit.example/w/other'), 'https://toolkit.example/w/other');
});

test('every storage name carries the app prefix, on a shared origin', () => {
  for (const name of [SETTINGS_KEY, DEVICE_KEY, DB_NAME]) assert.ok(name.startsWith(STORAGE_PREFIX), name);
  const storeSource = readFileSync(new URL('../src/state/store.js', import.meta.url), 'utf8');
  assert.match(storeSource, /AUTOSAVE_KEY = 'sysml-modeler:autosave'/);
});

test('the contract file agrees with the sync module', () => {
  const contract = JSON.parse(readFileSync(new URL('../toolkit-app.json', import.meta.url), 'utf8'));
  assert.equal(contract.id, APP_ID);
  assert.equal(contract.workspace, WORKSPACE);
  assert.equal(contract.connectScheme, APP_ID);
  assert.ok(contract.static.include.includes('sync-kit/**'));
  for (const excluded of ['tests', 'doc', 'macos', 'serve.sh']) assert.ok(!contract.static.include.some((p) => p.startsWith(excluded)), excluded);
});
