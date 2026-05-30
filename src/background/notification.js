import { STATS_PAGE_PATH } from '../shared/constants.js';

const PREFIX = 'tubeguard-limit-';

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

// Single listener for all notification button clicks
chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (!notifId.startsWith(PREFIX)) return;
  if (btnIdx === 0) {
    chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE_PATH) });
  }
  chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener((notifId) => {
  if (!notifId.startsWith(PREFIX)) return;
  chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE_PATH) });
  chrome.notifications.clear(notifId);
});
