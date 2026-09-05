import {expect,test} from 'vitest';
import {decideChannel,validateVerdict,aggregateVerdicts} from '../background/analysis-policy.js';
test('strict threshold with deterministic eligibility',()=>{
  const base={eligible:true,alreadyBlocked:false};
  expect(decideChannel({...base,irrelevantMs:1800000}).action).toBe('none');
  expect(decideChannel({...base,irrelevantMs:1800001}).action).toBe('block');
  expect(decideChannel({...base,eligible:false,irrelevantMs:9999999}).action).toBe('none');
});
test('model cannot nominate a channel or invent evidence',()=>{
  const part={videoId:'abcdefghijk',evidenceVersion:'v1',part:0,refs:['segment:0']};
  const response={videoId:part.videoId,evidenceVersion:'v1',part:0,verdict:'irrelevant',reason:'Off topic',evidenceRefs:['segment:0']};
  expect(validateVerdict({part,response})).toEqual(response);
  expect(()=>validateVerdict({part,response:{...response,channelId:'UCaaaaaaaaaaaaaaaaaaaaaa'}})).toThrow();
  expect(()=>validateVerdict({part,response:{...response,evidenceRefs:['segment:999']}})).toThrow();
});
test('incomplete analysis cannot block',()=>{
  expect(aggregateVerdicts([{verdict:'irrelevant'}],2).verdict).toBe('uncertain');
  expect(aggregateVerdicts([{verdict:'irrelevant'},{verdict:'relevant'}],2).verdict).toBe('relevant');
  expect(aggregateVerdicts([{verdict:'irrelevant'},{verdict:'irrelevant'}],2).verdict).toBe('irrelevant');
});
