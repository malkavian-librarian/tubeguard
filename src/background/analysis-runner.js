import {analysisStore} from '../shared/storage.js';
import {buildAnalysisParts,requestBody} from './analysis-input.js';
import {aggregateVerdicts} from './analysis-policy.js';
import {classifyPart} from './openrouter-client.js';
import {drainBlockOutbox} from './block-service.js';
import {ensureAnalysisAlarm} from './analysis-scheduler.js';
import {notifyAnalysisSuspended} from './notification.js';
import {byteLength,safeError} from '../shared/analysis-validation.js';
import {ANALYSIS_LEASE_MS} from '../shared/analysis-contracts.js';
let active=null;
export function cancelAnalysis(){active?.abort();}
export async function runDueAnalysis({now=Date.now(),trigger='alarm',classify=classifyPart,leaseMs=ANALYSIS_LEASE_MS}={}){
  if(active)return null;
  const run=await analysisStore.claimRun({now,owner:crypto.randomUUID(),leaseMs,force:trigger==='manual'});
  if(!run)return null;
  const controller=new AbortController();active=controller;
  let status='completed',retryAt=null;
  // a single classify() call can outlive the lease (large prompt, slow provider); renew it
  // periodically so a second worker/alarm firing cannot reclaim and double-process this run.
  const renewTimer=setInterval(()=>{analysisStore.renewRunLease({...run,now:Date.now(),leaseMs}).catch(()=>{});},Math.max(50,Math.floor(leaseMs/3)));
  try{
    await ensureAnalysisAlarm({wakeAt:now+leaseMs});
    const batch=await analysisStore.selectRunBatch({...run,maxVideos:10});
    let calls=0;
    for(const video of batch.videos){
      const chunks=batch.chunks.filter(c=>c.videoId===video.videoId);
      const parts=buildAnalysisParts({video,chunks,priorities:run.config.priorities});
      await analysisStore.savePreparedParts({...run,batchId:batch.batchId,parts});
      let persisted=(await analysisStore.getPreparedParts(run)).filter(p=>p.videoId===video.videoId);
      for(const part of persisted){
        if(part.result)continue;
        if(calls>=1){status='waiting_retry';retryAt=Date.now()+30000;break;}
        if((part.attempts?.length??0)>=4){part.result={verdict:'uncertain',reason:'Retry limit reached',evidenceRefs:[]};continue;}
        const config=await analysisStore.getConfig();
        if(!config.enabled||config.configGeneration!==run.configGeneration)throw Object.assign(Error(),{code:'STALE_GENERATION'});
        const {attemptId}=await analysisStore.beginAttempt({...run,partId:part.id,now:Date.now(),inputBytes:byteLength(requestBody(part,run.config))});
        calls++;
        try{
          const result=await classify({part,config:{...run.config,apiKey:await analysisStore.getApiKey()},signal:controller.signal});
          await analysisStore.finishAttempt({...run,attemptId,outcome:{status:'success',result:result.verdict,usage:result.usage,providerRequestId:result.providerRequestId}});
          part.result=result.verdict;
        }catch(e){
          if(['STALE_GENERATION','LEASE_LOST'].includes(e.code))throw e;
          const retryable=['NETWORK_ERROR','REQUEST_TIMEOUT','RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(e.code);
          await analysisStore.finishAttempt({...run,attemptId,outcome:{status:retryable?'retryable':'terminal',error:safeError(e)}});
          if(e.code==='PROVIDER_AUTH_ERROR'){status='suspended';break;}
          if(retryable){status='waiting_retry';retryAt=Date.now()+Math.max([60000,300000,1800000][Math.min(part.attempts?.length??0,2)],e.retryAfterMs||0);break;}
          part.result={verdict:'uncertain',reason:safeError(e).message,evidenceRefs:[]};
        }
      }
      if(status!=='completed')break;
      const result=aggregateVerdicts(persisted.map(p=>p.result).filter(Boolean),parts.length);
      await analysisStore.commitVideoResult({...run,batchId:batch.batchId,videoId:video.videoId,result,chunkIds:chunks.map(c=>c.id)});
      if(result.verdict==='irrelevant')await analysisStore.planBlock({...run,channelId:video.channelId});
      await drainBlockOutbox();
    }
    if(status==='completed'&&batch.videos.length){
      await analysisStore.advanceBatch(run);
      const next=await analysisStore.selectRunBatch({...run,maxVideos:10});
      if(next.videos.length){status='waiting_retry';retryAt=Date.now()+30000;}
    }
    await analysisStore.finishRun({...run,status,retryAt});
    if(status==='suspended')await notifyAnalysisSuspended({now}).catch(()=>{});
  }catch(e){
    if(['STALE_GENERATION','LEASE_LOST'].includes(e.code)){
      // checkRun would reject a normal finishRun here (that mismatch is exactly what's being
      // caught) — cancelRun closes the row out administratively so it doesn't stay 'running'
      // forever and block same-day resumption (saveConfig resets nextDueAt for this case).
      status='cancelled';
      await analysisStore.cancelRun({runId:run.runId}).catch(()=>{});
    }else{
      status=e.code==='BUDGET_EXHAUSTED'?'waiting_retry':'completed_with_errors';
      if(status==='waiting_retry'){const c=await analysisStore.getConfig();const origin=c.budgetOrigin??now;retryAt=origin+(Math.floor((Date.now()-origin)/86400000)+1)*86400000;}
      await analysisStore.finishRun({...run,status,retryAt}).catch(()=>{});
    }
  }finally{clearInterval(renewTimer);active=null;await ensureAnalysisAlarm().catch(()=>{});}
  return {runId:run.runId,status};
}
