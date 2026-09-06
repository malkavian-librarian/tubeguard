import { STATS_PAGE_PATH } from '../shared/constants.js';
import { toDateString } from '../shared/utils.js';

const PREFIX = 'tubeguard-limit-';
const SUSPENDED_PREFIX = 'tubeguard-analysis-suspended';

export function showLimitNotification({ channelId, channelName, watchedMinutes, limitMinutes }) {
  const id = `${PREFIX}${channelId}`;

  chrome.notifications.create(id, {
    type:             'basic',
    iconUrl:          chrome.runtime.getURL('assets/icons/icon128.png'),
    title:            'TubeGuard — Watch limit reached',
    message:          `You've watched "${channelName}" for ${Math.round(watchedMinutes)} min today (limit: ${limitMinutes} min).`,
    buttons:          [{ title: 'View Stats' }, { title: 'Dismiss' }],
    requireInteraction: false,
  });
}

// At most one per calendar day (per CLAUDE.md notification convention), keyed off the caller's
// notion of "now" rather than the wall clock so callers stay testable/deterministic.
export async function notifyAnalysisSuspended({ now = Date.now() } = {}) {
  const key = `${SUSPENDED_PREFIX}-notified-${toDateString(new Date(now))}`;
  const stored = await new Promise((resolve) => chrome.storage.local.get({ [key]: false }, resolve));
  if (stored[key]) return false;

  chrome.notifications.create(SUSPENDED_PREFIX, {
    type:             'basic',
    iconUrl:          chrome.runtime.getURL('assets/icons/icon128.png'),
    title:            'TubeGuard — Daily analysis stopped',
    message:          'Your OpenRouter API key was rejected. Update it in Options to resume daily learning analysis.',
    buttons:          [{ title: 'View Stats' }, { title: 'Dismiss' }],
    requireInteraction: false,
  });
  await new Promise((resolve) => chrome.storage.local.set({ [key]: true }, resolve));
  return true;
}

function isTubeGuardNotification(notifId) {
  return notifId.startsWith(PREFIX) || notifId === SUSPENDED_PREFIX;
}

// Single listener for all notification button clicks
chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (!isTubeGuardNotification(notifId)) return;
  if (btnIdx === 0) {
    chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE_PATH) });
  }
  chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener((notifId) => {
  if (!isTubeGuardNotification(notifId)) return;
  chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE_PATH) });
  chrome.notifications.clear(notifId);
});
