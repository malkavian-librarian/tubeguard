import { settings, sessions } from '../shared/storage.js';
import { MessageType, STATS_PAGE_PATH } from '../shared/constants.js';
import { formatDuration, toDateString } from '../shared/utils.js';

async function init() {
  document.getElementById('open-learning').addEventListener('click',()=>chrome.runtime.openOptionsPage());
  const prefs    = await settings.get();
  const today    = toDateString();
  const todaySessions = await sessions.getByDateRange(today, today);

  // Blocked channel count
  const blockedCount = (prefs.blockedChannels || []).length;
  setEl('stat-blocked', blockedCount);

  // Today's watch time
  const todaySeconds = todaySessions.reduce((s, r) => s + (r.duration || 0), 0);
  setEl('stat-today', formatDuration(todaySeconds));

  // Enable toggle
  const enabledToggle = document.getElementById('enabled-toggle');
  enabledToggle.checked = prefs.enabled !== false;
  enabledToggle.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type:    MessageType.SET_SETTING,
      payload: { key: 'enabled', value: enabledToggle.checked },
    }).catch(() => {});
    // Fallback direct write if service worker is sleeping
    setStatus(enabledToggle.checked ? 'Blocking enabled' : 'Blocking disabled');
  });

  // Notifications toggle
  const notifToggle = document.getElementById('notif-toggle');
  notifToggle.checked = prefs.notifications?.enabled || false;
  notifToggle.addEventListener('change', () => saveNotifSetting(prefs));

  // Global daily limit
  const limitInput = document.getElementById('daily-limit');
  limitInput.value = prefs.notifications?.globalDailyLimitMinutes || '';
  limitInput.addEventListener('change', () => saveNotifSetting(prefs));

  // Open stats
  document.getElementById('open-stats').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE_PATH) });
    window.close();
  });
}

function saveNotifSetting(prefs) {
  const notifEnabled = document.getElementById('notif-toggle').checked;
  const globalLimit  = parseInt(document.getElementById('daily-limit').value, 10) || 0;
  const updated = {
    ...prefs.notifications,
    enabled:                 notifEnabled,
    globalDailyLimitMinutes: globalLimit,
  };
  chrome.runtime.sendMessage({type:MessageType.SET_SETTING,payload:{key:'notifications',value:updated}}).catch(()=>setStatus('Could not save settings'));
  prefs.notifications = updated;
  setStatus('Settings saved');
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setStatus(msg) {
  const el = document.getElementById('status-text');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2000);
}

init().catch(console.error);
