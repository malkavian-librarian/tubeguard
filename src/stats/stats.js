import { sessions, blocklistMeta, settings } from '../shared/storage.js';
import { dateRangeStart, toDateString, formatDuration, generateCSV, downloadCSV } from '../shared/utils.js';
import { MessageType } from '../shared/constants.js';
import { renderBarChart } from './charts.js';

// ── Plugin registry (v2 extensibility hook) ───────────────────────────────────
const plugins = new Map();
export function registerStatsPlugin(name, renderFn) { plugins.set(name, renderFn); }

// ── State ─────────────────────────────────────────────────────────────────────
let allSessions  = [];
let allMeta      = [];
let syncSettings = {};
let currentDays  = 7;
let sortState    = {};      // tableId → { col, dir }
let currentTab   = 'watchtime';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  [allSessions, allMeta, syncSettings] = await Promise.all([
    sessions.getAll(),
    blocklistMeta.getAll(),
    settings.get(),
  ]);

  renderCards();
  renderWatchTimeTab();
  renderBlocklistTab();
  bindEvents();
}

// ── Cards ─────────────────────────────────────────────────────────────────────
function renderCards() {
  const counts = { channel: 0, video: 0, comment: 0, playlist: 0 };
  for (const m of allMeta) if (counts[m.type] !== undefined) counts[m.type]++;

  setEl('blocked-channels',  counts.channel);
  setEl('blocked-videos',    counts.video);
  setEl('blocked-comments',  counts.comment);
  setEl('blocked-playlists', counts.playlist);
}

// ── Watch Time tab ────────────────────────────────────────────────────────────
function renderWatchTimeTab() {
  const filtered = allSessions.filter(s => s.date >= dateRangeStart(currentDays));

  // Channel aggregation
  const byChannel = new Map();
  for (const s of filtered) {
    if (!byChannel.has(s.channelId)) {
      byChannel.set(s.channelId, {
        channelId: s.channelId, channelName: s.channelName || s.channelId,
        totalSeconds: 0, sessions: 0, lastWatched: s.date,
      });
    }
    const c = byChannel.get(s.channelId);
    c.totalSeconds += s.duration || 0;
    c.sessions++;
    if (s.date > c.lastWatched) c.lastWatched = s.date;
    if (s.channelName) c.channelName = s.channelName;
  }
  const channels = [...byChannel.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);

  // Video aggregation
  const byVideo = new Map();
  for (const s of filtered) {
    if (!s.videoId) continue;
    if (!byVideo.has(s.videoId)) {
      byVideo.set(s.videoId, {
        videoId: s.videoId, videoTitle: s.videoTitle || s.videoId,
        channelName: s.channelName || s.channelId,
        totalSeconds: 0, count: 0, lastWatched: s.date,
      });
    }
    const v = byVideo.get(s.videoId);
    v.totalSeconds += s.duration || 0;
    v.count++;
    if (s.date > v.lastWatched) v.lastWatched = s.date;
    if (s.videoTitle) v.videoTitle = s.videoTitle;
  }
  const videos = [...byVideo.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);

  renderChannelChart(channels);
  renderChannelTable(channels);
  renderVideoTable(videos);
}

function renderChannelChart(channels) {
  const canvas = document.getElementById('channel-chart');
  const top10  = channels.slice(0, 10).map(c => ({
    label: c.channelName,
    value: Math.round(c.totalSeconds / 60),
  }));
  renderBarChart(canvas, top10, { unit: '', maxValue: undefined });
}

function renderChannelTable(channels) {
  const tbody  = document.getElementById('channel-tbody');
  tbody.innerHTML = '';

  if (!channels.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No watch history for this period.</td></tr>';
    return;
  }

  const perLimits = syncSettings.notifications?.perChannelLimits || {};

  for (const c of applySortOrder('channel-table', channels)) {
    const tr = document.createElement('tr');

    const avgSec = c.totalSeconds / currentDays;

    tr.innerHTML = `
      <td class="highlight-name">${esc(c.channelName)}</td>
      <td>${formatDuration(c.totalSeconds)}</td>
      <td>${formatDuration(avgSec)}/day</td>
      <td>${c.lastWatched}</td>
      <td></td>
    `;

    // Limit input
    const limitTd = tr.cells[4];
    const inp = document.createElement('input');
    inp.type      = 'number';
    inp.min       = '0';
    inp.className = 'limit-input';
    inp.value     = perLimits[c.channelId] || '';
    inp.placeholder = '—';
    inp.addEventListener('change', () => {
      const val = parseInt(inp.value, 10);
      const newLimits = { ...perLimits, [c.channelId]: val || 0 };
      chrome.runtime.sendMessage({
        type:    MessageType.SET_SETTING,
        payload: { key: 'notifications', value: { ...syncSettings.notifications, perChannelLimits: newLimits } },
      });
      syncSettings.notifications = { ...syncSettings.notifications, perChannelLimits: newLimits };
    });
    limitTd.appendChild(inp);

    tbody.appendChild(tr);
  }
}

function renderVideoTable(videos) {
  const tbody = document.getElementById('video-tbody');
  tbody.innerHTML = '';

  if (!videos.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No watch history for this period.</td></tr>';
    return;
  }

  for (const v of applySortOrder('video-table', videos)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(v.videoTitle)}</td>
      <td class="highlight-name">${esc(v.channelName)}</td>
      <td>${formatDuration(v.totalSeconds)}</td>
      <td>${v.count}</td>
      <td>${v.lastWatched}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Blocklist tab ─────────────────────────────────────────────────────────────
function renderBlocklistTab(filter = '', typeFilter = '') {
  const tbody = document.getElementById('blocklist-tbody');
  tbody.innerHTML = '';

  const items = allMeta.filter(m => {
    if (typeFilter && m.type !== typeFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (m.name || '').toLowerCase().includes(q) || (m.id || '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => b.blockedAt - a.blockedAt);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No blocked items match the filter.</td></tr>';
    return;
  }

  for (const item of items) {
    const tr = document.createElement('tr');

    const typeBadge = document.createElement('span');
    typeBadge.className = `type-badge type-${item.type}`;
    typeBadge.textContent = item.type;

    const unblockBtn = document.createElement('button');
    unblockBtn.className   = 'unblock-btn';
    unblockBtn.textContent = 'Unblock';
    unblockBtn.addEventListener('click', () => doUnblock(item, tr));

    const tdType   = document.createElement('td');
    const tdName   = document.createElement('td');
    const tdDate   = document.createElement('td');
    const tdAction = document.createElement('td');

    tdType.appendChild(typeBadge);
    tdName.textContent = item.name || item.id;
    tdDate.textContent = item.blockedAt
      ? new Date(item.blockedAt).toLocaleDateString()
      : '—';
    tdAction.appendChild(unblockBtn);

    tr.append(tdType, tdName, tdDate, tdAction);
    tbody.appendChild(tr);
  }
}

async function doUnblock(item, row) {
  const msgType = item.type === 'video' ? MessageType.UNBLOCK_VIDEO : MessageType.UNBLOCK_CHANNEL;
  const payload = item.type === 'video'
    ? { videoId: item.id }
    : { channelId: item.id };

  await chrome.runtime.sendMessage({ type: msgType, payload }).catch(() => {});

  allMeta = allMeta.filter(m => m.id !== item.id);
  renderCards();

  row.style.transition = 'opacity .3s';
  row.style.opacity    = '0';
  setTimeout(() => row.remove(), 300);
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportStats() {
  const headers = ['Date', 'ChannelId', 'ChannelName', 'VideoId', 'VideoTitle', 'DurationSeconds'];
  const rows    = allSessions.map(s => [
    s.date, s.channelId, s.channelName, s.videoId, s.videoTitle, Math.round(s.duration || 0),
  ]);
  downloadCSV(`tubeguard-stats-${toDateString()}.csv`, generateCSV(headers, rows));
}

function exportBlocklist() {
  const headers = ['Type', 'Id', 'Name', 'BlockedAt'];
  const rows    = allMeta.map(m => [
    m.type, m.id, m.name, m.blockedAt ? new Date(m.blockedAt).toISOString() : '',
  ]);
  downloadCSV(`tubeguard-blocklist-${toDateString()}.csv`, generateCSV(headers, rows));
}

// ── Sorting ────────────────────────────────────────────────────────────────────
function applySortOrder(tableId, rows) {
  const st = sortState[tableId];
  if (!st) return rows;
  const { col, dir } = st;
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}

// ── Event wiring ───────────────────────────────────────────────────────────────
function bindEvents() {
  // Tabs
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  }

  // Date range
  for (const btn of document.querySelectorAll('.range-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDays = parseInt(btn.dataset.days, 10);
      renderWatchTimeTab();
    });
  }

  // Sortable column headers
  for (const th of document.querySelectorAll('th[data-col]')) {
    th.addEventListener('click', () => {
      const table  = th.closest('table');
      const col    = th.dataset.col;
      const tId    = table.id;
      const prev   = sortState[tId];
      const newDir = (prev?.col === col && prev.dir === 'desc') ? 'asc' : 'desc';
      sortState[tId] = { col, dir: newDir };

      // Update sort icon
      for (const otherTh of table.querySelectorAll('th[data-col]')) {
        const icon = otherTh.querySelector('.sort-icon');
        if (!icon) continue;
        icon.className = 'sort-icon' + (otherTh === th ? ` ${newDir}` : '');
      }

      renderWatchTimeTab();
    });
  }

  // Blocklist search / filter
  document.getElementById('blocklist-search').addEventListener('input', (e) => {
    renderBlocklistTab(e.target.value, document.getElementById('blocklist-filter').value);
  });
  document.getElementById('blocklist-filter').addEventListener('change', (e) => {
    renderBlocklistTab(document.getElementById('blocklist-search').value, e.target.value);
  });

  // Exports
  document.getElementById('export-stats-btn').addEventListener('click', exportStats);
  document.getElementById('export-blocklist-btn').addEventListener('click', exportBlocklist);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init().catch(console.error);
