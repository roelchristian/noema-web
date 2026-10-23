// Disposable synthetic vault only. Uses the existing optional Playwright harness.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-inbox-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/noema-inbox-evidence');await mkdir(artifacts,{recursive:true});
let db,server,vite,browser;const errors=[];
try {
 db=openDatabase(join(directory,'fixture.sqlite'));const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),organizer=new Organizer(store);
 store.run('DELETE FROM pages');
 const draft=pages.create('default',{title:'Untitled',blocks:[{id:'capture',type:'paragraph',checked:false,content:[{text:'A newly captured idea about making room for thoughtful work. This synthetic page is ready to organize.'}]}]});
 const reading=pages.create('default',{title:'Notes on a slower rhythm',blocks:[{id:'reading',type:'quote',checked:false,content:[{text:'A reading note keeps the passage and our response close together.'}]}]});
 store.run("INSERT INTO page_reading_notes VALUES (?, 'default', NULL, NULL, 'hash', 0, 4, 'text', '{}', '2026-10-23')",reading.id);
 const third=pages.create('default',{title:'Questions for the next project',blocks:[{id:'questions',type:'paragraph',checked:false,content:[{text:'What would make this useful every day?'}]}]});
 for(const page of [draft,reading,third])pages.update('default',page.id,{title:page.title,revision:page.revision,blocks:[{id:page.id+'-body',type:'paragraph',checked:false,content:[{text:page.id===draft.id?'A newly captured idea about making room for thoughtful work.':page.id===reading.id?'A reading note keeps the passage and our response close together.':'What would make this useful every day?'}]}]});
 const folder=organizer.saveFolder('default',{name:'Projects'}).folders[0].id;
 const collection=organizer.saveCollection('default',{name:'Working ideas'}).collections[0].id;
 server=createApp(store,join(repo,'dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 let previews=0;page.on('request',request=>{if(request.url().endsWith('/preview'))previews++;});
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
 await page.getByRole('button',{name:'Inbox',exact:true}).first().click();
 await page.getByRole('button',{name:'File…',exact:true}).waitFor();
 await page.getByRole('button',{name:'File…',exact:true}).isEnabled();
 await page.locator('.inbox-preview').waitFor();
 assert.equal(previews,1,'Queue fetches just the selected preview');
 await page.getByRole('combobox',{name:'Sort Inbox',exact:true}).click();
 await page.getByRole('option',{name:'Title · A–Z',exact:true}).click();
 await page.locator('.inbox-preview').waitFor();
 if(!process.env.NOEMA_SKIP_SCREENSHOTS)await page.screenshot({path:join(artifacts,'inbox-desktop.png')});
 // Folder picker cancellation preserves the current item and does not mutate.
 const selected=await page.locator('.inbox-detail h2').innerText();
 await page.getByRole('button',{name:'File…',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('.inbox-detail h2').innerText(),selected);
 // Add to collection leaves the page in the queue and retains its location.
 await page.getByRole('button',{name:'Add to collection…',exact:true}).click();
 await page.getByRole('combobox',{name:'Triage destination',exact:true}).click();await page.getByRole('option',{name:'Working ideas',exact:true}).click();
 await page.getByRole('button',{name:'Add to collection',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'}).catch(async error=>{console.error('DIALOG',await page.locator('dialog').innerText());throw error;});
 assert.equal(await page.locator('.inbox-detail h2').innerText(),selected);
 assert.equal(organizer.list('default').memberships.filter(item=>item.collection_id===collection).length,1);
 assert.equal(organizer.list('default').locations.length,0);
 // Recoverable Trash cancellation and success use the shell confirmation.
 await page.getByRole('button',{name:'Trash…',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.inbox-detail h2').innerText(),selected);
 // Failed filing and repeated clicks keep selection and issue only one write.
 let failedWrites=0;
 await page.route('**/api/organization/locations',async route=>{failedWrites++;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic filing failure'})});});
 await page.getByRole('button',{name:'File…',exact:true}).click();await page.getByRole('combobox',{name:'Triage destination',exact:true}).click();await page.getByRole('option',{name:'Projects',exact:true}).click();
 await page.getByRole('button',{name:'File',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByText('Synthetic filing failure',{exact:true}).waitFor();assert.equal(failedWrites,1);assert.equal(await page.locator('.inbox-detail h2').innerText(),selected);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.unroute('**/api/organization/locations');
 // Filing advances into the former successor, preserving collection membership.
 await page.getByRole('button',{name:'File…',exact:true}).click();await page.getByRole('combobox',{name:'Triage destination',exact:true}).click();await page.getByRole('option',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'File',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'}).catch(async error=>{console.error('DIALOG',await page.locator('dialog').innerText());throw error;});
 assert.notEqual(await page.locator('.inbox-detail h2').innerText(),selected);
 assert.equal(organizer.list('default').locations[0].folder_id,folder);assert.equal(organizer.list('default').memberships.filter(item=>item.collection_id===collection).length,1);
 // Batch toolbar remains available in triage.
 await page.locator('.inbox-queue input').first().check();await page.getByRole('toolbar',{name:'Selected page actions'}).waitFor();await page.getByRole('button',{name:'Clear',exact:true}).click();
 // Keep visits each page once and terminates without any persistent status write.
 await page.getByRole('button',{name:'Keep in Inbox',exact:true}).click();await page.getByRole('button',{name:'Keep in Inbox',exact:true}).click();
 await page.getByText('Session complete. Kept pages remain in Inbox.',{exact:true}).waitFor();assert.equal(pages.list('default').length,3);
 await page.getByRole('button',{name:'Review kept pages',exact:true}).click();await page.locator('.inbox-preview').waitFor();
 await page.getByRole('button',{name:'Keep in Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Trash…',exact:true}).click();await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'}).catch(async error=>{console.error('DIALOG',await page.locator('dialog').innerText());throw error;});assert.equal(pages.trash('default').length,1);await page.getByText('Session complete. Kept pages remain in Inbox.',{exact:true}).waitFor();
 // All existing layouts remain reachable.
 for(const name of ['List view','Compact view','Grid view','Triage view']){await page.getByRole('button',{name,exact:true}).click();}
 await page.locator('.inbox-preview').waitFor();
 // Mobile queue then detail, with actual target bounds and no horizontal overflow.
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('combobox',{name:'Sort Inbox',exact:true}).waitFor({state:'visible'});
 await page.evaluate(()=>window.scrollTo(0,0));
 if(!process.env.NOEMA_SKIP_SCREENSHOTS)await page.screenshot({path:join(artifacts,'inbox-mobile-queue.png')});
 await page.locator('.inbox-queue-row > button').first().click();await page.locator('.inbox-detail').waitFor({state:'visible'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const targets=await page.locator('.inbox-detail .button').evaluateAll(items=>items.filter(item=>item.getBoundingClientRect().height).map(item=>({text:item.textContent,width:item.getBoundingClientRect().width,height:item.getBoundingClientRect().height})));
 for(const target of targets)assert.ok(target.width>=44&&target.height>=44,JSON.stringify(target));
 if(!process.env.NOEMA_SKIP_SCREENSHOTS)await page.screenshot({path:join(artifacts,'inbox-mobile-detail.png')});
 await page.getByRole('button',{name:'Back to queue',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.matches('.inbox-queue-row button[aria-current]'));
 assert.deepEqual(errors,[]);await writeFile(join(artifacts,'validation.json'),JSON.stringify({browser:await browser.version(),previews,errors,targets,synthetic:true},null,2));console.log(JSON.stringify({passed:true,artifacts,previews,errors}));await context.close();
} finally {if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(resolve=>server.close(resolve));if(db)db.close();await rm(directory,{recursive:true,force:true});}
