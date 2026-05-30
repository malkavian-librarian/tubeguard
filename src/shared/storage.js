import { DB_NAME, DB_VERSION, STORE, DEFAULT_SETTINGS } from './constants.js';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORE.SESSIONS)) {
        const s = db.createObjectStore(STORE.SESSIONS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('channelId', 'channelId');
        s.createIndex('videoId',   'videoId');
        s.createIndex('date',      'date');
      }

      if (!db.objectStoreNames.contains(STORE.BLOCKLIST_META)) {
        db.createObjectStore(STORE.BLOCKLIST_META, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE.STATS_CACHE)) {
        db.createObjectStore(STORE.STATS_CACHE, { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

function idbReq(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  }));
}

// ── Sessions ────────────────────────────────────────────────────────────────

export const sessions = {
  add: (session) =>
    idbReq(STORE.SESSIONS, 'readwrite', (s) => s.add(session)),

  getByDateRange: (startDate, endDate) =>
    idbReq(STORE.SESSIONS, 'readonly', (s) =>
      s.index('date').getAll(IDBKeyRange.bound(startDate, endDate))),

  getAll: () =>
    idbReq(STORE.SESSIONS, 'readonly', (s) => s.getAll()),
};

// ── Blocklist metadata ───────────────────────────────────────────────────────

export const blocklistMeta = {
  put:    (item) => idbReq(STORE.BLOCKLIST_META, 'readwrite', (s) => s.put(item)),
  get:    (id)   => idbReq(STORE.BLOCKLIST_META, 'readonly',  (s) => s.get(id)),
  getAll: ()     => idbReq(STORE.BLOCKLIST_META, 'readonly',  (s) => s.getAll()),
  delete: (id)   => idbReq(STORE.BLOCKLIST_META, 'readwrite', (s) => s.delete(id)),
};

// ── Stats cache ──────────────────────────────────────────────────────────────

export const statsCache = {
  get: (key) => idbReq(STORE.STATS_CACHE, 'readonly',  (s) => s.get(key)),
  put: (key, data) =>
    idbReq(STORE.STATS_CACHE, 'readwrite', (s) =>
      s.put({ key, data, computedAt: Date.now() })),
};

// ── Settings (chrome.storage.sync) ──────────────────────────────────────────

export const settings = {
  get: () => new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) =>
      resolve({ ...DEFAULT_SETTINGS, ...items }))),

  set: (updates) => new Promise((resolve) =>
    chrome.storage.sync.set(updates, resolve)),

  getBlockedChannels: () => new Promise((resolve) =>
    chrome.storage.sync.get({ blockedChannels: [] }, (i) =>
      resolve(i.blockedChannels || []))),

  getBlockedVideos: () => new Promise((resolve) =>
    chrome.storage.sync.get({ blockedVideos: [] }, (i) =>
      resolve(i.blockedVideos || []))),
};
