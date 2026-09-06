import { STORE } from '../constants.js';
import { openDB } from './schema.js';
import { DEFAULT_AI_CONFIG, ANALYSIS_ADMISSION_BYTES } from '../analysis-contracts.js';
import { assert, analysisError, byteLength } from '../analysis-validation.js';

export const featureStores = Object.values(STORE).filter(s => ![STORE.SESSIONS, STORE.BLOCKLIST_META, STORE.STATS_CACHE].includes(s));
export const uuid = () => crypto.randomUUID();
const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function transaction(names, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(names)], mode);
    const api = {
      get: (name, id) => request(tx.objectStore(name).get(id)),
      all: name => request(tx.objectStore(name).getAll()),
      put: (name, value) => request(tx.objectStore(name).put(value)),
      delete: (name, id) => request(tx.objectStore(name).delete(id)),
      clear: name => request(tx.objectStore(name).clear()),
      index: (name, index, key) => request(tx.objectStore(name).index(index).get(key)),
      indexed: (name,index,key) => request(tx.objectStore(name).index(index).getAll(key)),
    };
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || analysisError('TRANSACTION_ABORTED'));
    tx.onerror = () => {};
    Promise.resolve().then(() => work(api)).then(r => { result = r; }).catch(e => { failure = e; try { tx.abort(); } catch { reject(e); } });
  });
}
export async function configIn(tx) {
  let c = await tx.get(STORE.STATE, 'config');
  if (!c) { c = { ...DEFAULT_AI_CONFIG, id: 'config', generation: uuid() }; await tx.put(STORE.STATE, c); }
  return c;
}
export const mutate = async (names, fn) => {
  try{return await transaction([STORE.STATE, ...names], 'readwrite', async tx => fn(tx, await configIn(tx)));}
  catch(e){
    if(e.code==='STORAGE_FULL'||e.name==='QuotaExceededError')await transaction([STORE.STATE],'readwrite',async tx=>{const c=await configIn(tx);c.storagePressure=true;await tx.put(STORE.STATE,c);}).catch(()=>{});
    throw e;
  }
};
export async function charge(tx, c, value) {
  const size = byteLength(value);
  assert(c.storageBytes + size < ANALYSIS_ADMISSION_BYTES, 'STORAGE_FULL');
  c.storageBytes += size; await tx.put(STORE.STATE, c);
}
export async function checkRun(tx, c, ref) {
  const run = await tx.get(STORE.RUNS, ref.runId);
  assert(run && run.leaseToken === ref.leaseToken, 'LEASE_LOST');
  assert(c.enabled && run.generation === c.generation && run.configGeneration === c.configGeneration, 'STALE_GENERATION');
  return run;
}
export async function checkCapture(tx, c, input, sender) {
  const s = await tx.get(STORE.CAPTURES, input.sessionId);
  assert(s && s.generation === c.generation && c.enabled, 'STALE_GENERATION');
  assert(s.captureEpoch === input.captureEpoch && s.videoId === input.videoId && s.navigationId === input.navigationId, 'INVALID_CAPTURE');
  if (sender) assert(s.sender.tabId === sender.tabId && s.sender.documentId === sender.documentId, 'FORBIDDEN');
  return s;
}
export async function trustedLocal() { await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); return chrome.storage.local; }
export async function pageStore(store, { cursor, limit = 50, cutoff = Infinity } = {}) {
  assert(featureStores.includes(store), 'INVALID_STORE');
  limit = Math.min(100, Math.max(1, Number(limit) || 50));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), rows = [];
    let nextCursor = null;
    const r = tx.objectStore(store).openCursor(cursor ? IDBKeyRange.lowerBound(cursor, true) : undefined);
    r.onsuccess = () => {
      const item = r.result;
      if (!item) return;
      if ((item.value.createdAt ?? item.value.capturedAt ?? 0) <= cutoff) rows.push(item.value);
      if (rows.length >= limit) { nextCursor = item.key; return; }
      item.continue();
    };
    tx.oncomplete = () => resolve({ items: rows, nextCursor });
    tx.onabort = () => reject(tx.error);
  });
}
