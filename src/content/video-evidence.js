import { SELECTORS } from '../shared/constants.js';
import { parseTranscript, unavailable, readBounded } from './transcript-adapter.js';
const utf8=new TextEncoder();
function trimBytes(value,max){let text=String(value??'');if(utf8.encode(text).length<=max)return text;while(utf8.encode(text).length>max)text=text.slice(0,Math.max(0,text.length-Math.ceil((utf8.encode(text).length-max)/4)));return text.replace(/[\uD800-\uDBFF]$/,'');}
function aborted(signal){if(signal?.aborted)throw new DOMException('Navigation changed','AbortError');}
export function getPlayerMetadata({videoId,signal,window:win=window}){
  return new Promise(resolve=>{
    const requestId=crypto.randomUUID();
    const done=value=>{clearTimeout(timeout);win.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>done(null);
    const receive=e=>{if(e.source!==win||e.origin!==win.location.origin||e.data?.kind!=='TUBEGUARD_METADATA'||e.data.requestId!==requestId||e.data.version!==1)return;try{if(utf8.encode(JSON.stringify(e.data)).length<=65536)done(e.data.metadata);}catch{done(null);}};
    const timeout=setTimeout(()=>done(null),2000);win.addEventListener('message',receive);signal?.addEventListener('abort',abort,{once:true});
    win.postMessage({kind:'TUBEGUARD_METADATA_REQUEST',version:1,requestId,videoId},win.location.origin);
  });
}
export async function extractEvidence({document:doc=document,videoId,navigationId,signal,getPlayerMetadata:metadataReader=getPlayerMetadata,fetchImpl=fetch}){
  const player=await metadataReader({videoId,signal});aborted(signal);
  const valid=player?.videoId===videoId?player:null;
  const owner=doc.querySelector(SELECTORS.WATCH_CHANNEL_LINK),href=owner?.getAttribute('href')??'';
  let ownerId=null;try{const u=new URL(href,'https://www.youtube.com');if(u.origin==='https://www.youtube.com')ownerId=u.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1]||u.pathname.match(/^\/(@[\w.-]+)\/?$/)?.[1]||null;}catch{}
  const playerId=/^UC[\w-]{22}$/.test(valid?.channelId)?valid.channelId:null;
  const conflict=ownerId?.startsWith('UC')&&playerId&&ownerId!==playerId;
  const channelId=conflict?null:ownerId?.startsWith('UC')?ownerId:ownerId&&playerId?playerId:null;
  const aliases=channelId&&ownerId!==channelId?[ownerId]:[];
  let transcript=unavailable();
  const tracks=[...(valid?.captionTracks??[])].sort((a,b)=>Number(!!a.kind)-Number(!!b.kind));
  for(const track of tracks.slice(0,3)){
    try{
      const url=new URL(track.baseUrl);
      if(url.origin!=='https://www.youtube.com'||url.pathname!=='/api/timedtext'||url.username||url.password||url.searchParams.get('v')!==videoId||url.href.length>8192)continue;
      const allowed=new Set(['v','ei','caps','opi','exp','xoaf','xowf','hl','ip','ipbits','expire','sparams','signature','key','kind','lang','fmt']);
      if([...url.searchParams.keys()].some(k=>!allowed.has(k)))continue;
      url.searchParams.set('fmt','json3');
      const response=await fetchImpl(url.href,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:'error',credentials:'same-origin'});aborted(signal);
      if(response.ok){transcript=parseTranscript({format:'json3',body:await readBounded(response,4*1024*1024)});transcript.language=String(track.languageCode??'').slice(0,128);if(transcript.status==='complete')break;}
    }catch(e){aborted(signal);if(e.message==='OVERSIZED')transcript=unavailable('oversized');}
  }
  aborted(signal);
  if(transcript.status!=='complete'){
    const segments=[...doc.querySelectorAll(SELECTORS.WATCH_TRANSCRIPT_SEGMENT)].slice(0,20000).map((e,i)=>{const stamp=e.querySelector(SELECTORS.WATCH_TRANSCRIPT_TIMESTAMP)?.textContent.trim()??'';return {id:String(i),startMs:stamp.split(':').reduce((n,v)=>n*60+Number(v),0)*1000,text:trimBytes(e.querySelector(SELECTORS.WATCH_TRANSCRIPT_TEXT)?.textContent,8192)};}).filter(s=>s.text&&Number.isFinite(s.startMs));
    if(segments.length)transcript={status:'partial',language:'',source:'transcript-panel',segments:segments.map((s,i)=>({...s,endMs:segments[i+1]?.startMs??s.startMs+1000}))};
  }
  const duration=Number(valid?.lengthSeconds);
  if(utf8.encode(String(valid?.shortDescription??'')).length>32768||utf8.encode(String(valid?.title??'')).length>2048)transcript.status='partial';
  return {videoId,navigationId,channelId,channelAliases:aliases,identityProvenance:channelId?(ownerId===channelId?'owner-hyperlink':'active-player+owner-handle'):'',channelName:trimBytes(owner?.textContent||valid?.author,2048),title:trimBytes(valid?.title||doc.querySelector(SELECTORS.WATCH_TITLE)?.textContent||doc.title,2048),description:trimBytes(valid?.shortDescription||doc.querySelector(SELECTORS.WATCH_DESCRIPTION)?.textContent,32768),durationSeconds:Number.isFinite(duration)&&duration>0?duration:null,transcript,capturedAt:Date.now()};
}
