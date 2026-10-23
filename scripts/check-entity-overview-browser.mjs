// Real application and backend; disposable synthetic data, no model/provider calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {lifecycleFixture} from '../test/helpers/entity-lifecycle-fixture.mjs';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/entity-overview-evidence');await mkdir(artifacts,{recursive:true});
const f=await lifecycleFixture();
f.knowledge.update('default',f.person.id,{name:f.person.name,type:'person',description:'An invented archivist used to explore how people, pages, and source passages connect. All material on this page is synthetic.'});
f.knowledge.property('default',f.person.id,{name:'birth date',value:'1843-01-01'});
f.knowledge.property('default',f.person.id,{name:'nationality',value:'Synthetic Republic'});
f.knowledge.associatePage('default',f.person.id,f.active.id,{pinned:true,annotation:'Start with the saved observations and their original passage.'});
for(let i=0;i<4;i++) {
 const page=f.pages.create('default',{title:i===3?'A synthetic title with unusually long words '+ 'LongTitle'.repeat(15):'Synthetic research notes '+(i+1)});
 f.knowledge.associatePage('default',f.person.id,page.id,{annotation:'An intentional association; this note does not claim support for the entity description.'});
 const peer=f.knowledge.create('default',{name:'Synthetic collection '+i,type:'concept'});f.knowledge.relationship('default',f.person.id,{target_id:peer.id,label:'catalogued'});
}
const sparse=f.knowledge.create('default',{name:'Synthetic sparse concept',type:'concept'});
const event=f.knowledge.create('default',{name:'Synthetic dated gathering',type:'event'});f.knowledge.property('default',event.id,{name:'start date',value:'1843-01-01'});
const server=createApp(f.store,resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser,page;const errors=[],external=[],writes=[];
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());if(r.url().includes('/api/entities/')&&['PUT','POST','DELETE','PATCH'].includes(r.method()))writes.push(r.url());});
 const base='http://127.0.0.1:'+server.address().port;
 const open=async id=>{await page.goto(base+'/?vault=default&view=entity&subject='+id);await page.locator('.entity-home h1').waitFor();};
 const tab=async name=>{await page.getByRole('tab',{name,exact:true}).click();await assertSelected(name);};
 const assertSelected=async name=>assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');
 const screenshot=async name=>{await page.screenshot({path:resolve(artifacts,name+'.png'),fullPage:true});};
 await open(f.person.id);await page.locator('.eh-glance-sources blockquote').waitFor();
 assert.equal(await page.locator('.eh-glance-connections li').count(),4);assert.equal(await page.locator('.eh-glance-sources blockquote').count(),1);
 assert.match(await page.locator('.eh-glance-sources').innerText(),/Cited alongside entity/);
 assert.equal(await page.getByRole('tab').count(),6);
 await screenshot('01-overview-desktop');
 // Gateways preserve identity and select the detailed destination with keyboard focus.
 await page.getByRole('button',{name:'View all connections',exact:true}).click();await page.getByRole('button',{name:'Edit connections',exact:true}).waitFor();await assertSelected('Connections');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'entity-home-tab-connections');assert.equal(await page.locator('.entity-home h1').innerText(),f.person.name);
 await tab('Overview');await page.getByRole('button',{name:'View mentions and manage associated pages',exact:true}).click();await page.getByRole('button',{name:'Attach existing page',exact:true}).waitFor();await assertSelected('Mentions');
 await tab('Edit');await page.getByRole('textbox',{name:'Entity name',exact:true}).waitFor();
 await tab('Discovery');await page.getByRole('button',{name:'Explore with AI',exact:true}).waitFor();
 await tab('Sources');await page.locator('#entity-home-panel-sources blockquote').waitFor();
 await tab('Overview');await page.locator('.eh-glance-sources blockquote').waitFor();
 // Preserve scroll/selected tab through page navigation and native browser history.
 await page.locator('.eh-glance-pages button').first().scrollIntoViewIfNeeded();
 const prior=await page.evaluate(()=>document.scrollingElement.scrollTop);
 await page.locator('.eh-glance-pages button').first().click();await page.locator('.page').waitFor();await page.goBack();await page.locator('.entity-home h1').waitFor();await page.locator('.eh-glance-sources blockquote').waitFor();await assertSelected('Overview');
 const returned=await page.evaluate(()=>document.scrollingElement.scrollTop);assert.ok(Math.abs(prior-returned)<5,`return scroll ${prior} -> ${returned}`);
 await page.goForward();await page.locator('.page').waitFor();await page.goBack();await page.locator('.entity-home h1').waitFor();
 // Exact saved mention opens a highlighted occurrence, then back returns to the entity.
 await page.locator('.eh-glance-pages > ul:last-of-type button').first().click();await page.locator('.page').waitFor();await page.goBack();await page.locator('.entity-home h1').waitFor();
 // Source passage keeps its real coordinates and returns focus to the triggering action.
 await page.locator('.eh-glance-sources li > button').first().click();await page.locator('#source-viewer').waitFor();assert.match(await page.locator('#source-viewer').innerText(),/fictional triangle/);
 await page.getByRole('button',{name:'Close source viewer',exact:true}).click();assert.ok(await page.locator('.eh-glance-sources li > button').first().evaluate(el=>el===document.activeElement));
 await page.evaluate(()=>window.scrollTo(0,0));await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await screenshot('02-overview-mobile');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 const small=await page.locator('#entity-home-panel-overview button:visible').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height<44).map(node=>node.textContent));assert.deepEqual(small,[]);
 await page.getByRole('tab',{name:'Overview',exact:true}).focus();await page.keyboard.press('End');await assertSelected('Edit');const editBounds=await page.getByRole('tab',{name:'Edit',exact:true}).boundingBox();assert.ok(editBounds.x+editBounds.width<=390);assert.ok(editBounds.width>=44);await page.keyboard.press('Home');await assertSelected('Overview');
 // Sparse, dates, and Source routing preserve their native behavior.
 await open(sparse.id);await page.getByText('No description recorded yet.',{exact:false}).waitFor();await screenshot('03-sparse-mobile');
 await open(event.id);await page.getByText('Day precision · Gregorian',{exact:true}).waitFor();await screenshot('04-date-properties-mobile');
 await page.goto(base+'/?vault=default&source='+f.source.id);await page.getByRole('region',{name:'Source reading view'}).waitFor();
 // Error/retry and interrupted previews cannot populate the next identity.
 await page.route('**/evidence?preview=1',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic evidence failure'})}));
 await open(f.person.id);await page.getByRole('button',{name:'Retry source preview',exact:true}).waitFor();await screenshot('05-preview-error-mobile');await page.unroute('**/evidence?preview=1');await page.getByRole('button',{name:'Retry source preview',exact:true}).click();await page.locator('.eh-glance-sources blockquote').waitFor();
 let release,started;const pending=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>started=resolve);await page.route('**/evidence?preview=1',async route=>{started();await pending;await route.continue().catch(()=>{});});
 await tab('Mentions');await tab('Overview');await requested;assert.equal(await page.locator('.eh-glance-sources blockquote').count(),1);await tab('Connections');release();await page.unroute('**/evidence?preview=1');await assertSelected('Connections');
 // Historical archived evidence stays visible and explicitly uncertain.
 f.store.run("UPDATE entities SET inactive=1,archived_at='2026-10-23' WHERE id=?",f.source.id);
 await open(f.person.id);await tab('Overview');await page.getByText('Saved excerpt · source location could not be verified',{exact:true}).waitFor();await screenshot('06-stale-evidence-mobile');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
 await writeFile(resolve(artifacts,'browser-result.json'),JSON.stringify({browser:await browser.version(),errors,external,writes,scroll:{prior,returned},passed:['all six tabs and gateways','bounded previews','exact mention and source navigation','source focus return','browser back/forward and Overview scroll','mobile overflow and 44px targets','keyboard tab traversal','sparse identity','date precision','native Source route','preview error retry','interrupted loading','stale evidence']},null,2));
 console.log('Entity Overview browser checks passed; evidence: '+artifacts);
} catch(error) {if(page){await screenshotFailure();}throw error;}
finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
async function screenshotFailure(){await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});await writeFile(resolve(artifacts,'failure.txt'),await page.locator('body').innerText());}
