import {sessions} from '../shared/storage.js';
import {assert,VIDEO_ID_PATTERN} from '../shared/analysis-validation.js';
import {CHANNEL_ID_PATTERN} from '../shared/constants.js';
import {EVIDENCE_LIMITS} from '../shared/analysis-contracts.js';
import {toDateString} from '../shared/utils.js';

export async function recordSession(payload){
  assert(Number.isFinite(payload.duration)&&payload.duration>0&&payload.duration<=10);
  assert(VIDEO_ID_PATTERN.test(payload.videoId));
  await sessions.add({
    channelId:CHANNEL_ID_PATTERN.test(payload.channelId)?payload.channelId:'unknown',
    channelName:String(payload.channelName||'Unknown').slice(0,EVIDENCE_LIMITS.TITLE_BYTES),
    videoId:payload.videoId,
    videoTitle:String(payload.videoTitle||payload.videoId).slice(0,EVIDENCE_LIMITS.TITLE_BYTES),
    startTime:payload.startTime||Date.now(),
    duration:payload.duration,
    date:toDateString(new Date(payload.startTime||Date.now())),
  });
  return {ok:true};
}
