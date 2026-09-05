# Daily learning analysis implementation review

Reviewed 2026-09-05 against `docs/superpowers/plans/2026-09-05-daily-learning-analysis.md`. Scope included storage, analysis scheduling and execution, OpenRouter, block application, message authorization, evidence capture, playback accounting, and the options page. This review did not modify implementation code.

## Remediation status

All P1 findings and the listed P2 durability/UI findings were remediated before delivery. Evidence is pinned per capture and separated by version in analysis batches; disable/re-enable rotates capture generations; outbox ownership is staged before Chrome sync; stale intents are cancelled; manual ownership follows a successful sync write; storage pressure, backlog, run outcome, and immutable run settings are exposed in options; fallback export files are bounded to 8 MiB. Final verification is recorded in `implementation-progress.md` and `security-review-2026-09-05.md`.

## Findings

### P1 — Watch chunks are classified with mutable latest evidence rather than the evidence captured for the watch

`acceptCheckpoint` stores the video and channel but no `evidenceVersion` (`src/shared/storage.js:262`). `selectRunBatch` later looks up `videos.evidenceVersion`, which is the latest snapshot at analysis time (`src/shared/storage.js:297-302`), and `commitVideoResult` assigns that latest evidence's channel and verdict to all selected historical chunks (`src/shared/storage.js:325-330`).

This violates the immutable evidence contract. A later visit that changes transcript, metadata, or canonical owner can cause old watch time to be classified from evidence that was not captured with that watch and can attribute the time to another channel. It also makes an evidence update between multipart attempts change what future runs do with old chunks.

Bind each accepted chunk (or capture session) to the immutable evidence version and identity used for that capture. Batch selection and classification commits must use that version, and reject conflicting later identity rather than rewriting old attribution. Add a regression test that saves version A, accepts a chunk, saves version B with a different channel/transcript, and proves the chunk remains bound to A.

### P1 — Crash recovery can relabel an automatically inserted block as manual

The outbox writes `blockedChannels` first and only afterward records `insertedIds` and the applied state (`src/background/block-service.js:13-20`). If the worker dies between those operations, replay sees the intended ID already in sync while ownership has no `insertedIds`; it calls `setManualOwnership(... blocked: true)` (`src/background/block-service.js:15-17`). The extension's own block is therefore permanently classified as manual.

This is the required “after sync write, before applied marker” recovery boundary. It corrupts ownership provenance, so deleting automatic blocks can retain the block and the decision audit no longer tells the truth.

Persist enough pre-write ownership state to distinguish a replay of the same intent from a pre-existing user block. On replay, an ID associated with that durable intent should be finalized as automatically inserted. Add a fresh-module/restart regression test at this exact failure point.

### P1 — Manual block ownership is committed before the Chrome sync mutation succeeds

`applyManualBlock` updates ownership/reset state and deletes pending automatic intents before calling `chrome.storage.sync.set` (`src/background/block-service.js:25-33`, `src/shared/storage.js:358-360`). If the sync write fails, a manual block is recorded although no block exists, or a manual unblock advances the reset watermark and destroys pending intents while the channel remains blocked.

This leaves the durable local authority inconsistent with the actual enforced block list. In the unblock case it can also suppress future accounting even though the requested unblock did not happen.

Represent manual changes as durable intents, apply sync, and finalize ownership only after success, with recoverable reconciliation after restart. At minimum, compensate the local mutation on failure. Add failure injection for both block and unblock sync writes.

### P2 — Configuration changes leave old capture sessions valid instead of rotating capture epochs

Capture validation checks the deletion `generation`, enabled state, and sender binding, but not `configGeneration` (`src/shared/storage.js:155-159`). Capture sessions store no config generation (`src/shared/storage.js:227-229`). Every save increments `configGeneration` (`src/shared/storage.js:201-208`), but old sessions remain acceptable whenever the feature is enabled.

The content broadcast usually starts a new capture, but it is advisory and races with queued messages or a content script that misses the broadcast. The plan explicitly requires configuration changes to rotate capture epochs. A stale document can continue submitting under its old session after a model change or disable/re-enable transition.

Store the capture's config generation and define the intended late-delivery rule explicitly: allow already measured intervals from the original policy where required, while refusing intervals whose wall time occurred after disable/config rotation. Regression-test a stale capture after model change and after disable/re-enable.

### P2 — Automatic intents made stale by settings changes remain pending forever

`drainBlockOutbox` silently skips intents whose generation, config generation, or ownership generation no longer matches (`src/background/block-service.js:9-11`). It neither deletes them nor records a terminal/cancelled decision. `listOutbox` returns every non-applied row (`src/shared/storage.js:363`), so each initialization retries and skips the same rows indefinitely while the options UI continues to show `pending`.

Mark stale intents cancelled with a bounded reason in the same durable reconciliation path. This keeps the audit truthful and prevents permanent outbox debris.

## Review dimensions

| Dimension | Rating | Notes |
|---|---:|---|
| Correctness | Needs changes | Immutable evidence binding and failed/manual block transitions have high-impact failures. |
| Security and privacy | Good with correctness caveats | Message sender authorization is narrow, user strings render through `textContent`, the OpenRouter endpoint is fixed, response size is bounded, and API keys are excluded from IndexedDB/public config. Incorrect identity/evidence binding can still affect an automatic enforcement decision. |
| Reliability | Needs changes | The outbox crash boundary and sync failure ordering break durable ownership; stale intents do not converge. |
| Performance | Acceptable for current scale | Global `getAll()` overlap and accounting scans will become expensive, but the immediate correctness failures above take priority. |
| Maintainability | Acceptable | Modules have clear boundaries, but several durable state machines lack explicit transition tests. |

## Positive observations

The implementation validates extension-page versus YouTube content-script senders, keeps the API key in trusted local storage and out of exported config, bounds provider and transcript responses, checks model output identifiers and evidence references, applies the strict greater-than-30-minute threshold, deduplicates checkpoint sequence keys before gap validation, uses transaction completion for repository writes, and renders hostile history text without dynamic HTML. The live-caption limitation is reported honestly rather than filled with fabricated transcript data.

The five findings above should be fixed before treating the feature as complete. The first three are release-blocking because they can produce wrong automatic enforcement or durable state that cannot be reconciled correctly.
