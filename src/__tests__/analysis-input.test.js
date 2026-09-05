import {expect,test} from 'vitest';
import {buildAnalysisParts,requestBody} from '../background/analysis-input.js';
const video={videoId:'abcdefghijk',evidenceVersion:'v',title:'Title',description:'a'.repeat(32768),transcript:{status:'complete',segments:[{id:'0',startMs:0,endMs:60000,text:'你'.repeat(6000)}]}};
test('splits all evidence with bounded complete request bodies',()=>{
  const parts=buildAnalysisParts({video,chunks:[{mediaIntervals:[{startMs:0,endMs:1000}]}],priorities:'Learn AI'});
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.flatMap(p=>p.evidence).filter(e=>e.kind==='description').map(e=>e.text).join('')).toBe(video.description);
  for(const p of parts)expect(new TextEncoder().encode(JSON.stringify(requestBody(p,{modelId:'z-ai/glm-4.7'}))).length).toBeLessThanOrEqual(24576);
});
test('missing transcript returns no remote parts',()=>{
  expect(buildAnalysisParts({video:{...video,transcript:{status:'unavailable',segments:[]}},chunks:[],priorities:'AI'})).toEqual([]);
});
