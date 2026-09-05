import { MessageType, CHANNEL_ID_PATTERN } from '../shared/constants.js';
import { settings, blocklistMeta, sessions, analysisStore } from '../shared/storage.js';
import { onMessage } from '../shared/message-bus.js';
import { registerAlarms, handleAlarm } from './alarm-manager.js';
import { toDateString, dateRangeStart } from '../shared/utils.js';
import { authorizeMessage, validateLegacySetting } from './message-authorization.js';
import { safeError, assert } from '../shared/analysis-validation.js';
import { runDueAnalysis, cancelAnalysis } from './analysis-runner.js';
import { ensureAnalysisAlarm, ANALYSIS_ALARM } from './analysis-scheduler.js';
import { applyManualBlock, drainBlockOutbox, reconcileExternalBlocks } from './block-service.js';
import { serializeMutation } from './mutation-queue.js';
import { verifyModel } from './openrouter-client.js';

async function initialize(){
  await analysisStore.reconcileConfig();
  registerAlarms();
  await drainBlockOutbox();
  await ensureAnalysisAlarm();
}
chrome.runtime.onInstalled.addListener(()=>void initialize().catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>void initialize().catch(()=>{}));
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name===ANALYSIS_ALARM)void runDueAnalysis().catch(()=>{});
  else void handleAlarm(alarm).catch(()=>{});
});
chrome.storage.onChanged.addListener(reconcileExternalBlocks);

async function broadcastCapture(){
  const tabs=await chrome.tabs.query({url:'https://www.youtube.com/*'});
  await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:MessageType.CAPTURE_POLICY_CHANGED})));
}
const aiTypes=new Set(['BEGIN_CAPTURE','UPSERT_VIDEO_EVIDENCE','RECORD_WATCH_CHECKPOINT','GET_AI_SETTINGS','SAVE_AI_SETTINGS','GET_HISTORY','GET_ANALYSIS_LOG','RUN_ANALYSIS_NOW','EXPORT_AI_DATA','DELETE_AI_DATA']);
onMessage(async(msg,sender)=>{
  try{
    authorizeMessage(msg,sender,chrome.runtime.id);
    const payload=msg.payload??{};
    const identity={tabId:sender.tab?.id,documentId:sender.documentId||String(sender.tab?.id)};
    let data;
    switch(msg.type){
      case MessageType.BEGIN_CAPTURE:data=await analysisStore.beginCapture({...payload,senderIdentity:identity});break;
      case MessageType.UPSERT_VIDEO_EVIDENCE:data=await analysisStore.upsertEvidence(payload,identity);break;
      case MessageType.RECORD_WATCH_CHECKPOINT:data=await analysisStore.acceptCheckpoint(payload,identity);break;
      case MessageType.GET_AI_SETTINGS:data=await analysisStore.getConfig();break;
      case MessageType.SAVE_AI_SETTINGS:
        assert(!Object.hasOwn(payload,'now'),'INVALID_INPUT');
        if(payload.enabled)await verifyModel(payload.modelId||(await analysisStore.getConfig()).modelId);
        data=await serializeMutation(async()=>{cancelAnalysis();return analysisStore.saveConfig(payload);});
        await broadcastCapture();await ensureAnalysisAlarm();break;
      case MessageType.GET_HISTORY:data=await analysisStore.listHistory(payload);break;
      case MessageType.GET_ANALYSIS_LOG:
        data=payload.evidenceVersion?await analysisStore.getEvidence(payload):payload.runId?await analysisStore.getRun(payload):await analysisStore.listAnalysisLog(payload);break;
      case MessageType.RUN_ANALYSIS_NOW:
        void runDueAnalysis({trigger:'manual'}).catch(()=>{});data={queued:true};break;
      case MessageType.EXPORT_AI_DATA:data=await analysisStore.exportPage(payload);break;
      case MessageType.DELETE_AI_DATA:
        data=await serializeMutation(async()=>{cancelAnalysis();if(payload.removeAutomaticBlocks){const automatic=new Set(await analysisStore.listAutomaticBlockIds()),{blockedChannels=[]}=await chrome.storage.sync.get({blockedChannels:[]});await chrome.storage.sync.set({blockedChannels:blockedChannels.filter(id=>!automatic.has(id))});}return analysisStore.deleteFeatureData(payload);});
        await broadcastCapture();await ensureAnalysisAlarm();break;
      case MessageType.BLOCK_CHANNEL:return applyManualBlock({...payload,action:'block'});
      case MessageType.UNBLOCK_CHANNEL:return applyManualBlock({...payload,action:'unblock'});
      case MessageType.BLOCK_VIDEO:
      case MessageType.UNBLOCK_VIDEO:
        assert(/^[\w-]{11}$/.test(payload.videoId));
        return serializeMutation(async()=>{
          const current=await settings.get(),ids=new Set(current.blockedVideos);
          if(msg.type===MessageType.BLOCK_VIDEO){ids.add(payload.videoId);await blocklistMeta.put({id:payload.videoId,type:'video',name:String(payload.videoTitle||payload.videoId).slice(0,2048),blockedAt:Date.now()});}
          else{ids.delete(payload.videoId);await blocklistMeta.delete(payload.videoId);}
          await chrome.storage.sync.set({blockedVideos:[...ids]});return {ok:true};
        });
      case MessageType.SET_SETTING:
        validateLegacySetting(payload);await chrome.storage.sync.set({[payload.key]:payload.value});return {ok:true};
      case MessageType.TRACK_SESSION:
        assert(Number.isFinite(payload.duration)&&payload.duration>0&&payload.duration<=10);
        assert(/^[\w-]{11}$/.test(payload.videoId));
        await sessions.add({channelId:CHANNEL_ID_PATTERN.test(payload.channelId)?payload.channelId:'unknown',channelName:String(payload.channelName||'Unknown').slice(0,2048),videoId:payload.videoId,videoTitle:String(payload.videoTitle||payload.videoId).slice(0,2048),startTime:payload.startTime||Date.now(),duration:payload.duration,date:toDateString(new Date(payload.startTime||Date.now()))});
        return {ok:true};
      case MessageType.GET_STATS:{
        const all=await sessions.getByDateRange(dateRangeStart(7),toDateString());
        return {hours:all.filter(s=>s.channelId===payload.channelId).reduce((sum,s)=>sum+(s.duration||0),0)/3600};
      }
      default:return null;
    }
    return {requestId:msg.requestId,ok:true,data};
  }catch(error){return aiTypes.has(msg.type)?{requestId:msg.requestId,ok:false,error:safeError(error)}:{error:safeError(error).message};}
});
void initialize().catch(()=>{});
