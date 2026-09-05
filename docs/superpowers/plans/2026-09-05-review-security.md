# Independent review: security, privacy and automatic-block semantics

Reviewed draft `2026-09-05-daily-learning-analysis.md` and existing service-worker, storage, message-bus, popup and stats code. Review only; no production edits. The core separation of LLM verdict from deterministic blocking, local secrets, sender checks, explicit enabling and durable outbox is sound. The following are concrete amendments needed before implementation.

## HIGH — H1: Durable config snapshots must explicitly exclude credentials

Runs contain an "immutable policy/config snapshot" and exports expose feature data. Config includes `key`; an executor following that literal contract could duplicate the credential into IDB, attempts or exports despite the general prohibition on logging secrets.

**Fix:** Define `PublicAnalysisConfigSnapshot` as an explicit allowlist: modelId, policyRevision, configGeneration, priorities, budgets and prompt/schema versions only. Read the key just before fetch from trusted local storage; never clone an entire config object into durable records. Error storage uses allowlisted error codes and redacted bounded provider messages, never request headers or arbitrary exception objects. Add T2/T4/T6 tests that inject a distinctive key and recursively inspect every IDB store, export and logged failure for its absence.

## HIGH — H2: Provenance is not sufficiently modeled to preserve manual blocks

Outbox stores add/remove IDs but there is no durable owner/reference model for canonical and alias IDs. Existing stats renders `blocklist-meta`, while the automatic path only promises sync writes. A manual block made after an automatic block, shared aliases, deletion of automatic blocks, and an unblock by handle can erase a manual block or leave invisible blocked IDs.

**Fix:** Add a local block provenance record keyed by canonical channel: observed aliases plus evidence/source timestamps; manual ownership flag; automatic decision IDs; generation; and exact inserted sync IDs. Preserve blocks with any remaining owner. Update `blocklist-meta` and sync reconciliation together through the recoverable outbox flow so existing stats sees automatic blocks. Resolve manual unblock by canonical ID or known alias to the same channel reset. Treat preexisting or externally synced ownership as unknown/manual and never delete it through "remove automatic blocks." T5 tests must cover auto -> manual -> delete-auto, alias unblock, duplicate aliases and crash between sync write and metadata update.

## HIGH — H3: Delete/disable is vulnerable to resurrection unless all commits are fenced

The plan checks generation before calls and block mutations, but accepts evidence/checkpoints without a capture generation and does not explicitly gate late result commits. A transcript fetch, pending checkpoint, run completion or retry can repopulate deleted data. Clearing `analysis-state` can also reset a generation to an old value (ABA).

**Fix:** Keep a monotonic or random durable tombstone generation outside deleted stores. Attach a worker-issued capture epoch to collection; check it transactionally in every evidence, checkpoint, classification, attempt, outbox and run-state write. Delete disables feature capture/analysis, advances epoch first, signals collectors/aborts network, then removes records. Disabling AI alone must have an explicit choice: recommended preserve locally enabled history collection but stop all network and automatic actions. Feature deletion stops enriched capture until explicitly reenabled; existing ordinary stats may continue, and UI must say so. A submitted provider request cannot be recalled or remote copies deleted by local deletion. Test delayed caption result, delayed provider success, content retry and queued alarm after deletion/restart; all must leave deleted stores empty.

## MEDIUM — M1: A local mutation queue does not serialize Chrome sync across computers

Reading the latest sync array and writing a union avoids races inside one worker only. Another computer can write between these operations. The local decision log may not explain blocks visible on another synced device, and a remote removal can be immediately replayed by a pending local add.

**Fix:** Explicitly document automatic block IDs continue syncing under the existing contract while evidence/audit remain device-local; settings must disclose this. Observe external `storage.onChanged` and reconcile conservatively, treating unexpected removed IDs as an unblock/reset and cancelling older pending additions. State that whole-array sync lacks cross-device atomic conflict resolution; do not promise lost-update freedom across devices. Include synthetic external-sync races in T5. A future per-ID/tombstone sync redesign should be a separate amendment, not implied by the local queue.

## MEDIUM — M2: Page spoofing and prompt injection have residual limits

MAIN-world data and owner DOM links can be forged by the page; validating the UC pattern proves format, not ownership. A schema-valid LLM answer can still follow malicious transcript instructions. A mocked "malicious transcript" test cannot prove model immunity.

**Fix:** Specify no arbitrary bridge request commands, fetch requests or watch-time inputs: accept only the fixed metadata response shape, validate source/window/origin, and independently match isolated-world active video and owner identity. Missing/conflicting owner evidence is ineligible. State explicitly that page identity is best effort and semantic model errors remain possible. T4 injection tests prove exact input delimiting and absence of authority-bearing output fields, not perfect classification. Add adversarial mocked verdicts to show they cannot choose another channel, increase credited time or alter priorities. Quiet reversible blocks and a clear correction/unblock route are retained.

## MEDIUM — M3: Resource bounds are inconsistent across acquisition, storage and prompts

A 2 MiB final transcript limit does not cap a huge response before parsing; signed caption requests may include unnecessary query fields. Priorities have no stated byte limit, and full durable input snapshots repeated per attempt can exceed the 250 MiB budget even when evidence admission stops.

**Fix:** Set concrete streamed response, segment-count, per-segment and bridge bounds before parsing (for example 4 MiB raw response, 20,000 segments, 8 KiB per segment, with oversize producing incomplete evidence). Validate necessary observed caption query parameters, reject redirects and never persist URLs. Bound priorities (for example 16 KiB UTF-8), budget the entire outbound request including system/schema/priorities, and ensure parts can fit this overhead. Store each immutable input snapshot once, reference it from retries, and include snapshots/runs/audit in storage accounting. Reserve space for compact failure/deletion records and stop new analysis requests when durable preflight recording cannot commit. Test huge provider/caption bodies, long priorities, repeated retries and storage exhaustion.

## MEDIUM — M4: Stable audit references require immutable source versions

`videos/videoId` is mutable; classifications refer to a hash and `segment:4`, but the same video can later have edited transcript/title/description. Exact input snapshots are promised without a store or dereference interface. Audit may display newer text as support for an older decision.

**Fix:** Add immutable input snapshots keyed by hash with submitted text, ordered stable segment IDs, watched ranges, prompt/schema version and non-secret config. Classifications/decisions reference this snapshot. History may show latest evidence, but audit must resolve the exact analyzed evidence; export includes it. Tests update video evidence after analysis and assert the old audit remains byte-identical.

## Recommended acceptance gate

Merge H1-H3 before agent handoff and give each an explicit red-test ownership entry. Address M1-M4 in the product/data contracts and related tasks. No extra user confirmation is needed for these planning clarifications; automatic blocks remain silently applied under the user's enabled policy.
