import {MessageType,STORE} from '../shared/constants.js';
const element=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);return e;};
async function send(type,payload={}){
  const r=await chrome.runtime.sendMessage({type,payload,requestId:crypto.randomUUID()});
  if(!r?.ok)throw Error(typeof r?.error==='string'?r.error:r?.error?.message||'Request failed');
  return r.data;
}
export function renderEntry(row){
  const article=element('article');
  article.append(element('h3',row.title||row.videoId||row.channelId||'Analysis run'));
  if(row.createdAt!=null)article.append(element('p',new Date(row.createdAt).toLocaleString()));
  if(row.channelName)article.append(element('p',row.channelName));
  if(row.watchMs!=null)article.append(element('p',(row.watchMs/60000).toFixed(1)+' minutes watched'));
  if(row.verdict)article.append(element('p',row.verdict+' · '+(row.action||'No block')));
  if(row.reason)article.append(element('p',row.reason));
  if(row.status)article.append(element('p','Status: '+row.status));
  if(row.countedMs!=null)article.append(element('p',(row.countedMs/60000).toFixed(2)+' irrelevant minutes · threshold: more than 30'));
  if(row.policyRevision!=null)article.append(element('p','Priorities revision '+row.policyRevision));
  if(row.error)article.append(element('p',row.error.message||row.error.code));
  if(row.description){const d=element('details');d.append(element('summary','Description'),element('p',row.description));article.append(d);}
  if(row.transcript){const d=element('details');d.append(element('summary','Transcript · '+row.transcript.status),element('pre',row.transcript.segments.map(s=>(s.startMs/1000).toFixed(1)+'s '+s.text).join('\n')));article.append(d);}
  if(row.evidenceVersion&&!row.transcript){const button=element('button','View analyzed evidence');button.className='secondary';button.onclick=async()=>{try{const e=await send(MessageType.GET_ANALYSIS_LOG,{videoId:row.videoId,evidenceVersion:row.evidenceVersion});if(e)article.append(renderEntry(e));button.disabled=true;}catch(e){status(e.message);}};article.append(button);}
  if(row.action==='block'&&row.channelId){const button=element('button','Unblock channel');button.className='secondary';button.onclick=async()=>{const r=await chrome.runtime.sendMessage({type:MessageType.UNBLOCK_CHANNEL,payload:{channelId:row.channelId}});if(r?.ok){button.disabled=true;button.textContent='Unblocked';}else status('Could not unblock channel.');};article.append(button);}
  if(row.runId&&!row.config){const button=element('button','View run configuration');button.className='secondary';button.onclick=async()=>{try{const result=await send(MessageType.GET_ANALYSIS_LOG,{kind:'run',runId:row.runId});const run=result?.items?.[0]??result;if(run?.config){const d=element('details');d.open=true;d.append(element('summary','Priorities and model used'),element('pre',JSON.stringify(run.config,null,2)));article.append(d);}button.disabled=true;}catch(e){status(e.message);}};article.append(button);}
  if(row.config){const d=element('details');d.append(element('summary','Priorities and model used'),element('pre',JSON.stringify(row.config,null,2)));article.append(d);}
  if(row.evidenceRefs?.length)article.append(element('p','Evidence: '+row.evidenceRefs.join(', ')));
  return article;
}
const byId=id=>document.getElementById(id);
function status(message){const e=byId('status');if(e)e.textContent=message;}
let config,historyCursor=null,logCursor=null;
async function loadSettings(nextConfig){
  config=nextConfig??await send(MessageType.GET_AI_SETTINGS);
  byId('priorities').value=config.priorities;byId('model').value=config.modelId;byId('ai-enabled').checked=config.enabled;
  byId('request-budget').value=config.maxRequestsPer24h;byId('byte-budget').value=config.maxInputBytesPer24h;
  byId('key-status').textContent=config.hasKey?'A key is saved on this computer. Leave blank to keep it.':'No key saved.';
  byId('schedule').textContent=config.enabled?'Next analysis: '+new Date(config.nextDueAt).toLocaleString()+'. Last outcome: '+(config.lastOutcome||'none')+'. Queued backlog: '+(config.queuedBacklog??0)+'. If Chrome is closed, analysis catches up when it reopens.':'Analysis is disabled.';
  const storageStatus=byId('storage-status');if(storageStatus)storageStatus.textContent=config.storagePressure?'Storage is full. Export or delete history before more records can be saved.':'Local storage is available.';
  byId('run-now').disabled=!config.enabled;
}
async function loadList(kind,append=false){
  const history=kind==='history',container=byId(history?'history-list':'log-list');
  const page=await send(history?MessageType.GET_HISTORY:MessageType.GET_ANALYSIS_LOG,{limit:20,cursor:append?(history?historyCursor:logCursor):null,...(!history?{kind:byId('log-kind').value}:{})});
  if(!append)container.replaceChildren();
  for(const row of page.items??[])container.append(renderEntry(row));
  if(!container.childNodes.length)container.append(element('p','No records yet.'));
  if(history)historyCursor=page.nextCursor;else logCursor=page.nextCursor;
  byId(history?'history-more':'log-more').hidden=!page.nextCursor;
}
async function exportData(){
  const snapshot=await send(MessageType.GET_AI_SETTINGS),cutoff=Date.now();
  let writer=null,number=1;
  if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:'tubeguard-history.jsonl'});writer=await handle.createWritable();}
  const save=async text=>{
    if(writer)return writer.write(text);
    const blob=new Blob([text],{type:'application/x-ndjson'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='tubeguard-history-'+number+++'.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  try{
    const maxFileBytes=8*1024*1024,encoder=new TextEncoder();let buffer=JSON.stringify({format:'tubeguard-export',version:1,cutoff})+'\n',bufferBytes=encoder.encode(buffer).byteLength;
    const append=async line=>{const bytes=encoder.encode(line).byteLength;if(buffer&&bufferBytes+bytes>maxFileBytes){await save(buffer);buffer='';bufferBytes=0;}buffer+=line;bufferBytes+=bytes;if(bufferBytes>=maxFileBytes){await save(buffer);buffer='';bufferBytes=0;}};
    const stores=[STORE.VIDEOS,STORE.EVIDENCE,STORE.CHUNKS,STORE.RUNS,STORE.CLASSIFICATIONS,STORE.DECISIONS,STORE.INPUTS];
    for(const store of stores){let cursor=null;do{const page=await send(MessageType.EXPORT_AI_DATA,{store,cursor,limit:1,generation:snapshot.generation,cutoff});for(const record of page.items)await append(JSON.stringify({store,record})+'\n');cursor=page.nextCursor;}while(cursor);}
    if(buffer)await save(buffer);
    if(writer)await writer.close();status('Export complete.');
  }catch(e){if(writer)await writer.abort().catch(()=>{});throw e;}
}
export async function initOptionsPage(){
  const guarded=fn=>async e=>{try{await fn(e);}catch(error){status(error.message);}};
  byId('settings-form').addEventListener('submit',guarded(async e=>{
    e.preventDefault();status('Saving settings…');
    const payload={enabled:byId('ai-enabled').checked,priorities:byId('priorities').value,modelId:byId('model').value.trim(),maxRequestsPer24h:Number(byId('request-budget').value),maxInputBytesPer24h:Number(byId('byte-budget').value)};
    if(byId('api-key').value.trim())payload.apiKey=byId('api-key').value.trim();
    if(byId('clear-key').checked){payload.keyAction='clear';payload.enabled=false;}
    const saved=await send(MessageType.SAVE_AI_SETTINGS,payload);byId('api-key').value='';byId('clear-key').checked=false;await loadSettings(saved?.generation?saved:{...config,...payload,hasKey:payload.keyAction==='clear'?false:Boolean(payload.apiKey)||config.hasKey});status('Priorities saved.');
  }));
  byId('run-now').onclick=guarded(async()=>{await send(MessageType.RUN_ANALYSIS_NOW);status('Analysis queued. Refresh the decision log to see its progress.');});
  byId('refresh-history').onclick=guarded(()=>loadList('history'));
  byId('refresh-log').onclick=guarded(()=>loadList('log'));
  byId('history-more').onclick=guarded(()=>loadList('history',true));byId('log-more').onclick=guarded(()=>loadList('log',true));
  byId('log-kind').onchange=guarded(()=>loadList('log'));
  byId('export').onclick=guarded(exportData);
  byId('delete').onclick=guarded(async()=>{if(!window.confirm('Delete enriched watch history and decision logs? Analysis will be disabled.'))return;await send(MessageType.DELETE_AI_DATA,{generation:config.generation,removeAutomaticBlocks:Boolean(byId('remove-automatic-blocks')?.checked)});await loadSettings();await loadList('history');await loadList('log');status('History and decision logs deleted.');});
  await loadSettings();await loadList('history');await loadList('log');
}
if(byId('settings-form'))void initOptionsPage().catch(e=>status(e.message));
