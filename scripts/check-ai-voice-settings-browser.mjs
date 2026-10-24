// Optional Chromium regression: real SettingsDialog, synthetic vault, mocked APIs.
// Run: node --import tsx scripts/check-ai-voice-settings-browser.mjs
// PLAYWRIGHT_MODULE may point to an external playwright-core installation.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {defaultIntelligencePreferences,defaultPageEnrichmentPreferences} from '../src/shared/intelligence.ts';
import {defaultNarrationPreferences} from '../src/shared/narration.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-settings-browser-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??join(tmpdir(),'noema-ai-voice-browser-artifacts'));
let vite,browser;
const errors=[],results=[];
const wav=Buffer.alloc(1644);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
async function choose(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
try {
 await mkdir(artifacts,{recursive:true});
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<html><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
 await writeFile(join(directory,'fixture.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsDialog} from '/@fs/${repo}/src/client/settings/SettingsDialog.tsx';import {defaultAppearance} from '/@fs/${repo}/src/client/settings/appearance.ts';import {defaultCalendarSettings} from '/@fs/${repo}/src/client/settings/calendar-settings.ts';import '/@fs/${repo}/src/client/styles/tokens.css';import '/@fs/${repo}/src/client/styles.css';const noop=()=>{},asyncNoop=async()=>{};createRoot(document.querySelector('#root')).render(<SettingsDialog appearance={defaultAppearance()} calendarSettings={defaultCalendarSettings()} vault={{id:'synthetic-vault',name:'Synthetic vault',locked:false}} storageError={false} onChange={noop} onCalendarSettingsChange={noop} onExitFocus={noop} onClose={noop} onChangePassphrase={asyncNoop} onBeforeNetworkChange={asyncNoop} onOpenPassage={asyncNoop} onOpenPage={asyncNoop} onOpenEntity={asyncNoop}/>);`);
 vite=await createServer({configFile:false,root:directory,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}},esbuild:{jsx:'automatic'}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const mode of ['light','dark']) {
  const context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce'});
  await context.addInitScript(mode=>{localStorage.setItem('noema.appearance.v1',JSON.stringify({mode}));},mode);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const requests=[],writes=[],previews=[];let finishPreview;
  let saved={...defaultIntelligencePreferences,personaId:'oxford_don',manualRequestsPerMinute:5,pageEnrichment:{...defaultPageEnrichmentPreferences},ttsEnabled:false,ttsProvider:'kokoro',ttsVoice:'puck',narration:structuredClone(defaultNarrationPreferences),configured:false,expiresAt:null};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname!=='127.0.0.1')return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   requests.push({path:url.pathname,method:request.method()});
   const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
   if(url.pathname==='/api/intelligence'&&request.method()==='GET')return json(saved);
   if(url.pathname==='/api/intelligence/speech/model')return json({ready:true,model:'kokoro-82m-v1.0',missingFiles:[],downloadCommand:'npm run tts:download'});
   if(url.pathname==='/api/intelligence/gemini')return json({configured:false,expiresAt:null});
   if(url.pathname==='/api/intelligence/preferences/ai'||url.pathname==='/api/intelligence/preferences/voice'){
    const body=request.postDataJSON();writes.push({category:url.pathname.endsWith('/ai')?'ai':'voice',body});saved={...saved,...body};return json(saved);
   }
   if(url.pathname==='/api/intelligence/speech/preview'){
    previews.push(request.postDataJSON());await new Promise(resolve=>{finishPreview=resolve;});
    try{return await route.fulfill({status:200,contentType:'audio/wav',body:wav});}catch{return;}
   }
   throw new Error('Unexpected API request '+request.method()+' '+url.pathname);
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
  await page.getByRole('tab',{name:'Voice',exact:true}).waitFor();
  await page.evaluate(mode=>document.documentElement.dataset.mode=mode,mode);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),mode);
  assert.equal(await page.locator('.settings-dialog').evaluate(element=>getComputedStyle(element).fontSize),'13px');
  assert.equal(requests.length,0,'Inactive AI and Voice do not initialize');
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#ai-tts-voice').disabled);
  assert.equal(await page.getByRole('tab',{name:'Voice',exact:true}).getAttribute('aria-controls'),'settings-panel-voice');
  assert.equal(await page.getByRole('tab',{name:'AI',exact:true}).getAttribute('aria-controls'),'settings-panel-intelligence');
  await choose(page,'Voice','Echo');await choose(page,'Reading pace','Slower · deliberate');
  assert.equal(await page.locator('#narration-preset').count(),0,'Unsupported Kokoro delivery controls are omitted');
  await page.getByRole('tab',{name:'AI',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('#ai-model'));
  await choose(page,'Writing model','GPT-6 Luna');
  await page.getByRole('button',{name:'Save AI preferences',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ai-preferences-form button[type=submit]')?.disabled??[...document.querySelectorAll('.ai-preferences-form button')].some(button=>button.textContent==='Save AI preferences'&&button.disabled));
  assert.equal(writes.length,1);assert.equal(writes[0].category,'ai');assert.equal(writes[0].body.model,'gpt-6-luna');assert.ok(!('ttsVoice' in writes[0].body));assert.equal(saved.ttsVoice,'puck');
  await page.screenshot({path:join(artifacts,mode+'-ai.png')});
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  assert.equal(await page.locator('#ai-tts-voice').inputValue(),'echo');assert.equal(await page.locator('#narration-pace').inputValue(),'0.75');
  await page.getByRole('button',{name:'Listen to sample',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.voice-settings [aria-label="Narration preview"]')||[...document.querySelectorAll('button')].some(button=>button.textContent==='Cancel preview'));
  assert.equal(previews.length,1);assert.equal(previews[0].voice,'echo');assert.equal(previews[0].narration.pace,0.75);assert.equal(saved.ttsVoice,'puck');
  await page.getByRole('tab',{name:'AI',exact:true}).click();finishPreview();
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Listen to sample'&&!button.disabled));
  assert.equal(await page.locator('.voice-settings audio').count(),0,'Inactive preview result is discarded');
  await page.getByRole('button',{name:'Save voice preferences',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Save voice preferences'&&button.disabled));
  assert.equal(writes.length,2);assert.equal(writes[1].category,'voice');assert.equal(writes[1].body.ttsVoice,'echo');assert.ok(!('model' in writes[1].body));assert.equal(saved.model,'gpt-6-luna');
  await choose(page,'Speech provider','Gemini · Cloud');
  assert.match(await page.locator('#ai-tts-description').textContent(),/Google.*API charges/);
  await page.getByRole('button',{name:'Browse all voices',exact:true}).click();await page.getByRole('searchbox',{name:'Search voices',exact:true}).fill('kore');
  await choose(page,'Voice','Kore');
  assert.equal(saved.ttsProvider,'kokoro','Browsing cloud voices never saves them');
  await page.screenshot({path:join(artifacts,mode+'-voice.png')});
  results.push({mode,requests:requests.length,writes:writes.map(write=>write.category),previewProvider:previews[0].provider,previewVoice:previews[0].voice});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),results,errors},null,2));
 console.log(JSON.stringify({browser:await browser.version(),results,artifacts,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();await rm(directory,{recursive:true,force:true});}
