import {test,expect,chromium} from '@playwright/test';
import path from 'node:path';
import {mkdir,mkdtemp} from 'node:fs/promises';

test('packaged extension captures playback, classifies, blocks, and preserves audit',async()=>{
  const root=process.cwd();await mkdir(path.join(root,'.test-profiles'),{recursive:true});
  const profile=await mkdtemp(path.join(root,'.test-profiles','learning-'));
  const browserPath=process.env.TUBEGUARD_TEST_CHROME||'C:/Users/FlyerOne/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:browserPath,args:['--disable-extensions-except='+root,'--load-extension='+root,'--autoplay-policy=no-user-gesture-required']});
  let intercepted=0;
  try{
    await context.route('https://openrouter.ai/**',async route=>{
      if(route.request().url().endsWith('/models'))return route.fulfill({json:{data:[{id:'z-ai/glm-4.7',context_length:200000,supported_parameters:['structured_outputs']}]}});
      const body=route.request().postDataJSON();expect(route.request().headers().authorization).toBe('Bearer dummy-browser-key');intercepted++;
      const input=JSON.parse(body.messages[1].content);
      await route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({videoId:input.videoId,evidenceVersion:input.evidenceVersion,part:input.part,verdict:'irrelevant',reason:'Synthetic entertainment is outside AI learning goals.',evidenceRefs:[input.untrustedEvidence[0].id]})}}]}});
    });
    await context.route('https://www.youtube.com/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/timedtext')return route.fulfill({json:{events:[{tStartMs:0,dDurationMs:400000,segs:[{utf8:'Entertainment and comedy, unrelated to AI.'}]}]}});
      if(url.pathname==='/fixture.wav'){
        const size=8000*2*310,buffer=Buffer.alloc(44+size);buffer.write('RIFF',0);buffer.writeUInt32LE(36+size,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(size,40);
        return route.fulfill({contentType:'audio/wav',body:buffer});
      }
      await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic video</title><div id="owner"><div id="channel-name"><a href="/@fixture">Fixture</a></div></div><div id="movie_player"><video autoplay muted src="/fixture.wav"></video></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:"abcdefghijk",channelId:"UCaaaaaaaaaaaaaaaaaaaaaa",title:"Synthetic entertainment",shortDescription:"Comedy",author:"Fixture",lengthSeconds:"310"},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:"https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en",languageCode:"en"}]}}};</script>'});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    const options=await context.newPage();await options.goto('chrome-extension://'+id+'/src/options/options.html');
    await options.getByLabel('What do you want to learn?').fill('Learn AI');
    await options.getByLabel('OpenRouter API key',{exact:true}).fill('dummy-browser-key');
    await options.getByLabel('Enable daily analysis and silent automatic blocking').check();
    await options.getByRole('button',{name:'Save priorities'}).click();
    await expect(options.getByRole('status')).toHaveText('Priorities saved.');
    const watch=await context.newPage();await watch.goto('https://www.youtube.com/watch?v=abcdefghijk');
    await expect.poll(()=>options.evaluate(async()=>{const {analysisStore}=await import('../shared/storage.js');return (await analysisStore.listHistory({})).items[0]?.watchMs||0;}),{timeout:20000}).toBeGreaterThan(0);
    await options.evaluate(async()=>{
      const {analysisStore:api}=await import('../shared/storage.js');
      const sender={tabId:999,documentId:'seed'},cap=await api.beginCapture({senderIdentity:sender,videoId:'abcdefghijk',navigationId:'seed'});
      const start=Date.now()-1811000;
      for(let i=0;i<181;i++)await api.acceptCheckpoint({...cap,videoId:'abcdefghijk',navigationId:'seed',sequence:i+1,startedAt:start+i*10000,endedAt:start+(i+1)*10000,activeMs:10000,activeIntervals:[{wallStartMs:start+i*10000,wallEndMs:start+(i+1)*10000,mediaStartMs:0,mediaEndMs:10000}],mediaIntervals:[]},sender);
    });
    await options.getByRole('button',{name:'Analyze now'}).click();
    await expect.poll(()=>intercepted,{timeout:15000}).toBeGreaterThan(0);
    await expect(watch.locator('#movie_player')).toHaveCount(0,{timeout:15000});
    await options.getByLabel('Show',{exact:true}).selectOption('action');
    await options.getByRole('button',{name:'Refresh',exact:true}).nth(1).click();
    await expect(options.getByText('Status: applied',{exact:true})).toBeVisible();
    await options.getByRole('button',{name:'Unblock channel'}).click();
    await expect(options.getByRole('button',{name:'Unblocked',exact:true})).toBeVisible();
    await options.reload();await expect(options.getByLabel('OpenRouter API key',{exact:true})).toHaveValue('');
    await options.screenshot({path:'test-results/learning-settings.png',fullPage:true});
  }finally{await context.close();}
});
