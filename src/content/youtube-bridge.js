import { SELECTORS } from '../shared/constants.js';
window.addEventListener('message',event=>{
  const data=event.data;
  if(event.source!==window||event.origin!==location.origin||data?.kind!=='TUBEGUARD_METADATA_REQUEST'||data.version!==1||typeof data.requestId!=='string'||data.requestId.length>64)return;
  const videoId=new URL(location.href).searchParams.get('v');if(data.videoId!==videoId)return;
  const player=document.querySelector(SELECTORS.WATCH_PLAYER)?.getPlayerResponse?.()||window.ytInitialPlayerResponse;
  const details=player?.videoDetails;if(details?.videoId!==videoId)return;
  const metadata={videoId,channelId:details.channelId,title:String(details.title??'').slice(0,2048),shortDescription:String(details.shortDescription??'').slice(0,32768),author:details.author,lengthSeconds:details.lengthSeconds,captionTracks:(player.captions?.playerCaptionsTracklistRenderer?.captionTracks??[]).slice(0,40).map(t=>({baseUrl:t.baseUrl,languageCode:t.languageCode,kind:t.kind}))};
  const envelope={kind:'TUBEGUARD_METADATA',version:1,requestId:data.requestId,metadata};
  if(new TextEncoder().encode(JSON.stringify(envelope)).length>65536)metadata.captionTracks=metadata.captionTracks.slice(0,2);
  if(new TextEncoder().encode(JSON.stringify(envelope)).length<=65536)window.postMessage(envelope,location.origin);
});
