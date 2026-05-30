export const MessageType = {
  BLOCK_CHANNEL:       'BLOCK_CHANNEL',
  UNBLOCK_CHANNEL:     'UNBLOCK_CHANNEL',
  BLOCK_VIDEO:         'BLOCK_VIDEO',
  UNBLOCK_VIDEO:       'UNBLOCK_VIDEO',
  GET_STATS:           'GET_STATS',
  SET_SETTING:         'SET_SETTING',
  TRACK_SESSION:       'TRACK_SESSION',
  NOTIFICATION_ACTION: 'NOTIFICATION_ACTION',
};

export const BlockType = {
  CHANNEL:  'channel',
  VIDEO:    'video',
  COMMENT:  'comment',
  PLAYLIST: 'playlist',
};

export const DB_NAME    = 'tubeguard-db';
export const DB_VERSION = 1;

export const STORE = {
  SESSIONS:       'sessions',
  BLOCKLIST_META: 'blocklist-meta',
  STATS_CACHE:    'stats-cache',
};

export const DEFAULT_SETTINGS = {
  blockedChannels:  [],
  blockedVideos:    [],
  blockedKeywords:  [],
  enabled:          true,
  notifications: {
    enabled:                 false,
    globalDailyLimitMinutes: 0,
    perChannelLimits:        {},
  },
  telemetry: {
    enabled: false,
    userId:  null,
  },
};

// Must match /^UC[\w-]{22}$|^@[\w.-]+$/
export const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$|^@[\w.-]+$/;

// YouTube DOM selectors — last verified: 2026-05-30
export const SELECTORS = {
  // Feed / search / subscriptions containers
  FEED_VIDEO_RENDERER:    'ytd-rich-item-renderer',
  VIDEO_RENDERER:         'ytd-video-renderer',
  COMPACT_VIDEO_RENDERER: 'ytd-compact-video-renderer',
  CHANNEL_RENDERER:       'ytd-channel-renderer',
  PLAYLIST_RENDERER:      'ytd-playlist-renderer',
  GRID_VIDEO_RENDERER:    'ytd-grid-video-renderer',
  SHORTS_RENDERER:        'ytd-reel-item-renderer',
  CHANNEL_HEADER:         'ytd-channel-header-renderer',

  // Channel links inside containers — prefer data/href patterns over obfuscated classes
  CHANNEL_LINK: 'a[href*="/channel/"], a[href^="/@"]',

  // Channel name text elements
  CHANNEL_NAME_TEXT: 'yt-formatted-string#channel-name, #channel-name a, .ytd-channel-name a, ytd-channel-name a',

  // Watch-page owner block
  WATCH_CHANNEL_LINK: '#owner #channel-name a, #upload-info #channel-name a, ytd-channel-name a',

  // Comments
  COMMENT_RENDERER: 'ytd-comment-renderer, ytd-comment-thread-renderer',
  COMMENT_AUTHOR:   '#author-text',

  // All video containers joined for a single querySelectorAll
  ALL_VIDEO_CONTAINERS: [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-playlist-renderer',
  ].join(', '),
};

export const ALARM_NAME        = 'watch-time-check';
export const STATS_CACHE_TTL   = 5 * 60 * 1000;
export const STATS_PAGE_PATH   = 'src/stats/stats.html';
