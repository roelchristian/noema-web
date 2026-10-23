// Disposable synthetic vault, actual built application; provider/network requests forbidden.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import http from 'node:http';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createRuntime} from '../src/server/runtime.ts';
import {createTransportHandler} from '../src/server/transport.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>/^http:\/\/127\.0\.0\.1(?::|\/)/.test(String(input))?originalFetch(input,options):Promise.reject(new Error('External requests forbidden in fixture'));
const dir=await mkdtemp(join(tmpdir(),'noema-review-')),artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/review-centre-evidence');await mkdir(artifacts,{recursive:true});
const db=openDatabase(join(dir,'fixture.sqlite')),store=new Store(db);store.run('DELETE FROM pages');store.run('DELETE FROM entities');
let providerCalls=0;
const ai=new Intelligence({read:()=>null,write:()=>{},remove:()=>{}},async()=>{providerCalls++;throw new Error('Provider calls forbidden in fixture');});
const runtime=createRuntime(store,ai,{lan:false}),{knowledge,pages,scans,sourceFiles,sourceReprocessing}=runtime;
const entity=knowledge.create('default',{name:'Observatory research',type:'concept'});
let note=pages.create('default',{title:'Observatory notebook'});note=pages.update('default',note.id,{...note,blocks:[{id:'evidence',type:'paragraph',content:[{text:'Luma explored the observatory.'}]}]});
const file=sourceFiles.add('default','Observatory transcript.txt',Buffer.from('The star was brigbt.'));
const source=knowledge.create('default',{name:'Observatory transcript',type:'source',attachmentIds:[file.id]});
store.run("UPDATE source_files SET status='ready',text='The star was brigbt.',admitted=1,enrichment_status='completed' WHERE id=?",file.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);
const editorial=sourceReprocessing.start('default',file.id,{});editorial.status='completed';editorial.patches=[{id:'correction',nodeIds:[],range:{startOffset:13,endOffset:19},original:'brigbt',replacement:'bright',category:'ocr',reason:'Synthetic OCR correction',confidence:0.96,decision:'pending'}];editorial.report.finishedAt=new Date().toISOString();
store.run("UPDATE source_reprocessing SET status='completed',payload=? WHERE id=?",JSON.stringify(editorial),editorial.id);
const failedFile=sourceFiles.add('default','Interrupted transcript.txt',Buffer.from('Synthetic failed source'));
const failedSource=knowledge.create('default',{name:'Interrupted transcript',type:'source',attachmentIds:[failedFile.id]});store.run("UPDATE source_files SET status='ready',admitted=1,enrichment_status='failed' WHERE id=?",failedFile.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',failedSource.id);
const input=JSON.parse(scans.input('default',note));const run=input.untrusted_note.bodyTextRuns[0];
const scan=scans.save('default',note,JSON.stringify({suggestions:[{name:'Luma',type:'person',evidence:'Luma',runId:run.runId,evidenceStart:0,reason:'Named researcher in this saved page.',description:'Synthetic researcher.',subtypes:[],aliases:[],existingId:null}]}),{model:'fixture',reasoningEffort:'low'});
// Persist a valid stale discovery snapshot without generating anything.
const draft={id:'saved-discovery',entityId:entity.id,createdAt:new Date().toISOString(),overviewRevision:0,stale:true,model:'fixture',reasoningEffort:'low',evidence:[{id:'page:'+note.id,kind:'page',pageId:note.id,title:note.title,excerpt:'Luma explored the observatory.'}],suggestions:[{id:'synthesis',kind:'synthesis',status:'pending',content:'Research at the observatory.',rationale:'Synthetic saved proposal.',evidenceIds:['page:'+note.id]}]};
store.run('INSERT INTO entity_discoveries VALUES (?,?,?,?,?)',draft.id,entity.id,draft.createdAt,'old-evidence',JSON.stringify(draft));
const sockets=new Set(),server=http.createServer(createTransportHandler(runtime,resolve('dist/client'),sockets));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser,lastPage;const checks=[],errors=[],mutations=[];
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const base=`http://127.0.0.1:${server.address().port}`;
 async function launch(width){const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<750,hasTouch:width<750,reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());const page=await context.newPage();lastPage=page;page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&!/\/liturgical|notifications|\/reading-locations\//.test(r.url()))mutations.push(r.method()+' '+new URL(r.url()).pathname);});await page.goto(`${base}/?vault=default&view=review`);await ready(page);return {page,context};}
 async function ready(page){await page.getByRole('heading',{name:'Review Centre',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.review-centre')?.getAttribute('aria-busy')==='false');}
 async function back(page){await page.getByRole('button',{name:'Return to Review Centre',exact:true}).click();await ready(page);}
 async function screenshot(page,name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(artifacts,name+'.png'),fullPage:true});}
 const {page}=await launch(1440);
 assert.equal(await page.locator('.review-items li').count(),3);await screenshot(page,'review-desktop-decisions');checks.push('Read-only initial queue; scan, discovery and editorial origins');
 await page.getByRole('button',{name:'Open Observatory research',exact:true}).click();await page.getByRole('tab',{name:'Discovery',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'Discovery',exact:true}).getAttribute('aria-selected'),'true');await page.locator('.eh-discovery-warning').first().waitFor();
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Write overview',exact:true}).click();await page.getByLabel('Entity overview Markdown',{exact:true}).fill('Keep my unsaved synthesis.');await back(page);
 await page.getByRole('button',{name:'Open Observatory research',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();assert.equal(await page.getByLabel('Entity overview Markdown',{exact:true}).inputValue(),'Keep my unsaved synthesis.');await back(page);checks.push('Discovery deep link and stale warning, return');
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Open Observatory notebook',exact:true}).click();const dialog=page.getByRole('dialog',{name:/Entity review/});await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await back(page);}checks.push('Repeated scan open, Escape, return');
 await page.getByRole('button',{name:/Open Observatory transcript ·/}).click();await page.locator('.reprocessing-patch').waitFor();assert.match(await page.locator('.reprocessing-patch').first().innerText(),/brigbt/);await page.locator('.reprocessing-patch').getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Edit suggested replacement',{exact:true}).fill('brilliant');await back(page);
 await page.getByRole('button',{name:/Open Observatory transcript ·/}).click();await page.getByLabel('Edit suggested replacement',{exact:true}).waitFor();assert.equal(await page.getByLabel('Edit suggested replacement',{exact:true}).inputValue(),'brilliant');await back(page);checks.push('Exact source attachment/editorial run and replacement draft preservation');
 await page.getByRole('button',{name:/Failures and stale results/}).click();assert.equal(await page.locator('.review-items li').count(),1);await page.getByRole('button',{name:/Open Interrupted transcript ·/}).click();await page.locator('.source-reader').waitFor();await page.getByRole('button',{name:'Retry AI enrichment',exact:true}).waitFor();await back(page);assert.equal(await page.getByRole('button',{name:/Failures and stale results/}).getAttribute('aria-pressed'),'true');checks.push('Failure classification, source destination and filter preservation');
 await page.getByRole('button',{name:/Needs judgement/}).click();
 // Resolve before opening: queue must stay put and explain the transition.
 store.run("UPDATE page_ai_enrichments SET data=json_set(data,'$.scan.suggestions[0].status','accepted') WHERE page_id=?",note.id);
 await page.getByRole('button',{name:'Open Observatory notebook',exact:true}).click();await page.getByText(/This work changed or is no longer available/).waitFor();await ready(page);assert.equal(await page.getByRole('button',{name:'Open Observatory notebook',exact:true}).count(),0);checks.push('No-longer-pending safe fallback');
 // Interrupted validation must never navigate after leaving the queue.
 let release;await page.route('**/api/review-centre?id=*',async route=>{await new Promise(r=>release=r);await route.continue().catch(()=>{});});
 await page.getByRole('button',{name:'Open Observatory research',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.review-items button:disabled'));
 await page.getByRole('button',{name:'Recent items',exact:true}).click();release();await page.waitForTimeout(150);assert.match(page.url(),/view=recent/);await page.unroute('**/api/review-centre?id=*');checks.push('Interrupted validation cannot redirect later');
 await page.goto(`${base}/?vault=default&view=review`);await ready(page);
 await page.route('**/api/review-centre?offset=*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],errors:['discovery: saved status could not be loaded.'],more:[]})}));await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByRole('alert').filter({hasText:'discovery:'}).waitFor();await page.unroute('**/api/review-centre?offset=*');checks.push('Partial category failure');
 await page.context().setOffline(true);await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByRole('alert').filter({hasText:/offline/}).waitFor();await page.context().setOffline(false);await page.getByRole('button',{name:'Refresh status',exact:true}).click();await ready(page);checks.push('Offline and manual refresh recovery');
 const mobile=await launch(390);await screenshot(mobile.page,'review-mobile-decisions');
 const sizes=await mobile.page.locator('.review-centre button,.review-centre summary').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).map(n=>({label:n.textContent,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})));
 for(const size of sizes){assert.ok(size.height>=44&&size.width>=44,JSON.stringify(size));assert.ok(size.right<=390,JSON.stringify(size));}
 assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('390px mobile responsive layout and 44px targets');
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.equal(providerCalls,0);
 await writeFile(join(artifacts,'verification.json'),JSON.stringify({checks,errors,mutations,providerCalls},null,2));console.log(JSON.stringify({checks,artifacts,providerCalls},null,2));
} catch(error){if(lastPage)await lastPage.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally {globalThis.fetch=originalFetch;await browser?.close();await new Promise(r=>server.close(r));runtime.close();db.close();await rm(dir,{recursive:true,force:true});}
