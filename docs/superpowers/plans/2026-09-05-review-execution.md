# Independent review: execution and verification

Reviewed the draft plan and package.json, manifest.json, existing tracker, storage, worker and constants. Planning review only; no implementation performed.

## High priority findings

1. **Evidence immutability is promised but not modeled.** `videos/videoId` overwrites evidence, while classifications reference an evidenceVersion and runs promise snapshots. A subsequent visit can replace text before a resumed run builds its next part, or make historical references unreadable. Add an immutable `evidence-versions/[videoId,evidenceVersion]` store, or persist complete selected evidence and all prepared parts atomically at run selection. Specify SHA-256 canonicalization fields, excluding capture timestamps, and stable segment IDs. Add a test that updates evidence between selection, first part, restart and final part, then reconstructs the exact audited evidence.

2. **Coverage and backlog contracts are not sufficient for independent workers.** The unique coverage key is unspecified; uncertain/failed evidence must remain a backlog, but repeatedly selecting it oldest-first can starve all later videos and consume every daily budget. Specify unique successful coverage by `[policyRevision,chunkId]`, with each chunk covered once regardless of evidence version, and separate attempt state from terminal accounting. Define retry eligibility: unchanged uncertain evidence waits for evidenceVersion change or explicit bounded retry date; permanently unavailable evidence is logged and skipped until new evidence. Define how watches of an already classified video are analyzed against the new watched ranges. Add starvation, changed-evidence, repeated-watch and two-run overlap tests.

3. **Checkpoint ownership crosses the declared parallel boundary.** T3 requires worker interval arbitration, but T2 owns acceptCheckpoint and T3 owns only content files. Move arbitration into T2 and specify its exact inputs/output. A single span plus activeMs cannot describe arbitrary active subintervals sufficiently to subtract cross-window overlap. Either require every checkpoint to represent one continuous active interval, or include explicit active wall-clock intervals. Worker receipt time must bound client timestamps. Define ordering for out-of-order retries rather than rejecting a missing earlier sequence forever. Test two windows, duplicate delivery, sequence 2 arriving before 1, and a lost acknowledgement.

4. **The T1/TDD handoff is internally inconsistent.** T1 is told to add failing production parser tests, implement only helpers, and precede T2, while the general rule forbids progressing past failed prerequisites. T1 should finish with passing harness/fixture-integrity checks and a documented live feasibility result. T3 owns production parser tests and its first red/green implementation cycle. Remove the deliberately wrong fixture assertion exercise: it provides no useful behavioral assurance. Keep the real red phase for production behavior.

5. **Browser verification needs an explicit executable harness.** The first E2E launch occurs before the listed build command, so it can run stale bundles. Add build as a test:e2e prerequisite and define a separate temporary persistent Chrome profile. Synthetic YouTube pages need an actual progressing local test video and fixture player data, not merely DOM events; otherwise this tests mocks rather than the playback state machine. Define how the test advances due time and inserts long prior watch history without 30-minute real waits: seed IDB only through the trusted options context in the test harness, never ship an unauthenticated test message. Specify how OpenRouter worker fetches are intercepted; page.route alone cannot be assumed to cover worker traffic. Require a proof-of-interception assertion before sending any synthetic request, with no real key present. Distinguish a control connection that terminates a worker from lifecycle-idle verification with no attached debugger. Add a harness spike before T5 if browser interception or extension loading is unavailable.

## Medium priority findings

6. **Legacy statistics mapping is underspecified.** Existing rows require channelName, videoTitle, startTime, duration and date; new evidence omits channelName and checkpoints can arrive before enrichment. Define a stable compatible row projection, local fallback display names, and handling of later metadata. Specify whether collecting legacy statistics continues while AI is disabled (recommended: preserve existing behavior), while feature chunks are admitted only during an enabled epoch. Test short videos, disabled AI, missing evidence and midnight splitting with existing stats consumers.

7. **Audit API does not expose every LLM decision.** listDecisions is channel-action oriented, while relevant/uncertain results and empty/error runs may never create channel decisions. Define GET_ANALYSIS_LOG as a paginated union or separate views of runs, attempts, classifications and block actions, linked by run/classification IDs. Include relevant and uncertain verdicts, invalid-response failures and no-block decisions. Test a relevant-only run is visible and its submitted evidence can be inspected.

8. **Export conflicts with its memory requirement.** A normal Blob constructed from all paginated records still buffers the full export. Choose an explicit bounded approach: streamed file writing when supported with a documented fallback to numbered bounded JSON files, or a smaller permitted export bound. Specify export consistency under concurrent writes/deletion and test multiple pages without assembling all records in one array.

9. **Part construction has unresolved pathological cases.** A description may be 32 KiB while an entire request is limited to 24 KiB; priorities lack any limit; one transcript segment can exceed the entire budget. Define limits on priorities and JSON framing overhead, and split title/description/transcript evidence losslessly with stable references at Unicode-safe boundaries. Distinguish request byte budget from model token/context capacity. Test a maximal description, one giant segment, large priorities and no transcript overlap with watched ranges. Also specify aggregation precedence for a relevant part plus an uncertain part (conservative no-block either way, but the logged verdict must be deterministic).

10. **Instruction requirements are covered but should happen before coding.** The requested Honcho-before-planning rule is only installed in final T8. Add an implementation preflight requiring existing AGENTS.md/CLAUDE.md/rules/project memory discovery, Honcho recall, and preservation of user modifications. T8 remains the final documentation update. Add a requirement matrix mapping each user requirement to task, named tests and live evidence. The draft header currently claims revised-after-review before dispositions exist; only use that status once revisions are complete.

## Recommended disposition

Resolve findings 1–5 in the plan before implementation handoff. Fold 6–10 into explicit acceptance criteria and contracts; they are small planning additions that prevent substantially different independent implementations. The scope, silent automatic blocking semantics, cumulative threshold default, local key handling and requested memory/code-review tasks are otherwise clearly covered.

## Minimal scheduler/storage handoff additions

These are contracts, not suggested production implementations:

```js
// Atomic: claim due/resumable job, or null if disabled/not due/leased.
claimRun({now, owner, leaseMs}) // -> {runId, leaseToken, configGeneration, policyRevision, cutoff, cursor}|null
// Atomic lease fencing on every mutation. Stale token => LEASE_LOST.
renewRunLease({runId, leaseToken, now, leaseMs}) // -> {expiresAt}
// Bounded selection skips covered or not-yet-retryable chunks; immutable snapshot.
selectRunBatch({runId, leaseToken, maxVideos, maxBytes}) // -> {batchId, videos, chunks, nextCursor}
savePreparedParts({runId, leaseToken, batchId, parts}) // -> {partIds}
// Network retries are attempts, never duplicate coverage.
beginAttempt({runId, leaseToken, partId, now, inputBytes}) // -> {attemptId}|BUDGET_EXHAUSTED
finishAttempt({runId, leaseToken, attemptId, outcome})
// outcome: success|retryable|terminal|indeterminate; retryAt?; validated result?; redacted error?
commitVideoResult({runId, leaseToken, batchId, videoId, result, chunkIds})
// Atomic successful coverage keys [policyRevision,chunkId]; uncertain stores retry condition only.
getChannelAccounting({policyRevision, channelId}) // -> {irrelevantMs, resetAt, coveredChunkIds}
finishRun({runId, leaseToken, status, nextDueAt})
listAnalysisLog({cursor, limit, kind}) // -> {items,nextCursor}; run|attempt|classification|action
```

Define run states `queued -> running -> waiting_retry -> running -> completed|completed_with_errors|cancelled|suspended`. A waiting job owns no active lease; an alarm at retryAt reclaims it. Daily due time and retry time are distinct persisted fields. Budget exhaustion closes the day's job with backlog retained, and the next daily slot receives a fresh budget; run-now reuses the day's budget ledger. Specify one concrete cadence rule, e.g. nextDueAt advances to the first original 24-hour slot strictly after now, preventing catch-up storms and finish-time drift. Every final result/outbox write checks leaseToken and configGeneration transactionally. T2 supplies these contracts and tests; T5 supplies orchestration.
