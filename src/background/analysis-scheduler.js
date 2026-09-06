import {analysisStore} from '../shared/storage.js';
import {ANALYSIS_DAY_MS} from '../shared/analysis-contracts.js';
export const ANALYSIS_ALARM='daily-learning-analysis';
export async function ensureAnalysisAlarm({now=Date.now(),wakeAt}={}){
  const c=await analysisStore.getConfig();
  if(!c.enabled){await chrome.alarms.clear(ANALYSIS_ALARM);return;}
  const pending=await analysisStore.getPendingWakeAt();
  const when=Math.max(now+1000,Math.min(wakeAt??Infinity,c.nextDueAt??now+ANALYSIS_DAY_MS,pending??Infinity));
  await chrome.alarms.create(ANALYSIS_ALARM,{when});
}
