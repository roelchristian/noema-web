// Real app and disposable vault; one mocked enrichment, no provider credentials.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {PageEnrichment} from '../src/server/modules/page-enrichment.ts';
import {Intelligence,intelligencePreferencesFor} from '../src/server/modules/intelligence.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const directory=await mkdtemp(join(tmpdir(),'noema-enrichment-browser-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-enrichment-evidence');await mkdir(artifacts,{recursive:true});
const db=openDatabase(join(directory,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages);
let browser,server;const errors=[],checks=[];let calls=0;
try {
 store.run("INSERT INTO embedding_settings(vault_id,automatic,min_characters) VALUES ('default',0,20) ON CONFLICT(vault_id) DO UPDATE SET automatic=0");
 const initial=pages.create('default',{title:'Chase observations'});
 const original='The larger dogs chase the smaller cats. These observations record the direction of the chase.';
 const blocks=[{id:'claim',type:'paragraph',content:[{text:original}]}];
 let page=pages.update('default',initial.id,{...initial,blocks});
 const generated='The larger dogs chase the smaller cats.';
 const coordinator=new PageEnrichment(store,pages,knowledge,enrichments,{enrichmentSelection:()=>({model:'mock-enrichment',reasoningEffort:'none'}),generatePageEnrichment:async()=>{calls++;return {summary:generated};}});
 await coordinator.run('default',page,undefined,{fields:['summary'],explicit:true});
 page=pages.update('default',page.id,{...page,blocks:[{...blocks[0],content:[{text:original.replace('larger dogs chase the smaller cats','smaller cats chase the larger dogs')}]}]});
 coordinator.configure('default',{automaticSummaries:false});coordinator.prepare('default',page.id,{fields:['summary']});
 const secrets={read:()=>null,write(){throw new Error('No credential writes');},remove(){}};
 const intelligence=new Intelligence(secrets,async()=>{throw new Error('Unexpected provider dispatch');},Date.now,intelligencePreferencesFor(store));
 server=createApp(store,resolve('dist/client'),intelligence);server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390])for(const mode of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:960}});await context.addInitScript(mode=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme:'ink'})),mode);
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const tab=await context.newPage();tab.setDefaultTimeout(15000);tab.on('pageerror',error=>errors.push(error.message));
  await tab.goto(`http://127.0.0.1:${server.address().port}/?vault=default&page=${page.id}`);
  await tab.getByRole('button',{name:'Show page knowledge',exact:true}).click();
  await tab.getByRole('status',{name:'Summary needs refresh',exact:true}).waitFor();
  assert.equal(await tab.locator('#knowledge-summary-text').innerText(),generated);
  assert.match(await tab.locator('.block-content').first().innerText(),/smaller cats chase the larger dogs/);
  await tab.screenshot({path:join(artifacts,`${mode}-${width}.png`)});
  checks.push({width,mode,previousSummaryRetained:true,refreshNeededVisible:true});await context.close();
 }
 assert.equal(calls,1);assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'validation.json'),JSON.stringify({checks,errors,mockedGenerationRequests:calls,liveProvider:false},null,2));
 console.log(JSON.stringify({artifacts,checks,errors}));
}finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());db.close();await rm(directory,{recursive:true,force:true});}
