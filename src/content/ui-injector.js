import { MessageType, SELECTORS } from '../shared/constants.js';
import { extractChannelId, extractChannelName, hideElement } from './blocker.js';

const injected = new WeakSet();

// ── Public entry point ────────────────────────────────────────────────────────

export function injectBlockButtons() {
  const containers = document.querySelectorAll(
    SELECTORS.ALL_VIDEO_CONTAINERS + ', ' + SELECTORS.CHANNEL_RENDERER + ', ' + SELECTORS.CHANNEL_HEADER + ', #page-header, ytd-c4-tabbed-header-renderer'
  );

  for (const container of containers) {
    if (injected.has(container)) continue;
    const channelId = extractChannelId(container);
    if (!channelId) continue;

    let anchor = container.querySelector(SELECTORS.CHANNEL_NAME_TEXT) ||
                   container.querySelector(SELECTORS.CHANNEL_LINK);
    
    if (!anchor && container.matches('#page-header, ytd-c4-tabbed-header-renderer, ytd-channel-header-renderer')) {
      anchor = container.querySelector('#channel-name, yt-dynamic-text-view-model') || container.firstElementChild;
    }

    if (!anchor) continue;

    const channelName = extractChannelName(container) || channelId;
    const btn         = makeBlockButton(channelId, channelName, container);

    // Anchor parent needs flex layout to keep button visible on same line
    const wrapper = anchor.closest('div') || anchor.parentElement;
    if (!wrapper) continue;
    wrapper.style.position = 'relative';
    wrapper.style.display = 'flex';
    wrapper.style.flexWrap = 'nowrap';
    wrapper.style.alignItems = 'center';

    const textSpan = wrapper.firstElementChild;
    if (textSpan && !textSpan.classList.contains('tubeguard-block-wrapper')) {
      textSpan.style.flex = '0 1 auto';
      textSpan.style.minWidth = '0';
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.whiteSpace = 'nowrap';
    }

    wrapper.appendChild(btn);
    injected.add(container);
  }

  injectOnWatchPage();
}

function injectOnWatchPage() {
  for (const link of document.querySelectorAll(SELECTORS.WATCH_CHANNEL_LINK)) {
    if (injected.has(link)) continue;
    const href = link.href || '';
    const m1   = href.match(/\/channel\/(UC[\w-]{22})/);
    const m2   = href.match(/\/@([\w.-]+)/);
    const channelId = m1 ? m1[1] : (m2 ? `@${m2[1]}` : null);
    if (!channelId) continue;

    const channelName = link.textContent.trim() || channelId;
    const btn         = makeBlockButton(channelId, channelName, null);
    link.insertAdjacentElement('afterend', btn);

    injected.add(link);
  }
}

// ── Button factory ────────────────────────────────────────────────────────────

function isDark() {
  return document.documentElement.hasAttribute('dark');
}

function makeBlockButton(channelId, channelName, container) {
  const wrapper = document.createElement('span');
  wrapper.className = 'tubeguard-block-wrapper';
  wrapper.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle;margin-left:8px;';

  const btn = document.createElement('button');
  btn.className  = 'tubeguard-block-btn';
  btn.setAttribute('aria-label', `Block channel: ${channelName}`);
  btn.setAttribute('title', 'Block this channel');
  btn.style.cssText = [
    'display:inline-flex;align-items:center;justify-content:center;',
    'padding:4px 8px;',
    'background:#cc0000;',
    'border:none;border-radius:4px;cursor:pointer;',
    'color:#fff;font-weight:bold;',
    'font-size:12px;line-height:1;vertical-align:middle;flex-shrink:0;',
    'position:relative;z-index:10;',
  ].join('');
  btn.textContent = 'BLOCK';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showConfirmPopover(btn, channelId, channelName, container);
  });

  wrapper.appendChild(btn);

  const statsChip = document.createElement('span');
  statsChip.className = 'tubeguard-stats-chip';
  statsChip.style.cssText = [
    'display:none;align-items:center;justify-content:center;',
    'padding:4px 8px;margin-left:6px;',
    'background:#ff9800;',
    'border:none;border-radius:4px;',
    'color:#fff;font-weight:bold;',
    'font-size:12px;line-height:1;vertical-align:middle;flex-shrink:0;',
    'position:relative;z-index:10;'
  ].join('');

  chrome.runtime.sendMessage({ type: MessageType.GET_STATS, payload: { channelId } }).then(res => {
    if (res && res.hours !== undefined && res.hours > 0) {
      statsChip.textContent = `${res.hours.toFixed(1)}h`;
      statsChip.style.display = 'inline-flex';
    }
  }).catch(() => {});

  wrapper.appendChild(statsChip);

  return wrapper;
}

// ── Confirmation popover ──────────────────────────────────────────────────────

function showConfirmPopover(anchor, channelId, channelName, container) {
  document.querySelector('.tubeguard-popover')?.remove();

  const dark    = isDark();
  const popover = document.createElement('div');
  popover.className = 'tubeguard-popover';
  popover.style.cssText = [
    'position:fixed;z-index:99999;border-radius:8px;padding:12px 16px;',
    `background:${dark ? '#212121' : '#fff'};`,
    `color:${dark ? '#fff' : '#0f0f0f'};`,
    `border:1px solid ${dark ? '#444' : '#dadada'};`,
    'box-shadow:0 4px 16px rgba(0,0,0,.28);',
    'font-family:Roboto,Arial,sans-serif;font-size:13px;min-width:210px;',
  ].join('');

  const rect  = anchor.getBoundingClientRect();
  popover.style.top  = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;

  const title = document.createElement('p');
  title.style.cssText = 'margin:0 0 10px;font-weight:500;word-break:break-word;';
  title.textContent   = `Block "${channelName.slice(0, 50)}"?`;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;';

  const confirmBtn = styleBtn('Block', '#c00', '#fff', dark);
  const cancelBtn  = styleBtn('Cancel', dark ? '#3f3f3f' : '#f2f2f2', dark ? '#fff' : '#0f0f0f', dark);

  confirmBtn.addEventListener('click', () => {
    popover.remove();
    doBlock(channelId, channelName, container);
  });
  cancelBtn.addEventListener('click', () => popover.remove());

  row.appendChild(confirmBtn);
  row.appendChild(cancelBtn);
  popover.appendChild(title);
  popover.appendChild(row);
  document.body.appendChild(popover);

  // Dismiss on outside click
  setTimeout(() =>
    document.addEventListener('click', () => popover.remove(), { once: true }), 0);
}

function styleBtn(text, bg, color, _dark) {
  const b = document.createElement('button');
  b.textContent     = text;
  b.style.cssText   = `flex:1;padding:6px 10px;background:${bg};color:${color};border:none;border-radius:4px;cursor:pointer;font-size:13px;`;
  return b;
}

// ── Block action ──────────────────────────────────────────────────────────────

function doBlock(channelId, channelName, container) {
  tryUnsubscribe(channelName);

  chrome.runtime.sendMessage({
    type:    MessageType.BLOCK_CHANNEL,
    payload: { channelId, channelName },
  }).catch(() => {});

  if (container) hideElement(container);

  showToast(`"${channelName.slice(0, 30)}" blocked.`, () => {
    chrome.runtime.sendMessage({
      type:    MessageType.UNBLOCK_CHANNEL,
      payload: { channelId },
    }).catch(() => {});
  });
}

function tryUnsubscribe(channelName) {
  if (!channelName) return;
  const buttons = document.querySelectorAll('button');
  let subBtn = null;
  const lowerName = channelName.toLowerCase();

  for (const btn of buttons) {
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = btn.textContent.trim().toLowerCase();
    
    if (aria.includes('unsubscribe') && aria.includes(lowerName)) {
      subBtn = btn;
      break;
    }
    if (text === 'subscribed' && (location.href.includes('/@') || location.href.includes('/channel/') || location.href.includes('/watch'))) {
      subBtn = btn;
    }
  }

  if (subBtn) {
    subBtn.click();
    const checkDialog = setInterval(() => {
      const dialogs = document.querySelectorAll('tp-yt-paper-dialog, yt-confirm-dialog-renderer');
      for (const dialog of dialogs) {
        if (!dialog.offsetParent) continue;
        for (const cb of dialog.querySelectorAll('button')) {
          const ct = cb.textContent.trim().toLowerCase();
          const ca = (cb.getAttribute('aria-label') || '').toLowerCase();
          if (ct === 'unsubscribe' || ca === 'unsubscribe') {
            cb.click();
            clearInterval(checkDialog);
            return;
          }
        }
      }
    }, 150);
    setTimeout(() => clearInterval(checkDialog), 3000);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, undoFn) {
  document.querySelector('.tubeguard-toast')?.remove();

  const dark  = isDark();
  const toast = document.createElement('div');
  toast.className   = 'tubeguard-toast';
  toast.style.cssText = [
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
    'background:#212121;color:#fff;',
    'padding:10px 18px;border-radius:6px;',
    'font-family:Roboto,Arial,sans-serif;font-size:13px;',
    'z-index:99999;display:flex;align-items:center;gap:14px;',
    'box-shadow:0 4px 14px rgba(0,0,0,.45);',
  ].join('');

  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);

  let undone = false;
  const undo = document.createElement('button');
  undo.textContent  = 'Undo';
  undo.style.cssText = 'background:transparent;border:none;color:#aaa;cursor:pointer;font-size:13px;font-weight:600;padding:0;';
  undo.addEventListener('click', () => {
    if (!undone) { undone = true; undoFn(); }
    toast.remove();
  });
  toast.appendChild(undo);

  document.body.appendChild(toast);
  setTimeout(() => { if (!undone) toast.remove(); }, 5000);
}
