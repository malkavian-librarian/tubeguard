import {beforeEach,expect,test,vi} from 'vitest';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {installChromeMock} from './helpers/chrome.js';

let api;
const sender={tabId:1,documentId:'doc'};
const channelId='UCaaaaaaaaaaaaaaaaaaaaaa';
const DAY_MS=86_400_000;

beforeEach(async()=>{
  vi.resetModules();globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  installChromeMock();chrome.storage.local.setAccessLevel=async()=>{};
  api=(await import('../shared/storage.js')).analysisStore;
});

async function seedCompletedRun({priorities,now}){
  await api.saveConfig({enabled:true,priorities,apiKey:'dummy',now});
  const cap=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'nav'});
  await api.upsertEvidence({...cap,videoId:'abcdefghijk',navigationId:'nav',channelId,channelAliases:[],title:'Entertainment',description:'Comedy',durationSeconds:4000,transcript:{status:'complete',segments:[{startMs:0,endMs:4000,text:'Comedy'}]}},sender);
  for(let i=0;i<181;i++){
    await api.acceptCheckpoint({...cap,sequence:i+1,videoId:'abcdefghijk',navigationId:'nav',startedAt:now+i*10000,endedAt:now+(i+1)*10000,activeMs:10000,activeIntervals:[{wallStartMs:now+i*10000,wallEndMs:now+(i+1)*10000,mediaStartMs:i*10000,mediaEndMs:(i+1)*10000}],mediaIntervals:[]},sender);
  }
  const run=await api.claimRun({now:now+DAY_MS,owner:'test',force:true});
  const batch=await api.selectRunBatch({...run,maxVideos:10});
  await api.commitVideoResult({...run,batchId:batch.batchId,videoId:'abcdefghijk',result:{verdict:'irrelevant',reason:'Outside priorities',evidenceRefs:[]},chunkIds:batch.chunks.map(c=>c.id)});
  await api.finishRun({...run,status:'completed',nextDueAt:now+2*DAY_MS});
  return run;
}

test('old finalized run/coverage/classification rows from a superseded policy revision are pruned after retention',async()=>{
  const oldNow=1000;
  const run=await seedCompletedRun({priorities:'Learn old things',now:oldNow});
  const historicalAccountingBefore=await api.getChannelAccounting({policyRevision:run.policyRevision,channelId});
  expect(historicalAccountingBefore.irrelevantMs).toBeGreaterThan(0);

  const laterNow=oldNow+2*DAY_MS;
  await api.saveConfig({priorities:'Learn new things',now:laterNow});

  // commitVideoResult/beginAttempt stamp createdAt with the real wall clock (not the test's
  // simulated `now`), so the prune cutoff must be computed against real time here too.
  const farFuture=Date.now()+32*DAY_MS;
  const result=await api.pruneAging({now:farFuture});
  expect(result.prunedCount).toBeGreaterThan(0);

  const runLog=await api.listAnalysisLog({kind:'run',limit:100});
  expect(runLog.items.find(r=>r.id===run.runId)).toBeUndefined();

  const classificationLog=await api.listAnalysisLog({kind:'classification',limit:100});
  expect(classificationLog.items.some(c=>c.runId===run.runId)).toBe(false);

  const historicalAccountingAfter=await api.getChannelAccounting({policyRevision:run.policyRevision,channelId});
  expect(historicalAccountingAfter.irrelevantMs).toBe(0);
});

test('pruning never touches coverage/classification/chunk rows tagged with the currently active policy revision, even when old',async()=>{
  const oldNow=1000;
  const run=await seedCompletedRun({priorities:'Learn AI',now:oldNow});
  const currentRevision=(await api.getConfig()).policyRevision;
  expect(run.policyRevision).toBe(currentRevision);

  const farFuture=oldNow+31*DAY_MS;
  await api.pruneAging({now:farFuture});

  const accounting=await api.getChannelAccounting({policyRevision:currentRevision,channelId});
  expect(accounting.irrelevantMs).toBeGreaterThan(0);

  const chunkPage=await api.exportPage({store:'watch-chunks',limit:100});
  expect(chunkPage.items.length).toBeGreaterThan(0);
});

test('pruning never deletes the still-active run for the current config generation',async()=>{
  await api.saveConfig({enabled:true,priorities:'Learn AI',apiKey:'dummy',now:0});
  const run=await api.claimRun({now:DAY_MS,owner:'test',force:true});
  expect(run).toBeTruthy();

  await api.pruneAging({now:DAY_MS+31*DAY_MS});

  expect(await api.getRun({runId:run.runId})).toBeTruthy();
});

test('pruning is a no-op well before the retention window has elapsed',async()=>{
  const oldNow=1000;
  const run=await seedCompletedRun({priorities:'Learn old things',now:oldNow});
  await api.saveConfig({priorities:'Learn new things',now:oldNow+2*DAY_MS});

  const soon=oldNow+5*DAY_MS;
  const result=await api.pruneAging({now:soon});
  expect(result.prunedCount).toBe(0);
  expect(await api.getRun({runId:run.runId})).toBeTruthy();
});
