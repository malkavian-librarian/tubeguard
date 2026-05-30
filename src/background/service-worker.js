import { MessageType, CHANNEL_ID_PATTERN, STATS_PAGE_PATH } from '../shared/constants.js';
import { settings, blocklistMeta, sessions } from '../shared/storage.js';
import { onMessage } from '../shared/message-bus.js';
import { registerAlarms, handleAlarm } from './alarm-manager.js';
import { toDateString } from '../shared/utils.js';

// ── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const current = await settings.get();
  // Ensure all keys exist with safe defaults (no-op if already set)
  await settings.set({
    blockedChannels: current.blockedChannels ?? [],
    blockedVideos:   current.blockedVideos   ?? [],
    blockedKeywords: current.blockedKeywords ?? [],
    enabled:         current.enabled         ?? true,
    notifications:   current.notifications   ?? {
      enabled: false, globalDailyLimitMinutes: 0, perChannelLimits: {},
    },
    telemetry: current.telemetry ?? { enabled: false, userId: null },
  });
  registerAlarms();
});

chrome.runtime.onStartup.addListener(() => registerAlarms());

chrome.alarms.onAlarm.addListener(handleAlarm);

// ── Message handling ─────────────────────────────────────────────────────────

onMessage(async (msg) => {
  switch (msg.type) {
    case MessageType.BLOCK_CHANNEL:   return blockChannel(msg.payload);
    case MessageType.UNBLOCK_CHANNEL: return unblockChannel(msg.payload);
    case MessageType.BLOCK_VIDEO:     return blockVideo(msg.payload);
    case MessageType.UNBLOCK_VIDEO:   return unblockVideo(msg.payload);
    case MessageType.TRACK_SESSION:   return trackSession(msg.payload);
    case MessageType.SET_SETTING:     return setSetting(msg.payload);
    default: return null;
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function blockChannel({ channelId, channelName }) {
  if (!CHANNEL_ID_PATTERN.test(channelId)) return { error: 'Invalid channel ID' };

  const current = await settings.get();
  const blocked = new Set(current.blockedChannels);
  blocked.add(channelId);
  await settings.set({ blockedChannels: [...blocked] });

  await blocklistMeta.put({
    id: channelId, type: 'channel',
    name: channelName || channelId, blockedAt: Date.now(),
  });

  broadcastToYouTube({ type: MessageType.BLOCK_CHANNEL, payload: { channelId } });
  return { ok: true };
}

async function unblockChannel({ channelId }) {
  const current = await settings.get();
  await settings.set({ blockedChannels: current.blockedChannels.filter(id => id !== channelId) });
  await blocklistMeta.delete(channelId);
  broadcastToYouTube({ type: MessageType.UNBLOCK_CHANNEL, payload: { channelId } });
  return { ok: true };
}

async function blockVideo({ videoId, videoTitle }) {
  const current = await settings.get();
  const blocked = new Set(current.blockedVideos);
  blocked.add(videoId);
  await settings.set({ blockedVideos: [...blocked] });

  await blocklistMeta.put({
    id: videoId, type: 'video',
    name: videoTitle || videoId, blockedAt: Date.now(),
  });

  broadcastToYouTube({ type: MessageType.BLOCK_VIDEO, payload: { videoId } });
  return { ok: true };
}

async function unblockVideo({ videoId }) {
  const current = await settings.get();
  await settings.set({ blockedVideos: current.blockedVideos.filter(id => id !== videoId) });
  await blocklistMeta.delete(videoId);
  broadcastToYouTube({ type: MessageType.UNBLOCK_VIDEO, payload: { videoId } });
  return { ok: true };
}

async function trackSession(data) {
  if (!data.duration || data.duration < 1) return { ok: true };
  await sessions.add({
    channelId:   data.channelId   || 'unknown',
    channelName: data.channelName || 'Unknown',
    videoId:     data.videoId     || '',
    videoTitle:  data.videoTitle  || '',
    startTime:   data.startTime   || Date.now(),
    duration:    data.duration,
    date:        toDateString(new Date(data.startTime || Date.now())),
  });
  return { ok: true };
}

async function setSetting({ key, value }) {
  await settings.set({ [key]: value });
  return { ok: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcastToYouTube(msg) {
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  });
}
