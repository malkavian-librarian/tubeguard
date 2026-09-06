import {beforeEach,expect,test,vi} from 'vitest';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {installChromeMock} from './helpers/chrome.js';

let api,runDueAnalysis;
const sender={tabId:1,documentId:'doc'};

beforeEach(async()=>{
  vi.resetModules();globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  installChromeMock();chrome.storage.local.setAccessLevel=async()=>{};
  api=(await import('../shared/storage.js')).analysisStore;
  runDueAnalysis=(await import('../background/analysis-runner.js')).runDueAnalysis;
});

async function seed(){
  await api.saveConfig({enabled:true,priorities:'Learn AI',apiKey:'dummy'});
  const cap=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'nav'});
  await api.upsertEvidence({...cap,videoId:'abcdefghijk',navigationId:'nav',channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',channelAliases:['@owner'],title:'Entertainment',description:'Comedy',durationSeconds:4000,transcript:{status:'complete',segments:[{startMs:0,endMs:4000,text:'Comedy and jokes'}]}},sender);
  const start=Date.now()-1810000;
  for(let i=0;i<181;i++)await api.acceptCheckpoint({...cap,sequence:i+1,videoId:'abcdefghijk',navigationId:'nav',startedAt:start+i*10000,endedAt:start+(i+1)*10000,activeMs:10000,activeIntervals:[{wallStartMs:start+i*10000,wallEndMs:start+(i+1)*10000,mediaStartMs:i*10000,mediaEndMs:(i+1)*10000}],mediaIntervals:[]},sender);
}
const okVerdict=({part})=>({verdict:{videoId:part.videoId,evidenceVersion:part.evidenceVersion,part:part.part,verdict:'irrelevant',reason:'Outside learning goals',evidenceRefs:[part.refs[0]]}});

test('changing priorities mid-run cancels the orphaned run instead of leaving it stuck, and allows same-day resumption',async()=>{
  await seed();
  const classify=async(args)=>{
    await api.saveConfig({priorities:'Learn something else'});
    return okVerdict(args);
  };
  const first=await runDueAnalysis({trigger:'manual',classify});
  expect(first).toBeTruthy();
  expect(first.status).toBe('cancelled');

  const runRow=await api.getRun({runId:first.runId});
  expect(runRow.status).toBe('cancelled');

  const config=await api.getConfig();
  expect(config.nextDueAt).toBeLessThanOrEqual(Date.now()+1000);

  const second=await runDueAnalysis({classify:async()=>({verdict:{videoId:'abcdefghijk',evidenceVersion:'x',part:0,verdict:'uncertain',reason:'n/a',evidenceRefs:[]}})});
  expect(second).not.toBeNull();
  expect(second.runId).not.toBe(first.runId);
},20000);

test('a classify call slower than the lease window is renewed so a second worker cannot double-claim the run',async()=>{
  await seed();
  let sawLocked='unset';
  const classify=async(args)=>{
    await new Promise(r=>setTimeout(r,260));
    sawLocked=await api.claimRun({now:Date.now(),owner:'intruder',leaseMs:200});
    return okVerdict(args);
  };
  const result=await runDueAnalysis({trigger:'manual',classify,leaseMs:200});
  expect(result).toBeTruthy();
  expect(sawLocked).toBeNull();
},20000);

test('a suspended run (bad OpenRouter key) fires a user-visible notification',async()=>{
  await seed();
  const classify=async()=>{throw Object.assign(new Error('bad key'),{code:'PROVIDER_AUTH_ERROR'});};
  const result=await runDueAnalysis({trigger:'manual',classify});
  expect(result.status).toBe('suspended');
  expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
},20000);

test('suspended runs notify at most once per day and analysis is retryable the next day',async()=>{
  await seed();
  const classify=async()=>{throw Object.assign(new Error('bad key'),{code:'PROVIDER_AUTH_ERROR'});};
  const base=Date.now();

  const first=await runDueAnalysis({trigger:'manual',now:base,classify});
  expect(first.status).toBe('suspended');
  expect(chrome.notifications.create).toHaveBeenCalledTimes(1);

  const sameDay=await runDueAnalysis({now:base+1000,classify});
  expect(sameDay).toBeNull();
  expect(chrome.notifications.create).toHaveBeenCalledTimes(1);

  const nextDay=await runDueAnalysis({now:base+86400000+1000,classify});
  expect(nextDay).toBeTruthy();
  expect(nextDay.status).toBe('suspended');
  expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
},20000);
