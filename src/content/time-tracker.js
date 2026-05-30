import { MessageType } from '../shared/constants.js';
import { toDateString } from '../shared/utils.js';

let session  = null;
let videoEl  = null;
let videoObs = null;

// ── Public init ───────────────────────────────────────────────────────────────

export function initTimeTracker() {
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('yt-navigate-finish', onNavigate);
  findAndAttach();
}

// ── Video element discovery ───────────────────────────────────────────────────

function findAndAttach() {
  const v = document.querySelector('video');
  if (v) {
    attachVideo(v);
    return;
  }
  // Watch for video element to appear in a SPA that hasn't rendered yet
  videoObs = new MutationObserver(() => {
    const v2 = document.querySelector('video');
    if (v2) { videoObs.disconnect(); videoObs = null; attachVideo(v2); }
  });
  videoObs.observe(document.body, { childList: true, subtree: true });
}

function attachVideo(v) {
  if (videoEl === v) return;
  detachVideo();
  videoEl = v;
  v.addEventListener('play',    onPlay);
  v.addEventListener('pause',   onPause);
  v.addEventListener('ended',   onEnded);
  v.addEventListener('emptied', onEnded);
  if (!v.paused && !document.hidden) beginSession();
}

function detachVideo() {
  if (!videoEl) return;
  videoEl.removeEventListener('play',    onPlay);
  videoEl.removeEventListener('pause',   onPause);
  videoEl.removeEventListener('ended',   onEnded);
  videoEl.removeEventListener('emptied', onEnded);
  videoEl = null;
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onPlay()       { if (!document.hidden) beginSession(); }
function onPause()      { commitSession(); }
function onEnded()      { commitSession(); detachVideo(); }
function onVisibility() { document.hidden ? commitSession() : (videoEl && !videoEl.paused && beginSession()); }

function onNavigate() {
  commitSession();
  detachVideo();
  if (videoObs) { videoObs.disconnect(); videoObs = null; }
  session = null;
  setTimeout(findAndAttach, 500);
}

// ── Session management ────────────────────────────────────────────────────────

function beginSession() {
  if (session) return;
  const info = currentVideoInfo();
  if (!info) return;
  session = { ...info, startTime: Date.now() };
}

function commitSession() {
  if (!session) return;
  const duration = (Date.now() - session.startTime) / 1000;
  if (duration >= 2) {
    chrome.runtime.sendMessage({
      type:    MessageType.TRACK_SESSION,
      payload: { ...session, duration },
    }).catch(() => {});
  }
  session = null;
}

function currentVideoInfo() {
  // Video ID from URL
  const m = location.href.match(/watch\?v=([\w-]{11})/);
  const videoId = m ? m[1] : null;
  if (!videoId) return null;

  // Video title
  const titleEl = document.querySelector([
    'h1.ytd-watch-metadata yt-formatted-string',
    '#title h1 yt-formatted-string',
    'h1.style-scope.ytd-watch-metadata',
  ].join(', '));
  const videoTitle = titleEl
    ? titleEl.textContent.trim()
    : document.title.replace(/ ?[-–|] YouTube$/, '').trim();

  // Channel
  const chanLink = document.querySelector(
    '#owner #channel-name a, #upload-info #channel-name a, ytd-channel-name a'
  );
  const channelName = chanLink ? chanLink.textContent.trim() : 'Unknown';
  const href        = chanLink?.href || '';
  const cm1         = href.match(/\/channel\/(UC[\w-]{22})/);
  const cm2         = href.match(/\/@([\w.-]+)/);
  const channelId   = cm1 ? cm1[1] : (cm2 ? `@${cm2[1]}` : channelName);

  return { videoId, videoTitle, channelId, channelName };
}
