import { scanDocument } from './blocker.js';
import { injectBlockButtons } from './ui-injector.js';

let observer     = null;
let debounceTimer = null;
let lastUrl       = location.href;

function flush() {
  scanDocument();
  injectBlockButtons();
}

function scheduleScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  // 16 ms ≈ one animation frame — keeps observer callback fast
  debounceTimer = setTimeout(() => { debounceTimer = null; flush(); }, 16);
}

export function startObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length) { scheduleScan(); return; }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  patchHistory();
}

export function stopObserver() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
}

// ── SPA navigation ────────────────────────────────────────────────────────────

function patchHistory() {
  const orig = history.pushState.bind(history);
  history.pushState = (...args) => { orig(...args); onNavigate(); };
  window.addEventListener('popstate', onNavigate);
  // YouTube fires this event on every SPA transition
  document.addEventListener('yt-navigate-finish', onNavigate);
}

function onNavigate() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  // Staggered scans to catch content that YouTube renders in batches
  setTimeout(flush, 100);
  setTimeout(flush, 600);
  setTimeout(flush, 1500);
}
