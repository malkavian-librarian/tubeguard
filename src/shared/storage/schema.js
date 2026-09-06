import { DB_NAME, DB_VERSION, STORE } from '../constants.js';
import { analysisError } from '../analysis-validation.js';

let _db = null;

export function openDB() {
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
      for (const name of Object.values(STORE)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      const legacy = e.target.transaction.objectStore(STORE.SESSIONS);
      if (!legacy.indexNames.contains('captureDate')) legacy.createIndex('captureDate', ['sessionId', 'date'], { unique: true });
      for(const [name,index,key] of [[STORE.CHUNKS,'endedAt','endedAt'],[STORE.CHUNKS,'videoId','videoId'],[STORE.CHUNKS,'policyRevision','policyRevision'],[STORE.RUNS,'status','status'],[STORE.CLASSIFICATIONS,'createdAt','createdAt'],[STORE.COVERAGE,'channelId','channelId']]){
        const store=e.target.transaction.objectStore(name);if(!store.indexNames.contains(index))store.createIndex(index,key);
      }
      // v3: compound/range indexes for hot-path accounting queries (getChannelAccounting,
      // planBlock, selectRunBatch, claimRun) and for periodic pruning — avoids full-table
      // getAll()+JS-filter scans that grow linearly with lifetime IndexedDB size.
      for(const [name,index,key,opts] of [
        [STORE.COVERAGE,'policyRevision','policyRevision'],
        [STORE.COVERAGE,'policyRevision_channelId',['policyRevision','channelId']],
        [STORE.CLASSIFICATIONS,'policyRevision','policyRevision'],
        [STORE.CLASSIFICATIONS,'videoId_evidenceVersion',['videoId','evidenceVersion']],
        [STORE.RUNS,'configGeneration','configGeneration'],
        [STORE.OWNERSHIP,'aliases','aliases',{multiEntry:true}],
      ]){
        const store=e.target.transaction.objectStore(name);if(!store.indexNames.contains(index))store.createIndex(index,key,opts);
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; _db.onversionchange = () => { _db.close(); _db = null; }; resolve(_db); };
    req.onblocked = () => reject(analysisError('DB_UPGRADE_BLOCKED'));
    req.onerror   = (e) => reject(e.target.error);
  });
}

export function idbReq(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = fn(store);
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || analysisError('TRANSACTION_ABORTED'));
    req.onerror   = (e) => reject(e.target.error);
  }));
}
