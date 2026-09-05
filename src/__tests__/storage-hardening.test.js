import {beforeEach,expect,test,vi} from 'vitest';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {installChromeMock} from './helpers/chrome.js';

let api;
const sender={tabId:1,documentId:'doc'};
const channelA='UCaaaaaaaaaaaaaaaaaaaaaa';
const channelB='UCbbbbbbbbbbbbbbbbbbbbbb';

beforeEach(async()=>{
  vi.resetModules();globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  installChromeMock();chrome.storage.local.setAccessLevel=async()=>{};
  api=(await import('../shared/storage.js')).analysisStore;
  await api.saveConfig({enabled:true,priorities:'Learn AI',apiKey:'dummy',now:0});
});

const checkpoint=(capture,sequence,start=1000,navigationId='nav')=>({...capture,sequence,videoId:'abcdefghijk',navigationId,startedAt:start,endedAt:start+5000,activeMs:5000,activeIntervals:[{wallStartMs:start,wallEndMs:start+5000,mediaStartMs:0,mediaEndMs:5000}],mediaIntervals:[]});
const evidence=(capture,channelId=channelA,title='Title',navigationId='nav')=>({...capture,videoId:'abcdefghijk',navigationId,channelId,channelAliases:[],title,description:'Description',durationSeconds:600,transcript:{status:'complete',segments:[{startMs:0,endMs:5000,text:'Evidence'}]}});

test('disable and re-enable fences captures issued before disable',async()=>{
  const capture=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'nav'});
  await api.saveConfig({enabled:false,now:10});
  await api.saveConfig({enabled:true,now:20});
  await expect(api.acceptCheckpoint(checkpoint(capture,1),sender)).rejects.toMatchObject({code:'STALE_GENERATION'});
});

test('checkpoint snapshots are pinned once and cannot be reattributed by a later visit',async()=>{
  const first=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'first'});
  await api.acceptCheckpoint(checkpoint(first,1,1000,'first'),sender);
  const a=await api.upsertEvidence(evidence(first,channelA,'A','first'),sender);
  const second=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'second'});
  await api.acceptCheckpoint(checkpoint(second,1,7000,'second'),sender);
  const b=await api.upsertEvidence(evidence(second,channelB,'B','second'),sender);
  const chunks=(await api.exportPage({store:'watch-chunks',limit:100})).items;
  expect(chunks.find(x=>x.sessionId===first.sessionId)).toMatchObject({channelId:channelA,evidenceVersion:a.evidenceVersion});
  expect(chunks.find(x=>x.sessionId===second.sessionId)).toMatchObject({channelId:channelB,evidenceVersion:b.evidenceVersion});
});

test('analysis batches keep conflicting evidence snapshots separate',async()=>{
  const first=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'first'});
  const a=await api.upsertEvidence(evidence(first,channelA,'A','first'),sender);
  await api.acceptCheckpoint(checkpoint(first,1,1000,'first'),sender);
  const second=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'second'});
  const b=await api.upsertEvidence(evidence(second,channelB,'B','second'),sender);
  await api.acceptCheckpoint(checkpoint(second,1,7000,'second'),sender);
  const run=await api.claimRun({now:86400000,owner:'test',force:true});
  const firstBatch=await api.selectRunBatch(run);
  expect(new Set(firstBatch.chunks.map(x=>x.evidenceVersion))).toEqual(new Set([firstBatch.videos[0].evidenceVersion]));
  expect(firstBatch.videos).toHaveLength(1);
  await api.advanceBatch(run);
  const secondBatch=await api.selectRunBatch(run);
  expect(new Set([firstBatch.videos[0].evidenceVersion,secondBatch.videos[0].evidenceVersion])).toEqual(new Set([a.evidenceVersion,b.evidenceVersion]));
  expect(secondBatch.chunks[0].channelId).toBe(secondBatch.videos[0].channelId);
});

test('history contains only eligible videos with positive viewing and derives legacy metadata from chunks',async()=>{
  const unwatched=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'unwatched'});
  await api.upsertEvidence(evidence(unwatched,channelA,'Title','unwatched'),sender);
  expect((await api.listHistory({limit:100})).items).toEqual([]);
  await api.acceptCheckpoint(checkpoint(unwatched,1,2000,'unwatched'),sender);
  const [row]=(await api.listHistory({limit:100})).items;
  expect(row).toMatchObject({watchMs:5000,firstWatchedAt:2000,lastWatchedAt:7000,durationSeconds:600});
});
