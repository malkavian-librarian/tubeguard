import { init, scanDocument, addBlockedChannel, removeBlockedChannel, addBlockedVideo, removeBlockedVideo, updateEnabled } from './blocker.js';
import { startObserver, stopObserver } from './observer.js';
import { injectBlockButtons } from './ui-injector.js';
import { initTimeTracker } from './time-tracker.js';
import { MessageType } from '../shared/constants.js';

async function bootstrap() {
  // Load block list synchronously from sync storage — fastest possible path
  const prefs = await new Promise(resolve =>
    chrome.storage.sync.get({
      blockedChannels: [], blockedVideos: [], blockedKeywords: [], enabled: true,
    }, resolve)
  );

  init({
    channels: prefs.blockedChannels,
    videos:   prefs.blockedVideos,
    keywords: prefs.blockedKeywords,
    enabled:  prefs.enabled,
  });

  if (!prefs.enabled) return;

  startObserver();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onMessage);
}

function onReady() {
  scanDocument();
  injectBlockButtons();
  initTimeTracker();

  // Retry injections for lazy-rendered content
  setTimeout(injectBlockButtons, 1000);
  setTimeout(injectBlockButtons, 3000);
}

function onStorageChanged(changes, area) {
  if (area !== 'sync') return;

  if (changes.enabled !== undefined) {
    const on = changes.enabled.newValue;
    updateEnabled(on);
    if (on) startObserver(); else stopObserver();
  }

  if (changes.blockedChannels) {
    const oldSet = new Set(changes.blockedChannels.oldValue || []);
    const newSet = new Set(changes.blockedChannels.newValue || []);
    for (const id of newSet) { if (!oldSet.has(id)) addBlockedChannel(id); }
    for (const id of oldSet) { if (!newSet.has(id)) removeBlockedChannel(id); }
    scanDocument();
  }

  if (changes.blockedVideos) {
    const oldSet = new Set(changes.blockedVideos.oldValue || []);
    const newSet = new Set(changes.blockedVideos.newValue || []);
    for (const id of newSet) { if (!oldSet.has(id)) addBlockedVideo(id); }
    for (const id of oldSet) { if (!newSet.has(id)) removeBlockedVideo(id); }
    scanDocument();
  }
}

function onMessage(msg) {
  if (!msg?.type) return;
  switch (msg.type) {
    case MessageType.BLOCK_CHANNEL:   addBlockedChannel(msg.payload.channelId); scanDocument(); break;
    case MessageType.UNBLOCK_CHANNEL: removeBlockedChannel(msg.payload.channelId); break;
    case MessageType.BLOCK_VIDEO:     addBlockedVideo(msg.payload.videoId);     scanDocument(); break;
    case MessageType.UNBLOCK_VIDEO:   removeBlockedVideo(msg.payload.videoId);  break;
  }
}

bootstrap().catch(console.error);
