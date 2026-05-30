# CLAUDE.md — TubeGuard Chrome Extension

This file documents project conventions, architecture decisions, and build instructions for Claude Code working in this repository. Read this before making any changes.

---

## Project Summary

TubeGuard is a Manifest V3 Chrome extension that blocks YouTube channels/videos and tracks watch time locally. See `SPEC.md` for the full feature specification.

---

## Environment

- **Platform:** Windows 10. Use **PowerShell** for all shell commands. Never use Bash.
- **Shell chaining:** use `;` or `if ($?) { ... }` — `&&` is not valid in PowerShell 5.1.
- **Git binary:** not in PATH. Use:
  ```powershell
  $git = "C:\Users\FlyerOne\AppData\Local\GitHubDesktop\app-3.5.11\resources\app\git\cmd\git.exe"
  & $git status
  ```
- **Disk space:** C: drive has limited free space. Check before large operations:
  ```powershell
  Get-PSDrive C | Select-Object @{N='Free_MB';E={[math]::Round($_.Free/1MB,0)}}
  ```

---

## Build

```powershell
# Install dev dependencies (one-time)
npm install

# Build extension bundles
npm run build        # outputs build/service-worker.js + build/content-main.js (flat, via --entry-names=[name])

# Build in watch mode during development
npm run build:watch

# Package for Chrome Web Store upload
npm run zip
```

**Bundler:** esbuild. Only `service-worker.js` and `content-main.js` are bundled into `build/` (flat — manifest expects `build/service-worker.js` and `build/content-main.js`). Stats and popup pages load ES modules directly as `type="module"`.

**Not yet configured (v1):** `npm run lint` and `npm test` are not wired up — eslint and vitest are not installed.

**Load unpacked in Chrome:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the project root folder

---

## File Structure

```
src/
  background/
    service-worker.js     # MV3 service worker entry point
    alarm-manager.js      # chrome.alarms for notification checks
    notification.js       # Chrome notification builder
  content/
    content-main.js       # Content script entry, bootstraps modules
    blocker.js            # Hides/removes blocked elements
    observer.js           # MutationObserver + SPA navigation
    ui-injector.js        # Injects Block buttons into YouTube UI
    time-tracker.js       # Tracks active watch time
  stats/
    stats.html / stats.js / stats.css / charts.js
  popup/
    popup.html / popup.js / popup.css
  shared/
    storage.js            # Unified storage API
    constants.js          # All enums, message types, selector registry
    message-bus.js        # Typed inter-context messaging
    utils.js              # Date math, CSV, telemetry stub
assets/icons/
manifest.json
```

---

## Coding Conventions

### General
- ES modules everywhere (`import`/`export`). No CommonJS.
- No `eval()`, no `Function()` constructor — violates CSP.
- No `innerHTML` with dynamic data. Use `createElement` + `textContent` or `setAttribute`.
- No external CDN scripts or runtime npm dependencies. Build-time only.
- No comments explaining what code does. Only comment non-obvious constraints or invariants.

### Storage rules (critical)
- **Content scripts must never write directly to IndexedDB.** They send a message to the service worker, which performs the write. This ensures all mutations are serialized through a single context.
- **chrome.storage.sync** is for the block list (IDs only) and settings. Keep entries small — sync storage has a 100 KB quota.
- **IndexedDB** is for session history, blocklist metadata, and stats cache. Accessed through `shared/storage.js` only. Never open IndexedDB directly in page code.
- The in-memory block `Set` in `blocker.js` is updated via `chrome.storage.onChanged`, not by re-reading storage on every mutation.

### Blocking logic rules
- Block list lookup must use `Set.has()` — never `Array.includes()`.
- Element removal: set `display: none` first (synchronous), then `element.remove()` in a microtask (`Promise.resolve().then(...)`). This prevents layout flash.
- Always extract `channelId` from the element's link `href` pattern, not from display text. Channel names can collide; IDs cannot.
- All DOM selectors live in `shared/constants.js` under `SELECTORS`. Never hardcode a selector outside that file.

### Message bus rules
- All messages must have a `type` field from `MessageType` in `constants.js`.
- The service worker ignores messages with unknown types.
- Use the `requestId` field for request/response patterns (stats queries, etc.).

### Notifications
- Show at most one notification per channel per calendar day.
- Always provide an action button ("View Stats") that opens `stats.html`.

---

## YouTube DOM Selector Strategy

YouTube's DOM changes frequently. The selector update process:

1. All selectors are in `src/shared/constants.js` under `SELECTORS`.
2. Each selector has a comment with the YouTube feature it targets and the date last verified.
3. When a selector breaks, update only `constants.js` — no other file should need changes.
4. Prefer `[href*="/channel/"]` and `[href^="/@"]` patterns over class-based selectors.
5. Never use YouTube's obfuscated class names (e.g., `.yt-spec-touch-feedback-shape`) as primary selectors.

---

## Security

- `content_security_policy` in `manifest.json` enforces `script-src 'self'`. Do not weaken it.
- Validate channel IDs before storing: must match `/^UC[\w-]{22}$|^@[\w.-]+$/`.
- Display all user-sourced strings via `textContent`, never `innerHTML`.
- The `telemetry.enabled` flag defaults to `false`. No data leaves the machine unless the user opts in.

---

## Adding New Features

The architecture supports extension without modifying core modules:

1. **New blocked content type** (e.g., Shorts): add to `BlockType` enum in `constants.js`, add a selector to `SELECTORS`, and implement a handler in `blocker.js`.
2. **New stats widget**: implement a `renderPlugin(container, data)` function and register it via `statsPage.registerPlugin(name, fn)` in `stats.js`.
3. **AI Summary (v2)**: implement as a stats plugin. API key stored in `chrome.storage.sync.aiApiKey`. No changes to core blocking or storage modules.
4. **Telemetry (v2)**: implement the `trackEvent` function in `utils.js`. The stub is already in place — it receives calls throughout the codebase but currently no-ops.

---

## Testing

Unit test infrastructure is not yet set up (v1). Planned framework: Vitest. Tests will live in `src/__tests__/`.

**Before every release**, run the manual QA checklist in `SPEC.md` section 13.

---

## .gitignore

Add to `.gitignore` before first commit:
```
build/
node_modules/
*.zip
```

---

## Telemetry

The `telemetry` object in settings always starts as `{ enabled: false, userId: null }`. Do not change this default. The opt-in UI is a future feature. Do not implement telemetry data collection in v1 — only the no-op stub.

---

## What NOT to do

- Do not add `webRequest` or `declarativeNetRequest` permissions — blocking is DOM-based only.
- Do not add `<all_urls>` host permissions — scoped to `youtube.com` only.
- Do not bundle runtime dependencies into the extension (no lodash, no moment, no chart libraries in v1).
- Do not use `setInterval` in the content script — use `Page Visibility API` events and `MutationObserver`.
- Do not write to IndexedDB from the content script directly.
- Do not store channel names or video titles in `chrome.storage.sync` — that's for IDs only. Metadata goes in IndexedDB.
- Do not skip the message type whitelist check in the service worker.
