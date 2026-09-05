import { expect, test, vi } from 'vitest';
import { createPlaybackTracker } from '../content/time-tracker.js';

function harness() {
  let wall = 1000, mono = 10;
  const sent = [];
  const tracker = createPlaybackTracker({ now: () => wall, monotonicNow: () => mono, sendRequest: async (type, payload) => {
    sent.push({ type, payload });
    if (type === 'BEGIN_CAPTURE') return { ok: true, data: { sessionId: 's1', captureEpoch: 7 } };
    return { ok: true, data: {} };
  }});
  return { tracker, sent, advance(ms, mediaDelta = ms / 1000) { wall += ms; mono += ms; tracker.progress(mediaDelta); } };
}

test('retains a ten-second partial view as one immutable checkpoint', async () => {
  const h = harness(); await h.tracker.navigate({ videoId: 'abcdefghijk', navigationId: 'n1', durationSeconds: 301 });
  h.tracker.play(0); h.advance(10000, 10); await h.tracker.pause(10);
  const cp = h.sent.find(x => x.type === 'RECORD_WATCH_CHECKPOINT').payload;
  expect(cp).toMatchObject({ sessionId: 's1', captureEpoch: 7, sequence: 1, videoId: 'abcdefghijk', navigationId: 'n1', activeMs: 10000 });
  expect(cp.activeIntervals).toEqual([{ wallStartMs: 1000, wallEndMs: 11000, mediaStartMs: 0, mediaEndMs: 10000 }]);
});

test.each([['paused','pause'], ['buffering','waiting'], ['seeking','seeking'], ['hidden','hidden'], ['ad','adStart']])('%s gaps earn zero time', async (_, event) => {
  const h = harness(); await h.tracker.navigate({ videoId: 'abcdefghijk', navigationId: 'n1', durationSeconds: 301 });
  h.tracker.play(0); h.advance(1000, 1); await h.tracker[event](1); h.advance(3000, 0); h.tracker.play(1); h.advance(1000, 1); await h.tracker.pause(2);
  expect(h.sent.filter(x => x.type === 'RECORD_WATCH_CHECKPOINT').reduce((n,x) => n + x.payload.activeMs, 0)).toBe(2000);
});

test('two-times playback credits wall time and splits at the rate change', async () => {
  const h = harness(); await h.tracker.navigate({ videoId: 'abcdefghijk', navigationId: 'n1', durationSeconds: 301 });
  h.tracker.play(0); h.advance(2000, 4); await h.tracker.rateChange(4); h.advance(1000, 2); await h.tracker.pause(6);
  expect(h.sent.filter(x => x.type === 'RECORD_WATCH_CHECKPOINT').reduce((n,x) => n+x.payload.activeMs,0)).toBe(3000);
});

test('duration 300 disables enriched capture while 301 enables it', async () => {
  const sendRequest = vi.fn(async type => type === 'BEGIN_CAPTURE' ? { ok:true, data:{sessionId:'s',captureEpoch:1} } : {ok:true,data:{}});
  const tracker = createPlaybackTracker({ now: () => 1, monotonicNow: () => 1, sendRequest });
  await tracker.navigate({ videoId:'abcdefghijk',navigationId:'a',durationSeconds:300 });
  expect(sendRequest).not.toHaveBeenCalled();
  await tracker.navigate({ videoId:'abcdefghijk',navigationId:'b',durationSeconds:301 });
  expect(sendRequest).toHaveBeenCalledWith('BEGIN_CAPTURE', { videoId:'abcdefghijk',navigationId:'b' });
});

test('discards unexplained sleep gaps and retries the exact same delta', async () => {
  let fail = true; const sent=[]; let wall=0, mono=0;
  const tracker=createPlaybackTracker({now:()=>wall,monotonicNow:()=>mono,sendRequest:async(type,payload)=>{sent.push({type,payload}); if(type==='BEGIN_CAPTURE')return {ok:true,data:{sessionId:'s',captureEpoch:1}}; if(fail){fail=false;throw Error('gone')} return {ok:true,data:{}};}});
  await tracker.navigate({videoId:'abcdefghijk',navigationId:'n',durationSeconds:301}); tracker.play(0); wall=20000; mono=20000; tracker.progress(20); await tracker.pause(20); await tracker.retryPending();
  expect(sent.filter(x=>x.type==='RECORD_WATCH_CHECKPOINT')).toHaveLength(0);
  tracker.play(20);wall+=1000;mono+=1000;tracker.progress(1);await tracker.pause(21);await tracker.retryPending();
  const attempts=sent.filter(x=>x.type==='RECORD_WATCH_CHECKPOINT');expect(attempts[0].payload).toEqual(attempts[1].payload);expect(attempts[0].payload.activeMs).toBe(1000);
});
