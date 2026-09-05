const OPTIONS_TYPES = new Set(['GET_AI_SETTINGS', 'SAVE_AI_SETTINGS', 'GET_HISTORY', 'GET_ANALYSIS_LOG', 'RUN_ANALYSIS_NOW', 'EXPORT_AI_DATA', 'DELETE_AI_DATA']);
const CAPTURE_TYPES = new Set(['BEGIN_CAPTURE', 'UPSERT_VIDEO_EVIDENCE', 'RECORD_WATCH_CHECKPOINT', 'TRACK_SESSION']);
const SHARED_TYPES = new Set(['BLOCK_CHANNEL', 'UNBLOCK_CHANNEL', 'BLOCK_VIDEO', 'UNBLOCK_VIDEO', 'GET_STATS']);

function reject(code = 'FORBIDDEN') { throw Object.assign(new Error(code), { code }); }

export function authorizeMessage(msg, sender, extensionId) {
  if (sender?.id !== extensionId || typeof msg?.type !== 'string') reject();
  let url;
  try { url = new URL(sender.url); } catch { reject(); }
  const trustedPage = url.protocol === 'chrome-extension:' && url.host === extensionId &&
    new Set(['/src/options/options.html', '/src/popup/popup.html', '/src/stats/stats.html']).has(url.pathname);
  const content = url.origin === 'https://www.youtube.com' && sender.frameId === 0 && Number.isInteger(sender.tab?.id);
  if (OPTIONS_TYPES.has(msg.type)) {
    if (!trustedPage || url.pathname !== '/src/options/options.html') reject();
  } else if (CAPTURE_TYPES.has(msg.type)) {
    if (!content) reject();
  } else if (SHARED_TYPES.has(msg.type)) {
    if (!trustedPage && !content) reject();
  } else if (msg.type === 'SET_SETTING') {
    if (!trustedPage) reject();
    validateLegacySetting(msg.payload);
  } else reject('UNKNOWN_TYPE');
  return true;
}

export function validateLegacySetting({ key, value } = {}) {
  if (key === 'enabled' && typeof value === 'boolean') return true;
  if (key === 'notifications' && value && typeof value === 'object' && !Array.isArray(value)) {
    if (Object.keys(value).some(k => !['enabled', 'globalDailyLimitMinutes', 'perChannelLimits'].includes(k))) reject('INVALID_SETTING');
    if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.globalDailyLimitMinutes) || value.globalDailyLimitMinutes < 0 || value.globalDailyLimitMinutes > 1440) reject('INVALID_SETTING');
    if (!value.perChannelLimits || typeof value.perChannelLimits !== 'object' || Array.isArray(value.perChannelLimits)) reject('INVALID_SETTING');
    for (const [id, minutes] of Object.entries(value.perChannelLimits)) {
      if (!/^UC[\w-]{22}$|^@[\w.-]+$/.test(id) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) reject('INVALID_SETTING');
    }
    return true;
  }
  reject('INVALID_SETTING');
}
