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
import {proposeValue} from '../src/server/modules/property-provenance.ts';
import {AINotifications} from '../src/server/modules/ai-notifications.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
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
const notifications=new AINotifications(store);
const activityLog=new AIActivityLog(store,{recoverRunning:false}),runningId=activityLog.start('page_summary',{model:'fixture',reasoningEffort:'low'},'default',note.id);
const sockets=new Set(),server=http.createServer(createTransportHandler(runtime,resolve('dist/client'),sockets));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser,lastPage;const checks=[],errors=[],mutations=[];
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const base=`http://127.0.0.1:${server.address().port}`;
 async function launch(width){const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<750,hasTouch:width<750,reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());const page=await context.newPage();lastPage=page;page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&!/\/liturgical|notifications|\/reading-locations\//.test(r.url()))mutations.push(r.method()+' '+new URL(r.url()).pathname);});await page.goto(`${base}/?vault=default&view=review`);await ready(page);return {page,context};}
 async function ready(page){await page.getByRole('heading',{name:'Inbox',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.review-centre')?.getAttribute('aria-busy')==='false');}
 async function back(page){await page.getByRole('button',{name:'Return to Inbox',exact:true}).click();await ready(page);}
 async function screenshot(page,name){if(process.env.NOEMA_SKIP_SCREENSHOTS==='1')return;await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(artifacts,name+'.png'),fullPage:true});}
 store.run('DELETE FROM ai_notifications');notifications.record('default',note.id,'page_summary');notifications.recordSource('default',source.id,'failed','source_enrichment');
 const {page}=await launch(1440);
 // The bell now routes into the persistent Inbox facet, with no duplicate dialog.
 await page.getByRole('button',{name:/^Inbox Activity/}).focus();await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();assert.match(page.url(),/facet=activity/);
 assert.equal(await page.locator('#ai-notifications').count(),0);
 await page.locator('.ai-notification-list li').nth(1).waitFor();await page.getByRole('heading',{name:'In progress (1)',exact:true}).waitFor();
 for(let i=0;i<3;i++) {await page.getByRole('group',{name:'Inbox views'}).getByRole('button',{name:/^To review/}).click();await page.getByRole('group',{name:'Inbox views'}).getByRole('button',{name:/^Activity/}).click();}
 await page.getByRole('button',{name:'Failed / interrupted',exact:true}).click();await page.waitForTimeout(3200);assert.equal(notifications.list().unreadCount,2,'Failed filter must not read hidden successes');
 assert.equal(await page.locator('.ai-notification-list li').count(),1);
 await page.getByRole('button',{name:'Recent',exact:true}).click();await page.getByRole('button',{name:'Settings → AI',exact:true}).click();
 await page.getByRole('tab',{name:'AI',exact:true}).waitFor();await page.waitForTimeout(3200);assert.equal(notifications.list().unreadCount,2,'Settings suspends reading behind the modal');await page.keyboard.press('Escape');
 // Interrupt source lookup by changing facet before its entities refresh returns.
 let releaseEntity,enteredEntity;const entityRequest=new Promise(resolve=>enteredEntity=resolve);await page.route('**/api/entities',async route=>{await new Promise(resolve=>{releaseEntity=resolve;enteredEntity();});await route.continue().catch(()=>{});});
 await page.getByRole('button',{name:/^Source AI enrichment failed: Observatory transcript/}).click();
 await entityRequest;
 await page.getByRole('group',{name:'Inbox views'}).getByRole('button',{name:/^Issues/}).click();releaseEntity();await page.waitForTimeout(150);assert.match(page.url(),/facet=issues/);await page.unroute('**/api/entities');
 await page.getByRole('group',{name:'Inbox views'}).getByRole('button',{name:/^Activity/}).click();
 await page.getByRole('button',{name:/^Source AI enrichment failed: Observatory transcript/}).click();await page.locator('.source-reader').waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Added summary to Observatory notebook/}).click();await page.locator('.page').waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 // Replaced requests must not let an older feed overwrite the latest response.
 let enteredFeed,releaseFeed;const feedRequest=new Promise(resolve=>enteredFeed=resolve);let feedRequests=0;
 await page.route('**/api/intelligence/notifications',async route=>{feedRequests++;if(feedRequests===1){await new Promise(resolve=>{releaseFeed=resolve;enteredFeed();});await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],running:[],unreadCount:0,through:0})}).catch(()=>{});}else await route.continue();});
 await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await feedRequest;
 await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.locator('.ai-notification-list li').nth(1).waitFor();releaseFeed();await page.waitForTimeout(100);assert.equal(await page.locator('.ai-notification-list li').count(),2);await page.unroute('**/api/intelligence/notifications');
 // Feed failures preserve outcomes and retry recovers; an empty feed is distinct from an error.
 await page.route('**/api/intelligence/notifications',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic activity outage'})}));
 await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic activity outage'}).waitFor();assert.equal(await page.locator('.ai-notification-list li').count(),2);await page.unroute('**/api/intelligence/notifications');
 await page.getByRole('alert').getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});
 await page.route('**/api/intelligence/notifications',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],running:[],unreadCount:0,through:0})}));
 await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.getByText('No updates yet',{exact:true}).waitFor();await page.unroute('**/api/intelligence/notifications');await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.locator('.ai-notification-list li').nth(1).waitFor();
 await screenshot(page,'inbox-activity-desktop');
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.mode==='dark');await screenshot(page,'inbox-activity-mobile-dark');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const activityTargets=await page.locator('.inbox-activity button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).map(n=>({text:n.textContent,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
 for(const target of activityTargets)assert.ok(target.width>=44&&target.height>=44,JSON.stringify(target));
 activityLog.finish(runningId,'completed',200);checks.push('Inbox Activity: shortcut/deep link, repeated facets, active/completed/failed, read visibility, interrupted source lookup, source/page destinations, error/retry/empty, mobile dark targets');
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'light'});
 // Cross-vault outcomes retain their source/page destinations. A locked selection still has a useful shortcut.
 const other=runtime.vaults.create({name:'Synthetic activity vault'}),otherNote=pages.create(other.id,{title:'Cross-vault notebook'});
 const otherFile=sourceFiles.add(other.id,'Cross-vault source.txt',Buffer.from('Synthetic source text'));
 const otherSource=knowledge.create(other.id,{name:'Cross-vault source',type:'source',attachmentIds:[otherFile.id]});store.run("UPDATE source_files SET status='ready',text='Synthetic source text',admitted=1,enrichment_status='completed' WHERE id=?",otherFile.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',otherSource.id);
 notifications.record(other.id,otherNote.id,'page_summary');notifications.recordSource(other.id,otherSource.id,'completed');
 await page.goto(`${base}/?vault=default&view=inbox&facet=activity`);await page.getByRole('button',{name:/^Added summary to Cross-vault notebook/}).click();await page.waitForURL(url=>url.searchParams.get('vault')===other.id&&url.searchParams.get('page')===otherNote.id);await page.locator('.page').waitFor();
 await page.goto(`${base}/?vault=default&view=inbox&facet=activity`);await page.getByRole('button',{name:/^Source ready: Cross-vault source/}).click();await page.waitForURL(url=>url.searchParams.get('vault')===other.id&&url.searchParams.get('source')===otherSource.id);await page.locator('.source-reader').waitFor();
 store.run('UPDATE vaults SET locked=1 WHERE id=?','default');await page.goto(`${base}/?vault=default&view=inbox&facet=activity`);
 await page.getByRole('button',{name:/^Inbox Activity/}).click();await page.waitForURL(url=>url.searchParams.get('vault')===other.id&&url.searchParams.get('facet')==='activity');await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 store.run('UPDATE vaults SET locked=0 WHERE id=?','default');checks.push('Keyboard shortcut and locked-vault fallback; cross-vault page and source destinations');

 await page.goto(`${base}/?vault=default&view=review`);await ready(page);

 assert.equal(await page.locator('.review-items li').count(),3);await screenshot(page,'review-desktop-decisions');checks.push('Read-only initial queue; scan, discovery and editorial origins');
 await page.getByRole('button',{name:'Review discoveries: Observatory research',exact:true}).click();await page.getByRole('tab',{name:'Discovery',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'Discovery',exact:true}).getAttribute('aria-selected'),'true');await page.locator('.eh-discovery-warning').first().waitFor();
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Write overview',exact:true}).click();await page.getByLabel('Entity overview Markdown',{exact:true}).fill('Keep my unsaved synthesis.');await back(page);
 await page.getByRole('button',{name:'Review discoveries: Observatory research',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();assert.equal(await page.getByLabel('Entity overview Markdown',{exact:true}).inputValue(),'Keep my unsaved synthesis.');await back(page);checks.push('Discovery deep link and stale warning, return');
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Review entities: Observatory notebook',exact:true}).click();const dialog=page.getByRole('dialog',{name:/Entity review/});await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await back(page);}checks.push('Repeated scan open, Escape, return');
 await page.getByRole('button',{name:/Review corrections: Observatory transcript ·/}).click();await page.locator('.reprocessing-patch').waitFor();assert.match(await page.locator('.reprocessing-patch').first().innerText(),/brigbt/);await page.locator('.reprocessing-patch').getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Edit suggested replacement',{exact:true}).fill('brilliant');await back(page);
 await page.getByRole('button',{name:/Review corrections: Observatory transcript ·/}).click();await page.getByLabel('Edit suggested replacement',{exact:true}).waitFor();assert.equal(await page.getByLabel('Edit suggested replacement',{exact:true}).inputValue(),'brilliant');await back(page);checks.push('Exact source attachment/editorial run and replacement draft preservation');
 await page.getByRole('button',{name:/Issues/}).click();assert.equal(await page.locator('.review-items li').count(),1);await page.getByRole('button',{name:/Inspect source: Interrupted transcript ·/}).click();await page.locator('.source-reader').waitFor();await page.getByRole('button',{name:'Retry AI enrichment',exact:true}).waitFor();await back(page);assert.equal(await page.getByRole('button',{name:/Issues/}).getAttribute('aria-pressed'),'true');checks.push('Failure classification, source destination and filter preservation');
 await page.getByRole('button',{name:/To review/}).click();
 // Resolve before opening: queue must stay put and explain the transition.
 store.run("UPDATE page_ai_enrichments SET data=json_set(data,'$.scan.suggestions[0].status','accepted') WHERE page_id=?",note.id);
 await page.getByRole('button',{name:'Review entities: Observatory notebook',exact:true}).click();await page.getByText(/This work changed or is no longer available/).waitFor();await ready(page);assert.equal(await page.getByRole('button',{name:'Review entities: Observatory notebook',exact:true}).count(),0);checks.push('No-longer-pending safe fallback');
 // Interrupted validation must never navigate after leaving the queue.
 let release;await page.route('**/api/review-centre?id=*',async route=>{await new Promise(r=>release=r);await route.continue().catch(()=>{});});
 await page.getByRole('button',{name:'Review discoveries: Observatory research',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.review-items button:disabled'));
 await page.getByRole('button',{name:'Recent items',exact:true}).click();release();await page.waitForTimeout(150);assert.match(page.url(),/view=recent/);await page.unroute('**/api/review-centre?id=*');checks.push('Interrupted validation cannot redirect later');
 await page.goto(`${base}/?vault=default&view=review`);await ready(page);
 await page.route('**/api/review-centre?offset=*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],errors:['discovery: saved status could not be loaded.'],more:[]})}));await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'discovery:'}).waitFor();await page.unroute('**/api/review-centre?offset=*');checks.push('Partial category failure');
 await page.context().setOffline(true);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:/offline/}).waitFor();await page.context().setOffline(false);await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page);checks.push('Offline and manual refresh recovery');
 const mobile=await launch(390);await screenshot(mobile.page,'review-mobile-decisions');
 const sizes=await mobile.page.locator('.review-centre button,.review-centre summary').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).map(n=>({label:n.textContent,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})));
 for(const size of sizes){assert.ok(size.height>=44&&size.width>=44,JSON.stringify(size));assert.ok(size.right<=390,JSON.stringify(size));}
 assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('390px mobile responsive layout and 44px targets');
 // New saved workflows are navigated through the same actual client, without decisions in Inbox.
 const owner=knowledge.create('default',{name:'Synthetic proposal owner',type:'person'});
 for(let index=0;index<101;index++){const historical=proposeValue(store,'default',{entity_id:owner.id,origin:'ai',property_name:'website',value:'https://historical.example/'+index});store.run("UPDATE property_proposals SET status='accepted' WHERE id=?",historical.id);}
 const proposal=proposeValue(store,'default',{entity_id:owner.id,origin:'ai',property_name:'website',value:'https://selected.example'});
 const sourceProposal=proposeValue(store,'default',{entity_id:source.id,origin:'ai',property_name:'website',value:'https://source-proposal.example'});
 for(let index=0;index<23;index++){const person=knowledge.create('default',{name:'Synthetic temporal owner '+index,type:'person'});knowledge.property('default',person.id,{name:'birth date',value:'2026-10-23'});}
 while(store.get('SELECT 1 FROM temporal_property_dirty WHERE vault_id=?','default'))runtime.temporal.refresh('default');
 const selectedDate='gregorian:day:2026-10-23',selectedTemporal=runtime.temporal.detail('default',selectedDate,0,0,20,0,0,20).proposals[0];assert.ok(selectedTemporal);
 await page.goto(`${base}/?vault=default&view=inbox&facet=review`);await ready(page);
 await page.getByRole('button',{name:'Review proposal: Synthetic proposal owner',exact:true}).click();await page.locator('.property-proposal').filter({hasText:'https://selected.example'}).waitFor();assert.equal(await page.locator('.property-proposal').count(),1);assert.equal(await page.locator('.property-proposal').evaluate(element=>document.activeElement===element),true);await back(page);assert.equal(await page.getByRole('button',{name:/To review/}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Review proposal: Observatory transcript',exact:true}).click();await page.locator('#entity-panel .property-proposal').filter({hasText:'https://source-proposal.example'}).waitFor();await back(page);checks.push('Exact property proposal beyond historical list bound, entity and source reviewers, return facet');
 await page.getByRole('button',{name:`Review date: ${selectedTemporal.name}`,exact:true}).click();await page.locator('#calendar-date-heading').waitFor();const selectedRelation=page.locator('.calendar-relation[tabindex="-1"]');await selectedRelation.waitFor();assert.match(await selectedRelation.innerText(),new RegExp(selectedTemporal.name));assert.equal(await page.getByRole('button',{name:'Accept relationship',exact:true}).count(),21);await back(page);assert.equal(await page.getByRole('button',{name:/To review/}).getAttribute('aria-pressed'),'true');checks.push('Exact pending temporal relationship beyond first evidence page, selected Calendar date and return facet');
 assert.equal(store.get('SELECT status FROM property_proposals WHERE id=?',proposal.id).status,'pending');assert.equal(store.get('SELECT status FROM property_proposals WHERE id=?',sourceProposal.id).status,'pending');assert.equal(store.get('SELECT status FROM temporal_relations WHERE id=?',selectedTemporal.id).status,'pending');
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.equal(providerCalls,0);
 await writeFile(join(artifacts,'verification.json'),JSON.stringify({checks,errors,mutations,providerCalls},null,2));console.log(JSON.stringify({checks,artifacts,providerCalls},null,2));
} catch(error){if(lastPage&&process.env.NOEMA_SKIP_SCREENSHOTS!=='1')await lastPage.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally {globalThis.fetch=originalFetch;await browser?.close();await new Promise(r=>server.close(r));runtime.close();db.close();await rm(dir,{recursive:true,force:true});}
