import {beforeEach,expect,test,vi} from 'vitest';
import {installChromeMock} from './helpers/chrome.js';
import {initOptionsPage,renderEntry} from '../options/options.js';

function page(){
  document.body.innerHTML=`<p id="status"></p><form id="settings-form"><textarea id="priorities"></textarea><input id="model"><input id="api-key"><input id="clear-key" type="checkbox"><input id="request-budget"><input id="byte-budget"><input id="ai-enabled" type="checkbox"><button>Save</button></form><p id="key-status"></p><p id="schedule"></p><p id="storage-status"></p><button id="run-now"></button><button id="refresh-history"></button><div id="history-list"></div><button id="history-more"></button><button id="refresh-log"></button><select id="log-kind"><option value="classification">classification</option><option value="run">run</option></select><div id="log-list"></div><button id="log-more"></button><button id="export"></button><input id="remove-automatic-blocks" type="checkbox"><button id="delete"></button>`;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const config={enabled:true,priorities:'AI',modelId:'z-ai/glm-4.7',maxRequestsPer24h:50,maxInputBytesPer24h:1048576,hasKey:true,nextDueAt:1000,lastOutcome:'completed',queuedBacklog:2,generation:'g1',storageBytes:1024,storagePressure:false};
beforeEach(()=>{page();vi.stubGlobal('confirm',vi.fn(()=>true));vi.stubGlobal('crypto',{randomUUID:()=> 'request'});});
test('history and log render hostile evidence as text',()=>{
  const row=renderEntry({title:'<img src=x onerror=alert(1)>',description:'Description',watchMs:60000,transcript:{status:'unavailable',segments:[]}});
  expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(row.querySelector('img')).toBeNull();
  expect(row.textContent).toContain('unavailable');
});
test('relevant decisions remain visible without a block',()=>{
  const row=renderEntry({videoId:'abcdefghijk',verdict:'relevant',reason:'Teaches AI',createdAt:0});
  expect(row.textContent).toContain('relevant');expect(row.textContent).toContain('Teaches AI');
});

test('saving replaces or clears the key without ever repopulating it',async()=>{
  const chrome=installChromeMock();
  chrome.runtime.sendMessage.mockImplementation(async message=>({ok:true,data:message.type==='GET_AI_SETTINGS'?config:{}}));
  await initOptionsPage();
  document.querySelector('#api-key').value='distinctive-secret';
  document.querySelector('#settings-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({apiKey:'distinctive-secret'})}));
  expect(document.querySelector('#api-key').value).toBe('');
  document.querySelector('#clear-key').checked=true;
  document.querySelector('#settings-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
  expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({payload:expect.objectContaining({keyAction:'clear',enabled:false})}));
  expect(document.body.textContent).not.toContain('distinctive-secret');
});

test('shows storage pressure, run outcome and backlog from settings',async()=>{
  const chrome=installChromeMock();
  chrome.runtime.sendMessage.mockResolvedValue({ok:true,data:{...config,storagePressure:true,lastOutcome:'completed_with_errors',queuedBacklog:7}});
  await initOptionsPage();
  expect(document.querySelector('#storage-status').textContent).toContain('Storage is full');
  expect(document.querySelector('#schedule').textContent).toContain('7');
  expect(document.querySelector('#schedule').textContent).toContain('completed_with_errors');
});

test('paginates history and appends the next durable page',async()=>{
  const chrome=installChromeMock();let calls=0;
  chrome.runtime.sendMessage.mockImplementation(async ({type,payload})=>{
    if(type==='GET_AI_SETTINGS')return {ok:true,data:config};
    if(type==='GET_HISTORY'){calls++;return {ok:true,data:calls===1?{items:[{videoId:'first-video'}],nextCursor:'next'}:{items:[{videoId:'second-video'}],nextCursor:null}};}
    return {ok:true,data:{items:[],nextCursor:null}};
  });
  await initOptionsPage();document.querySelector('#history-more').click();await tick();
  expect(document.querySelector('#history-list').textContent).toContain('first-video');
  expect(document.querySelector('#history-list').textContent).toContain('second-video');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({cursor:'next'})}));
});

test('decision rows reveal exact analyzed evidence and immutable run configuration',async()=>{
  installChromeMock().runtime.sendMessage.mockImplementation(async ({payload})=>({ok:true,data:payload.evidenceVersion?{title:'old title',description:'old <script>',transcript:{status:'complete',segments:[{startMs:0,text:'old exact text'}]}}:{items:[{id:'run-1',config:{priorities:'Old priorities',modelId:'old-model'}}],nextCursor:null}}));
  const row=renderEntry({videoId:'abcdefghijk',runId:'run-1',evidenceVersion:'ev-1',verdict:'relevant'});document.body.append(row);
  [...row.querySelectorAll('button')].find(x=>x.textContent.includes('evidence')).click();await tick();
  [...row.querySelectorAll('button')].find(x=>x.textContent.includes('run configuration')).click();await tick();
  expect(row.textContent).toContain('old exact text');expect(row.textContent).toContain('Old priorities');expect(row.querySelector('script')).toBeNull();
});

test('fallback export buffers records into bounded numbered files',async()=>{
  const chrome=installChromeMock();const urls=[];vi.stubGlobal('URL',{createObjectURL:vi.fn(blob=>{urls.push(blob);return 'blob:test';}),revokeObjectURL:vi.fn()});
  HTMLAnchorElement.prototype.click=vi.fn();
  const huge='x'.repeat(5*1024*1024);let pageNo=0;
  chrome.runtime.sendMessage.mockImplementation(async ({type,payload})=>{
    if(type==='GET_AI_SETTINGS')return {ok:true,data:config};
    if(type==='EXPORT_AI_DATA')return {ok:true,data:payload.store==='videos'&&pageNo++<2?{items:[{text:huge}],nextCursor:pageNo===1?'two':null,generation:'g1'}:{items:[],nextCursor:null,generation:'g1'}};
    return {ok:true,data:{items:[],nextCursor:null}};
  });
  await initOptionsPage();document.querySelector('#export').click();
  while(document.querySelector('#status').textContent!=='Export complete.')await tick();
  expect(urls.length).toBe(2);expect(Math.max(...urls.map(x=>x.size))).toBeLessThanOrEqual(8*1024*1024);
});

test('deletion sends the explicit automatic-block choice and reports errors',async()=>{
  const chrome=installChromeMock();
  chrome.runtime.sendMessage.mockImplementation(async ({type})=>type==='GET_AI_SETTINGS'?{ok:true,data:config}:type==='DELETE_AI_DATA'?{ok:false,error:{message:'Deletion failed safely'}}:{ok:true,data:{items:[],nextCursor:null}});
  await initOptionsPage();document.querySelector('#remove-automatic-blocks').checked=true;document.querySelector('#delete').click();await tick();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({payload:{generation:'g1',removeAutomaticBlocks:true}}));
  expect(document.querySelector('#status').textContent).toBe('Deletion failed safely');
});
