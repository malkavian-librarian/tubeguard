import { MessageType } from './constants.js';

const VALID_TYPES = new Set(Object.values(MessageType));

function validate(type) {
  if (!VALID_TYPES.has(type)) throw new Error(`Unknown message type: ${type}`);
}

export function send(type, payload = {}, requestId = null) {
  validate(type);
  const msg = { type, payload };
  if (requestId) msg.requestId = requestId;
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker may be inactive — not a fatal error for fire-and-forget calls
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function sendToTab(tabId, type, payload = {}) {
  validate(type);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, payload }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

export function onMessage(handler) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !VALID_TYPES.has(msg.type)) return false;
    const result = handler(msg, sender);
    if (result instanceof Promise) {
      result
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true; // keep channel open for async response
    }
    if (result !== undefined) sendResponse(result);
    return false;
  });
}
