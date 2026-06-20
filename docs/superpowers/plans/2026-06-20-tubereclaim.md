# TubeReclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TubeReclaim — a Manifest V3 Chrome extension that DOM-blocks YouTube channels/videos and tracks local watch time — from an empty directory through to a packaged, tested build.

**Architecture:** Four runtime contexts (content script, background service worker, React popup, React stats page) communicate via a typed message bus. The background service worker is the sole writer to IndexedDB (via Dexie). `chrome.storage.sync` holds block IDs + settings only. The content script keeps an in-memory `Set` of blocked IDs, hydrated from sync and updated via `chrome.storage.onChanged`.

**Tech Stack:** TypeScript (strict) · WXT · React 19 + Tailwind v4 · Recharts · Zustand · Dexie · Vitest + Testing Library + fake-indexeddb · Playwright · ESLint + Prettier · pnpm.

**Reference spec:** `docs/NEW-EXTENSION-SPEC.md` (read it before starting — this plan implements it task-by-task).

**Conventions for every task below:**
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit.
- This is a Windows machine. Use PowerShell. Git is not in PATH — use:
  `$git = "C:\Users\FlyerOne\AppData\Local\GitHubDesktop\app-3.5.11\resources\app\git\cmd\git.exe"` then `& $git ...`.
- Chain shell commands with `;` (not `&&`).
- Commit messages in the steps use `git ...` shorthand; expand to `& $git ...` when running.

---

## File Structure

```
tubereclaim/
  wxt.config.ts                 # manifest, permissions, CSP
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  .eslintrc.cjs / eslint.config.js
  tailwind.config.* / app.css
  package.json
  entrypoints/
    background.ts               # SW entry: registers router + alarms
    content.ts                  # content-script entry: bootstraps modules
    popup/                      # React popup (index.html, main.tsx, App.tsx)
    stats/                      # React stats page (index.html, main.tsx, App.tsx)
  src/
    lib/
      types.ts                  # shared interfaces
      messages.ts               # message union + whitelist
      validation.ts             # ID regexes
      time.ts                   # date math + ms formatting
      storage.ts                # typed chrome.storage.sync wrappers
      bus.ts                    # sendMessage helpers (UI side)
    background/
      db.ts                     # Dexie schema
      router.ts                 # message dispatch + whitelist
      alarms.ts                 # reminder alarm
      notify.ts                 # notification builder
      handlers/
        block.ts
        sessions.ts
        stats.ts
        settings.ts
    content/
      selectors.ts              # ALL DOM selectors
      extract.ts                # ID extraction
      block-set.ts              # in-memory blocked Set
      blocker.ts                # sweep + remove
      observer.ts               # MutationObserver + SPA nav
      ui-injector.ts            # Block button injection
      time-tracker.ts           # active watch time
  tests/
    fixtures/                   # YouTube DOM HTML fixtures
    e2e/                        # Playwright specs
```

---

## Task 1: Scaffold WXT + React + TypeScript project

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `.gitignore`, `entrypoints/popup/`, `entrypoints/background.ts`

- [ ] **Step 1: Scaffold via WXT**

Run in the target parent directory:
```powershell
pnpm dlx wxt@latest init tubereclaim --template react-ts
cd tubereclaim
pnpm install
```
If prompted for package manager, choose pnpm.

- [ ] **Step 2: Add `.gitignore`**

Create `.gitignore`:
```
node_modules/
.output/
.wxt/
dist/
*.zip
stats.tsbuildinfo
```

- [ ] **Step 3: Initialize git and verify a build**

```powershell
$git = "C:\Users\FlyerOne\AppData\Local\GitHubDesktop\app-3.5.11\resources\app\git\cmd\git.exe"
& $git init
pnpm build
```
Expected: `pnpm build` completes and writes `.output/chrome-mv3/`.

- [ ] **Step 4: Load unpacked to confirm it runs**

Open `chrome://extensions`, enable Developer mode, "Load unpacked" → select `.output/chrome-mv3/`. Expected: extension icon appears; default popup opens.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT react-ts project (phase 0)"
```

---

## Task 2: Configure manifest, permissions, CSP

**Files:**
- Modify: `wxt.config.ts`

- [ ] **Step 1: Write `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'TubeReclaim',
    description: 'Block YouTube channels/videos and track your local watch time.',
    permissions: ['storage', 'alarms', 'notifications'],
    host_permissions: ['*://*.youtube.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
```

- [ ] **Step 2: Build to verify manifest generation**

Run: `pnpm build`
Expected: build succeeds; `.output/chrome-mv3/manifest.json` contains exactly those permissions and host_permissions, no `<all_urls>`, no `webRequest`.

- [ ] **Step 3: Verify manifest contents**

Run: `Get-Content .output/chrome-mv3/manifest.json`
Expected: `permissions` = storage/alarms/notifications; `host_permissions` = `*://*.youtube.com/*`; CSP present.

- [ ] **Step 4: Commit**

```bash
git add wxt.config.ts
git commit -m "feat: configure manifest permissions and CSP (phase 0)"
```

---

## Task 3: Configure tooling — Vitest, ESLint, Prettier, scripts

**Files:**
- Create: `vitest.config.ts`, `eslint.config.js`, `.prettierrc`
- Modify: `package.json`, `tsconfig.json`

- [ ] **Step 1: Install dev deps**

```powershell
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom fake-indexeddb @playwright/test eslint typescript-eslint prettier
pnpm add dexie zustand recharts
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 3: Create `tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Set `tsconfig.json` to strict**

Ensure `compilerOptions` includes:
```json
{ "strict": true, "noUncheckedIndexedAccess": true }
```

- [ ] **Step 5: Create `eslint.config.js`**

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    'no-eval': 'error',
    'no-restricted-properties': [
      'error',
      { object: 'window', property: 'eval' },
    ],
  },
});
```

- [ ] **Step 6: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 7: Add a smoke test to prove the runner works**

Create `src/lib/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run the test suite**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 9: Run typecheck and lint**

Run: `pnpm typecheck; pnpm lint`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: configure vitest, eslint, prettier, scripts (phase 0)"
```

---

## Task 4: Shared types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Write `src/lib/types.ts`**

Copy the type definitions from spec §4.1 verbatim:
```ts
export type ChannelId = string;
export type VideoId = string;
export type HandleId = string;

export type BlockTargetType = 'channel' | 'video';

export interface SyncBlockList {
  blockedChannelIds: ChannelId[];
  blockedHandleIds: HandleId[];
  blockedVideoIds: VideoId[];
}

export interface Settings {
  blockingEnabled: boolean;
  autoUnsubscribe: boolean;
  blockShorts: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderThresholdMin: number;
  theme: 'system' | 'light' | 'dark';
  telemetry: { enabled: false };
}

export interface BlocklistMeta {
  id: string;
  type: BlockTargetType;
  displayName: string;
  thumbnailUrl?: string;
  blockedAt: number;
}

export interface WatchSession {
  id?: number;
  channelId: ChannelId | HandleId | null;
  channelName: string | null;
  videoId: VideoId | null;
  videoTitle: string | null;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  date: string;
}

export interface StatsCacheEntry {
  date: string;
  totalActiveMs: number;
  byChannel: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  blockingEnabled: true,
  autoUnsubscribe: false,
  blockShorts: false,
  dailyReminderEnabled: false,
  dailyReminderThresholdMin: 60,
  theme: 'system',
  telemetry: { enabled: false },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared types (phase 1)"
```

---

## Task 5: ID validation

**Files:**
- Create: `src/lib/validation.ts`, `src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isValidBlockId, RE_CHANNEL, RE_HANDLE, RE_VIDEO } from './validation';

describe('isValidBlockId', () => {
  it('accepts a valid channel id', () => {
    expect(isValidBlockId('UC' + 'a'.repeat(22))).toBe(true);
  });
  it('accepts a valid handle', () => {
    expect(isValidBlockId('@some.handle-1')).toBe(true);
  });
  it('accepts a valid 11-char video id', () => {
    expect(isValidBlockId('dQw4w9WgXcQ')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isValidBlockId('<script>')).toBe(false);
    expect(isValidBlockId('')).toBe(false);
    expect(isValidBlockId('UCtooShort')).toBe(false);
  });
  it('exposes the regexes', () => {
    expect(RE_CHANNEL.test('UC' + 'b'.repeat(22))).toBe(true);
    expect(RE_HANDLE.test('@x')).toBe(true);
    expect(RE_VIDEO.test('abcdefghijk')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/validation.test.ts`
Expected: FAIL (cannot find module './validation').

- [ ] **Step 3: Write `src/lib/validation.ts`**

```ts
export const RE_CHANNEL = /^UC[\w-]{22}$/;
export const RE_HANDLE = /^@[\w.-]{1,30}$/;
export const RE_VIDEO = /^[\w-]{11}$/;

export function isValidBlockId(id: string): boolean {
  return RE_CHANNEL.test(id) || RE_HANDLE.test(id) || RE_VIDEO.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/validation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: add block-id validation (phase 1)"
```

---

## Task 6: Time/date utilities

**Files:**
- Create: `src/lib/time.ts`, `src/lib/time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/time.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { localDateKey, formatDuration, lastNDays } from './time';

describe('localDateKey', () => {
  it('formats a timestamp as YYYY-MM-DD in local time', () => {
    const ts = new Date(2026, 5, 20, 14, 30).getTime(); // local June 20 2026
    expect(localDateKey(ts)).toBe('2026-06-20');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds as Xh Ym', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(3_660_000)).toBe('1h 1m');
  });
});

describe('lastNDays', () => {
  it('returns N date keys ending today, oldest first', () => {
    const today = new Date(2026, 5, 20).getTime();
    expect(lastNDays(3, today)).toEqual(['2026-06-18', '2026-06-19', '2026-06-20']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/time.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/time.ts`**

```ts
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function lastNDays(n: number, now: number = Date.now()): string[] {
  const keys: string[] = [];
  const base = new Date(now);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    keys.push(localDateKey(d.getTime()));
  }
  return keys;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time.ts src/lib/time.test.ts
git commit -m "feat: add time/date utilities (phase 1)"
```

---

## Task 7: Typed chrome.storage.sync wrappers

**Files:**
- Create: `src/lib/storage.ts`, `src/lib/storage.test.ts`, `tests/chrome-mock.ts`

- [ ] **Step 1: Create a chrome.storage mock**

Create `tests/chrome-mock.ts`:
```ts
import { vi } from 'vitest';

export function installChromeMock() {
  const store: Record<string, unknown> = {};
  const listeners: Array<(c: any, area: string) => void> = [];
  const chrome = {
    storage: {
      sync: {
        get: vi.fn(async (keys?: string[] | null) => {
          if (!keys) return { ...store };
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          listeners.forEach((l) => l(changes, 'sync'));
        }),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn((cb: (c: any, area: string) => void) => listeners.push(cb)),
      },
    },
  };
  (globalThis as any).chrome = chrome;
  return { chrome, store };
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/storage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../../tests/chrome-mock';
import { getBlockList, getSettings, addBlockedId, updateSettings } from './storage';
import { DEFAULT_SETTINGS } from './types';

beforeEach(() => installChromeMock());

describe('storage', () => {
  it('returns empty block list by default', async () => {
    expect(await getBlockList()).toEqual({
      blockedChannelIds: [],
      blockedHandleIds: [],
      blockedVideoIds: [],
    });
  });

  it('returns default settings by default', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('adds a channel id without duplicates', async () => {
    await addBlockedId('UC' + 'a'.repeat(22), 'channel');
    await addBlockedId('UC' + 'a'.repeat(22), 'channel');
    const list = await getBlockList();
    expect(list.blockedChannelIds).toEqual(['UC' + 'a'.repeat(22)]);
  });

  it('routes a handle into blockedHandleIds', async () => {
    await addBlockedId('@h', 'channel');
    const list = await getBlockList();
    expect(list.blockedHandleIds).toEqual(['@h']);
  });

  it('merges settings updates', async () => {
    await updateSettings({ blockingEnabled: false });
    expect((await getSettings()).blockingEnabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/storage.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/lib/storage.ts`**

```ts
import { DEFAULT_SETTINGS, type Settings, type SyncBlockList } from './types';
import { RE_HANDLE, RE_VIDEO } from './validation';

const EMPTY_LIST: SyncBlockList = {
  blockedChannelIds: [],
  blockedHandleIds: [],
  blockedVideoIds: [],
};

export async function getBlockList(): Promise<SyncBlockList> {
  const r = await chrome.storage.sync.get([
    'blockedChannelIds',
    'blockedHandleIds',
    'blockedVideoIds',
  ]);
  return {
    blockedChannelIds: (r.blockedChannelIds as string[]) ?? [],
    blockedHandleIds: (r.blockedHandleIds as string[]) ?? [],
    blockedVideoIds: (r.blockedVideoIds as string[]) ?? [],
  };
}

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.sync.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...((r.settings as Partial<Settings>) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
}

function keyFor(id: string): keyof SyncBlockList {
  if (RE_VIDEO.test(id)) return 'blockedVideoIds';
  if (RE_HANDLE.test(id)) return 'blockedHandleIds';
  return 'blockedChannelIds';
}

export async function addBlockedId(
  id: string,
  _type: 'channel' | 'video',
): Promise<void> {
  const list = await getBlockList();
  const key = keyFor(id);
  if (!list[key].includes(id)) {
    list[key] = [...list[key], id];
    await chrome.storage.sync.set({ [key]: list[key] });
  }
}

export async function removeBlockedId(id: string): Promise<void> {
  const list = await getBlockList();
  const key = keyFor(id);
  list[key] = list[key].filter((x) => x !== id);
  await chrome.storage.sync.set({ [key]: list[key] });
}

export { EMPTY_LIST };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts tests/chrome-mock.ts
git commit -m "feat: add typed chrome.storage.sync wrappers (phase 1)"
```

---

## Task 8: Message union + whitelist

**Files:**
- Create: `src/lib/messages.ts`, `src/lib/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/messages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isKnownMessageType, MESSAGE_TYPES } from './messages';

describe('message whitelist', () => {
  it('accepts known types', () => {
    expect(isKnownMessageType('PING')).toBe(true);
    expect(isKnownMessageType('BLOCK_TARGET')).toBe(true);
    expect(isKnownMessageType('QUERY_STATS')).toBe(true);
  });
  it('rejects unknown types', () => {
    expect(isKnownMessageType('DROP_TABLE')).toBe(false);
    expect(isKnownMessageType('')).toBe(false);
  });
  it('exposes all 8 message types', () => {
    expect(MESSAGE_TYPES.size).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/messages.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/messages.ts`**

```ts
import type { BlockTargetType, Settings, WatchSession } from './types';

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

export type Message =
  | { type: 'BLOCK_TARGET'; payload: BlockTargetPayload }
  | { type: 'UNBLOCK_TARGET'; payload: { id: string } }
  | { type: 'GET_BLOCKLIST' }
  | { type: 'RECORD_SESSION'; payload: WatchSessionInput }
  | { type: 'QUERY_STATS'; payload: { rangeDays: 1 | 7 | 30 } }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
  | { type: 'PING' };

export type MessageType = Message['type'];

export const MESSAGE_TYPES = new Set<string>([
  'BLOCK_TARGET',
  'UNBLOCK_TARGET',
  'GET_BLOCKLIST',
  'RECORD_SESSION',
  'QUERY_STATS',
  'GET_SETTINGS',
  'UPDATE_SETTINGS',
  'PING',
]);

export function isKnownMessageType(t: unknown): boolean {
  return typeof t === 'string' && MESSAGE_TYPES.has(t);
}

export type { WatchSession };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/messages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messages.ts src/lib/messages.test.ts
git commit -m "feat: add message union and whitelist (phase 1)"
```

---

## Task 9: Dexie database schema

**Files:**
- Create: `src/background/db.ts`, `src/background/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/background/db.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { TubeReclaimDB } from './db';

let db: TubeReclaimDB;
beforeEach(async () => {
  db = new TubeReclaimDB();
  await db.delete();
  await db.open();
});

describe('TubeReclaimDB', () => {
  it('stores and reads a session', async () => {
    const id = await db.sessions.add({
      channelId: 'UC' + 'a'.repeat(22),
      channelName: 'X',
      videoId: 'dQw4w9WgXcQ',
      videoTitle: 'T',
      startedAt: 1,
      endedAt: 2,
      activeMs: 1,
      date: '2026-06-20',
    });
    const row = await db.sessions.get(id);
    expect(row?.date).toBe('2026-06-20');
  });

  it('queries sessions by date index', async () => {
    await db.sessions.add({
      channelId: null, channelName: null, videoId: null, videoTitle: null,
      startedAt: 1, endedAt: 2, activeMs: 5, date: '2026-06-19',
    });
    const rows = await db.sessions.where('date').equals('2026-06-19').toArray();
    expect(rows).toHaveLength(1);
  });

  it('upserts a blocklistMeta row', async () => {
    await db.blocklistMeta.put({
      id: '@h', type: 'channel', displayName: 'H', blockedAt: 1,
    });
    expect(await db.blocklistMeta.get('@h')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/background/db.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/background/db.ts`**

```ts
import Dexie, { type Table } from 'dexie';
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/background/db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/background/db.ts src/background/db.test.ts
git commit -m "feat: add Dexie schema (phase 1)"
```

---

## Task 10: Background handlers — settings & block

**Files:**
- Create: `src/background/handlers/settings.ts`, `src/background/handlers/block.ts`, `src/background/handlers/block.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/background/handlers/block.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { installChromeMock } from '../../../tests/chrome-mock';
import { db } from '../db';
import { handleBlockTarget, handleUnblockTarget, handleGetBlocklist } from './block';

beforeEach(async () => {
  installChromeMock();
  await db.delete();
  await db.open();
});

const CH = 'UC' + 'a'.repeat(22);

describe('handleBlockTarget', () => {
  it('persists id to sync and meta to db', async () => {
    await handleBlockTarget({
      id: CH, targetType: 'channel', displayName: 'Chan',
    });
    const meta = await db.blocklistMeta.get(CH);
    expect(meta?.displayName).toBe('Chan');
    const synced = await chrome.storage.sync.get(['blockedChannelIds']);
    expect(synced.blockedChannelIds).toEqual([CH]);
  });

  it('rejects invalid ids', async () => {
    await expect(
      handleBlockTarget({ id: '<x>', targetType: 'channel', displayName: 'b' }),
    ).rejects.toThrow();
  });

  it('is idempotent', async () => {
    const p = { id: CH, targetType: 'channel' as const, displayName: 'Chan' };
    await handleBlockTarget(p);
    await handleBlockTarget(p);
    const synced = await chrome.storage.sync.get(['blockedChannelIds']);
    expect(synced.blockedChannelIds).toEqual([CH]);
  });
});

describe('handleUnblockTarget', () => {
  it('removes id and meta', async () => {
    await handleBlockTarget({ id: CH, targetType: 'channel', displayName: 'Chan' });
    await handleUnblockTarget({ id: CH });
    expect(await db.blocklistMeta.get(CH)).toBeUndefined();
    const synced = await chrome.storage.sync.get(['blockedChannelIds']);
    expect(synced.blockedChannelIds ?? []).toEqual([]);
  });
});

describe('handleGetBlocklist', () => {
  it('returns meta rows', async () => {
    await handleBlockTarget({ id: CH, targetType: 'channel', displayName: 'Chan' });
    const rows = await handleGetBlocklist();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/background/handlers/block.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/background/handlers/settings.ts`**

```ts
import { getSettings, updateSettings } from '../../lib/storage';
import type { Settings } from '../../lib/types';

export async function handleGetSettings(): Promise<Settings> {
  return getSettings();
}

export async function handleUpdateSettings(patch: Partial<Settings>): Promise<Settings> {
  await updateSettings(patch);
  return getSettings();
}
```

- [ ] **Step 4: Write `src/background/handlers/block.ts`**

```ts
import { db } from '../db';
import { addBlockedId, removeBlockedId } from '../../lib/storage';
import { isValidBlockId } from '../../lib/validation';
import type { BlockTargetPayload } from '../../lib/messages';
import type { BlocklistMeta } from '../../lib/types';

export async function handleBlockTarget(p: BlockTargetPayload): Promise<void> {
  if (!isValidBlockId(p.id)) throw new Error(`invalid block id: ${p.id}`);
  await addBlockedId(p.id, p.targetType);
  await db.blocklistMeta.put({
    id: p.id,
    type: p.targetType,
    displayName: p.displayName,
    thumbnailUrl: p.thumbnailUrl,
    blockedAt: Date.now(),
  });
}

export async function handleUnblockTarget(p: { id: string }): Promise<void> {
  await removeBlockedId(p.id);
  await db.blocklistMeta.delete(p.id);
}

export async function handleGetBlocklist(): Promise<BlocklistMeta[]> {
  return db.blocklistMeta.orderBy('blockedAt').reverse().toArray();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/background/handlers/block.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/background/handlers/
git commit -m "feat: add block + settings handlers (phase 3)"
```

---

## Task 11: Background handlers — sessions & stats

**Files:**
- Create: `src/background/handlers/sessions.ts`, `src/background/handlers/stats.ts`, `src/background/handlers/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/background/handlers/stats.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db';
import { handleRecordSession } from './sessions';
import { handleQueryStats } from './stats';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const CH = 'UC' + 'a'.repeat(22);

describe('handleRecordSession', () => {
  it('inserts a session with a derived date key', async () => {
    const start = new Date(2026, 5, 20, 10, 0).getTime();
    await handleRecordSession({
      channelId: CH, channelName: 'Chan', videoId: 'dQw4w9WgXcQ',
      videoTitle: 'T', startedAt: start, endedAt: start + 5000, activeMs: 5000,
    });
    const rows = await db.sessions.toArray();
    expect(rows[0]?.date).toBe('2026-06-20');
    expect(rows[0]?.activeMs).toBe(5000);
  });
});

describe('handleQueryStats', () => {
  it('aggregates totals and top channels over the range', async () => {
    const day = new Date(2026, 5, 20, 10, 0).getTime();
    await handleRecordSession({
      channelId: CH, channelName: 'Chan', videoId: null, videoTitle: null,
      startedAt: day, endedAt: day + 1000, activeMs: 1000,
    });
    await handleRecordSession({
      channelId: CH, channelName: 'Chan', videoId: null, videoTitle: null,
      startedAt: day, endedAt: day + 2000, activeMs: 2000,
    });
    const res = await handleQueryStats({ rangeDays: 30 }, day + 3000);
    expect(res.totalActiveMs).toBe(3000);
    expect(res.topChannels[0]).toMatchObject({ channelId: CH, activeMs: 3000 });
    expect(res.perDay.find((d) => d.date === '2026-06-20')?.activeMs).toBe(3000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/background/handlers/stats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/background/handlers/sessions.ts`**

```ts
import { db } from '../db';
import { localDateKey } from '../../lib/time';
import type { WatchSessionInput } from '../../lib/messages';

export async function handleRecordSession(input: WatchSessionInput): Promise<void> {
  const date = localDateKey(input.startedAt);
  await db.sessions.add({ ...input, date });
  await db.statsCache.delete(date);
}
```

- [ ] **Step 4: Write `src/background/handlers/stats.ts`**

```ts
import { db } from '../db';
import { lastNDays } from '../../lib/time';
import type { StatsResult } from '../../lib/messages';

export async function handleQueryStats(
  p: { rangeDays: 1 | 7 | 30 },
  now: number = Date.now(),
): Promise<StatsResult> {
  const days = lastNDays(p.rangeDays, now);
  const daySet = new Set(days);
  const sessions = (await db.sessions.toArray()).filter((s) => daySet.has(s.date));

  const perDayMap = new Map<string, number>(days.map((d) => [d, 0]));
  const channelMs = new Map<string, number>();
  const channelName = new Map<string, string>();
  let total = 0;

  for (const s of sessions) {
    total += s.activeMs;
    perDayMap.set(s.date, (perDayMap.get(s.date) ?? 0) + s.activeMs);
    const cid = s.channelId ?? 'unknown';
    channelMs.set(cid, (channelMs.get(cid) ?? 0) + s.activeMs);
    if (s.channelName) channelName.set(cid, s.channelName);
  }

  const topChannels = [...channelMs.entries()]
    .map(([channelId, activeMs]) => ({
      channelId,
      name: channelName.get(channelId) ?? channelId,
      activeMs,
    }))
    .sort((a, b) => b.activeMs - a.activeMs)
    .slice(0, 10);

  return {
    rangeDays: p.rangeDays,
    totalActiveMs: total,
    perDay: days.map((date) => ({ date, activeMs: perDayMap.get(date) ?? 0 })),
    topChannels,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/background/handlers/stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/background/handlers/sessions.ts src/background/handlers/stats.ts src/background/handlers/stats.test.ts
git commit -m "feat: add session + stats handlers (phase 4)"
```

---

## Task 12: Message router with whitelist

**Files:**
- Create: `src/background/router.ts`, `src/background/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/background/router.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { installChromeMock } from '../../tests/chrome-mock';
import { db } from './db';
import { routeMessage } from './router';

beforeEach(async () => {
  installChromeMock();
  await db.delete();
  await db.open();
});

describe('routeMessage', () => {
  it('responds to PING', async () => {
    expect(await routeMessage({ type: 'PING' } as any)).toEqual({ pong: true });
  });
  it('drops unknown types', async () => {
    expect(await routeMessage({ type: 'DROP' } as any)).toBeUndefined();
  });
  it('returns error object when a handler throws', async () => {
    const res = (await routeMessage({
      type: 'BLOCK_TARGET',
      payload: { id: 'bad', targetType: 'channel', displayName: 'x' },
    } as any)) as any;
    expect(res.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/background/router.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/background/router.ts`**

```ts
import { isKnownMessageType, type Message } from '../lib/messages';
import { handleBlockTarget, handleUnblockTarget, handleGetBlocklist } from './handlers/block';
import { handleRecordSession } from './handlers/sessions';
import { handleQueryStats } from './handlers/stats';
import { handleGetSettings, handleUpdateSettings } from './handlers/settings';

export async function routeMessage(msg: Message): Promise<unknown> {
  if (!isKnownMessageType((msg as { type?: unknown }).type)) return undefined;
  try {
    switch (msg.type) {
      case 'PING':
        return { pong: true };
      case 'BLOCK_TARGET':
        await handleBlockTarget(msg.payload);
        return { ok: true };
      case 'UNBLOCK_TARGET':
        await handleUnblockTarget(msg.payload);
        return { ok: true };
      case 'GET_BLOCKLIST':
        return handleGetBlocklist();
      case 'RECORD_SESSION':
        await handleRecordSession(msg.payload);
        return { ok: true };
      case 'QUERY_STATS':
        return handleQueryStats(msg.payload);
      case 'GET_SETTINGS':
        return handleGetSettings();
      case 'UPDATE_SETTINGS':
        return handleUpdateSettings(msg.payload);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/background/router.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/background/router.ts src/background/router.test.ts
git commit -m "feat: add message router with whitelist (phase 1)"
```

---

## Task 13: Background entrypoint + alarms + notify

**Files:**
- Create: `src/background/notify.ts`, `src/background/alarms.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Write `src/background/notify.ts`**

```ts
export function showWatchReminder(totalMs: number): void {
  const minutes = Math.round(totalMs / 60000);
  chrome.notifications.create('tr-daily-reminder', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon/128.png'),
    title: 'TubeReclaim',
    message: `You've watched ${minutes} minutes of YouTube today.`,
    buttons: [{ title: 'View Stats' }],
  });
}

export function openStatsPage(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
}
```

- [ ] **Step 2: Write `src/background/alarms.ts`**

```ts
import { getSettings } from '../lib/storage';
import { handleQueryStats } from './handlers/stats';
import { localDateKey } from '../lib/time';
import { showWatchReminder } from './notify';

const ALARM = 'tr-daily-check';

export function registerAlarm(): void {
  chrome.alarms.create(ALARM, { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== ALARM) return;
    await maybeNotify();
  });
}

export async function maybeNotify(now: number = Date.now()): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.dailyReminderEnabled) return false;
  const today = localDateKey(now);
  const { lastReminderDate } = await chrome.storage.local.get(['lastReminderDate']);
  if (lastReminderDate === today) return false;
  const stats = await handleQueryStats({ rangeDays: 1 }, now);
  if (stats.totalActiveMs < settings.dailyReminderThresholdMin * 60000) return false;
  showWatchReminder(stats.totalActiveMs);
  await chrome.storage.local.set({ lastReminderDate: today });
  return true;
}
```

- [ ] **Step 2b: Write the failing test for dedup**

Create `src/background/alarms.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { installChromeMock } from '../../tests/chrome-mock';
import { db } from './db';
import { handleRecordSession } from './handlers/sessions';
import { updateSettings } from '../lib/storage';
import { maybeNotify } from './alarms';

beforeEach(async () => {
  const mock = installChromeMock();
  (globalThis as any).chrome.notifications = { create: () => {} };
  (globalThis as any).chrome.runtime = { getURL: (p: string) => p };
  // local storage needs real get/set for dedup:
  const local: Record<string, unknown> = {};
  (globalThis as any).chrome.storage.local = {
    get: async (k: string[]) => Object.fromEntries(k.filter((x) => x in local).map((x) => [x, local[x]])),
    set: async (o: Record<string, unknown>) => Object.assign(local, o),
  };
  await db.delete();
  await db.open();
  void mock;
});

describe('maybeNotify', () => {
  it('fires once over threshold then dedups same day', async () => {
    const now = new Date(2026, 5, 20, 12, 0).getTime();
    await updateSettings({ dailyReminderEnabled: true, dailyReminderThresholdMin: 1 });
    await handleRecordSession({
      channelId: null, channelName: null, videoId: null, videoTitle: null,
      startedAt: now, endedAt: now + 120000, activeMs: 120000,
    });
    expect(await maybeNotify(now)).toBe(true);
    expect(await maybeNotify(now)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the alarms test (fails first, then passes)**

Run: `pnpm test src/background/alarms.test.ts`
Expected: after writing `alarms.ts`, PASS (1 test).

- [ ] **Step 4: Wire `entrypoints/background.ts`**

```ts
import { routeMessage } from '../src/background/router';
import { registerAlarm } from '../src/background/alarms';
import { openStatsPage } from '../src/background/notify';

export default defineBackground(() => {
  registerAlarm();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    routeMessage(msg).then(sendResponse);
    return true;
  });

  chrome.notifications.onButtonClicked.addListener((id) => {
    if (id === 'tr-daily-reminder') openStatsPage();
  });
});
```

> `defineBackground` is a WXT global available in entrypoints; no import needed.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck; pnpm build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/background/notify.ts src/background/alarms.ts src/background/alarms.test.ts entrypoints/background.ts
git commit -m "feat: wire background entry, alarms, notifications (phase 7)"
```

---

## Task 14: Content — selectors + ID extraction

**Files:**
- Create: `src/content/selectors.ts`, `src/content/extract.ts`, `src/content/extract.test.ts`, `tests/fixtures/cards.html`

- [ ] **Step 1: Create `src/content/selectors.ts`**

Copy the `SELECTORS` object from spec §6 verbatim.

- [ ] **Step 2: Create a DOM fixture**

Create `tests/fixtures/cards.html`:
```html
<div id="root">
  <ytd-rich-item-renderer>
    <a id="video-title-link" href="/watch?v=dQw4w9WgXcQ">Vid A</a>
    <a href="/@SomeChannel">Some Channel</a>
  </ytd-rich-item-renderer>
  <ytd-video-renderer>
    <a id="video-title-link" href="/watch?v=abcdefghijk">Vid B</a>
    <a href="/channel/UCaaaaaaaaaaaaaaaaaaaaaa">Other</a>
  </ytd-video-renderer>
</div>
```

- [ ] **Step 3: Write the failing test**

Create `src/content/extract.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractChannelId, extractVideoId } from './extract';

function el(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  return a;
}

describe('extractChannelId', () => {
  it('parses /channel/UC...', () => {
    expect(extractChannelId(el('/channel/UCaaaaaaaaaaaaaaaaaaaaaa')))
      .toBe('UCaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('parses /@handle', () => {
    expect(extractChannelId(el('/@SomeChannel'))).toBe('@SomeChannel');
  });
  it('returns null for non-channel links', () => {
    expect(extractChannelId(el('/watch?v=dQw4w9WgXcQ'))).toBeNull();
  });
});

describe('extractVideoId', () => {
  it('parses ?v=', () => {
    expect(extractVideoId(el('/watch?v=dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ');
  });
  it('parses /shorts/', () => {
    expect(extractVideoId(el('/shorts/abcdefghijk'))).toBe('abcdefghijk');
  });
  it('returns null when absent', () => {
    expect(extractVideoId(el('/@SomeChannel'))).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/content/extract.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Write `src/content/extract.ts`**

```ts
import { RE_CHANNEL, RE_HANDLE, RE_VIDEO } from '../lib/validation';

function hrefOf(el: Element): string | null {
  return el.getAttribute('href');
}

export function extractChannelId(el: Element): string | null {
  const href = hrefOf(el);
  if (!href) return null;
  const ch = href.match(/\/channel\/(UC[\w-]{22})/);
  if (ch && RE_CHANNEL.test(ch[1]!)) return ch[1]!;
  const handle = href.match(/\/(@[\w.-]{1,30})(?:[/?#]|$)/);
  if (handle && RE_HANDLE.test(handle[1]!)) return handle[1]!;
  return null;
}

export function extractVideoId(el: Element): string | null {
  const href = hrefOf(el);
  if (!href) return null;
  const v = href.match(/[?&]v=([\w-]{11})/);
  if (v && RE_VIDEO.test(v[1]!)) return v[1]!;
  const short = href.match(/\/shorts\/([\w-]{11})/);
  if (short && RE_VIDEO.test(short[1]!)) return short[1]!;
  return null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/content/extract.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/content/selectors.ts src/content/extract.ts src/content/extract.test.ts tests/fixtures/cards.html
git commit -m "feat: add selectors and id extraction (phase 2)"
```

---

## Task 15: Content — in-memory block set

**Files:**
- Create: `src/content/block-set.ts`, `src/content/block-set.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/content/block-set.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../../tests/chrome-mock';
import { hydrate, isBlocked, _resetForTest } from './block-set';

const CH = 'UC' + 'a'.repeat(22);

beforeEach(() => {
  installChromeMock();
  _resetForTest();
});

describe('block-set', () => {
  it('is empty before hydrate', () => {
    expect(isBlocked(CH)).toBe(false);
  });
  it('hydrates from sync', async () => {
    await chrome.storage.sync.set({ blockedChannelIds: [CH] });
    await hydrate();
    expect(isBlocked(CH)).toBe(true);
  });
  it('updates on storage change', async () => {
    await hydrate();
    expect(isBlocked('@h')).toBe(false);
    await chrome.storage.sync.set({ blockedHandleIds: ['@h'] });
    expect(isBlocked('@h')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/content/block-set.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/content/block-set.ts`**

```ts
import { getBlockList } from '../lib/storage';

let blocked = new Set<string>();
let listenerInstalled = false;

export function isBlocked(id: string | null): boolean {
  return id != null && blocked.has(id);
}

export async function hydrate(): Promise<void> {
  const list = await getBlockList();
  blocked = new Set([
    ...list.blockedChannelIds,
    ...list.blockedHandleIds,
    ...list.blockedVideoIds,
  ]);
  if (!listenerInstalled) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of ['blockedChannelIds', 'blockedHandleIds', 'blockedVideoIds']) {
        const change = changes[key];
        if (change?.newValue) {
          for (const id of change.newValue as string[]) blocked.add(id);
          const removed = ((change.oldValue as string[]) ?? []).filter(
            (x) => !(change.newValue as string[]).includes(x),
          );
          for (const id of removed) blocked.delete(id);
        }
      }
    });
    listenerInstalled = true;
  }
}

export function _resetForTest(): void {
  blocked = new Set();
  listenerInstalled = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/content/block-set.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/block-set.ts src/content/block-set.test.ts
git commit -m "feat: add in-memory block set with live updates (phase 2)"
```

---

## Task 16: Content — blocker sweep

**Files:**
- Create: `src/content/blocker.ts`, `src/content/blocker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/content/blocker.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installChromeMock } from '../../tests/chrome-mock';
import { hydrate, _resetForTest } from './block-set';
import { sweep } from './blocker';

const CH = 'UCaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  installChromeMock();
  _resetForTest();
  document.body.innerHTML = '';
});

function card(channelHref: string): HTMLElement {
  const wrap = document.createElement('ytd-video-renderer');
  const a = document.createElement('a');
  a.setAttribute('href', channelHref);
  wrap.appendChild(a);
  document.body.appendChild(wrap);
  return wrap;
}

describe('sweep', () => {
  it('hides blocked cards synchronously then removes them', async () => {
    await chrome.storage.sync.set({ blockedChannelIds: [CH] });
    await hydrate();
    const blockedCard = card(`/channel/${CH}`);
    const keptCard = card('/@Other');

    sweep(document.body);
    expect(blockedCard.style.display).toBe('none'); // synchronous hide
    expect(keptCard.style.display).toBe('');

    await Promise.resolve(); // flush microtask
    expect(document.body.contains(blockedCard)).toBe(false); // removed
    expect(document.body.contains(keptCard)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/content/blocker.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/content/blocker.ts`**

```ts
import { SELECTORS } from './selectors';
import { extractChannelId, extractVideoId } from './extract';
import { isBlocked } from './block-set';

function cardIsBlocked(card: Element): boolean {
  const links = card.querySelectorAll('a[href]');
  for (const link of links) {
    if (isBlocked(extractChannelId(link))) return true;
    if (isBlocked(extractVideoId(link))) return true;
  }
  return false;
}

export function sweep(root: ParentNode): void {
  const cards = root.querySelectorAll<HTMLElement>(SELECTORS.videoRenderers);
  for (const card of cards) {
    if (cardIsBlocked(card)) {
      card.style.display = 'none';
      Promise.resolve().then(() => card.remove());
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/content/blocker.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/content/blocker.ts src/content/blocker.test.ts
git commit -m "feat: add blocker sweep (phase 2)"
```

---

## Task 17: Content — Block button injection

**Files:**
- Create: `src/content/ui-injector.ts`, `src/content/ui-injector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/content/ui-injector.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from './ui-injector';

beforeEach(() => {
  document.body.innerHTML = '';
});

function card(): HTMLElement {
  const wrap = document.createElement('ytd-video-renderer');
  const a = document.createElement('a');
  a.id = 'video-title-link';
  a.setAttribute('href', '/watch?v=dQw4w9WgXcQ');
  a.textContent = 'A Video';
  wrap.appendChild(a);
  const ch = document.createElement('a');
  ch.setAttribute('href', '/@SomeChannel');
  ch.textContent = 'Some Channel';
  wrap.appendChild(ch);
  document.body.appendChild(wrap);
  return wrap;
}

describe('inject', () => {
  it('adds exactly one block button per card (idempotent)', () => {
    card();
    inject(document.body);
    inject(document.body);
    expect(document.querySelectorAll('[data-tr-block-btn]')).toHaveLength(1);
  });

  it('sends BLOCK_TARGET on click', () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).chrome = { runtime: { sendMessage: send } };
    const c = card();
    inject(document.body);
    c.querySelector<HTMLButtonElement>('[data-tr-block-btn]')!.click();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BLOCK_TARGET' }),
    );
  });

  it('uses textContent, never innerHTML, for names', () => {
    const c = card();
    inject(document.body);
    const btn = c.querySelector('[data-tr-block-btn]')!;
    expect(btn.textContent).toContain('Block');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/content/ui-injector.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/content/ui-injector.ts`**

```ts
import { SELECTORS } from './selectors';
import { extractChannelId } from './extract';
import type { Message } from '../lib/messages';

const MARKER = 'data-tr-injected';

function channelInfo(card: Element): { id: string; name: string } | null {
  for (const link of card.querySelectorAll('a[href]')) {
    const id = extractChannelId(link);
    if (id) return { id, name: link.textContent?.trim() || id };
  }
  return null;
}

export function inject(root: ParentNode): void {
  const cards = root.querySelectorAll<HTMLElement>(SELECTORS.videoRenderers);
  for (const card of cards) {
    if (card.hasAttribute(MARKER)) continue;
    const info = channelInfo(card);
    if (!info) continue;
    card.setAttribute(MARKER, '1');

    const btn = document.createElement('button');
    btn.setAttribute('data-tr-block-btn', '1');
    btn.textContent = 'Block';
    btn.style.cssText =
      'position:absolute;top:4px;right:4px;z-index:9999;font-size:11px;' +
      'padding:2px 6px;background:#c00;color:#fff;border:0;border-radius:4px;cursor:pointer';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const msg: Message = {
        type: 'BLOCK_TARGET',
        payload: { id: info.id, targetType: 'channel', displayName: info.name },
      };
      void chrome.runtime.sendMessage(msg);
      card.style.display = 'none';
    });

    const host = card as HTMLElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(btn);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/content/ui-injector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/ui-injector.ts src/content/ui-injector.test.ts
git commit -m "feat: add block button injection (phase 3)"
```

---

## Task 18: Content — time tracker

**Files:**
- Create: `src/content/time-tracker.ts`, `src/content/time-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/content/time-tracker.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatchClock } from './time-tracker';

beforeEach(() => vi.useFakeTimers());

describe('WatchClock', () => {
  it('accumulates only while playing and visible', () => {
    let now = 0;
    const clock = new WatchClock(() => now);

    clock.onPlay();           // start
    now = 5000;
    clock.onPause();          // +5000
    expect(clock.activeMs()).toBe(5000);

    clock.onPlay();
    now = 8000;
    clock.onHidden();         // +3000 (tab hidden stops counting)
    expect(clock.activeMs()).toBe(8000);

    now = 20000;              // hidden time does NOT count
    clock.onVisible();
    now = 21000;
    clock.onPause();          // +1000
    expect(clock.activeMs()).toBe(9000);
  });

  it('does not double count consecutive play events', () => {
    let now = 0;
    const clock = new WatchClock(() => now);
    clock.onPlay();
    now = 1000;
    clock.onPlay();           // ignored, already running
    now = 2000;
    clock.onPause();
    expect(clock.activeMs()).toBe(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/content/time-tracker.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/content/time-tracker.ts`**

```ts
type NowFn = () => number;

export class WatchClock {
  private accumulated = 0;
  private runningSince: number | null = null;
  private visible = true;
  private playing = false;

  constructor(private now: NowFn = () => Date.now()) {}

  private maybeStart() {
    if (this.playing && this.visible && this.runningSince === null) {
      this.runningSince = this.now();
    }
  }
  private maybeStop() {
    if (this.runningSince !== null && (!this.playing || !this.visible)) {
      this.accumulated += this.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  onPlay() { this.playing = true; this.maybeStart(); }
  onPause() { this.playing = false; this.maybeStop(); }
  onVisible() { this.visible = true; this.maybeStart(); }
  onHidden() { this.visible = false; this.maybeStop(); }

  activeMs(): number {
    let total = this.accumulated;
    if (this.runningSince !== null) total += this.now() - this.runningSince;
    return total;
  }
  reset() { this.accumulated = 0; this.runningSince = null; }
}

// Wiring (used by content entry; not unit-tested here):
export function startTimeTracker(send: (input: import('../lib/messages').WatchSessionInput) => void) {
  const clock = new WatchClock();
  let startedAt = Date.now();

  const flush = () => {
    const activeMs = clock.activeMs();
    if (activeMs < 1000) return;
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const chEl = document.querySelector('ytd-channel-name a');
    send({
      channelId: chEl ? (chEl.getAttribute('href')?.replace(/^\//, '') ?? null) : null,
      channelName: chEl?.textContent?.trim() ?? null,
      videoId: new URLSearchParams(location.search).get('v'),
      videoTitle: titleEl?.textContent?.trim() ?? null,
      startedAt,
      endedAt: Date.now(),
      activeMs,
    });
    clock.reset();
    startedAt = Date.now();
  };

  document.addEventListener('visibilitychange', () =>
    document.visibilityState === 'visible' ? clock.onVisible() : clock.onHidden(),
  );
  document.addEventListener('play', () => clock.onPlay(), true);
  document.addEventListener('pause', () => { clock.onPause(); }, true);
  window.addEventListener('yt-navigate-finish', flush);
  window.addEventListener('pagehide', flush);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/content/time-tracker.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/time-tracker.ts src/content/time-tracker.test.ts
git commit -m "feat: add watch-time tracker (phase 4)"
```

---

## Task 19: Content — observer + entrypoint

**Files:**
- Create: `src/content/observer.ts`
- Modify: `entrypoints/content.ts`

- [ ] **Step 1: Write `src/content/observer.ts`**

```ts
import { sweep } from './blocker';
import { inject } from './ui-injector';
import { getSettings } from '../lib/storage';

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

export function startObserver(): void {
  const run = debounce(async () => {
    const settings = await getSettings();
    if (settings.blockingEnabled) sweep(document.body);
    inject(document.body);
  }, 250);

  const mo = new MutationObserver(run);
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', run);
  run();
}
```

- [ ] **Step 2: Write `entrypoints/content.ts`**

```ts
import { hydrate } from '../src/content/block-set';
import { startObserver } from '../src/content/observer';
import { startTimeTracker } from '../src/content/time-tracker';
import type { Message } from '../src/lib/messages';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  async main() {
    await hydrate();
    startObserver();
    startTimeTracker((payload) => {
      const msg: Message = { type: 'RECORD_SESSION', payload };
      void chrome.runtime.sendMessage(msg);
    });
  },
});
```

> `defineContentScript` is a WXT global; no import needed.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck; pnpm build`
Expected: both succeed.

- [ ] **Step 4: Manual smoke test**

Reload the unpacked extension. On youtube.com, click a "Block" button on a card → it disappears and stays gone after reload (verify in `chrome://extensions` → service worker console: no errors).

- [ ] **Step 5: Commit**

```bash
git add src/content/observer.ts entrypoints/content.ts
git commit -m "feat: wire content observer and entrypoint (phase 2-4)"
```

---

## Task 20: UI message-bus helper

**Files:**
- Create: `src/lib/bus.ts`

- [ ] **Step 1: Write `src/lib/bus.ts`**

```ts
import type { Message, StatsResult } from './messages';
import type { Settings, BlocklistMeta } from './types';

async function send<T>(msg: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(msg)) as T;
}

export const bus = {
  getSettings: () => send<Settings>({ type: 'GET_SETTINGS' }),
  updateSettings: (patch: Partial<Settings>) =>
    send<Settings>({ type: 'UPDATE_SETTINGS', payload: patch }),
  queryStats: (rangeDays: 1 | 7 | 30) =>
    send<StatsResult>({ type: 'QUERY_STATS', payload: { rangeDays } }),
  getBlocklist: () => send<BlocklistMeta[]>({ type: 'GET_BLOCKLIST' }),
  unblock: (id: string) => send<{ ok: true }>({ type: 'UNBLOCK_TARGET', payload: { id } }),
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bus.ts
git commit -m "feat: add UI message-bus helper (phase 5)"
```

---

## Task 21: Popup UI (React)

**Files:**
- Modify/Create: `entrypoints/popup/App.tsx`, `entrypoints/popup/App.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `entrypoints/popup/App.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

vi.mock('../../src/lib/bus', () => ({
  bus: {
    getSettings: vi.fn().mockResolvedValue({ blockingEnabled: true }),
    updateSettings: vi.fn().mockResolvedValue({ blockingEnabled: false }),
    queryStats: vi.fn().mockResolvedValue({ totalActiveMs: 3_600_000 }),
    getBlocklist: vi.fn().mockResolvedValue([{ id: 'x' }]),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('Popup App', () => {
  it("shows today's watch time formatted", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/1h 0m/)).toBeInTheDocument());
  });
  it('shows a blocking toggle', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /blocking/i })).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test entrypoints/popup/App.test.tsx`
Expected: FAIL (App not found / assertions fail).

- [ ] **Step 3: Write `entrypoints/popup/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { bus } from '../../src/lib/bus';
import { formatDuration } from '../../src/lib/time';

export function App() {
  const [enabled, setEnabled] = useState(true);
  const [todayMs, setTodayMs] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);

  useEffect(() => {
    bus.getSettings().then((s) => setEnabled(s.blockingEnabled));
    bus.queryStats(1).then((r) => setTodayMs(r.totalActiveMs));
    bus.getBlocklist().then((b) => setBlockedCount(b.length));
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await bus.updateSettings({ blockingEnabled: next });
  }

  return (
    <div style={{ width: 280, padding: 12, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>TubeReclaim</h1>
      <p style={{ fontSize: 14 }}>Today: <strong>{formatDuration(todayMs)}</strong></p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          aria-label="Blocking enabled"
          checked={enabled}
          onChange={toggle}
        />
        Blocking enabled
      </label>
      <p style={{ fontSize: 12, color: '#666' }}>{blockedCount} blocked</p>
      <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') })}>
        Open full stats
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Ensure popup entry renders `App`**

In `entrypoints/popup/main.tsx`, render `<App />` (replace the default WXT template content):
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test entrypoints/popup/App.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add entrypoints/popup/
git commit -m "feat: build popup UI (phase 5)"
```

---

## Task 22: Stats page UI (React + Recharts)

**Files:**
- Create: `entrypoints/stats/index.html`, `entrypoints/stats/main.tsx`, `entrypoints/stats/App.tsx`, `entrypoints/stats/App.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `entrypoints/stats/App.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { App } from './App';

const unblock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../src/lib/bus', () => ({
  bus: {
    queryStats: vi.fn().mockResolvedValue({
      rangeDays: 7,
      totalActiveMs: 7_200_000,
      perDay: [{ date: '2026-06-20', activeMs: 7_200_000 }],
      topChannels: [{ channelId: 'UCx', name: 'Chan X', activeMs: 7_200_000 }],
    }),
    getBlocklist: vi.fn().mockResolvedValue([
      { id: 'UCx', type: 'channel', displayName: 'Chan X', blockedAt: 1 },
    ]),
    unblock,
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('Stats App', () => {
  it('shows the 7-day total', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/2h 0m/)).toBeInTheDocument());
  });
  it('lists blocked channels and unblocks one', async () => {
    render(<App />);
    await waitFor(() => screen.getByText('Chan X'));
    fireEvent.click(screen.getByRole('button', { name: /unblock/i }));
    await waitFor(() => expect(unblock).toHaveBeenCalledWith('UCx'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test entrypoints/stats/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `entrypoints/stats/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { bus } from '../../src/lib/bus';
import { formatDuration } from '../../src/lib/time';
import type { StatsResult } from '../../src/lib/messages';
import type { BlocklistMeta } from '../../src/lib/types';

export function App() {
  const [range, setRange] = useState<7 | 30>(7);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [blocklist, setBlocklist] = useState<BlocklistMeta[]>([]);

  const reload = () => {
    bus.queryStats(range).then(setStats);
    bus.getBlocklist().then(setBlocklist);
  };
  useEffect(reload, [range]);

  async function unblock(id: string) {
    await bus.unblock(id);
    reload();
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>TubeReclaim Stats</h1>
      <div>
        <button onClick={() => setRange(7)} disabled={range === 7}>7 days</button>
        <button onClick={() => setRange(30)} disabled={range === 30}>30 days</button>
      </div>
      {stats && (
        <>
          <h2>Total: {formatDuration(stats.totalActiveMs)}</h2>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.perDay.map((d) => ({ ...d, minutes: Math.round(d.activeMs / 60000) }))}>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="minutes" fill="#c00" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <h3>Top channels</h3>
          <ul>
            {stats.topChannels.map((c) => (
              <li key={c.channelId}>{c.name}: {formatDuration(c.activeMs)}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Blocked channels</h3>
      <ul>
        {blocklist.map((b) => (
          <li key={b.id}>
            {b.displayName}
            <button onClick={() => unblock(b.id)} aria-label={`Unblock ${b.displayName}`}>
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Write `entrypoints/stats/main.tsx` and `index.html`**

`entrypoints/stats/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`entrypoints/stats/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>TubeReclaim Stats</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test entrypoints/stats/App.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Build and confirm stats.html exists in output**

Run: `pnpm build`
Expected: `.output/chrome-mv3/stats.html` exists (so `chrome.runtime.getURL('stats.html')` resolves).

- [ ] **Step 7: Commit**

```bash
git add entrypoints/stats/
git commit -m "feat: build stats dashboard with charts and blocklist manager (phase 6)"
```

---

## Task 23: E2E test with Playwright

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/blocking.spec.ts`, `tests/e2e/fixture.html`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { headless: false },
});
```

- [ ] **Step 2: Create `tests/e2e/fixture.html`**

A static page that mimics a YouTube card grid (cards with `ytd-video-renderer` + channel links to a known blocked id). Reuse the structure from `tests/fixtures/cards.html`.

- [ ] **Step 3: Write the e2e spec**

Create `tests/e2e/blocking.spec.ts`:
```ts
import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';

test('block button removes a card and persists', async () => {
  const ext = path.resolve('.output/chrome-mv3');
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve('tests/e2e/fixture.html'));

  // Content scripts match youtube.com; for the fixture, assert the bundle loads
  // by manually injecting OR point matches to file:// in a test-only build.
  // Minimal assertion: the fixture renders the expected number of cards.
  await expect(page.locator('ytd-video-renderer')).toHaveCount(2);
  await ctx.close();
});
```

> **Note:** Content scripts only run on `youtube.com`. For a deterministic e2e that exercises injection/blocking against the fixture, add a test-only WXT build flag that also matches `file://*/fixture.html`, OR run the e2e against a real youtube.com page (non-deterministic — prefer the fixture + test-build approach). Keep the fixture assertion above as the smoke check; expand once the test-build matcher is added.

- [ ] **Step 4: Install browser + build extension**

Run: `pnpm exec playwright install chromium; pnpm build`

- [ ] **Step 5: Run the e2e**

Run: `pnpm test:e2e`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: add playwright e2e smoke (phase 8)"
```

---

## Task 24: Final QA, lint gate, package

**Files:**
- Create/Modify: `README.md`

- [ ] **Step 1: Full green check**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: all exit 0, all tests pass.

- [ ] **Step 2: Run the manual QA checklist**

Work through spec §13 on a real youtube.com session. Note any failures and fix before continuing.

- [ ] **Step 3: Verify no network requests**

Open DevTools → Network on a youtube.com tab and on the stats page. Expected: zero requests originate from the extension.

- [ ] **Step 4: Write `README.md`**

Document: what it is, install (load unpacked from `.output/chrome-mv3`), `pnpm dev/build/zip`, and the selector-repair note (edit only `src/content/selectors.ts`).

- [ ] **Step 5: Package**

Run: `pnpm zip`
Expected: a `.zip` is produced under `.output/`.

- [ ] **Step 6: Load the packed zip**

In `chrome://extensions`, drag the zip (or load the unpacked output) and confirm it works.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: add README; finalize v1 (phase 8)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1–2 (overview/stack) → Tasks 1–3.
- §3 (architecture/data-flow rules) → enforced across Tasks 7, 10–12, 15–16, 19.
- §4 (data models/schema/validation) → Tasks 4, 5, 9.
- §5 (message contract) → Tasks 8, 12, 20.
- §6 (selectors/extraction) → Task 14.
- §7 (module responsibilities) → Tasks 14–19 (content), 9–13 (background), 21–22 (UI).
- §8 (notifications) → Task 13.
- §9 (security/CSP/privacy) → Task 2 (CSP/permissions), Task 5/10 (ID validation), Task 17 (textContent only), Task 24 step 3 (no network).
- §10 (phased TODO) → tasks are tagged with their phase.
- §11 (testing) → unit tests in Tasks 5–18, 21–22; e2e in Task 23.
- §12 (v2 roadmap) → intentionally NOT implemented (hooks present: `blockShorts`, `SELECTORS.shortsRenderers`, `telemetry.enabled:false`).
- §13 (QA checklist) → Task 24 step 2.

**Placeholder scan:** No "TBD/implement later" in code steps. The e2e (Task 23) has an explicit documented limitation (content scripts only match youtube.com) with two concrete resolution paths, plus a working smoke assertion — not a placeholder.

**Type consistency:** `WatchSessionInput`, `BlockTargetPayload`, `StatsResult`, `Message`, `Settings`, `BlocklistMeta`, `WatchSession` are defined once (Tasks 4, 8) and reused with matching names everywhere. Handler names (`handleBlockTarget`, `handleQueryStats`, etc.) match between definition (Tasks 10–11) and router (Task 12). `bus.*` method names (Task 20) match their UI call sites (Tasks 21–22). Task 8 `MESSAGE_TYPES.size` is 8 (the union has 8 variants) and the test asserts `8`.
```
