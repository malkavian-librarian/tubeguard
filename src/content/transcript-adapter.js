import { SELECTORS } from '../shared/constants.js';
import { EVIDENCE_LIMITS, MAX_TRANSCRIPT_SEGMENTS } from '../shared/analysis-contracts.js';
export const unavailable = (status='unavailable') => ({status,language:'',source:'',segments:[]});
export async function readBounded(response, maxBytes) {
  if (Number(response.headers?.get('content-length')) > maxBytes) throw Error('OVERSIZED');
  if (!response.body?.getReader) {
    const text=await response.text(); if(new TextEncoder().encode(text).length>maxBytes)throw Error('OVERSIZED');return text;
  }
  const reader=response.body.getReader(), decoder=new TextDecoder();let text='',bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('OVERSIZED');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{await reader.cancel().catch(()=>{});}
}
export function parseTranscript({format,body}) {
  if(!body)return unavailable();
  if(new TextEncoder().encode(body).length>4*1024*1024)return unavailable('oversized');
  let raw;
  try{
    if(format==='json3')raw=(JSON.parse(body).events??[]).filter(e=>e.segs).map(e=>({startMs:Math.round(e.tStartMs),endMs:Math.round(e.tStartMs+(e.dDurationMs??0)),text:e.segs.map(s=>s.utf8??'').join('').trim()}));
    else if(format==='xml'){
      const doc=new DOMParser().parseFromString(body,'text/xml');if(doc.querySelector(SELECTORS.XML_PARSE_ERROR))return unavailable();
      raw=[...doc.querySelectorAll(SELECTORS.TRANSCRIPT_XML_TEXT)].map(e=>({startMs:Math.round(Number(e.getAttribute('start'))*1000),endMs:Math.round((Number(e.getAttribute('start'))+Number(e.getAttribute('dur')))*1000),text:e.textContent.trim()}));
    }else return unavailable();
    raw=raw.filter(s=>s.text);
    if(raw.length>MAX_TRANSCRIPT_SEGMENTS||raw.some(s=>!Number.isSafeInteger(s.startMs)||s.startMs<0||!Number.isSafeInteger(s.endMs)||s.endMs<=s.startMs))return unavailable('partial');
    if(raw.some(s=>new TextEncoder().encode(s.text).length>EVIDENCE_LIMITS.SEGMENT_TEXT_BYTES)||new TextEncoder().encode(raw.map(s=>s.text).join('')).length>2*1024*1024)return unavailable('oversized');
    return raw.length?{status:'complete',language:'',source:'captions-'+format,segments:raw.map((s,i)=>({id:String(i),...s}))}:unavailable();
  }catch{return unavailable();}
}
