import {beforeEach,expect,test,vi} from 'vitest';
import {installChromeMock} from './helpers/chrome.js';
import {MessageType} from '../shared/constants.js';

let initTimeTracker,observeSpy,disconnectSpy;

beforeEach(async()=>{
  vi.resetModules();
  installChromeMock();
  document.body.innerHTML='';
  observeSpy=vi.spyOn(MutationObserver.prototype,'observe');
  disconnectSpy=vi.spyOn(MutationObserver.prototype,'disconnect');
  ({initTimeTracker}=await import('../content/time-tracker.js'));
});

async function settle(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}

test('the attribute-observing MutationObserver stays disconnected while the analysis feature is disabled',async()=>{
  const sendRequest=vi.fn(async()=>({ok:true,data:{enabled:false}}));
  initTimeTracker({sendRequest});
  await settle();
  expect(observeSpy).not.toHaveBeenCalled();
});

test('the observer connects once the analysis feature is confirmed enabled',async()=>{
  const sendRequest=vi.fn(async()=>({ok:true,data:{enabled:true}}));
  initTimeTracker({sendRequest});
  await settle();
  expect(observeSpy).toHaveBeenCalledTimes(1);
});

test('a CAPTURE_POLICY_CHANGED broadcast disconnects the observer once the feature is turned off',async()=>{
  let enabled=true;
  const sendRequest=vi.fn(async(type)=>type===MessageType.GET_AI_SETTINGS?{ok:true,data:{enabled}}:{ok:true,data:{}});
  initTimeTracker({sendRequest});
  await settle();
  expect(observeSpy).toHaveBeenCalledTimes(1);

  enabled=false;
  chrome.runtime.onMessage.dispatch({type:MessageType.CAPTURE_POLICY_CHANGED});
  await settle();
  expect(disconnectSpy).toHaveBeenCalled();
});

test('a failed config lookup leaves the observer disconnected rather than defaulting to on',async()=>{
  const sendRequest=vi.fn(async()=>{throw new Error('service worker asleep');});
  initTimeTracker({sendRequest});
  await settle();
  expect(observeSpy).not.toHaveBeenCalled();
});
