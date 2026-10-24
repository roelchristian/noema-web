// Disposable synthetic UI fixture: local browser requests only, no vault or AI provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),moduleId=resolve(repo,'__reprocessing-fixture.tsx');
const fixture=JSON.parse(readFileSync(resolve(repo,'test/fixtures/dante-editorial-revision.json'),'utf8'));
fixture.pipelineVersion=2;fixture.configuration={depth:'balanced',reviewPolicy:'verified',evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}};
fixture.status='failed';fixture.report.chunksTotal=3;fixture.report.chunksCompleted=1;fixture.report.error='Unsupported reasoning for the selected model.';fixture.report.errorCode='provider_http_400';
fixture.report.excerpts=[{index:0,startPage:1,endPage:2,status:'completed',attempts:1,durationMs:1800},{index:1,startPage:3,endPage:3,status:'failed',attempts:1,durationMs:500,error:'Unsupported reasoning',errorCode:'provider_http_400'},{index:2,startPage:4,endPage:4,status:'pending',attempts:0,durationMs:0}];
fixture.report.excerpts[0].passesCompleted=2;fixture.report.excerpts[0].requiredPassCount=2;fixture.report.excerpts[1].passesCompleted=1;fixture.report.excerpts[1].requiredPassCount=2;
fixture.report.model='gpt-5-mini';fixture.report.reasoningEffort='low';fixture.report.usageIncomplete=true;fixture.report.excerpts[0].history=[{model:'gpt-5-mini',reasoningEffort:'medium',startedAt:'2026-10-23T10:00:00Z',durationMs:1800}];
fixture.patches=fixture.patches.slice(0,2).map((patch,index)=>({...patch,id:'patch-'+index,decision:'pending'}));
fixture.reprocessed=structuredClone(fixture.original);
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/__reprocessing-fixture.tsx"></script></body></html>';
let vite,browser;
try {
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0},plugins:[{name:'synthetic-reprocessing-fixture',resolveId(id){return id==='/__reprocessing-fixture.tsx'?moduleId:null;},load(id){if(id!==moduleId)return;return `import React from 'react';import {createRoot} from 'react-dom/client';import {SourceReprocessing} from '/src/client/sources/SourceReprocessing.tsx';import '/src/client/styles/tokens.css';import '/src/client/styles.css';createRoot(document.querySelector('#root')).render(<main className="source-reader"><SourceReprocessing vaultId="synthetic" fileId="synthetic" visible onShow={()=>{}} onOriginal={()=>{}}/></main>);`;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__reprocessing-check')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,html));});}}]});
 await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const base=`http://127.0.0.1:${vite.httpServer.address().port}`,errors=[];
 for(const width of [1200,390]) {
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<750,hasTouch:width<750,reducedMotion:'reduce'});
  let revision=structuredClone(fixture);const mutations=[];
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let result;
   if(req.method()==='POST'){
    const body=req.postDataJSON();mutations.push({url:url.pathname,body});
    if(url.pathname.endsWith('/review'))revision={...revision,updatedAt:new Date().toISOString(),patches:revision.patches.map(patch=>{const change=body.decisions.find(item=>item.patchId===patch.id);return change?{...patch,decision:change.decision}:patch;})};
    result=revision;
   }else if(url.pathname==='/api/intelligence')result={model:'gpt-5-mini',reasoningEffort:'low'};
   else if(url.pathname.endsWith('/reprocessing'))result=[{...revision,patchCount:revision.patches.length,pendingCount:revision.patches.filter(patch=>patch.decision==='pending').length}];
   else if(url.pathname.endsWith('/status'))result={id:revision.id,status:revision.status,updatedAt:revision.updatedAt,...revision.report};
   else result=revision;
   await route.fulfill({json:result});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/__reprocessing-check');
  await page.getByRole('button',{name:'Review changes (2)',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Review changes (2)',exact:true}).getAttribute('aria-expanded'),'false');
  await page.locator('.reprocessing-processing-details > summary').click();
  await page.getByText('Check the model, supported reasoning and provider access in Settings → Intelligence before retrying. Completed suggestions remain available for review.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Reading version'}).locator('option').count(),2);
  assert.match(await page.locator('.reprocessing-stage-summary').innerText(),/Balanced Reconstruction.*Exactly 2 model requests/s);
  assert.equal(await page.locator('.reprocessing-ledger').getAttribute('open'),'');
  assert.match(await page.getByRole('list',{name:'Excerpt processing ledger'}).innerText(),/Excerpt 1[\s\S]*Completed[\s\S]*Excerpt 2[\s\S]*Failed[\s\S]*Unsupported reasoning[\s\S]*Excerpt 3[\s\S]*Not started/);
  assert.match(await page.getByRole('list',{name:'Excerpt processing ledger'}).innerText(),/Last attempt: GPT-5 Mini.*medium reasoning/);
  await page.locator('.reprocessing-report > summary').click();await page.getByText('Token totals are incomplete: some attempts did not report usage. Displayed counts include only reported usage.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Review changes (2)',exact:true}).click();await page.getByRole('button',{name:'Bulk review',exact:true}).click();
  await page.locator('.reprocessing-select input').first().check();await page.getByRole('button',{name:'Accept selected (1)',exact:true}).click();
  await page.getByRole('button',{name:'Accept selected (0)',exact:true}).waitFor();assert.deepEqual(mutations[0].body.decisions,[{patchId:'patch-0',decision:'accepted'}]);
  await page.getByRole('button',{name:'Close corrections',exact:true}).click();
  await page.getByRole('button',{name:'Reprocess with AI',exact:true}).click();
  await page.getByText('Supported reasoning: minimal, low, medium, high',{exact:true}).waitFor();
  assert.match(await page.locator('.reprocessing-configuration').innerText(),/low reasoning/);
  assert.equal(await page.getByRole('combobox',{name:'Processing depth',exact:true}).inputValue(),'balanced');
  assert.equal(await page.getByRole('combobox',{name:'Review policy',exact:true}).inputValue(),'verified');
  await page.getByRole('combobox',{name:'Processing depth',exact:true}).selectOption('light');
  assert.equal(await page.getByRole('combobox',{name:'Review policy',exact:true}).inputValue(),'verified');
  assert.equal(await page.getByRole('button',{name:'Start reprocessing',exact:true}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`No horizontal overflow at ${width}px`);
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('Source reprocessing browser checks passed: desktop/mobile V2 settings, pass ledger, failure recovery, review, configuration preview and overflow.');
}finally{await browser?.close();await vite?.close();}
