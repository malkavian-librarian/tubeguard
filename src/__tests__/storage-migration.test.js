import { beforeEach, expect, test, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

let storage;
beforeEach(async () => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  const local = {};
  globalThis.chrome = { storage: { local: {
    setAccessLevel: async () => {},
    get: async (key) => key === null ? { ...local } : Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, local[k]])),
    set: async (values) => Object.assign(local, values),
    remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete local[key]; },
  } } };
  storage = await import('../shared/storage.js');
});

test('upgrades v1 without losing legacy sessions and adds analysis stores', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('tubeguard-db', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      store.createIndex('date', 'date'); store.createIndex('channelId', 'channelId'); store.createIndex('videoId', 'videoId');
      store.add({ date: '2026-09-05', duration: 12, videoId: 'abcdefghijk' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  expect(await storage.sessions.getAll()).toHaveLength(1);
  expect(storage.analysisStore, 'durable analysis repository').toBeDefined();
  expect((await storage.analysisStore.getConfig()).enabled).toBe(false);
});

test('upgrades v2 to v3 without losing existing rows and adds the new hot-path indexes', async () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('tubeguard-db', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      sessions.createIndex('date', 'date'); sessions.createIndex('channelId', 'channelId'); sessions.createIndex('videoId', 'videoId');
      sessions.createIndex('captureDate', ['sessionId', 'date'], { unique: true });
      db.createObjectStore('blocklist-meta', { keyPath: 'id' });
      db.createObjectStore('stats-cache', { keyPath: 'key' });
      for (const name of ['videos', 'video-evidence', 'watch-chunks', 'capture-sessions', 'coverage', 'analysis-budgets', 'analysis-inputs', 'block-ownership', 'analysis-runs', 'classifications', 'analysis-decisions', 'block-outbox', 'analysis-state']) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
      const chunks = request.transaction.objectStore('watch-chunks');
      chunks.createIndex('endedAt', 'endedAt'); chunks.createIndex('videoId', 'videoId'); chunks.createIndex('policyRevision', 'policyRevision');
      request.transaction.objectStore('analysis-runs').createIndex('status', 'status');
      request.transaction.objectStore('classifications').createIndex('createdAt', 'createdAt');
      request.transaction.objectStore('coverage').createIndex('channelId', 'channelId');
      request.transaction.objectStore('coverage').add({ id: '0:pre-existing-chunk', chunkId: 'pre-existing-chunk', channelId, policyRevision: 0, verdict: 'irrelevant', countedMs: 120000, endedAt: 5000 });
      request.transaction.objectStore('block-ownership').add({ id: channelId, aliases: ['@legacy-alias'], manual: false, automatic: [], generation: 0, resetAt: 0 });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });

  const preUpgradeCoverage = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tubeguard-db', 2);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('coverage', 'readonly').objectStore('coverage').getAll();
      tx.onsuccess = () => { db.close(); resolve(tx.result); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
  expect(preUpgradeCoverage).toHaveLength(1);

  storage = await import('../shared/storage.js');

  const coverageAfter = await storage.analysisStore.getChannelAccounting({ policyRevision: 0, channelId });
  expect(coverageAfter.irrelevantMs).toBe(120000);
  expect(coverageAfter.coveredChunkIds).toEqual(['pre-existing-chunk']);

  const ownershipByAlias = await storage.analysisStore.getOwnership({ channelId: '@legacy-alias' });
  expect(ownershipByAlias.id).toBe(channelId);

  const ownershipDirect = await storage.analysisStore.getOwnership({ channelId });
  expect(ownershipDirect.id).toBe(channelId);
});

test('the repository supports capture, leases, audit, deletion and staged secrets', () => {
  for (const method of ['getConfig','saveConfig','getApiKey','reconcileConfig','beginCapture','upsertEvidence','acceptCheckpoint','claimRun','renewRunLease','selectRunBatch','savePreparedParts','beginAttempt','finishAttempt','commitVideoResult','getChannelAccounting','planBlock','finishRun','listHistory','listAnalysisLog','resetChannel','deleteFeatureData','listOutbox','markOutbox','setManualOwnership','getOwnership','exportPage']) {
    expect(storage.analysisStore?.[method], method).toBeTypeOf('function');
  }
});

const sender = { tabId: 1, documentId: 'doc-a' };
async function enable() {
  expect(storage.analysisStore, 'analysis storage must exist').toBeDefined();
  await storage.analysisStore.saveConfig({ enabled: true, priorities: 'Learn computing', apiKey: 'secret-SENTINEL', now: 0 });
  return storage.analysisStore;
}
function delta(capture, sequence = 1, start = 1000) {
  return { ...capture, sequence, videoId: 'abcdefghijk', navigationId: 'nav-a', startedAt: start, endedAt: start + 5000, activeMs: 5000,
    activeIntervals: [{ wallStartMs: start, wallEndMs: start + 5000, mediaStartMs: 0, mediaEndMs: 5000 }], mediaIntervals: [{ startMs: 0, endMs: 5000 }] };
}
test('duplicate checkpoint and overlapping windows cannot inflate accounting; deltas aggregate one view', async () => {
  const api = await enable();
  const capture = await api.beginCapture({ senderIdentity: sender, videoId: 'abcdefghijk', navigationId: 'nav-a' });
  const first = await api.acceptCheckpoint(delta(capture), sender);
  expect(await api.acceptCheckpoint(delta(capture), sender)).toMatchObject({ accepted: false, chunkId: first.chunkId });
  await expect(api.acceptCheckpoint(delta(capture, 3, 11000), sender)).rejects.toMatchObject({ code: 'SEQUENCE_GAP' });
  await api.acceptCheckpoint(delta(capture, 2, 6000), sender);
  const other = { tabId: 2, documentId: 'doc-b' };
  const second = await api.beginCapture({ senderIdentity: other, videoId: 'abcdefghijk', navigationId: 'nav-a' });
  expect(await api.acceptCheckpoint(delta(second, 1, 3000), other)).toMatchObject({ activeMs: 0 });
  const rows = await storage.sessions.getAll();
  expect(rows).toHaveLength(1);
  expect(rows[0].duration).toBe(10);
});
test('late old capture retains original policy but deletion fences every old capture', async () => {
  const api = await enable();
  const capture = await api.beginCapture({ senderIdentity: sender, videoId: 'abcdefghijk', navigationId: 'nav-a' });
  await api.saveConfig({ priorities: 'Learn music' });
  await api.acceptCheckpoint(delta(capture), sender);
  const page = await api.exportPage({ store: 'watch-chunks', limit: 100 });
  expect(page.items[0].policyRevision).toBe(capture.policyRevision);
  await api.deleteFeatureData({ generation: (await api.getConfig()).generation });
  await expect(api.acceptCheckpoint(delta(capture, 2, 6000), sender)).rejects.toMatchObject({ code: 'STALE_GENERATION' });
  expect((await api.exportPage({ store: 'watch-chunks' })).items).toHaveLength(0);
});
test('config secrets never enter IDB or exported settings and missing key fails disabled', async () => {
  const api = await enable();
  expect(JSON.stringify(await api.getConfig())).not.toContain('secret-SENTINEL');
  expect(await api.getApiKey()).toBe('secret-SENTINEL');
  const page = await api.exportPage({ store: 'analysis-state' });
  expect(JSON.stringify(page)).not.toContain('secret-SENTINEL');
  const config = await api.getConfig();
  await chrome.storage.local.remove((await chrome.storage.local.get(null)) && Object.keys(await chrome.storage.local.get(null)));
  expect((await api.reconcileConfig()).enabled).toBe(false);
  expect(config.hasKey).toBe(true);
});
test('concurrent claims have one owner and an expired token cannot commit', async () => {
  const api = await enable();
  const claims = await Promise.all(['a','b'].map(owner => api.claimRun({ now: 86400000, owner, leaseMs: 1000 })));
  const run = claims.find(Boolean);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const recovered = await api.claimRun({ now: 86402000, owner: 'c', leaseMs: 1000 });
  expect(recovered.runId).toBe(run.runId);
  await expect(api.finishRun({ ...run, status: 'completed', nextDueAt: 172800000 })).rejects.toMatchObject({ code: 'LEASE_LOST' });
});
