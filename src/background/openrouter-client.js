import {requestBody} from './analysis-input.js';
import {validateVerdict} from './analysis-policy.js';
import {analysisError,assert,byteLength} from '../shared/analysis-validation.js';
import {readBounded} from '../content/transcript-adapter.js';
export async function verifyModel(modelId,fetchImpl=fetch){
  assert(/^z-ai\/glm-[\w.-]+$/.test(modelId),'UNSUPPORTED_MODEL');
  const r=await fetchImpl('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(20000),redirect:'error'});
  assert(r.ok,'MODEL_LOOKUP_FAILED');const data=JSON.parse(await readBounded(r,8*1024*1024));
  const model=data.data?.find(m=>m.id===modelId);
  assert(model&&model.context_length>=30000&&model.supported_parameters?.includes('structured_outputs'),'UNSUPPORTED_MODEL');
  return true;
}
export async function classifyPart({part,config,signal,fetchImpl=fetch}){
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,20000);
  try{
    assert(config.apiKey,'CONFIG_INCOMPLETE');
    if(signal?.aborted)throw analysisError('CANCELLED');
    const body=JSON.stringify(requestBody(part,config));assert(byteLength(body)<=24576,'INPUT_TOO_LARGE');
    const r=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body});
    if(!r.ok){
      const code=r.status===429?'RATE_LIMITED':[401,403,402].includes(r.status)?'PROVIDER_AUTH_ERROR':r.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED';
      const error=analysisError(code);const retry=r.headers?.get('retry-after');error.retryAfterMs=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now())):0;throw error;
    }
    const text=await readBounded(r,65536);let data;
    try{data=JSON.parse(text);}catch{throw analysisError('INVALID_RESPONSE');}
    const choice=data.choices?.[0];assert(choice?.finish_reason==='stop'&&!choice.message?.refusal,'INVALID_RESPONSE');
    let response;try{response=JSON.parse(choice.message.content);}catch{throw analysisError('INVALID_RESPONSE');}
    const verdict=validateVerdict({part,response});
    return {verdict,usage:data.usage?{prompt_tokens:data.usage.prompt_tokens,completion_tokens:data.usage.completion_tokens,cost:data.usage.cost}:null,providerRequestId:typeof data.id==='string'?data.id.slice(0,128):null};
  }catch(e){
    if(e.code)throw e;
    throw analysisError(controller.signal.aborted?'REQUEST_TIMEOUT':'NETWORK_ERROR');
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
