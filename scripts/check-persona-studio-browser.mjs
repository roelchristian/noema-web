// Isolated real Settings component; browser API interception only. No credentials or provider network.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {defaultIntelligencePreferences,defaultPageEnrichmentPreferences} from '../src/shared/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-studio-browser-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-studio-evidence');let vite,browser;const errors=[],results=[];
try{
 await mkdir(artifacts,{recursive:true});await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<html><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
 await writeFile(join(directory,'fixture.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {IntelligenceSettings} from '/@fs/${repo}/src/client/settings/IntelligenceSettings.tsx';import '/@fs/${repo}/src/client/styles/tokens.css';import '/@fs/${repo}/src/client/styles.css';createRoot(document.querySelector('#root')).render(<main className="settings-dialog" style={{width:'100%',maxWidth:900,padding:16,boxSizing:'border-box'}}><IntelligenceSettings/></main>);`);
 vite=await createServer({cacheDir:join(directory,'vite-cache'),configFile:false,root:directory,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}},esbuild:{jsx:'automatic'}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const mode of ['light','dark'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const calls=[],writes=[];let fail=false,hold=false,release;
  let saved={...defaultIntelligencePreferences,personaId:'oxford_don',personaExpression:'expressive',manualRequestsPerMinute:120,pageEnrichment:defaultPageEnrichmentPreferences,configured:true,expiresAt:null};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   if(url.pathname==='/api/intelligence'&&request.method()==='GET')return json(saved);
   if(url.pathname==='/api/intelligence/preferences/ai'){const value=request.postDataJSON();writes.push(value);saved={...saved,...value};return json(saved);}
   if(url.pathname==='/api/intelligence/persona-preview'){
    const body=request.postDataJSON();calls.push(body);if(hold)await new Promise(resolve=>release=resolve);
    try{return fail?await json({error:'Synthetic preview interrupted'},502):await json({text:`Synthetic provider response for ${body.personaId}. An identity leaves each element unchanged.`,persona:{id:body.personaId,version:2,origin:'builtin',expression:body.personaExpression},modelSettings:body.modelSettings});}catch{return;}
   }
   throw new Error(`Unexpected API ${request.method()} ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);await page.evaluate(mode=>document.documentElement.dataset.mode=mode,mode);
  await page.getByRole('button',{name:'Choose writing style',exact:true}).click();const generate=page.getByRole('button',{name:'Generate comparison',exact:true});await generate.waitFor();assert.equal(calls.length,0);
  await generate.focus();await page.keyboard.press('Enter');await page.locator('.persona-studio-output').nth(1).waitFor();assert.equal(calls.length,2);assert.equal(calls[0].input,calls[1].input);assert.deepEqual(calls[0].modelSettings,calls[1].modelSettings);
  await page.getByRole('button',{name:'Just right',exact:true}).first().click();await page.getByRole('button',{name:'Use The Tutor as default',exact:true}).click();assert.equal(writes.length,0);
  await page.getByRole('button',{name:'Save AI preferences',exact:true}).click();await page.getByRole('status').filter({hasText:'AI preferences saved.'}).waitFor();assert.equal(saved.personaId,'tutor');
  const again=page.getByRole('button',{name:'Generate comparison again',exact:true});hold=true;await again.click();await page.getByRole('button',{name:'Cancel comparison',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel comparison',exact:true}).click();hold=false;release();await page.getByText('Cancelled. Dispatched provider outcome and charges may be unknown.',{exact:true}).first().waitFor();assert.equal(await page.locator('.persona-studio-output').count(),0);
  fail=true;await again.click();await page.getByRole('alert').filter({hasText:'Synthetic preview interrupted'}).first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Generate comparison again'&&!b.disabled));
  fail=false;await again.focus();await page.keyboard.press('Enter');await page.locator('.persona-studio-output').nth(1).waitFor();assert.ok(await again.evaluate(el=>el===document.activeElement),'Keyboard focus remains on repeated-run trigger');
  await page.locator('.persona-studio').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No narrow horizontal overflow');await page.screenshot({path:join(artifacts,`${mode}-${width}-studio.png`),fullPage:true});
  results.push({mode,width,explicitRequests:calls.length,identicalInputs:true,cancelErrorRepeat:true,keyboardFocus:true,defaultSaved:saved.personaId,horizontalOverflow:false});await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),results,errors},null,2));console.log(JSON.stringify({artifacts,results,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();await rm(directory,{recursive:true,force:true});}
