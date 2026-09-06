import { ALARM_NAME } from '../shared/constants.js';
import { sessions, settings, analysisStore } from '../shared/storage.js';
import { showLimitNotification } from './notification.js';
import { toDateString } from '../shared/utils.js';

export const PRUNE_ALARM_NAME = 'analysis-data-prune';

export function registerAlarms() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 15 });
    }
  });
  chrome.alarms.get(PRUNE_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(PRUNE_ALARM_NAME, { periodInMinutes: 1440 });
    }
  });
}

export async function handleAlarm(alarm) {
  if (alarm.name === PRUNE_ALARM_NAME) {
    await analysisStore.pruneAging();
    return;
  }
  if (alarm.name !== ALARM_NAME) return;

  const prefs = await settings.get();
  if (!prefs.notifications?.enabled) return;

  const today        = toDateString();
  const todaySessions = await sessions.getByDateRange(today, today);

  // Aggregate watch time per channel for today
  const channelTime = {};
  for (const s of todaySessions) {
    if (!channelTime[s.channelId]) {
      channelTime[s.channelId] = { name: s.channelName || s.channelId, seconds: 0 };
    }
    channelTime[s.channelId].seconds += s.duration;
    // keep most recent channel name
    if (s.channelName) channelTime[s.channelId].name = s.channelName;
  }

  // Retrieve already-notified channels to enforce one notification per channel per day
  const notifiedKey               = `notified-${today}`;
  const stored                    = await new Promise(r =>
    chrome.storage.local.get({ [notifiedKey]: [] }, r));
  const notifiedToday             = stored[notifiedKey];
  const newlyNotified             = [...notifiedToday];

  const globalLimit       = prefs.notifications.globalDailyLimitMinutes || 0;
  const perChannelLimits  = prefs.notifications.perChannelLimits || {};

  for (const [channelId, { name, seconds }] of Object.entries(channelTime)) {
    if (notifiedToday.includes(channelId)) continue;

    const limitMinutes = perChannelLimits[channelId] ?? globalLimit;
    if (!limitMinutes) continue;

    const watchedMinutes = seconds / 60;
    if (watchedMinutes >= limitMinutes) {
      showLimitNotification({ channelId, channelName: name, watchedMinutes, limitMinutes });
      newlyNotified.push(channelId);
    }
  }

  if (newlyNotified.length !== notifiedToday.length) {
    await new Promise(r => chrome.storage.local.set({ [notifiedKey]: newlyNotified }, r));
  }
}
