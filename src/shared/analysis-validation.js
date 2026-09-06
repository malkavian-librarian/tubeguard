import { CHANNEL_ID_PATTERN } from './constants.js';
import { EVIDENCE_LIMITS, MAX_TRANSCRIPT_SEGMENTS, PRIORITIES_MAX_BYTES } from './analysis-contracts.js';
export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
export const CANONICAL_CHANNEL_PATTERN = /^UC[\w-]{22}$/;
export function analysisError(code, message = code) { return Object.assign(new Error(message), { code }); }
export function assert(condition, code = 'INVALID_INPUT') { if (!condition) throw analysisError(code); }
export const byteLength = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
export function boundedText(value, maximum) {
  assert(typeof value === 'string' && byteLength(value) <= maximum); return value;
}
export function validateSender(sender) {
  assert(sender && Number.isInteger(sender.tabId) && sender.tabId >= 0 && typeof sender.documentId === 'string' && sender.documentId.length > 0);
  return { tabId: sender.tabId, documentId: boundedText(sender.documentId, 256) };
}
export function validateConfigPatch(patch) {
  assert(patch && typeof patch === 'object' && !Array.isArray(patch));
  const allowed = new Set(['enabled','modelId','priorities','maxRequestsPer24h','maxInputBytesPer24h','apiKey','keyAction','now']);
  assert(Object.keys(patch).every(key => allowed.has(key)));
  if ('enabled' in patch) assert(typeof patch.enabled === 'boolean');
  if ('modelId' in patch) assert(/^z-ai\/glm-[\w.-]+$/.test(patch.modelId), 'UNSUPPORTED_MODEL');
  if ('priorities' in patch) boundedText(patch.priorities, PRIORITIES_MAX_BYTES);
  if ('apiKey' in patch) { boundedText(patch.apiKey, 4096); assert(patch.apiKey.trim().length > 0); }
  if ('keyAction' in patch) assert(['keep','replace','clear'].includes(patch.keyAction));
  for (const [key, min, max] of [['maxRequestsPer24h',1,1000],['maxInputBytesPer24h',1024,16*1024*1024]]) {
    if (key in patch) assert(Number.isInteger(patch[key]) && patch[key] >= min && patch[key] <= max);
  }
  return patch;
}
export function validateEvidence(input) {
  assert(input && VIDEO_ID_PATTERN.test(input.videoId));
  assert(typeof input.captureEpoch === 'string' && typeof input.navigationId === 'string');
  assert(input.channelId == null || CHANNEL_ID_PATTERN.test(input.channelId));
  assert(input.durationSeconds == null || (Number.isFinite(input.durationSeconds) && input.durationSeconds > 0));
  const transcript = input.transcript;
  assert(transcript && ['complete','unavailable','pending','partial','oversized','failed'].includes(transcript.status));
  assert(Array.isArray(transcript.segments) && transcript.segments.length <= MAX_TRANSCRIPT_SEGMENTS);
  const segments = transcript.segments.map((segment, index) => {
    assert(Number.isInteger(segment.startMs) && segment.startMs >= 0 && Number.isInteger(segment.endMs) && segment.endMs >= segment.startMs);
    return { id: String(index), startMs: segment.startMs, endMs: segment.endMs, text: boundedText(segment.text, EVIDENCE_LIMITS.SEGMENT_TEXT_BYTES) };
  });
  assert(segments.reduce((sum, segment) => sum + byteLength(segment.text), 0) <= 2 * 1024 * 1024);
  const aliases = input.channelAliases ?? [];
  assert(Array.isArray(aliases) && aliases.length <= 20 && aliases.every(alias => CHANNEL_ID_PATTERN.test(alias)));
  return { videoId: input.videoId, navigationId: input.navigationId, captureEpoch: input.captureEpoch,
    channelId: input.channelId ?? null, channelName: boundedText(input.channelName ?? '', EVIDENCE_LIMITS.TITLE_BYTES), channelAliases: [...new Set(aliases)],
    identityProvenance: boundedText(input.identityProvenance ?? input.provenance ?? '', EVIDENCE_LIMITS.TITLE_BYTES),
    title: boundedText(input.title ?? '', EVIDENCE_LIMITS.TITLE_BYTES), description: boundedText(input.description ?? '', EVIDENCE_LIMITS.DESCRIPTION_BYTES), durationSeconds: input.durationSeconds ?? null,
    transcript: { status: transcript.status, language: boundedText(transcript.language ?? '', 128), source: boundedText(transcript.source ?? '', 128), segments },
    capturedAt: Number.isFinite(input.capturedAt) ? input.capturedAt : Date.now(),
  };
}
export function validateCheckpoint(value) {
  assert(value && VIDEO_ID_PATTERN.test(value.videoId) && typeof value.sessionId === 'string' && typeof value.captureEpoch === 'string');
  assert(Number.isInteger(value.sequence) && value.sequence > 0);
  for (const key of ['startedAt','endedAt','activeMs']) assert(Number.isSafeInteger(value[key]) && value[key] >= 0);
  assert(value.endedAt > value.startedAt && value.endedAt - value.startedAt <= 10000 && value.activeMs <= value.endedAt - value.startedAt);
  assert(Array.isArray(value.activeIntervals) && value.activeIntervals.length <= 100);
  let last = value.startedAt, sum = 0;
  for (const segment of value.activeIntervals) {
    for (const key of ['wallStartMs','wallEndMs','mediaStartMs','mediaEndMs']) assert(Number.isSafeInteger(segment[key]) && segment[key] >= 0);
    assert(segment.wallStartMs >= last && segment.wallEndMs > segment.wallStartMs && segment.wallEndMs <= value.endedAt && segment.mediaEndMs >= segment.mediaStartMs);
    assert(segment.mediaEndMs - segment.mediaStartMs <= (segment.wallEndMs - segment.wallStartMs) * 16);
    last = segment.wallEndMs; sum += segment.wallEndMs - segment.wallStartMs;
  }
  assert(sum === value.activeMs);
  return value;
}
export function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
  return { code, message: code.replaceAll('_', ' ').toLowerCase() };
}
