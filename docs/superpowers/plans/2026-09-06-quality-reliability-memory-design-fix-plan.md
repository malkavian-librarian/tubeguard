# TubeGuard — Quality / Reliability / Memory / Design Fix Plan

Synthesized from four parallel subagent audits (code quality, reliability, RAM/memory, design) run on 2026-09-06 against `feature/daily-learning-analysis`. Each phase follows TDD: write/extend a failing test that captures the current bug or missing invariant, then implement the minimal fix, then refactor.

---

## Phase 0 — Housekeeping (no code risk, do first)

- [ ] Delete `pnpm-lock.yaml` and `pnpm-workspace.yaml` (untracked stray artifacts — this is an npm project; `node_modules` was polluted by a stray `pnpm install`). Reinstall with `npm install` to confirm a clean npm-only lockfile.
- [ ] Delete local Playwright run artifacts `.test-profiles/` and `test-results/` (gitignored, safe, just disk clutter).
- [ ] Mark `docs/NEW-EXTENSION-SPEC.md` and `docs/superpowers/plans/2026-06-20-tubereclaim.md` as historical (add a one-line "superseded — kept for history" banner) since they describe the old "TubeReclaim" TypeScript rebuild that never happened; don't delete, they have historical value.
- [ ] Merge `AGENTS.md` into `CLAUDE.md` (or make `AGENTS.md` a one-line pointer) — they're near-duplicates and drift independently.

No tests needed — verify via `npm install` succeeding and `git status` showing a clean tree.

---

## Phase 1 — Reliability fixes (HIGH priority, genuine stuck-state bugs)

All three are real correctness bugs, not theoretical. TDD: each gets a new test in `src/__tests__/` reproducing the stuck state before the fix.

1. **Outbox permanent-failure stuck ownership** — `src/shared/storage.js` `markOutbox`/`planBlock`. A non-stale outbox failure (e.g. `chrome.storage.sync` quota exceeded) never clears `ownership.automatic`, so `planBlock`'s guard permanently blocks re-evaluating that channel — it can accrue watch time forever but never get blocked, silently.
   - Test first: simulate a `chrome.storage.sync.set` failure in `drainBlockOutbox`, assert the channel becomes re-plannable after N retries/a time window.
   - Fix: add failure-count/backoff to outbox rows; after threshold, clear `o.automatic` (mirror `cancelOutbox`) and optionally notify.

2. **Orphaned run rows on config-change mid-run** — `src/background/analysis-runner.js` outer catch never calls `finishRun` on `STALE_GENERATION`/`LEASE_LOST`, so editing priorities while a run is in-flight leaves a dead run row forever and **pauses analysis until the next calendar day** instead of resuming same-day.
   - Test first: start a run, mutate config mid-run, assert a new run becomes claimable the same day (not next `nextDueAt`).
   - Fix: on catching `STALE_GENERATION` for the owning run, close it out (new `cancelled` status) and have `saveConfig` set `nextDueAt = now` so same-day resumption works.

3. **Silent `suspended` runs on bad OpenRouter key** — `PROVIDER_AUTH_ERROR` → `status:'suspended'` is never read back anywhere; user gets zero signal that analysis has stopped.
   - Test first: assert a suspended run either disables `config.enabled` or triggers a notification.
   - Fix: on `PROVIDER_AUTH_ERROR`, notify via the existing `notification.js` pattern (or surface a warning in options/stats UI keyed off latest run status).

**Medium priority, same phase (cheaper, bundle in):**
4. `renewRunLease` (exists in `storage.js`) is never called from `analysis-runner.js` — a run longer than the 120s lease can be double-claimed. Fix: call it periodically inside `runDueAnalysis`.
5. `drainBlockOutbox` has no backoff cap on retrying a failing entry (runs ~10×/run + every worker startup). Bundle exponential backoff into fix #1.

**Test-gap backfill** (write these regardless of whether the bug is hit today): outbox partial-failure crash recovery across a simulated worker restart; config-change-during-run orphaned-run behavior; long-running attempt vs. lease expiry; suspended→next-day recovery.

---

## Phase 2 — Code quality fixes

TDD where behavior changes; pure refactors (constant extraction, file split) just need the existing suite green before/after.

1. **Centralize magic numbers into `src/shared/analysis-contracts.js`**: `EVIDENCE_LIMITS` (title 2048 / description 32768 / segment 8192 — currently duplicated in `youtube-bridge.js`, `video-evidence.js`, `analysis-validation.js`, `service-worker.js`), `ANALYSIS_MIN_DURATION_SECONDS=300`, `ANALYSIS_LEASE_MS=120000`, `ANALYSIS_RETRY_BACKOFF_MS`, `MAX_TRANSCRIPT_SEGMENTS=20000`. Wire in the two constants that already exist but aren't used everywhere (`ANALYSIS_THRESHOLD_MS`, `ANALYSIS_DAY_MS`). Effort: S, but touches a trust boundary (page→content→background) — run `video-evidence.test.js` after.
2. **Replace `setInterval` in `src/content/ui-injector.js` (~line 225)** with a short-lived `MutationObserver` on the confirm-dialog container. Fixes the CLAUDE.md violation. Manual QA on YouTube's real unsubscribe-confirm flow required (DOM-timing-sensitive).
3. **Unify the request/response wrapper** — `message-bus.js` already supports `requestId` but `time-tracker.js`, `options.js`, and `ui-injector.js` each hand-roll their own `sendMessage` wrapper. Add one `sendRequest(type, payload)` export to `message-bus.js`, migrate all three call sites.
4. **Fix `service-worker.js` module-boundary inconsistency** — `BLOCK_VIDEO`/`TRACK_SESSION` inline validation+storage in the router, unlike `BLOCK_CHANNEL` which delegates to `block-service.js`. Extract for symmetry.
5. **Split `storage.js` (374 lines, God object)** into `shared/storage/{schema,transaction,legacy-stores,analysis-store}.js`, re-exported from a thin `storage.js` barrel so the ~8 existing import sites don't change. This also closes the CLAUDE.md documentation gap (docs reference an "analysisStore module" that doesn't exist as a file today). Run `storage-migration.test.js`, `storage-hardening.test.js`, `analysis-recovery.test.js` before and after — this file is concurrency-sensitive (generation fencing, lease tokens). Effort: L, do last in this phase.
6. **Finish the `innerHTML`→`textContent`/`createElement` migration in `stats.js`** (lines ~103,114,147,150,156,170,182) — an `esc()` helper already exists, this just completes the documented convention.

---

## Phase 3 — Memory / performance fixes

1. **Add pruning/retention for IndexedDB analysis stores** (`CAPTURES`, `EVIDENCE`, `CHUNKS`, `RUNS`, `CLASSIFICATIONS`, `COVERAGE`) — currently the only growth guard is a 245MB hard-fail cliff, no TTL/eviction. Add periodic pruning via `alarm-manager.js` for finalized/aged-out rows.
   - Test first: assert old finalized runs/coverage rows get pruned after N days without breaking active-channel accounting.
2. **Add indexes for the hot-path full-table scans** in `storage.js`: `selectRunBatch`'s `tx.all(COVERAGE)`/`tx.all(CLASSIFICATIONS)`, `claimRun`'s `tx.all(RUNS)`, `getChannelAccounting`'s `tx.all(COVERAGE)`. These currently get slower every day the feature runs. Add a compound index (e.g. COVERAGE by `[policyRevision, channelId]`) and switch to indexed range queries.
3. **Fix `getOwnership`/`listAutomaticBlockIds`** (`storage.js`) — full `getAll()` + JS filter on every checkpoint/outbox drain. Add a direct `get(channelId)` fast path plus a multi-entry alias index for the fallback.
4. **Gate the always-on attribute-observing `MutationObserver` in `time-tracker.js`** (~lines 77-78) behind `config.enabled` — currently runs unconditionally on every YouTube tab regardless of whether the analysis feature is turned on, and is never disconnected. This is the one real "adds sustained churn" cost found.

Everything else (checkpoint queues, transcript/evidence buffers, UI pagination) was already verified well-bounded — no action needed there.

---

## Phase 4 — Night-mode purple-neon brand book rollout

Full token spec, exact hex values, and component specs already drafted (see the design agent's output — reproduce as `docs/BRANDBOOK.md` verbatim, it's implementation-ready). Summary of the rollout:

1. **Create `src/shared/theme.css`** — single source of truth `:root { --tg-*: ...; }` token file (backgrounds, text, neon-purple accent system `--tg-accent:#7c3aed` + glow shadows, semantic danger/warning/success/info tuned into the purple family, one font stack, 4-step radius scale, 6-step spacing scale). Night-mode only, `color-scheme: dark`, no light-mode branch anywhere.
2. **Rewire `popup.css`, `stats.css`, `options.css`** to `@import`/`<link>` `theme.css` and replace every hardcoded hex with `var(--tg-*)`. Delete `options.css`'s forced `color-scheme:light`, its Georgia serif headings, and its independent sage-green palette. Delete `stats.css`'s duplicated `:root` block and hardcoded pastel type-badge colors (replace with the semantic tint tokens).
3. **Create `src/content/theme-inject.js`** — fetches `theme.css` via `chrome.runtime.getURL` and injects it once per page load as a `<style>` tag into the YouTube page (safe/inert since it only declares custom properties). Create a second injected stylesheet (`content/injected-ui.css`) defining shared classes (`.tg-btn`, `.tg-chip`, `.tg-popover`, `.tg-toast`) using the same tokens.
4. **Refactor `ui-injector.js` and `blocker.js`** to set `className` instead of inline `style.color`/`style.background` (inline styles stay only for computed layout values like `top`/`left`). This removes the 4 independent ad-hoc red shades currently hardcoded there.
5. **Write `docs/BRANDBOOK.md`** as the durable design-system reference (full palette table, typography scale, spacing/radius/elevation tokens, component specs, accessibility contrast table — all already drafted, ready to paste in).
6. **Add a CLAUDE.md rule**: "All colors/spacing/radius/typography must come from `src/shared/theme.css` custom properties. Never hardcode a hex/px value in a `.css` file or inline `element.style`. See `docs/BRANDBOOK.md`. Night-mode only — no light-mode branch."

Verification: load the unpacked extension, open popup/stats/options side by side, confirm identical palette; inject on a real YouTube page and confirm the block button/stats chip/popover use the same purple/neon system, not the old inline hexes.

---

## Phase 5 — Docs, CLAUDE.md, memory, README

1. **Fix stale CLAUDE.md/AGENTS.md claims**: remove "npm test not wired up" (vitest+Playwright are fully configured and passing — 13 files/52 tests); update the File Structure section to include `background/analysis-*.js`, `content/video-evidence.js`, `content/transcript-adapter.js`, `shared/analysis-contracts.js`, `shared/analysis-validation.js`; fix the "IndexedDB through `analysisStore`" reference now that Phase 2 step 5 makes that a real file path.
2. **Run the `claude-md-improver` skill** against the updated `CLAUDE.md` to audit tone/structure/completeness after the above manual fixes land, rather than before (so it audits the corrected version, not the stale one).
3. **Rewrite `README.md`** — confirm it still accurately describes the daily-learning-analysis feature, the new brandbook/theming, and drop any now-stale setup instructions (e.g. reference the pnpm/npm cleanup from Phase 0 if it mentioned pnpm).
4. **Update this repo's Claude memory** (`~/.claude/projects/.../memory/`) with: the resolved reliability bugs (so future sessions don't re-flag them), the brandbook's existence and location (`docs/BRANDBOOK.md`, `src/shared/theme.css`) so future design work references it instead of re-auditing, and the npm/pnpm lockfile conflict resolution (so it's not repeated).
5. Record a Honcho conclusion: the architectural decision to split `storage.js` into submodules and to adopt a single `theme.css` token file as the enforced design-system boundary — both are non-obvious decisions worth recalling in future sessions.

---

## Suggested execution order

Phase 0 → Phase 1 (reliability, since these are live correctness bugs affecting real blocking behavior) → Phase 4 (design, since it's the most visible ask and self-contained) → Phase 2 (code quality) → Phase 3 (memory/perf, lowest urgency — nothing is broken today, just gets slower over time) → Phase 5 (docs, last, since it should describe the final state).

Each phase should land as its own commit (or small set of commits), with `npm test`, `npm run build`, and `npm run test:e2e` green before moving to the next phase, per the project's existing testing mandate for this feature.
