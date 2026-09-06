import {beforeEach,expect,test,vi} from 'vitest';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {installChromeMock} from './helpers/chrome.js';

let api,drainBlockOutbox;
const sender={tabId:1,documentId:'doc'};
const channelId='UCaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(async()=>{
  vi.resetModules();globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  installChromeMock();chrome.storage.local.setAccessLevel=async()=>{};
  api=(await import('../shared/storage.js')).analysisStore;
  drainBlockOutbox=(await import('../background/block-service.js')).drainBlockOutbox;
});

async function seedDecision(){
  await api.saveConfig({enabled:true,priorities:'Learn AI',apiKey:'dummy',now:0});
  const cap=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'nav'});
  await api.upsertEvidence({...cap,videoId:'abcdefghijk',navigationId:'nav',channelId,channelAliases:['@owner'],title:'Entertainment',description:'Comedy',durationSeconds:4000,transcript:{status:'complete',segments:[{startMs:0,endMs:4000,text:'Comedy'}]}},sender);
  const start=1000;
  for(let i=0;i<181;i++)await api.acceptCheckpoint({...cap,sequence:i+1,videoId:'abcdefghijk',navigationId:'nav',startedAt:start+i*10000,endedAt:start+(i+1)*10000,activeMs:10000,activeIntervals:[{wallStartMs:start+i*10000,wallEndMs:start+(i+1)*10000,mediaStartMs:i*10000,mediaEndMs:(i+1)*10000}],mediaIntervals:[]},sender);
  const run=await api.claimRun({now:86400000,owner:'test',force:true});
  const batch=await api.selectRunBatch({...run,maxVideos:10});
  await api.commitVideoResult({...run,batchId:batch.batchId,videoId:'abcdefghijk',result:{verdict:'irrelevant',reason:'Outside priorities',evidenceRefs:[]},chunkIds:batch.chunks.map(c=>c.id)});
  const decision=await api.planBlock({...run,channelId});
  return {run,decision};
}

test('a persistently failing sync write eventually clears automatic ownership so the channel is re-plannable',async()=>{
  const {run,decision}=await seedDecision();
  expect(decision).toBeTruthy();
  chrome.storage.sync.set=vi.fn(()=>Promise.reject(Object.assign(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'),{name:'QuotaExceededError'})));

  let now=100;
  for(let i=0;i<8;i++){
    await drainBlockOutbox({now});
    now+=7*60*60*1000;
  }

  const ownership=await api.getOwnership({channelId});
  expect(ownership.manual).toBeFalsy();
  expect(ownership.automatic).toEqual([]);

  const outbox=await api.listOutbox();
  expect(outbox.find(x=>x.id===decision.id)).toBeUndefined();

  const replanned=await api.planBlock({...run,channelId});
  expect(replanned).toBeTruthy();
  expect(replanned.id).not.toBe(decision.id);
});

test('backoff delays retries — a failing entry is not retried again before its retryAt',async()=>{
  const {decision}=await seedDecision();
  chrome.storage.sync.set=vi.fn(()=>Promise.reject(new Error('boom')));

  await drainBlockOutbox({now:0});
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);

  await drainBlockOutbox({now:1000});
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);

  const row=(await api.listOutbox()).find(x=>x.id===decision.id);
  await drainBlockOutbox({now:row.retryAt+1});
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(2);
});

test('failure/backoff bookkeeping survives a simulated service worker restart',async()=>{
  const {decision}=await seedDecision();
  chrome.storage.sync.set=vi.fn(()=>Promise.reject(new Error('boom')));
  await drainBlockOutbox({now:0});
  let row=(await api.listOutbox()).find(x=>x.id===decision.id);
  expect(row.failureCount).toBe(1);

  vi.resetModules();
  const storageMod=await import('../shared/storage.js');
  const blockMod=await import('../background/block-service.js');
  api=storageMod.analysisStore;drainBlockOutbox=blockMod.drainBlockOutbox;
  chrome.storage.sync.set=vi.fn(()=>Promise.reject(new Error('boom')));

  let now=row.retryAt+1;
  for(let i=0;i<8;i++){
    await drainBlockOutbox({now});
    const current=(await api.listOutbox()).find(x=>x.id===decision.id);
    if(!current)break;
    now=current.retryAt+1;
  }

  const ownership=await api.getOwnership({channelId});
  expect(ownership.automatic).toEqual([]);
  expect((await api.listOutbox()).find(x=>x.id===decision.id)).toBeUndefined();
});
