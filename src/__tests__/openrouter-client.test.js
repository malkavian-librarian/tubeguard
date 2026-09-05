import {expect,test,vi} from 'vitest';
import {classifyPart,verifyModel} from '../background/openrouter-client.js';
test('rejects unsupported models before use',async()=>{
  await expect(verifyModel('z-ai/glm-4.7',async()=>new Response(JSON.stringify({data:[]})))).rejects.toMatchObject({code:'UNSUPPORTED_MODEL'});
});
test('provider errors never leak credentials and retry-after is retained',async()=>{
  const fetchImpl=vi.fn(async()=>new Response('secret-KEY',{status:429,headers:{'Retry-After':'120'}}));
  await expect(classifyPart({part:{videoId:'abcdefghijk',evidenceVersion:'v',part:0,refs:[],evidence:[],priorities:'AI'},config:{modelId:'z-ai/glm-4.7',apiKey:'secret-KEY'},fetchImpl})).rejects.toMatchObject({code:'RATE_LIMITED',retryAfterMs:120000});
});
