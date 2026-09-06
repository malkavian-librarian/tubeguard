import {assert} from '../shared/analysis-validation.js';
import {ANALYSIS_THRESHOLD_MS} from '../shared/analysis-contracts.js';
export function decideChannel({eligible,alreadyBlocked,irrelevantMs}) {
  return {action:eligible&&!alreadyBlocked&&Number.isFinite(irrelevantMs)&&irrelevantMs>ANALYSIS_THRESHOLD_MS?'block':'none'};
}
export function validateVerdict({part,response}) {
  assert(response&&typeof response==='object'&&!Array.isArray(response),'INVALID_RESPONSE');
  const keys=['videoId','evidenceVersion','part','verdict','reason','evidenceRefs'];
  assert(Object.keys(response).length===keys.length&&keys.every(k=>Object.hasOwn(response,k)),'INVALID_RESPONSE');
  assert(response.videoId===part.videoId&&response.evidenceVersion===part.evidenceVersion&&response.part===part.part,'INVALID_RESPONSE');
  assert(['relevant','irrelevant','uncertain'].includes(response.verdict),'INVALID_RESPONSE');
  assert(typeof response.reason==='string'&&response.reason.length>0&&response.reason.length<=1000,'INVALID_RESPONSE');
  assert(Array.isArray(response.evidenceRefs)&&response.evidenceRefs.length<=100&&response.evidenceRefs.every(x=>part.refs.includes(x)),'INVALID_RESPONSE');
  assert(response.verdict==='uncertain'||response.evidenceRefs.length>0,'INVALID_RESPONSE');
  return response;
}
export function aggregateVerdicts(results,expected) {
  const verdict=results.some(r=>r.verdict==='relevant')?'relevant':results.length!==expected||!expected||results.some(r=>r.verdict!=='irrelevant')?'uncertain':'irrelevant';
  return {verdict,reason:results.map(r=>r.reason).filter(Boolean).join('\n').slice(0,4000)||'Insufficient complete evidence.',evidenceRefs:[...new Set(results.flatMap(r=>r.evidenceRefs??[]))]};
}
