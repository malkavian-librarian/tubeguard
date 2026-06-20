# TubeReclaim — Build Specification

> **Audience:** an autonomous coding agent (or developer) building this extension from an empty
> directory. This document is **self-contained**. You should not need any other file to complete the
> build. Follow the phased TODO checklist in §10 in order. Each phase ends with an **acceptance
> check** you must pass before moving on.
>
> **Status:** v1 spec, ready to implement.
> **Target browser:** Chrome / Chromium (Manifest V3). Firefox is a v2 stretch goal.
> **Estimated effort:** ~3–5 focused days for an experienced agent.

---

## 1. Overview & Goals

**TubeReclaim** is a Manifest V3 browser extension that helps users take back control of their
YouTube consumption. It does two things:

1. **Blocks** channels and individual videos the user never wants to see, by injecting a "Block"
   button into the YouTube UI and then removing matching DOM elements on every page.
2. **Tracks** how much time the user actively spends watching YouTube, stored 100% locally, and
   surfaces it in a stats dashboard designed to create healthy friction ("you watched 6h 12m this
   week").

### Design principles

| Principle | Meaning |
|---|---|
| **Local-first & private** | No data leaves the device. No analytics, no remote calls in v1. |
| **DOM-based blocking only** | No `webRequest` / `declarativeNetRequest`. We hide and remove elements. |
| **Fragile-by-nature, isolated-by-design** | YouTube's DOM changes often. All selectors live in ONE file so breakage is a one-file fix. |
| **Single source of truth for writes** | Only the background service worker writes to IndexedDB. |
| **Type-safe** | TypeScript everywhere; data contracts are shared interfaces. |
| **Testable units** | Each module has one purpose, a clear interface, and unit tests. |

### Non-goals (v1)

- No network-level blocking. No ad-blocking. No video downloading.
- No account/login, no cloud sync, no telemetry (see §12 roadmap for v2).
- No support for browsers other than Chromium-based ones.

### Success criteria

A build is "done" when every acceptance check in §10 passes and the manual QA checklist in §13 is
green on a real youtube.com session.

---

## 2. Tech Stack & Rationale

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.x** (strict mode) | Type-safe message contracts and storage schemas; fewer runtime surprises. |
| Extension framework | **WXT** (`wxt.dev`) | Purpose-built MV3 framework: auto-generates `manifest.json`, HMR for content scripts, entrypoint conventions, `wxt build` / `wxt zip`. Removes most boilerplate. |
| Bundler | **Vite** (via WXT) | WXT uses Vite under the hood. Fast, ESM-native. |
| UI framework | **React 19** | Popup and stats dashboard are real UIs; React keeps them maintainable. |
| Styling | **Tailwind CSS v4** | Fast, consistent, no hand-rolled CSS files. Scoped to extension pages only (NOT injected into YouTube). |
| Charts | **Recharts** | Declarative React charts for the stats dashboard. (Alternative: hand-rolled Canvas if bundle size matters — see note below.) |
| UI state | **Zustand** | Tiny, simple store for popup/stats local state. |
| IndexedDB access | **Dexie.js** | Ergonomic typed wrapper over IndexedDB. Used ONLY in the service worker. |
| Unit tests | **Vitest** + `@testing-library/react` | Fast, Vite-native. |
| E2E tests | **Playwright** (with `chromium.launchPersistentContext` + `--load-extension`) | Loads the built extension against a local YouTube DOM fixture. |
| Lint/format | **ESLint** (typescript-eslint) + **Prettier** | Enforced in CI. |
| Package manager | **pnpm** (npm acceptable) | Fast, disk-efficient. |

> **Bundle-size note:** Recharts adds ~100 KB gzipped. If the agent wants the leanest possible build,
> replace Recharts with a small hand-rolled Canvas 2D chart module (`src/lib/canvas-charts.ts`). The
> spec assumes Recharts; swapping is a localized change confined to the stats UI.

> **Why WXT over CRXJS/raw esbuild:** WXT gives a cold agent the strongest guardrails — convention
> over configuration, generated manifest from typed config, and first-class content-script HMR. This
> directly serves the "any modern model can follow" requirement.

### Constraints the stack must respect

- `content_security_policy` must remain `script-src 'self'; object-src 'self'`. No `eval`, no remote scripts.
- No runtime npm dependency is allowed to inject `<script>` tags or use `eval` (rules out some chart libs).
- React/Tailwind run **only** inside the extension's own pages (popup, stats). The **content script
  must be dependency-light** — no React injected into youtube.com. Content-script UI (the Block
  button) is built with plain DOM APIs.

---

## 3. Architecture & Data Flow

Four runtime contexts communicate via typed messages:

```
┌──────────────────────────┐         chrome.runtime           ┌───────────────────────────┐
│   CONTENT SCRIPT          │  ───── sendMessage ───────────▶  │  BACKGROUND SERVICE WORKER │
│   (runs on youtube.com)   │  ◀──── response / push ───────   │  (MV3, event-driven)       │
│                           │                                  │                            │
│  • selector registry      │                                  │  • message router (whitelist)
│  • MutationObserver       │                                  │  • Dexie / IndexedDB (SOLE writer)
│  • SPA navigation hook     │                                  │  • chrome.alarms (reminders)
│  • injects Block buttons   │                                  │  • chrome.notifications
│  • hides + removes blocked │                                  │  • aggregates stats on request
│  • tracks active watch time│                                  │                            │
└─────────────┬─────────────┘                                  └──────────────┬────────────┘
              │                                                                 │
              │ chrome.storage.onChanged (block set, settings)                  │
              ▼                                                                 ▼
      ┌─────────────────────────────┐                            ┌──────────────────────────┐
      │ chrome.storage.sync          │                            │ IndexedDB (via Dexie)     │
      │ • blockedChannelIds[]         │  ◀── read by all ──▶        │ • sessions                │
      │ • blockedVideoIds[]           │                            │ • blocklistMeta           │
      │ • settings                    │                            │ • statsCache              │
      └─────────────────────────────┘                            └──────────────────────────┘
                          ▲                                                     ▲
                          │                                                     │
              ┌───────────┴───────────┐                          ┌─────────────┴────────────┐
              │  POPUP (React)         │                          │  STATS PAGE (React)        │
              │  • today's watch time  │  ── queryStats msg ──▶    │  • 7/30-day charts         │
              │  • quick block/unblock │  ◀── stats payload ──     │  • per-channel breakdown   │
              │  • open stats / toggle │                          │  • blocklist manager       │
              └────────────────────────┘                          └────────────────────────────┘
```

### Key data-flow rules (MUST follow)

1. **Content scripts never write IndexedDB.** They send a message; the service worker performs the
   write. This serializes all mutations through one context and avoids race conditions.
2. **The in-memory block `Set` in the content script is updated via `chrome.storage.onChanged`**, not
   by re-reading storage on every DOM mutation.
3. **Block-list lookups use `Set.has()`**, never `Array.includes()`.
4. **Channel identity is always the channel ID** parsed from a link `href`, never display text.
   Names collide; IDs do not.
5. **The service worker is event-driven and stateless between events** (MV3 can kill it anytime).
   Never hold long-lived in-memory state that must survive; persist to storage.

---

## 4. Data Models & Storage Schema

### 4.1 Shared TypeScript types (`src/lib/types.ts`)

```ts
// A blocked channel or video — IDs only live in chrome.storage.sync.
export type ChannelId = string; // matches /^UC[\w-]{22}$/
export type VideoId   = string; // matches /^[\w-]{11}$/
export type HandleId  = string; // matches /^@[\w.-]{1,30}$/

export type BlockTargetType = 'channel' | 'video';

// Stored in chrome.storage.sync (small, ID-only).
export interface SyncBlockList {
  blockedChannelIds: ChannelId[];   // canonical UC… ids
  blockedHandleIds:  HandleId[];    // @handle ids (YouTube shows handles widely)
  blockedVideoIds:   VideoId[];
}

// Stored in chrome.storage.sync. Keep < 100 KB total.
export interface Settings {
  blockingEnabled: boolean;          // master on/off
  autoUnsubscribe: boolean;          // attempt to unsubscribe when blocking a channel
  blockShorts: boolean;              // v2 hook; default false
  dailyReminderEnabled: boolean;
  dailyReminderThresholdMin: number; // notify if today's watch time exceeds this
  theme: 'system' | 'light' | 'dark';
  telemetry: { enabled: false };     // ALWAYS false in v1. Do not change default.
}

// IndexedDB (Dexie) — metadata about blocked targets (names/titles live HERE, never in sync).
export interface BlocklistMeta {
  id: string;                  // channelId | handleId | videoId (primary key)
  type: BlockTargetType;
  displayName: string;         // channel name or video title (user-sourced)
  thumbnailUrl?: string;
  blockedAt: number;           // epoch ms
}

// IndexedDB — one row per continuous active-watch session.
export interface WatchSession {
  id?: number;                 // auto-increment primary key
  channelId: ChannelId | HandleId | null;
  channelName: string | null;
  videoId: VideoId | null;
  videoTitle: string | null;
  startedAt: number;           // epoch ms
  endedAt: number;             // epoch ms
  activeMs: number;            // active foreground watch time (<= endedAt-startedAt)
  date: string;                // 'YYYY-MM-DD' (local) for fast day grouping (indexed)
}

// IndexedDB — precomputed rollups to keep the dashboard fast.
export interface StatsCacheEntry {
  date: string;                // 'YYYY-MM-DD' primary key
  totalActiveMs: number;
  byChannel: Record<string, number>; // channelId/handle -> activeMs
}
```

### 4.2 Storage placement rules

| Data | Location | Reason |
|---|---|---|
| Blocked IDs + settings | `chrome.storage.sync` | Small, syncs across user's devices, ≤100 KB quota. **IDs only.** |
| Channel names, video titles, thumbnails | IndexedDB `blocklistMeta` | User-sourced strings; never put in sync. |
| Watch sessions | IndexedDB `sessions` | Can grow large; not for sync. |
| Daily rollups | IndexedDB `statsCache` | Derived; rebuildable from sessions. |

### 4.3 Dexie schema (`src/background/db.ts`)

```ts
import Dexie, { Table } from 'dexie';
import type { WatchSession, BlocklistMeta, StatsCacheEntry } from '../lib/types';

export class TubeReclaimDB extends Dexie {
  sessions!: Table<WatchSession, number>;
  blocklistMeta!: Table<BlocklistMeta, string>;
  statsCache!: Table<StatsCacheEntry, string>;

  constructor() {
    super('TubeReclaimDB');
    this.version(1).stores({
      sessions: '++id, date, channelId',
      blocklistMeta: 'id, type, blockedAt',
      statsCache: 'date',
    });
  }
}
export const db = new TubeReclaimDB();
```

### 4.4 ID validation (`src/lib/validation.ts`)

Validate before storing. Reject anything that doesn't match:

```ts
export const RE_CHANNEL = /^UC[\w-]{22}$/;
export const RE_HANDLE  = /^@[\w.-]{1,30}$/;
export const RE_VIDEO   = /^[\w-]{11}$/;

export function isValidBlockId(id: string): boolean {
  return RE_CHANNEL.test(id) || RE_HANDLE.test(id) || RE_VIDEO.test(id);
}
```

---

## 5. Message-Bus Contract

All cross-context messages share a discriminated union. The service worker **ignores unknown
types** (whitelist enforced).

### 5.1 Message types (`src/lib/messages.ts`)

```ts
export type Message =
  | { type: 'BLOCK_TARGET'; payload: BlockTargetPayload }
  | { type: 'UNBLOCK_TARGET'; payload: { id: string } }
  | { type: 'GET_BLOCKLIST' }                                 // -> BlocklistMeta[]
  | { type: 'RECORD_SESSION'; payload: WatchSessionInput }
  | { type: 'QUERY_STATS'; payload: { rangeDays: 7 | 30 | 1 } } // -> StatsResult
  | { type: 'GET_SETTINGS' }                                  // -> Settings
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
  | { type: 'PING' };                                         // -> { pong: true }

export interface BlockTargetPayload {
  id: string;
  targetType: BlockTargetType;
  displayName: string;
  thumbnailUrl?: string;
  attemptUnsubscribe?: boolean;
}

export interface WatchSessionInput {
  channelId: string | null;
  channelName: string | null;
  videoId: string | null;
  videoTitle: string | null;
  startedAt: number;
  endedAt: number;
  activeMs: number;
}

export interface StatsResult {
  rangeDays: number;
  totalActiveMs: number;
  perDay: { date: string; activeMs: number }[];
  topChannels: { channelId: string; name: string; activeMs: number }[];
}
```

### 5.2 Request/response pattern

- Use `chrome.runtime.sendMessage(msg)` which returns a Promise in MV3.
- The service worker's `onMessage` listener returns `true` (keep channel open) and resolves via
  `sendResponse`.
- Every handler is wrapped in try/catch; on error it returns `{ error: string }` and logs.
- Validate `message.type` against a `Set<MessageType>` whitelist before dispatch; drop unknowns
  silently (return `false`).

---

## 6. YouTube DOM Selector Strategy

YouTube's DOM is volatile. This is the single biggest maintenance risk. Mitigations:

1. **All selectors live in `src/content/selectors.ts`** under a `SELECTORS` object. No selector may
   appear anywhere else in the codebase.
2. Each selector entry has a comment: what UI feature it targets, and the date last verified.
3. **Prefer stable attribute patterns** over obfuscated class names:
   - Channel links: `a[href^="/@"]`, `a[href*="/channel/"]`
   - Video links: `a#video-title-link`, `a[href*="/watch?v="]`
   - Renderer hosts: `ytd-rich-item-renderer`, `ytd-video-renderer`, `ytd-compact-video-renderer`,
     `ytd-grid-video-renderer`, `ytd-reel-item-renderer` (Shorts).
4. **Never** use classes like `.yt-spec-touch-feedback-shape__fill` as primary selectors.
5. When a selector breaks, the fix is confined to `selectors.ts`. No other file changes.

```ts
// src/content/selectors.ts
export const SELECTORS = {
  // Channel anchor inside a video card. Verified: 2026-06-20.
  channelLink: 'a[href^="/@"], a[href*="/channel/"]',
  // Video card containers across home/search/sidebar/grid. Verified: 2026-06-20.
  videoRenderers: [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
  ].join(','),
  // Shorts shelf items (v2). Verified: 2026-06-20.
  shortsRenderers: 'ytd-reel-item-renderer, ytm-shorts-lockup-view-model',
  // Watch-page primary video title. Verified: 2026-06-20.
  watchTitle: 'h1.ytd-watch-metadata yt-formatted-string',
  // Watch-page channel owner link. Verified: 2026-06-20.
  watchChannelLink: 'ytd-channel-name a',
  // The hover action menu button on a card (where we add "Block"). Verified: 2026-06-20.
  cardMenuButton: 'ytd-menu-renderer button[aria-label]',
  // Subscribe button (for auto-unsubscribe). Verified: 2026-06-20.
  subscribeButton: 'ytd-subscribe-button-renderer button',
} as const;
```

### ID extraction helpers (`src/content/extract.ts`)

- `extractChannelId(el)` → parse `href`: `/channel/UC…` → `UC…`; `/@handle` → `@handle`.
- `extractVideoId(el)` → parse `?v=` query param; fall back to `/shorts/<id>`.
- Always return `null` if no valid ID; callers must handle null (never guess from text).

---

## 7. Module Responsibilities

Each file has **one** purpose, a clear interface, and a unit test.

### Content script (`src/content/`)
| File | Responsibility | Key interface |
|---|---|---|
| `index.ts` | Entrypoint. Bootstraps observer, ui-injector, time-tracker. Subscribes to `storage.onChanged`. | — |
| `selectors.ts` | The ONLY home for DOM selectors (§6). | `SELECTORS` |
| `extract.ts` | Parse IDs from elements. | `extractChannelId`, `extractVideoId` |
| `block-set.ts` | In-memory `Set` of blocked IDs; hydrated from sync; updated on change. | `isBlocked(id)`, `hydrate()` |
| `blocker.ts` | Given the page, hide+remove elements whose channel/video is blocked. | `sweep(root)` |
| `observer.ts` | MutationObserver + SPA-navigation detection (`yt-navigate-finish`). Debounced. Calls `blocker.sweep` + `ui-injector.inject`. | `start()` |
| `ui-injector.ts` | Inject a "Block" button into each card/watch page. Plain DOM only. On click → send `BLOCK_TARGET`. | `inject(root)` |
| `time-tracker.ts` | Track active foreground watch time using Page Visibility API + `<video>` play/pause events. On session end → send `RECORD_SESSION`. | `start()` |

### Background (`src/background/` → WXT `entrypoints/background.ts`)
| File | Responsibility |
|---|---|
| `background.ts` | Service-worker entry: registers message router + alarm listener. |
| `router.ts` | Validate type against whitelist; dispatch to handlers; wrap errors. |
| `db.ts` | Dexie instance + schema (§4.3). |
| `handlers/block.ts` | `BLOCK_TARGET`/`UNBLOCK_TARGET`: update `chrome.storage.sync` IDs + write `blocklistMeta`. |
| `handlers/sessions.ts` | `RECORD_SESSION`: insert session row; invalidate the day's `statsCache`. |
| `handlers/stats.ts` | `QUERY_STATS`: build/return rollups from cache or recompute. |
| `handlers/settings.ts` | `GET_SETTINGS`/`UPDATE_SETTINGS`. |
| `alarms.ts` | `chrome.alarms` daily check; fire reminder notification per rules (§8). |
| `notify.ts` | Build notification with a "View Stats" action button. |

### Shared lib (`src/lib/`)
`types.ts`, `messages.ts`, `validation.ts`, `time.ts` (date math, ms→“6h 12m” formatting, local
`YYYY-MM-DD`), `storage.ts` (typed wrappers around `chrome.storage.sync`).

### UI (`src/popup/`, `src/stats/`)
React + Tailwind. Communicate ONLY via messages. No direct IndexedDB access.

---

## 8. Notifications

- Use `chrome.alarms` (NOT `setInterval`) — one alarm, e.g. every 30 min, that checks today's total.
- **At most one reminder per calendar day.** Track `lastReminderDate` in `chrome.storage.local`.
- Fire only if `settings.dailyReminderEnabled` and today's `totalActiveMs` exceeds
  `dailyReminderThresholdMin`.
- Every notification includes a **"View Stats"** action button that opens `stats.html`.
- Respect `settings.blockingEnabled === false` → still track time, but the user may disable reminders
  independently.

---

## 9. Security, Privacy & CSP

| Rule | Detail |
|---|---|
| CSP | `content_security_policy.extension_pages = "script-src 'self'; object-src 'self'"`. Never weaken. |
| No `eval` / `Function()` | Forbidden (CSP + lint rule `no-eval`). |
| No `innerHTML` with dynamic data | Build DOM with `createElement` + `textContent` / `setAttribute`. User strings → `textContent` only. |
| Host permissions | `*://*.youtube.com/*` only. **No `<all_urls>`.** |
| Permissions | `storage`, `alarms`, `notifications`. **No `webRequest`, no `declarativeNetRequest`, no `tabs` unless needed for opening stats** (use `chrome.runtime.getURL` + `chrome.tabs.create` only for the stats page). |
| ID validation | Validate every ID with §4.4 regexes before persisting. |
| Privacy | No network requests in v1. `telemetry.enabled` is hard-coded `false`. No data leaves the device. |
| Dependencies | No runtime dep may inject scripts or use `eval`. Audit Recharts/Dexie/Zustand build output. |

---

## 10. Phased TODO Checklist (the build plan)

> Do these **in order**. Check the box only when the phase's **acceptance check** passes. Commit at
> the end of each phase with a message like `feat: phase N — <name>`.

### Phase 0 — Scaffold & tooling
- [ ] `pnpm create wxt@latest tubereclaim` (choose the **React + TypeScript** template).
- [ ] Add Tailwind CSS v4 and wire it into popup + stats entrypoints only.
- [ ] Add deps: `dexie`, `zustand`, `recharts`.
- [ ] Add dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `playwright`, `eslint`, `typescript-eslint`, `prettier`.
- [ ] Configure `tsconfig.json` with `"strict": true`.
- [ ] Configure ESLint (ban `eval`, `no-restricted-syntax` for `innerHTML` assignment) + Prettier.
- [ ] Configure `wxt.config.ts`: manifest name `TubeReclaim`, permissions `["storage","alarms","notifications"]`, host_permissions `["*://*.youtube.com/*"]`, the CSP from §9, and the stats page as a web-accessible/extension page.
- [ ] Add npm scripts: `dev` (`wxt`), `build` (`wxt build`), `zip` (`wxt zip`), `test` (`vitest`), `test:e2e` (`playwright test`), `lint`, `typecheck`.
- [ ] Add `.gitignore` (`node_modules/`, `.output/`, `.wxt/`, `*.zip`, `dist/`).
- **Acceptance:** `pnpm build` produces a loadable extension; `pnpm typecheck` and `pnpm lint` pass with zero errors. Loading the unpacked build in `chrome://extensions` shows the icon and opens an (empty) popup.

### Phase 1 — Shared lib + storage + DB
- [ ] Implement `src/lib/types.ts`, `messages.ts`, `validation.ts`, `time.ts`, `storage.ts` (§4, §5).
- [ ] Implement `src/background/db.ts` (Dexie schema, §4.3).
- [ ] Implement message router skeleton (`router.ts`) with whitelist + `PING` handler.
- [ ] Unit tests: validation regexes, `time.ts` formatting/date math, router whitelist drops unknowns.
- **Acceptance:** `vitest` green. From the popup devtools, `chrome.runtime.sendMessage({type:'PING'})` resolves `{pong:true}`; an unknown type resolves nothing/`{error}` and does not throw.

### Phase 2 — Blocking engine (content script)
- [ ] Implement `selectors.ts`, `extract.ts`, `block-set.ts`, `blocker.ts`, `observer.ts`.
- [ ] `block-set` hydrates from `chrome.storage.sync` on load and updates via `chrome.storage.onChanged`.
- [ ] `blocker.sweep`: for each rendered card/watch element, extract ID; if `isBlocked` → set `display:none` synchronously, then `element.remove()` in a microtask (`Promise.resolve().then(...)`).
- [ ] `observer`: debounced MutationObserver + `yt-navigate-finish` listener → re-sweep.
- [ ] Unit tests for `extract` (href fixtures) and `blocker.sweep` (jsdom fixtures of card HTML).
- **Acceptance:** Manually add a real channel ID to `chrome.storage.sync` via devtools; reload YouTube → that channel's videos disappear from home/search/sidebar without layout flash. SPA navigation (clicking into a video and back) keeps them hidden.

### Phase 3 — Block button injection
- [ ] Implement `ui-injector.ts`: inject a clearly visible "Block" button onto each video card and the watch page (plain DOM, no React). Idempotent (don't double-inject; mark elements with a `data-tr-injected` attr).
- [ ] On click: extract ID + name + thumbnail, send `BLOCK_TARGET`; optimistically hide the card.
- [ ] Background `handlers/block.ts`: validate ID, append to the right `chrome.storage.sync` array (dedup), write `blocklistMeta` row. If `attemptUnsubscribe` → content script clicks the subscribe/unsubscribe control when on the channel page.
- [ ] Unit tests for `handlers/block.ts` (mock storage + db).
- **Acceptance:** Clicking "Block" on a card removes it immediately, persists across reload, and adds a `blocklistMeta` row. Re-blocking the same channel does not create duplicates.

### Phase 4 — Watch-time tracking
- [ ] Implement `time-tracker.ts`: start timing when a `<video>` is playing AND `document.visibilityState === 'visible'`; pause on tab hide / video pause / navigation. Accumulate `activeMs`.
- [ ] On session end (navigation away, tab hidden > threshold, or `pagehide`), send `RECORD_SESSION` with channel/video metadata captured from the watch page.
- [ ] Background `handlers/sessions.ts`: insert `WatchSession`; invalidate that day's `statsCache`.
- [ ] Unit tests: a fake timer drives play/visibility events and asserts `activeMs` accounting (no double counting, no counting while hidden/paused).
- **Acceptance:** Watch a video ~2 min with the tab focused, switch tabs for 1 min (should NOT count), return and finish. A `sessions` row exists with `activeMs ≈` only the focused playing time.

### Phase 5 — Popup (React)
- [ ] Build popup: master "Blocking enabled" toggle, today's watch time (querying `QUERY_STATS {rangeDays:1}`), an "Open full stats" button, and a quick blocklist count.
- [ ] Wire settings via `GET_SETTINGS`/`UPDATE_SETTINGS`. Theme honored.
- [ ] Component tests with Testing Library (mock the message bus).
- **Acceptance:** Popup shows accurate today's time, toggling "blocking enabled" immediately changes content-script behavior on an open YouTube tab.

### Phase 6 — Stats dashboard (React)
- [ ] Build stats page: 7-day and 30-day bar charts (Recharts), total time, top-channels breakdown, and a **blocklist manager** (list `blocklistMeta`, unblock buttons → `UNBLOCK_TARGET`).
- [ ] `handlers/stats.ts`: compute `StatsResult` from `statsCache`/`sessions`; build missing day rollups on demand.
- [ ] Component test for chart data mapping; unit test for stats aggregation.
- **Acceptance:** Dashboard renders correct totals for seeded sessions; unblocking a channel from here makes its videos reappear on YouTube after reload.

### Phase 7 — Notifications
- [ ] Implement `alarms.ts` + `notify.ts` per §8. One reminder/day, threshold-gated, "View Stats" action opens stats page.
- [ ] Test: simulate alarm with today's total above/below threshold and assert single-fire/dedup.
- **Acceptance:** With a low threshold set, a reminder fires once; firing again same day is suppressed; clicking "View Stats" opens the dashboard.

### Phase 8 — E2E, polish & package
- [ ] Playwright e2e: load built extension, open a local YouTube DOM fixture page, assert blocked cards are removed and the Block button works.
- [ ] Run full QA checklist (§13) on real youtube.com.
- [ ] Verify CSP, permissions, and that no network requests occur (DevTools → Network, filtered to the extension).
- [ ] `pnpm zip` → produce store-ready artifact. Write `README.md` install/build instructions.
- **Acceptance:** All tests green; QA checklist green; zip loads cleanly as unpacked AND as packed.

---

## 11. Testing Strategy

| Layer | Tool | What to cover |
|---|---|---|
| Pure logic | Vitest | validation regexes, time/date math, ms formatting, stats aggregation, router whitelist. |
| DOM logic | Vitest + jsdom | `extract.*` against href fixtures; `blocker.sweep` against card HTML fixtures; idempotent injection. |
| React UI | Vitest + Testing Library | popup toggle behavior, stats rendering, blocklist manager interactions (message bus mocked). |
| Background handlers | Vitest | block/unblock/session/stats handlers with mocked `chrome.storage` + in-memory Dexie (`fake-indexeddb`). |
| E2E | Playwright | built extension loaded; blocking + Block button + popup against a checked-in YouTube DOM fixture (NOT live YouTube, to stay deterministic). |

- Keep **YouTube DOM fixtures** in `tests/fixtures/` so selector tests are deterministic and don't depend on the network.
- Aim for meaningful coverage of `extract`, `blocker`, `time-tracker`, and all handlers — these are the correctness-critical units.

---

## 12. v2 Roadmap (out of scope for v1 — design hooks only)

These must NOT be implemented in v1, but the architecture should not preclude them:

1. **Shorts blocking** — `settings.blockShorts` + `SELECTORS.shortsRenderers` already exist. Add a `blocker` handler branch. (Architecture-ready.)
2. **AI video summaries** — a stats-page plugin. User supplies their own Claude API key stored in `chrome.storage.sync.aiApiKey`. Calls the Claude API (model `claude-sonnet-4-6` or latest) from the **extension page** (not content script). No core changes.
3. **Multi-device sync of metadata** — currently only IDs sync. v2 could sync a compressed blocklist-meta snapshot, mindful of the 100 KB quota.
4. **Opt-in telemetry** — implement a real `trackEvent` behind `settings.telemetry.enabled` (default stays `false`). Backend TBD. Must have a clear opt-in UI and a privacy notice.
5. **Firefox port** — WXT supports cross-browser builds; revisit MV3 background differences.
6. **Scheduled lockouts / focus mode** — block ALL of YouTube during user-defined hours.

---

## 13. Manual QA Checklist (run before every release)

Run on a real, logged-in youtube.com session in Chrome:

- [ ] Block a channel from the **home feed** → its cards vanish without flicker.
- [ ] Block from **search results**, **watch-page sidebar**, and **channel page** → all work.
- [ ] Blocked channel stays blocked after **SPA navigation** (no full reload) and after **hard reload**.
- [ ] Blocked channel stays blocked after **browser restart** (sync persistence).
- [ ] Unblock from the stats **blocklist manager** → channel reappears after reload.
- [ ] **Watch time:** focused playback counts; backgrounded tab does NOT count; paused video does NOT count.
- [ ] Popup shows today's time matching the dashboard's day-1 figure.
- [ ] Dashboard 7-day and 30-day charts render and totals add up.
- [ ] Daily reminder fires once when over threshold; "View Stats" opens the dashboard.
- [ ] Master **"blocking enabled" toggle off** → nothing is hidden; toggle on → hiding resumes.
- [ ] **No network requests** originate from the extension (DevTools Network).
- [ ] **CSP intact**; no console CSP violations; no `innerHTML`/`eval` warnings.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all green.

---

## 14. Ideas & Enhancements (nice-to-have, not required)

- **Undo toast** after blocking ("Blocked Channel X — Undo").
- **Keyword blocking** — hide cards whose title matches user regex/keywords (stored in sync, small).
- **"Why am I seeing this?"** debug overlay listing the selector/ID matched, to speed selector repair.
- **Selector health check** — on load, if zero cards match `videoRenderers` on the home page, log a loud warning ("selectors may be stale") to flag YouTube DOM drift early.
- **Export/import** blocklist + sessions as JSON (local file, no network).
- **Streak/goal tracking** — "3 days under 1h" to gamify reduction.
- **Weekly digest notification** summarizing the past 7 days.

---

## 15. Definition of Done

1. Every Phase 0–8 acceptance check passed.
2. Manual QA checklist (§13) fully green on real YouTube.
3. `pnpm build` and `pnpm zip` succeed; the zip loads as a packed extension.
4. README documents install (unpacked), build, and the selector-repair process (edit only `selectors.ts`).
5. No `eval`, no `innerHTML` with dynamic data, no network calls, CSP and permissions as specified.
```
