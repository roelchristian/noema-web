// Synthetic disposable vault; no external AI calls or user data.
// Run after npm run build: node --import tsx scripts/check-entity-connections-browser.mjs.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const dir=await mkdtemp(join(tmpdir(),'noema-connections-'));
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/shared/entity-connections-evidence');await mkdir(artifacts,{recursive:true});
const db=openDatabase(join(dir,'db.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
const subject=knowledge.create('default',{name:'Synthetic Ada',type:'person',description:'Synthetic mathematician.'});
const peer=knowledge.create('default',{name:'Synthetic Papers',type:'creativework'});
knowledge.relationship('default',subject.id,{target_id:peer.id,label:'author of'});
knowledge.relationship('default',peer.id,{target_id:subject.id,label:'commemorates'});
const note=pages.create('default',{title:'Synthetic research notes'});
pages.update('default',note.id,{...note,blocks:[{id:'many',type:'paragraph',checked:false,content:Array.from({length:7},()=>[{text:'Read '},{entityId:subject.id,mentionText:'Synthetic Ada'},{text:'. '}]).flat()}]});
knowledge.associatePage('default',subject.id,note.id,{pinned:true,annotation:'Original annotation'});
const duplicateA=pages.create('default',{title:'Synthetic duplicate'}),duplicateB=pages.create('default',{title:'Synthetic duplicate'});
const refs=pages.create('default',{title:'Synthetic links'});
pages.update('default',refs.id,{...refs,blocks:[{id:'refs',type:'paragraph',checked:false,content:[{text:`[[page:${duplicateA.id}|Preserved display label]] and [[Synthetic duplicate]]`}]}]});
pages.update('default',duplicateA.id,{...pages.get('default',duplicateA.id),title:'Synthetic renamed destination'});
const server=createApp(store,resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}/?vault=default&view=entity&subject=${subject.id}`;
let browser;const errors=[],requests=[];
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',request=>{if(request.method()!=='GET')requests.push(request.url());});
 await page.goto(url);await page.locator('.entity-home h1').waitFor();
 assert.deepEqual(await page.locator('.eh-tabs [role=tab]').allTextContents(),['Overview','Connections','Evidence']);
 assert.equal(await page.locator('#entity-home-tab-edit').count(),0);
 await page.getByRole('tab',{name:'Connections',exact:true}).click();
 const panel=page.locator('#entity-home-panel-connections');
 assert.equal(await panel.locator('.eh-linked-page').count(),1);
 assert.match(await panel.locator('.eh-linked-page').innerText(),/Associated · 7 mentions · Featured/);
 // Both directed predicates contribute to a single target row.
 const entityRows=panel.locator('.entity-connection-list > li');assert.equal(await entityRows.count(),1);assert.match(await entityRows.innerText(),/Author of/i);assert.match(await entityRows.innerText(),/Incoming · commemorates/);
 await panel.getByText('View mentions',{exact:false}).click();assert.equal(await panel.locator('.eh-occurrences button').count(),7);
 await panel.getByRole('button',{name:'Unpin Synthetic research notes',exact:true}).click();
 assert.equal(knowledge.detail('default',subject.id).linkedPages[0].pinned,false);assert.equal(await panel.locator('.eh-linked-page').count(),1);
 await panel.getByRole('button',{name:'Remove association with Synthetic research notes',exact:true}).click();
 assert.equal(knowledge.detail('default',subject.id).linkedPages.length,0);assert.equal(await panel.locator('.eh-linked-page').count(),1);assert.match(await panel.locator('.eh-linked-page').innerText(),/7 mentions/);
 await panel.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(knowledge.detail('default',subject.id).linkedPages[0].annotation,'Original annotation');
 await panel.getByRole('button',{name:'Edit note',exact:true}).click();await panel.getByRole('textbox',{name:'Annotation for Synthetic research notes'}).fill('Retry annotation');
 await page.route('**/pages/'+note.id,route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic storage failure"}'}):route.continue());
 await panel.getByRole('button',{name:'Save note',exact:true}).click();await panel.getByRole('alert').filter({hasText:'Synthetic storage failure'}).waitFor();
 assert.equal(await panel.getByRole('textbox',{name:'Annotation for Synthetic research notes'}).inputValue(),'Retry annotation');await page.unroute('**/pages/'+note.id);
 await panel.getByRole('button',{name:'Save note',exact:true}).click();await panel.locator('.eh-annotation-form').waitFor({state:'hidden'});assert.equal(knowledge.detail('default',subject.id).linkedPages[0].annotation,'Retry annotation');
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByText('Identity and property details',{exact:true}).click();
 const name=page.getByRole('textbox',{name:'Entity name',exact:true});await name.fill('Unsaved synthetic name');
 await page.getByRole('tab',{name:'Connections',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();assert.equal(await name.inputValue(),'Unsaved synthetic name');
 await page.getByRole('tab',{name:'Connections',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Evidence',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:'Connections',exact:true}).click();const before=requests.length;await panel.getByRole('button',{name:'Find connections',exact:true}).click();await panel.locator('.eh-discovery').waitFor();assert.equal(requests.length,before,'Opening suggestion review must not generate or accept');
 await page.screenshot({path:join(artifacts,'desktop-connections.png'),fullPage:true});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark'}),touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(url);await touch.getByRole('tab',{name:'Connections',exact:true}).click();await touch.locator('#entity-home-panel-connections .eh-linked-page').waitFor();
 assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Mobile connections fit viewport');await touch.screenshot({path:join(artifacts,'mobile-dark-connections.png'),fullPage:true});
 // Page More keeps the common Connect picker, page targets, refresh event and Undo.
 await page.goto(`http://127.0.0.1:${server.address().port}/?vault=default&page=${note.id}`);await page.locator('#blocks').waitFor();
 const knowledgeToggle=page.getByRole('button',{name:'Show page knowledge',exact:true});if(await knowledgeToggle.getAttribute('aria-expanded')!=='true')await knowledgeToggle.click();
 await page.locator('.knowledge-note-links:not(.knowledge-related-notes)').waitFor();await page.evaluate(()=>{window.__pageConnectionEvents=[];window.addEventListener('noema:page-connections-changed',event=>window.__pageConnectionEvents.push(event.detail));});
 await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Connect…',exact:true}).click();
 const connect=page.getByRole('dialog',{name:'Connect',exact:true});await connect.getByRole('button',{name:'Connect Synthetic renamed destination',exact:true}).click();
 await connect.locator('[aria-label="Associated pages"]').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.__pageConnectionEvents.at(-1)),{vaultId:'default',pageId:note.id});
 await connect.getByRole('button',{name:'Done',exact:true}).click();await page.locator('.knowledge-note-links:not(.knowledge-related-notes)').getByRole('button',{name:/Synthetic renamed destination/}).waitFor();
 assert.match(await page.locator('.knowledge-note-links:not(.knowledge-related-notes)').innerText(),/Associated/);
 await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Connect…',exact:true}).click();await connect.locator('[aria-label="Associated pages"]').getByRole('button',{name:'Remove association',exact:true}).click();
 await connect.getByRole('button',{name:'Undo',exact:true}).click();await connect.locator('[aria-label="Associated pages"]').getByText('Synthetic renamed destination',{exact:true}).waitFor();await connect.getByRole('button',{name:'Done',exact:true}).click();
 await touch.goto(`http://127.0.0.1:${server.address().port}/?vault=default&page=${note.id}`);await touch.locator('#blocks').waitFor();await touch.getByRole('button',{name:'More page actions',exact:true}).tap();await touch.getByRole('menuitem',{name:'Connect…',exact:true}).tap();
 const mobileConnect=touch.getByRole('dialog',{name:'Connect',exact:true});await mobileConnect.getByRole('button',{name:'Connect Synthetic duplicate',exact:true}).tap();await mobileConnect.locator('[aria-label="Associated pages"]').getByText('Synthetic duplicate',{exact:true}).waitFor();assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await mobileConnect.getByRole('button',{name:'Done',exact:true}).tap();
 // Persisted inline ID stays fixed through rename; ambiguous legacy title cannot auto-navigate.
 await page.goto(`http://127.0.0.1:${server.address().port}/?vault=default&page=${refs.id}`);await page.locator(`#blocks [data-page-id="${duplicateA.id}"]`).waitFor();
 assert.equal(await page.locator(`#blocks [data-page-id="${duplicateA.id}"]`).innerText(),'Preserved display label');
 await page.locator(`#blocks [data-page-id="${duplicateA.id}"]`).click();await page.waitForFunction(id=>new URL(location.href).searchParams.get('page')===id,duplicateA.id);assert.equal(pages.get('default',duplicateA.id).title,'Synthetic renamed destination');
 // Restore the duplicate title pair for an explicit choice, without rewriting either legacy reference.
 pages.update('default',duplicateA.id,{...pages.get('default',duplicateA.id),title:'Synthetic duplicate'});
 await page.goto(`http://127.0.0.1:${server.address().port}/?vault=default&page=${refs.id}`);await page.locator('#blocks [data-page-title="Synthetic duplicate"]').click();
 assert.ok(page.url().includes(refs.id),'Ambiguous title keeps current page until a choice');
 const choices=page.getByRole('menuitem',{name:'Synthetic duplicate',exact:false});assert.ok(await choices.count()>=2,'Ambiguous destinations are offered explicitly');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:await browser.version(),passed:['three tabs and contextual identity editing','single target with directed relationship reasons','associated + featured + seven exact mention targets','unpin/remove preserves knowledge; Undo restores annotation','failed annotation save preserves draft and retries','draft continuity across tabs','keyboard tab selection','opening provisional suggestions performs no mutation','mobile dark viewport','page More Connect picker with page targets, inspector refresh event, association removal/Undo and mobile touch','stable ID rename retains label and target','ambiguous title requires explicit destination'],artifacts,errors}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();await rm(dir,{recursive:true,force:true});}
