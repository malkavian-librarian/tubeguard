export const ANALYSIS_DAY_MS = 86_400_000;
export const ANALYSIS_ADMISSION_BYTES = 245 * 1024 * 1024;
export const ANALYSIS_MAX_BYTES = 250 * 1024 * 1024;
export const ANALYSIS_THRESHOLD_MS = 1_800_000;
export const ANALYSIS_LEASE_MS = 120_000;
export const ANALYSIS_MIN_DURATION_SECONDS = 300;
export const MAX_TRANSCRIPT_SEGMENTS = 20_000;
export const ANALYSIS_RETRY_BACKOFF_MS = 30_000;
export const ANALYSIS_RETRY_ESCALATION_MS = [60_000, 300_000, 1_800_000];
export const EVIDENCE_LIMITS = Object.freeze({
  TITLE_BYTES: 2048, DESCRIPTION_BYTES: 32_768, SEGMENT_TEXT_BYTES: 8192,
});
export const PRIORITIES_MAX_BYTES = 8 * 1024;
export const OUTBOX_MAX_FAILURES = 5;
export const OUTBOX_RETRY_BASE_MS = 30_000;
export const OUTBOX_RETRY_CAP_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_AI_CONFIG = Object.freeze({
  enabled: false, modelId: 'z-ai/glm-4.7', priorities: '', policyRevision: 0,
  configGeneration: 0, maxRequestsPer24h: 50, maxInputBytesPer24h: 1_048_576,
  keySlotId: null, nextDueAt: null, epochStartedAt: null, storageBytes: 0, storagePressure: false,
});
/** @typedef {{tabId:number, documentId:string}} SenderIdentity */
/** @typedef {{sessionId:string,captureEpoch:string,policyRevision:number,generation:string}} Capture */
/** @typedef {{runId:string,leaseToken:string,configGeneration:number,policyRevision:number,cutoff:number,cursor:number}} RunLease */
/** @typedef {{videoId:string,evidenceVersion:string,transcript:{status:string,segments:Array}}} VideoEvidence */
/** @typedef {{requestId:string,ok:boolean,data?:unknown,error?:{code:string,message:string}}} AnalysisResponse */
export function publicConfig(config) {
  return Object.fromEntries(['modelId','priorities','policyRevision','configGeneration','maxRequestsPer24h','maxInputBytesPer24h']
    .map(key => [key, config[key]]).concat([['promptVersion', 1], ['schemaVersion', 1]]));
}
