// Sync: the settings, the engine over a record store, and when it runs.
// The only module that imports from sync-kit.
//
// Workspace "sysml". One model is one record — a sync-kit `DocumentRecord`
// whose `body` is exactly the bytes `File ▸ Save` writes, so a model that
// travelled through sync and one that travelled on a USB stick are the same
// model. The server never learns what any of it means. The containment tree
// (every element exists once; diagrams only point at elements) is what would
// make per-element records the natural next step; this is not that step.
//
// Two ways to reach a server:
//   - typed in: a URL and a token in Settings ▸ Sync (or handed over by the
//     macOS shell after pairing, which is the same two values);
//   - the Portal: served at /sysml/ on the Portal's origin, the page syncs the
//     workspace the session names, with the session cookie and no token.
//
// The rule that matters is in `decideRemote()`: a newer model from somewhere
// else replaces this one only while there is nothing unsaved here.

import {
  SyncEngine, HttpTransport, SyncedDocument, LocalStore, IndexedDbStore,
  SYNC_CURSOR_KEYS, publishStatus, onSyncNow, portalApp, portalSession, portalRemote, mergeRecord,
} from '../../sync-kit/js/index.js';
import { store, set, subscribe, loadModel, markSaved, modelRevision, readLegacyAutosave, forgetLegacyAutosave } from './store.js';
import { downloadText, slugify } from '../util.js';
import { hosted } from '../host.js';
import { serialize, parse } from '../io/json.js';
import { FORMAT } from '../model/types.js';

export const APP_ID = 'sysml';
export const WORKSPACE = 'sysml';
/** Every storage name this app owns carries this prefix: nine apps share one origin on the Portal. */
export const STORAGE_PREFIX = 'sysml-modeler';
export const SETTINGS_KEY = `${STORAGE_PREFIX}:sync`;
export const DEVICE_KEY = `${STORAGE_PREFIX}:deviceId`;
export const DB_NAME = STORAGE_PREFIX;
/** Record-store meta key: which model this device had open last. */
const OPEN_MODEL_META = 'app.openModel';
/** The shape `File ▸ Export everything` writes. */
export const EXPORT_FORMAT = 'sysml-modeler-records';

/** How often a configured, enabled sync runs by itself. */
const INTERVAL_MS = 30_000;
/** How long after the last edit the model is written to the record store. */
const COMMIT_MS = 800;
/** …and how long after that it goes to the server, when sync is on. */
const AUTOSAVE_MS = 2_500;

let recordStore = null;
let engine = null;
let doc = null;
let timer = null;
let commitTimer = null;
let autosaveTimer = null;
let settings = { url: '', token: '', enabled: false };
/** Set when the page is served by the Portal as this app: { baseUrl, workspace }. */
let portal = null;
/** True while a pulled model is being loaded, so the load is not sent back out. */
let adopting = false;
/** The model the record store currently describes; a different model starts a new document. */
let docModelId = null;
let lastStatus = { phase: 'idle', lastSyncAt: null, lastError: null, pulled: 0, pushed: 0, label: WORKSPACE };
/** What the browser said about keeping this origin's storage: null until asked. */
let storage = { persisted: null, asked: false };

const read = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode, quota */ } };

/** A stable id for this device. It is the `origin` of every record written here. */
export function deviceId() {
  let id = read(DEVICE_KEY, '');
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8);
    write(DEVICE_KEY, id);
  }
  return id;
}

export const getSettings = () => ({ ...settings });
/** True when this page is the Portal's copy of the app: no URL, no token, the cookie signs. */
export const inPortal = () => !!portal;
export const syncStatus = () => (engine ? engine.status : lastStatus);
export const syncConfigured = () => !!(portal || (settings.url && settings.enabled));
/** The document id sync uses for the open model: the model's root package id, which the file carries. */
export const modelDocId = () => store.model.rootId;

/**
 * IndexedDB where there is one, `localStorage` where there is not. A WKWebView
 * serving a custom scheme has not always had a working IndexedDB, so the
 * fallback is not theoretical.
 */
async function openStore() {
  try {
    const idb = new IndexedDbStore({ name: DB_NAME });
    await idb.open();
    return idb;
  } catch {
    const local = new LocalStore({ prefix: STORAGE_PREFIX });
    await local.open();
    return local;
  }
}

/**
 * Call once at start. In a browser it also puts the last open model on screen
 * — from the record store, or from an older build's localStorage autosave,
 * moved across once — and falls back to `fallback()` for a first launch.
 */
export async function initSync({ fallback = null } = {}) {
  try { settings = { ...settings, ...JSON.parse(read(SETTINGS_KEY, '{}')) }; } catch { /* keep defaults */ }
  if (portalApp() === APP_ID) portal = portalRemote(APP_ID, await portalSession());
  recordStore = await openStore();
  if (!hosted && !(await restoreModel()) && fallback) loadModel(fallback());
  await openDocument();
  void requestPersistence();

  // The record store follows the model: every committed edit, debounced.
  let lastRev = modelRevision();
  let lastId = modelDocId();
  subscribe((_, meta = {}) => {
    if (meta.light) return;
    if (modelDocId() !== lastId) { lastId = modelDocId(); lastRev = modelRevision(); void openDocument(); return; }
    if (modelRevision() === lastRev) return;
    lastRev = modelRevision();
    if (adopting) return;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { void commit(); }, COMMIT_MS);
  });

  if (typeof window !== 'undefined') {
    onSyncNow(() => { void syncNow(); });
    // Coming back to the window is the moment a stale model is most obvious.
    window.addEventListener('focus', () => { if (syncConfigured()) void syncNow(); });
  }
  if (typeof window !== 'undefined') {
    // A tab closed inside the commit debounce would lose its last edit; IndexedDB can still take a write here.
    window.addEventListener('pagehide', () => { clearTimeout(commitTimer); void commit(); });
  }
  rebuild();
  if (syncConfigured()) void syncNow();
}

/**
 * The model to open: what this device had open last, else the newest on the
 * shelf, else an autosave an older build kept in localStorage — which is moved
 * into the record store and forgotten only once it reads back. True when a
 * model was put on screen.
 */
async function restoreModel() {
  const lastId = await recordStore.meta(OPEN_MODEL_META);
  const records = (await recordStore.all()).filter((r) => r?.type === 'document' && r.format === FORMAT && !r.deletedAt);
  const pick = records.find((r) => r.id === lastId) || records.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (pick) { const m = readModel(pick.body); if (m) { adoptQuietly(m); return true; } }
  const legacy = readLegacyAutosave();
  if (!legacy) return false;
  const m = readModel(JSON.stringify(legacy));
  if (!m) { forgetLegacyAutosave(); return false; }
  const record = { id: m.rootId, type: 'document', format: FORMAT, name: m.name, body: serialize(m), updatedAt: Date.now(), deletedAt: null, origin: deviceId() };
  await recordStore.put([record]);
  const back = await recordStore.get(m.rootId);
  if (back && back.body === record.body) forgetLegacyAutosave();
  adoptQuietly(m);
  return true;
}

function readModel(text) { try { return parse(text).model; } catch { return null; } }
function adoptQuietly(model) {
  adopting = true;
  try { loadModel(model, null); markSaved(null); } finally { adopting = false; }
}

/** Ask the browser to keep this origin's storage. Never blocks; the answer shows in Settings. */
export async function requestPersistence() {
  const api = globalThis.navigator?.storage;
  if (!api?.persist) { storage = { persisted: null, asked: true }; announce(); return storage; }
  try {
    const persisted = (await api.persisted?.()) || (await api.persist());
    storage = { persisted: !!persisted, asked: true };
  } catch { storage = { persisted: null, asked: true }; }
  announce();
  return storage;
}
export const storageState = () => ({ ...storage });

/** How much this origin holds and may hold, when the browser will say. */
export async function storageEstimate() {
  try { const e = await globalThis.navigator?.storage?.estimate?.(); return e ? { usage: e.usage, quota: e.quota } : null; } catch { return null; }
}

/** Live records and tombstones in this device's store. */
export async function localCounts() {
  if (!recordStore) return { live: 0, tombstones: 0, total: 0 };
  const all = await recordStore.all();
  const tombstones = all.filter((r) => r?.deletedAt).length;
  return { live: all.length - tombstones, tombstones, total: all.length };
}

/** The server's answer at /sync/health: how many records the workspace holds. Throws when it cannot say. */
export async function fetchHealth() {
  const base = portal ? portal.baseUrl : settings.url ? workspaceUrl(settings.url) : null;
  if (!base) throw new Error('No server is configured.');
  const headers = { accept: 'application/json' };
  if (!portal && settings.token) headers.authorization = `Bearer ${settings.token}`;
  const res = await fetch(`${base}/sync/health`, { headers, credentials: 'same-origin' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in.' : `The server answered ${res.status}.`);
  return res.json();
}

/** Point the document at the open model, reading what the store already holds. */
async function openDocument() {
  if (!recordStore) return;
  docModelId = modelDocId();
  await recordStore.setMeta(OPEN_MODEL_META, docModelId);
  doc = new SyncedDocument(recordStore, { id: docModelId, origin: deviceId(), format: FORMAT, name: store.model.name });
  await doc.load();
  // A model that is already on the shelf, newer than the one just opened, wins if nothing here is unsaved.
  if (doc.record.updatedAt && !store.ui.dirty && doc.body && doc.body !== serialize(store.model)) {
    const remote = doc.record;
    let parsed = null;
    try { parsed = parse(remote.body).model; } catch { parsed = null; }
    if (parsed) { adopting = true; try { loadModel(parsed, store.ui.fileName); markSaved(store.ui.fileName); } finally { adopting = false; } }
    return;
  }
  await commit();
}

/**
 * Write the open model into the record store, where a push can find it, and —
 * when sync is on — send it shortly after.
 */
async function commit() {
  if (!doc || adopting || modelDocId() !== docModelId) return;
  // A fresh, untitled model is what every new window starts as. Giving each one
  // a record would put a row on the shelf — and on every other device — for the
  // act of opening the app, so a model earns its record by having something in it.
  const untouched = Object.keys(store.model.elements).length <= 1 && !Object.keys(store.model.diagrams).length && !doc.record.updatedAt;
  if (untouched) return;
  const body = serialize(store.model);
  if (body === doc.body && store.model.name === doc.name) return;
  doc.edit(body, store.model.name);
  await doc.save();
  if (!syncConfigured()) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { void syncNow(); }, AUTOSAVE_MS);
}

/** Save new settings and restart. A changed URL clears both cursors: they belong to the old server. */
export async function applySettings(next) {
  const urlChanged = (next.url || '').trim() !== settings.url;
  settings = { url: (next.url || '').trim(), token: (next.token || '').trim(), enabled: !!next.enabled };
  write(SETTINGS_KEY, JSON.stringify(settings));
  if (urlChanged && recordStore && !portal) await resetCursors();
  rebuild();
  if (syncConfigured()) { void requestPersistence(); await syncNow(); }
  announce();
}

async function resetCursors() {
  // A cursor describes a position against one particular server and means
  // nothing against another; a client that keeps them uploads nothing at all.
  for (const key of SYNC_CURSOR_KEYS) await recordStore.setMeta(key, 0);
}

/**
 * Settings handed over by the macOS shell, because this Mac is paired with the
 * toolkit Portal. They are the same two values the dialog holds, so they are
 * applied the same way. Signed out (two empty strings) switches sync off.
 */
export async function adoptRemoteSettings({ url, token }) {
  const next = { url: (url || '').trim(), token: (token || '').trim() };
  if (next.url === settings.url && next.token === settings.token) return;
  await applySettings({ ...next, enabled: !!next.url });
}

function rebuild() {
  clearInterval(timer);
  timer = null;
  engine = null;
  let transport = null;
  if (portal) transport = new HttpTransport({ baseUrl: portal.baseUrl, label: portal.workspace, onUnauthorized });
  else if (settings.url) transport = new HttpTransport({ baseUrl: workspaceUrl(settings.url), token: settings.token, label: WORKSPACE, onUnauthorized });
  if (!recordStore || !transport) { announce(); return; }
  engine = new SyncEngine(recordStore, transport, deviceId());
  if (syncConfigured()) timer = setInterval(() => { void syncNow(); }, INTERVAL_MS);
  announce();
}

/** A pasted origin gets the workspace path appended; a full workspace URL is kept. */
export function workspaceUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  return /\/w\/[a-z0-9-]+$/i.test(u) ? u : `${u}/w/${WORKSPACE}`;
}

/** The session is gone: the status readout and the Portal bar both offer Sign in. */
function onUnauthorized() {
  document.querySelector('sc-portal-bar')?.refresh?.();
}

function announce() {
  const s = syncStatus();
  lastStatus = { ...s };
  publishStatus({ ...s, storage: { ...storage }, lastError: s.lastErrorCode === 'unauthorized' ? { code: 'unauthorized', message: s.lastError } : s.lastError });
}

// ---------------------------------------------------------------- export and import
//
// One JSON file of every record and tombstone, so a copy can live anywhere
// without the server, and come back by the same last-write-wins rule a sync uses.

const isRecord = (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length > 0 && typeof r.updatedAt === 'number';

/** Merge incoming records into what a store holds. Pure; returns what to write and the tally. */
export function mergeIncoming(local, incoming) {
  const byId = new Map(local.map((r) => [r.id, r]));
  const writes = [];
  const tally = { added: 0, updated: 0, unchanged: 0, invalid: 0 };
  for (const r of incoming) {
    if (!isRecord(r)) { tally.invalid++; continue; }
    const mine = byId.get(r.id);
    const winner = mergeRecord(mine, r);
    if (winner === mine) { tally.unchanged++; continue; }
    writes.push(winner);
    byId.set(r.id, winner);
    if (mine) tally.updated++; else tally.added++;
  }
  return { writes, tally };
}

export async function exportEverything() {
  if (!recordStore) return null;
  const records = await recordStore.all();
  const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, workspace: WORKSPACE, exportedAt: new Date().toISOString(), origin: deviceId(), records }, null, 1);
  const name = `${slugify(WORKSPACE)}-records-${new Date().toISOString().slice(0, 10)}.json`;
  downloadText(text, name, 'application/json');
  return { name, count: records.length, text };
}

/** Read an export back in. Returns the tally; the open model follows if a newer copy of it arrived. */
export async function importEverything(text) {
  if (!recordStore) throw new Error('The record store is not open yet.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The file is not JSON.'); }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.records)) throw new Error('This is not a SysML Modeler records export.');
  const { writes, tally } = mergeIncoming(await recordStore.all(), data.records);
  if (writes.length) await recordStore.put(writes);
  await adopt(writes);
  if (syncConfigured()) void syncNow();
  return { ...tally, written: writes.length, total: (await recordStore.all()).length };
}

/** One sync, now. A failure is reported through the status, never thrown at a caller. */
export async function syncNow() {
  if (!engine) { set({ hint: portal ? 'Not signed in.' : 'Set a sync server in Settings first.' }); return null; }
  await commit();
  try {
    const result = await engine.sync();
    if (result.applied.length) await adopt(result.applied);
    return result;
  } catch (err) {
    set({ hint: `Sync failed: ${err.message}` });
    return null;
  } finally {
    announce();
  }
}

/** Sync because the model was just written to a file, if that is switched on. */
export function syncAfterSave() { if (syncConfigured()) void syncNow(); }

/**
 * What to do with a model that arrived from somewhere else.
 *   'ignore'  nothing for this model came back
 *   'take'    it is newer and nothing here is unsaved: replace what is open
 *   'ask'     it is newer but this model has unsaved edits
 * Pure and exported: the one rule here worth a test that needs no browser.
 */
export function decideRemote({ dirty, applied, modelId }) {
  const remote = (applied || []).find((r) => r.id === modelId && r.type === 'document' && !r.deletedAt);
  if (!remote) return { action: 'ignore', remote: null };
  return { action: dirty ? 'ask' : 'take', remote };
}

async function adopt(applied) {
  const { action, remote } = decideRemote({ dirty: store.ui.dirty, applied, modelId: docModelId });
  if (action === 'ignore' || !doc) return;
  if (action === 'take') { load(remote); return; }
  const { confirmDialog } = await import('../ui/dialog.js');
  const mine = new Date(doc.record.updatedAt || Date.now()).toLocaleString();
  const theirs = new Date(remote.updatedAt).toLocaleString();
  const takeTheirs = await confirmDialog('A newer model arrived',
    `Another device saved “${remote.name}” at ${theirs}; this window's copy is from ${mine} and has changes you have not saved. Replace them with the version that arrived, or keep yours and send it on the next sync?`,
    'Use the newer model');
  if (takeTheirs) load(remote);
  else { doc.edit(serialize(store.model), store.model.name); await doc.save(); }
}

/** Every model on this device's shelf — what has synced in, and what was written here. Newest first. */
export async function listSyncedModels() {
  if (!recordStore) return [];
  const all = await recordStore.all();
  return all.filter((r) => r && r.type === 'document' && r.format === FORMAT && !r.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, origin: r.origin, open: r.id === docModelId }));
}

/** Open a model from the shelf. Unsaved edits to the current one are the caller's to guard. */
export async function openSyncedModel(id) {
  if (!recordStore) return false;
  const record = await recordStore.get(id);
  if (!record || record.deletedAt) return false;
  let parsed;
  try { parsed = parse(record.body).model; } catch { set({ hint: 'That model could not be read.' }); return false; }
  adopting = true;
  try { loadModel(parsed, null); markSaved(null); } finally { adopting = false; }
  return true;
}

/** Put a record's model on screen. */
function load(remote) {
  if (!doc.accept(remote)) return;
  let parsed;
  try { parsed = parse(remote.body).model; } catch { set({ hint: 'A model arrived that could not be read.' }); return; }
  adopting = true;
  try {
    loadModel(parsed, store.ui.fileName);
    markSaved(store.ui.fileName);
    set({ hint: `Updated from ${remote.origin === deviceId() ? 'another window' : 'another device'}.` });
  } finally {
    adopting = false;
  }
}
