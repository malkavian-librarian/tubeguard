import { MessageType, SELECTORS } from '../shared/constants.js';
import { extractEvidence } from './video-evidence.js';
import { ANALYSIS_MIN_DURATION_SECONDS } from '../shared/analysis-contracts.js';
import { sendRequest as sendRequestDefault } from '../shared/message-bus.js';

export function createPlaybackTracker({now=Date.now,monotonicNow=()=>performance.now(),sendRequest=sendRequestDefault}={}){
  let info=null,capture=null,sequence=0,start=null,media=0,queue=[],sending=null,nav=0;
  const flushQueue=()=>{
    if(sending)return sending;
    sending=(async()=>{while(queue.length){try{const item=queue[0],r=await sendRequest(item.type,item.payload);if(r?.ok===false)throw Object.assign(Error(),{code:r.error?.code});queue.shift();}catch(e){if(['STALE_GENERATION','AI_DISABLED','INVALID_CAPTURE'].includes(e.code))queue=[];break;}}})().finally(()=>{sending=null;});
    return sending;
  };
  const play=position=>{media=position;if(!start)start={wall:now(),mono:monotonicNow(),media:position};};
  const pause=async position=>{
    media=position;
    if(start&&info){
      const end=Math.round(now()),elapsed=Math.round(monotonicNow()-start.mono),wall=end-Math.round(start.wall);
      if(elapsed>0&&elapsed<=10000&&wall>0&&wall<=10000&&Math.abs(elapsed-wall)<500&&position>start.media){
        if(queue.length<100){
          if(capture){
            const interval={wallStartMs:Math.round(start.wall),wallEndMs:end,mediaStartMs:Math.round(start.media*1000),mediaEndMs:Math.round(position*1000)};
            queue.push({type:MessageType.RECORD_WATCH_CHECKPOINT,payload:{...capture,sequence:++sequence,videoId:info.videoId,navigationId:info.navigationId,startedAt:interval.wallStartMs,endedAt:end,activeMs:wall,activeIntervals:[interval],mediaIntervals:[{startMs:interval.mediaStartMs,endMs:interval.mediaEndMs}]}});
          }else queue.push({type:MessageType.TRACK_SESSION,payload:{videoId:info.videoId,videoTitle:info.title||info.videoId,channelId:info.channelId,channelName:info.channelName,startTime:start.wall,duration:wall/1000}});
        }
      }
    }
    start=null;await flushQueue();
  };
  return {
    async navigate(next){const token=++nav;await pause(media);info=next;capture=null;sequence=0;if(next.durationSeconds>ANALYSIS_MIN_DURATION_SECONDS&&Number.isFinite(next.durationSeconds)){try{const r=await sendRequest(MessageType.BEGIN_CAPTURE,{videoId:next.videoId,navigationId:next.navigationId});if(token===nav&&r?.ok)capture=r.data;}catch{}}return capture;},
    play,progress(delta){media+=delta;},
    pause,waiting:pause,seeking:pause,hidden:pause,adStart:pause,
    async rateChange(position){await pause(position);play(position);},
    retryPending:flushQueue,
    async checkpoint(position){await pause(position);play(position);},
    get capture(){return capture;},
  };
}

export function initTimeTracker({sendRequest=sendRequestDefault}={}){
  const tracker=createPlaybackTracker({sendRequest});let video=null,controller=null,dispose=[],navigation=0,ready=false,lastPosition=0,lastCheckpoint=0,blocked=false;
  const active=()=>video&&!video.paused&&!video.ended&&!video.seeking&&!document.hidden&&!blocked&&!document.querySelector(SELECTORS.WATCH_AD);
  const stop=()=>{if(video)void tracker.pause(lastPosition);};
  const attach=async()=>{
    const v=document.querySelector(SELECTORS.WATCH_VIDEO),videoId=new URL(location.href).searchParams.get('v');
    if(!v||!/^[\w-]{11}$/.test(videoId??''))return;
    if(video===v&&ready)return;
    const token=++navigation;controller?.abort();controller=new AbortController();for(const off of dispose)off();dispose=[];stop();video=v;ready=true;
    const navigationId=crypto.randomUUID();lastPosition=v.currentTime;
    const listen=(name,fn)=>{v.addEventListener(name,fn);dispose.push(()=>v.removeEventListener(name,fn));};
    listen('playing',()=>{blocked=false;if(active())tracker.play(v.currentTime);});
    for(const event of ['pause','ended','waiting','seeking','emptied'])listen(event,()=>{stop();blocked=event==='waiting'||event==='seeking';if(event==='emptied'){ready=false;void attach();}});
    listen('seeked',()=>{blocked=false;lastPosition=v.currentTime;if(active())tracker.play(v.currentTime);});
    listen('ratechange',()=>{void tracker.rateChange(v.currentTime);});
    listen('timeupdate',()=>{const pos=v.currentTime;if(active()){tracker.progress(Math.max(0,pos-lastPosition));if(performance.now()-lastCheckpoint>=5000){lastCheckpoint=performance.now();void tracker.checkpoint(pos);}}else stop();lastPosition=pos;});
    const basic={videoId,navigationId,durationSeconds:Number.isFinite(v.duration)&&v.duration>0?v.duration:null,title:document.title};
    let capture=await tracker.navigate(basic);
    if(token!==navigation)return;
    if(active())tracker.play(v.currentTime);
    listen('loadedmetadata',()=>{if(!basic.durationSeconds){ready=false;void attach();}});
    const evidence=await extractEvidence({videoId,navigationId,signal:controller.signal}).catch(()=>null);
    if(token!==navigation||!evidence)return;
    evidence.durationSeconds??=Number.isFinite(v.duration)&&v.duration>0?v.duration:null;
    if(!capture&&evidence.durationSeconds>ANALYSIS_MIN_DURATION_SECONDS)capture=await tracker.navigate(evidence);
    if(token!==navigation)return;
    if(capture)await sendRequestDefault(MessageType.UPSERT_VIDEO_EVIDENCE,{...evidence,...capture}).catch(()=>{});
    if(active())tracker.play(v.currentTime);
  };
  document.addEventListener('yt-navigate-start',()=>{stop();ready=false;controller?.abort();navigation++;});
  document.addEventListener('yt-navigate-finish',()=>{ready=false;void attach();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(active())tracker.play(video.currentTime);});
  window.addEventListener('pagehide',stop);

  // the full-subtree attribute observer only exists to catch ad/video-swap DOM churn the
  // analysis feature needs (see attach()'s WATCH_AD/re-attach checks below); it stays
  // disconnected unless that feature is enabled, since it fires on every class mutation
  // across the whole document on every YouTube tab.
  let featureObserver=null;
  const startFeatureObserver=()=>{
    if(featureObserver)return;
    featureObserver=new MutationObserver(()=>{if(document.querySelector(SELECTORS.WATCH_AD))stop();if(document.querySelector(SELECTORS.WATCH_VIDEO)!==video||!ready)void attach();});
    featureObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  };
  const stopFeatureObserver=()=>{if(featureObserver){featureObserver.disconnect();featureObserver=null;}};
  const syncFeatureObserver=async()=>{
    try{const r=await sendRequest(MessageType.GET_AI_SETTINGS);if(r?.ok!==false&&r?.data?.enabled)startFeatureObserver();else stopFeatureObserver();}
    catch{stopFeatureObserver();}
  };

  chrome.runtime.onMessage.addListener(msg=>{if(msg?.type===MessageType.CAPTURE_POLICY_CHANGED){stop();ready=false;void attach();void syncFeatureObserver();}});
  void syncFeatureObserver();
  void attach();
}
