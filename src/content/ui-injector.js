import { MessageType, SELECTORS } from '../shared/constants.js';
import { extractChannelId, extractChannelName, hideElement } from './blocker.js';
import { sendRequest } from '../shared/message-bus.js';

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
    wrapper.classList.add('tg-anchor-wrapper');

    const textSpan = wrapper.firstElementChild;
    if (textSpan && !textSpan.classList.contains('tg-btn-wrapper')) {
      textSpan.classList.add('tg-anchor-text');
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

function makeBlockButton(channelId, channelName, container) {
  const wrapper = document.createElement('span');
  wrapper.className = 'tubeguard-block-wrapper tg-btn-wrapper';

  const btn = document.createElement('button');
  btn.className = 'tubeguard-block-btn tg-btn tg-btn--danger';
  btn.setAttribute('aria-label', `Block channel: ${channelName}`);
  btn.setAttribute('title', 'Block this channel');
  btn.textContent = 'BLOCK';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showConfirmPopover(btn, channelId, channelName, container);
  });

  wrapper.appendChild(btn);

  const statsChip = document.createElement('span');
  statsChip.className = 'tubeguard-stats-chip tg-chip';

  sendRequest(MessageType.GET_STATS, { channelId }).then(res => {
    if (res && res.hours !== undefined && res.hours > 0) {
      statsChip.textContent = `${res.hours.toFixed(1)}h`;
      statsChip.classList.add('tg-chip--visible');
    }
  }).catch(() => {});

  wrapper.appendChild(statsChip);

  return wrapper;
}

// ── Confirmation popover ──────────────────────────────────────────────────────

function showConfirmPopover(anchor, channelId, channelName, container) {
  document.querySelector('.tubeguard-popover')?.remove();

  const popover = document.createElement('div');
  popover.className = 'tubeguard-popover tg-popover';

  // Position is computed from the anchor's live layout — must stay inline.
  const rect  = anchor.getBoundingClientRect();
  popover.style.top  = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;

  const title = document.createElement('p');
  title.className   = 'tg-popover__title';
  title.textContent = `Block "${channelName.slice(0, 50)}"?`;

  const row = document.createElement('div');
  row.className = 'tg-popover__actions';

  const confirmBtn = styleBtn('Block', 'confirm');
  const cancelBtn  = styleBtn('Cancel', 'cancel');

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

function styleBtn(text, variant) {
  const b = document.createElement('button');
  b.textContent = text;
  b.className   = `tg-popover__btn tg-popover__btn--${variant}`;
  return b;
}

// ── Block action ──────────────────────────────────────────────────────────────

function doBlock(channelId, channelName, container) {
  tryUnsubscribe(channelName);

  sendRequest(MessageType.BLOCK_CHANNEL, { channelId, channelName }).catch(() => {});

  if (container) hideElement(container);

  showToast(`"${channelName.slice(0, 30)}" blocked.`, () => {
    sendRequest(MessageType.UNBLOCK_CHANNEL, { channelId }).catch(() => {});
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
    watchForUnsubscribeConfirm();
  }
}

function clickConfirmIfPresent() {
  const dialogs = document.querySelectorAll('tp-yt-paper-dialog, yt-confirm-dialog-renderer');
  for (const dialog of dialogs) {
    if (!dialog.offsetParent) continue;
    for (const cb of dialog.querySelectorAll('button')) {
      const ct = cb.textContent.trim().toLowerCase();
      const ca = (cb.getAttribute('aria-label') || '').toLowerCase();
      if (ct === 'unsubscribe' || ca === 'unsubscribe') {
        cb.click();
        return true;
      }
    }
  }
  return false;
}

function watchForUnsubscribeConfirm() {
  if (clickConfirmIfPresent()) return;
  const observer = new MutationObserver(() => {
    if (clickConfirmIfPresent()) {
      observer.disconnect();
      clearTimeout(timeout);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timeout = setTimeout(() => observer.disconnect(), 3000);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, undoFn) {
  document.querySelector('.tubeguard-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'tubeguard-toast tg-toast';

  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);

  let undone = false;
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.className   = 'tg-toast__undo';
  undo.addEventListener('click', () => {
    if (!undone) { undone = true; undoFn(); }
    toast.remove();
  });
  toast.appendChild(undo);

  document.body.appendChild(toast);
  setTimeout(() => { if (!undone) toast.remove(); }, 5000);
}
