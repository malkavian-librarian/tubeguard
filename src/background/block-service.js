import {analysisStore,blocklistMeta} from '../shared/storage.js';
import {serializeMutation} from './mutation-queue.js';
import {safeError} from '../shared/analysis-validation.js';

let expectedSync=null;
async function writeIds(ids){expectedSync=new Set(ids);try{await chrome.storage.sync.set({blockedChannels:ids});}catch(e){expectedSync=null;throw e;}}
export async function drainBlockOutbox(){
  return serializeMutation(async()=>{
    for(const intent of await analysisStore.listOutbox()){
      const config=await analysisStore.getConfig(),owner=await analysisStore.getOwnership({channelId:intent.channelId});
      if(!config.enabled||config.generation!==intent.generation||config.configGeneration!==intent.configGeneration||owner?.generation!==intent.ownershipGeneration){await analysisStore.cancelOutbox({decisionId:intent.id,reason:'The analysis configuration or channel ownership changed before the block was applied.'});continue;}
      try{
        const {blockedChannels=[]}=await chrome.storage.sync.get({blockedChannels:[]}),ids=new Set(blockedChannels);
        const insertedIds=intent.insertedIds??intent.ids.filter(id=>!ids.has(id));
        if(!intent.insertedIds)await analysisStore.stageOutbox({decisionId:intent.id,generation:intent.generation,insertedIds,preexistingIds:intent.ids.filter(id=>ids.has(id))});
        for(const id of intent.ids)ids.add(id);
        await writeIds([...ids]);
        await analysisStore.markOutbox({decisionId:intent.id,generation:intent.generation,status:'applied',insertedIds});
      }catch(e){await analysisStore.markOutbox({decisionId:intent.id,generation:intent.generation,status:'failed',error:safeError(e)}).catch(()=>{});}
    }
  });
}
export async function applyManualBlock({channelId,channelName,action}){
  return serializeMutation(async()=>{
    const existing=await analysisStore.getOwnership({channelId}),aliases=existing?.aliases??[];
    const {blockedChannels=[]}=await chrome.storage.sync.get({blockedChannels:[]}),ids=new Set(blockedChannels);
    if(action==='block')ids.add(channelId);
    else for(const id of [existing?.id??channelId,...aliases])ids.delete(id);
    await writeIds([...ids]);
    const owner=await analysisStore.setManualOwnership({channelId,aliases,blocked:action==='block'});
    if(action==='block')await blocklistMeta.put({id:owner.id,type:'channel',name:channelName||owner.id,blockedAt:Date.now(),source:'manual'});
    else {await blocklistMeta.delete(owner.id);for(const alias of owner.aliases)await blocklistMeta.delete(alias);}
    return {ok:true};
  });
}
export function reconcileExternalBlocks(changes,area){
  if(area!=='sync'||!changes.blockedChannels)return;
  const next=new Set(changes.blockedChannels.newValue??[]);
  if(expectedSync&&expectedSync.size===next.size&&[...next].every(x=>expectedSync.has(x))){expectedSync=null;return;}
  const removed=(changes.blockedChannels.oldValue??[]).filter(id=>!next.has(id));
  if(removed.length)void serializeMutation(async()=>{for(const channelId of removed)await analysisStore.resetChannel({channelId,at:Date.now()});}).catch(()=>{});
}
