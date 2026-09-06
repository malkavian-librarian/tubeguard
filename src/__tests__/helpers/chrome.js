import 'fake-indexeddb/auto';
import { vi } from 'vitest';

function createEvent() {
  const listeners = new Set();
  return {
    addListener: vi.fn((listener) => listeners.add(listener)),
    hasListener: vi.fn((listener) => listeners.has(listener)),
    removeListener: vi.fn((listener) => listeners.delete(listener)),
    dispatch(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

function respond(value, callback) {
  if (typeof callback === 'function') {
    callback(value);
    return undefined;
  }
  return Promise.resolve(value);
}

function selectKeys(values, keys) {
  if (keys == null) return { ...values };
  if (typeof keys === 'string') return keys in values ? { [keys]: values[keys] } : {};
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
  }
  return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]));
}

function createStorageArea(areaName, initialValues, onChanged) {
  let values = { ...initialValues };
  return {
    get: vi.fn((keys, callback) => {
      if (typeof keys === 'function') return respond({ ...values }, keys);
      return respond(selectKeys(values, keys), callback);
    }),
    set: vi.fn((items, callback) => {
      const changes = {};
      for (const [key, newValue] of Object.entries(items)) {
        changes[key] = { oldValue: values[key], newValue };
        values[key] = newValue;
      }
      if (Object.keys(changes).length > 0) onChanged.dispatch(changes, areaName);
      return respond(undefined, callback);
    }),
    remove: vi.fn((keys, callback) => {
      const changes = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (key in values) {
          changes[key] = { oldValue: values[key], newValue: undefined };
          delete values[key];
        }
      }
      if (Object.keys(changes).length > 0) onChanged.dispatch(changes, areaName);
      return respond(undefined, callback);
    }),
    clear: vi.fn((callback) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, oldValue]) => [key, { oldValue, newValue: undefined }]),
      );
      values = {};
      if (Object.keys(changes).length > 0) onChanged.dispatch(changes, areaName);
      return respond(undefined, callback);
    }),
  };
}

export function installChromeMock(seed = {}) {
  const storageChanged = createEvent();
  const chrome = {
    alarms: {
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      get: vi.fn(() => Promise.resolve(undefined)),
      onAlarm: createEvent(),
    },
    notifications: {
      create: vi.fn(() => Promise.resolve('notification-id')),
      clear: vi.fn(() => Promise.resolve(true)),
      onButtonClicked: createEvent(),
      onClicked: createEvent(),
    },
    runtime: {
      getURL: vi.fn((path) => `chrome-extension://test-extension/${path}`),
      onMessage: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent(),
      sendMessage: vi.fn(() => Promise.resolve(undefined)),
    },
    storage: {
      onChanged: storageChanged,
    },
    tabs: {
      create: vi.fn(() => Promise.resolve({ id: 1 })),
      query: vi.fn(() => Promise.resolve([])),
      sendMessage: vi.fn(() => Promise.resolve(undefined)),
    },
  };
  chrome.storage.local = createStorageArea('local', seed.local, storageChanged);
  chrome.storage.sync = createStorageArea('sync', seed.sync, storageChanged);
  globalThis.chrome = chrome;
  return chrome;
}

export function resetChromeMock() {
  delete globalThis.chrome;
  globalThis.indexedDB = new IDBFactory();
}
