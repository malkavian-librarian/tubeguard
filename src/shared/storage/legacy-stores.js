import { STORE, DEFAULT_SETTINGS } from '../constants.js';
import { idbReq } from './schema.js';

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
    chrome.storage.sync.set(updates, () => resolve())),

  getBlockedChannels: () => new Promise((resolve) =>
    chrome.storage.sync.get({ blockedChannels: [] }, (i) =>
      resolve(i.blockedChannels || []))),

  getBlockedVideos: () => new Promise((resolve) =>
    chrome.storage.sync.get({ blockedVideos: [] }, (i) =>
      resolve(i.blockedVideos || []))),
};
