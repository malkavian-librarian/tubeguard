import { SELECTORS, MessageType } from '../shared/constants.js';

let blockedChannels = new Set();
let blockedVideos   = new Set();
let blockedKeywords = [];
let enabled         = true;

// ── Init / update ─────────────────────────────────────────────────────────────

export function init({ channels = [], videos = [], keywords = [], enabled: en = true }) {
  blockedChannels = new Set(channels);
  blockedVideos   = new Set(videos);
  blockedKeywords = keywords;
  enabled         = en;
}

export function updateEnabled(val)          { enabled = val; }
export function addBlockedChannel(id)       { blockedChannels.add(id); }
export function removeBlockedChannel(id)    { blockedChannels.delete(id); }
export function addBlockedVideo(id)         { blockedVideos.add(id); }
export function removeBlockedVideo(id)      { blockedVideos.delete(id); }

// ── Extraction helpers ────────────────────────────────────────────────────────

export function extractChannelId(el) {
  if (el.matches && el.matches('#page-header, ytd-c4-tabbed-header-renderer, ytd-channel-header-renderer')) {
    const url = location.href;
    const m1  = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
    const m2  = url.match(/youtube\.com\/@([\w.-]+)/);
    if (m1) return m1[1];
    if (m2) return `@${m2[1]}`;
  }
  // /channel/UC... links
  for (const a of el.querySelectorAll('a[href*="/channel/"]')) {
    const m = (a.href || '').match(/\/channel\/(UC[\w-]{22})/);
    if (m) return m[1];
  }
  // /@handle links
  for (const a of el.querySelectorAll('a[href^="/@"]')) {
    const m = (a.href || '').match(/\/@([\w.-]+)/);
    if (m) return `@${m[1]}`;
  }
  // element itself is a link
  if (el.href) {
    const m1 = el.href.match(/\/channel\/(UC[\w-]{22})/);
    if (m1) return m1[1];
    const m2 = el.href.match(/\/@([\w.-]+)/);
    if (m2) return `@${m2[1]}`;
  }
  return null;
}

export function extractVideoId(el) {
  for (const a of el.querySelectorAll('a[href*="watch?v="], a[href*="/shorts/"]')) {
    const m1 = (a.href || '').match(/watch\?v=([\w-]{11})/);
    if (m1) return m1[1];
    const m2 = (a.href || '').match(/\/shorts\/([\w-]{11})/);
    if (m2) return m2[1];
  }
  return null;
}

export function extractChannelName(el) {
  const nameEl = el.querySelector(SELECTORS.CHANNEL_NAME_TEXT);
  return nameEl ? nameEl.textContent.trim() : '';
}

// ── Blocking logic ────────────────────────────────────────────────────────────

function isBlocked(channelId, videoId, text) {
  if (channelId && blockedChannels.has(channelId)) return true;
  if (videoId   && blockedVideos.has(videoId))     return true;
  if (text && blockedKeywords.length) {
    const lower = text.toLowerCase();
    for (const kw of blockedKeywords) {
      if (lower.includes(kw.toLowerCase())) return true;
    }
  }
  return false;
}

export function hideElement(el) {
  el.style.display = 'none';
  Promise.resolve().then(() => { if (el.parentNode) el.remove(); });
}

export function processElement(el) {
  if (!enabled) return false;
  const channelId   = extractChannelId(el);
  const videoId     = extractVideoId(el);
  const channelName = extractChannelName(el);

  if (isBlocked(channelId, videoId, channelName)) {
    hideElement(el);
    return true;
  }
  return false;
}

// ── Full-page scan ────────────────────────────────────────────────────────────

export function scanDocument() {
  if (!enabled) return;

  for (const el of document.querySelectorAll(SELECTORS.ALL_VIDEO_CONTAINERS)) {
    processElement(el);
  }
  for (const el of document.querySelectorAll(SELECTORS.CHANNEL_RENDERER)) {
    processElement(el);
  }

  // Comment blocking — username string match (v1: imprecise but useful)
  for (const comment of document.querySelectorAll(SELECTORS.COMMENT_RENDERER)) {
    const authorEl = comment.querySelector(SELECTORS.COMMENT_AUTHOR);
    if (!authorEl) continue;
    const name = authorEl.textContent.trim();
    if (blockedKeywords.length && isBlocked(null, null, name)) hideElement(comment);
  }

  maybeOverlayBlockedChannelPage();
  const owner=document.querySelector(SELECTORS.WATCH_CHANNEL_LINK);
  const id=owner?extractChannelId(owner):null;
  const videoId=new URL(location.href).searchParams.get('v');
  if((id&&blockedChannels.has(id))||(videoId&&blockedVideos.has(videoId))){
    const player=document.querySelector(SELECTORS.WATCH_PLAYER),video=player?.querySelector(SELECTORS.WATCH_VIDEO);
    if(video)video.pause();
    if(player)hideElement(player);
  }
}

// ── Channel-page overlay ──────────────────────────────────────────────────────

function maybeOverlayBlockedChannelPage() {
  const url = location.href;
  const m1  = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  const m2  = url.match(/youtube\.com\/@([\w.-]+)/);
  const id  = m1 ? m1[1] : (m2 ? `@${m2[1]}` : null);
  if (!id || !blockedChannels.has(id)) return;

  if (document.getElementById('tubeguard-channel-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'tubeguard-channel-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;',
    'color:#fff;font-family:Roboto,Arial,sans-serif;',
  ].join('');

  const msg = document.createElement('p');
  msg.style.cssText = 'font-size:20px;font-weight:500;margin:0;';
  msg.textContent = 'This channel is blocked by TubeGuard.';

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:8px 20px;background:#c00;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:15px;';
  btn.textContent = 'Unblock Channel';
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MessageType.UNBLOCK_CHANNEL, payload: { channelId: id } });
    overlay.remove();
  });

  overlay.appendChild(msg);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}
