import {beforeEach,expect,test,vi} from 'vitest';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {installChromeMock} from './helpers/chrome.js';
let api,runDueAnalysis;
beforeEach(async()=>{
  vi.resetModules();globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  installChromeMock();chrome.storage.local.setAccessLevel=async()=>{};
  api=(await import('../shared/storage.js')).analysisStore;
  runDueAnalysis=(await import('../background/analysis-runner.js')).runDueAnalysis;
});
async function seed(){
  await api.saveConfig({enabled:true,priorities:'Learn AI',apiKey:'dummy'});
  const sender={tabId:1,documentId:'doc'},cap=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'nav'});
  await api.upsertEvidence({...cap,videoId:'abcdefghijk',navigationId:'nav',channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',channelAliases:['@owner'],title:'Entertainment',description:'Comedy',durationSeconds:4000,transcript:{status:'complete',segments:[{startMs:0,endMs:4000000,text:'Comedy and jokes'}]}},sender);
  const start=Date.now()-1810000;
  for(let i=0;i<181;i++)await api.acceptCheckpoint({...cap,sequence:i+1,videoId:'abcdefghijk',navigationId:'nav',startedAt:start+i*10000,endedAt:start+(i+1)*10000,activeMs:10000,activeIntervals:[{wallStartMs:start+i*10000,wallEndMs:start+(i+1)*10000,mediaStartMs:i*10000,mediaEndMs:(i+1)*10000}],mediaIntervals:[]},sender);
}
const classify=async({part})=>({verdict:{videoId:part.videoId,evidenceVersion:part.evidenceVersion,part:part.part,verdict:'irrelevant',reason:'Outside learning goals',evidenceRefs:[part.refs[0]]}});
test('daily job blocks strictly over threshold and replay never duplicates coverage',async()=>{
  await seed();
  await runDueAnalysis({trigger:'manual',classify});
  expect((await chrome.storage.sync.get('blockedChannels')).blockedChannels).toContain('@owner');
  const actions=await api.listDecisions({limit:100});expect(actions.items).toHaveLength(1);expect(actions.items[0].status).toBe('applied');
  await runDueAnalysis({trigger:'manual',classify});
  expect((await api.listDecisions({limit:100})).items).toHaveLength(1);
  expect(chrome.notifications.create).not.toHaveBeenCalled();
},20000);
test('disable during provider response prevents its result from committing',async()=>{
  await seed();
  await runDueAnalysis({trigger:'manual',classify:async args=>{await api.saveConfig({enabled:false});return classify(args);}});
  expect((await api.listDecisions({limit:100})).items).toHaveLength(0);
  expect((await chrome.storage.sync.get('blockedChannels')).blockedChannels).toBeUndefined();
},20000);
