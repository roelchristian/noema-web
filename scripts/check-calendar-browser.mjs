import {selectionOffsets} from './browser-selection.mjs';
import {readFileSync} from 'node:fs';
import {liturgicalCalendars,liturgicalKey} from '../src/shared/liturgical.ts';
import {normalizeLitcal} from '../src/server/modules/liturgical-providers.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
// Real application, disposable synthetic vault, local-only network, no provider calls.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-calendar-browser-')),artifacts=resolve(process.env.NOEMA_SCREENSHOTS??join(directory,'screenshots'));
await mkdir(artifacts,{recursive:true});
const originalFetch=globalThis.fetch;
let db,server,vite,browser,lastPage;const errors=[],checks=[];
const block=(id,text)=>({id,type:'paragraph',checked:false,content:[{text}]});
 async function screenshot(page,name){if(process.env.NOEMA_SKIP_SCREENSHOTS==='1')return;await page.screenshot({path:join(artifacts,name+'.png')});}
try {
 db=openDatabase(join(directory,'fixture.sqlite'));const store=new Store(db),vault=new Vaults(store).create({name:'Calendar studio'}),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),index=new TemporalIndex(store);
 function note(title,blocks){let page=pages.create(vault.id,{title});return pages.update(vault.id,page.id,{...page,blocks});}
 const working=note('Project notebook',[{...block('work',''),content:[{text:'Our 😀 é project milestone is '},{text:'23 October ',bold:true},{text:'2026',italic:true},{text:'. Keep the original context close.'}]},block('next','Reading notes from October 2026, collected in 2026.')]);
 note('Reading journal',[block('reading','On 12 October 2026, I returned to these research notes.'),block('incidental','A bibliographical reference to 13 October 2026. A numeric expression 03/04/2026 remains unresolved.')]);
 note('Collected evidence',Array.from({length:24},(_,i)=>block('evidence'+i,`Reference ${i+1}: 12 October 2026. A synthetic passage for navigation testing.`)));
 let historical=note('Historical context',[block('historical','The notes discuss 27 October 2026 in a historical comparison.')]);
 const old=index.pageEvidence(vault.id,historical.id)[0],event=knowledge.create(vault.id,{name:'Research discussion',type:'event'});index.relate(vault.id,old.dateId,{entityId:event.id,mentionId:old.id,kind:'discusses'});
 historical=pages.update(vault.id,historical.id,{...historical,blocks:[block('replacement','The discussion was revised to 28 October 2026.')]});
 for(const [value,label,layer] of [['2026-10-12','Reading notes','knowledge'],['2026-10-23','Project milestone','personal'],['2026-10-27','Historical comparison','historical'],['2026-10','October research','knowledge'],['2026','A year of ideas','knowledge']])index.curate(vault.id,value,{label,layer,pinned:value.endsWith('23'),annotation:value.endsWith('23')?'A meaningful checkpoint, connected to the original notebook.':''});
 index.curate(vault.id,'2026-10-23',{label:'Julian checkpoint',layer:'historical'},'julian');
 const authoredEvent=knowledge.create(vault.id,{name:'Native structured assertion',type:'event'});knowledge.property(vault.id,authoredEvent.id,{name:'start date',value:'2026-10-30',definition_id:'builtin:event:start_date'});
 const sourceText='On 23 October 2026 first. Again on 23 October 2026 second.';
 const sourceFile=new SourceFiles(store).add(vault.id,'Calendar source.txt',Buffer.from(sourceText));const source=knowledge.create(vault.id,{name:'Synthetic calendar source',type:'source',attachmentIds:[sourceFile.id]});
 store.run("UPDATE source_files SET text=?,status='ready',admitted=1 WHERE id=?",sourceText,sourceFile.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);new SourcePassages(store,text=>text.length).synchronize(vault.id);
 const typedEvent=knowledge.create(vault.id,{name:'Typed date proposal',type:'event'});knowledge.property(vault.id,typedEvent.id,{name:'start date',value:'2026-10-29'});
 index.refresh(vault.id);
 // Public-calendar fixtures keep this browser script local-only, including background preloads.
 for(const calendar of liturgicalCalendars)for(const year of [2025,2026,2027]) {
  const days={};for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1))days[date.toISOString().slice(0,10)]={principal:{id:'fixture_weekday',name:'Synthetic weekday',rank:'WEEKDAY',rankName:'Weekday',seasons:[],colors:[],optional:false},alternatives:[]};
  const data=calendar.id==='grc-en'&&year===2026?normalizeLitcal(JSON.parse(readFileSync(join(repo,'test/fixtures/liturgical/litcal-2026.json'),'utf8')),year,calendar.id):{year,providerKey:liturgicalKey(calendar.id),providerVersion:'fixture',dataVersion:'fixture',generatedAt:new Date().toISOString(),days};
  store.run('INSERT OR REPLACE INTO liturgical_calendar_cache VALUES (?,?,?,?,?,?)',calendar.id,year,liturgicalKey(calendar.id),JSON.stringify(data),data.generatedAt,data.generatedAt);
 }
 globalThis.fetch=(input,options)=>String(input).startsWith('https://')?Promise.reject(new Error('External requests are disabled in browser fixtures')):originalFetch(input,options);
 async function calendarSetting(target,label,checked){await target.getByRole('button',{name:'Calendar settings',exact:true}).click();await target.getByLabel(label,{exact:true}).setChecked(checked);await target.getByRole('button',{name:'Done',exact:true}).click();}
 server=createApp(store,join(repo,'dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 async function context(width) {const context=await browser.newContext({viewport:{width,height:1040},isMobile:width<750,hasTouch:width<750,reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());const page=await context.newPage();lastPage=page;page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));return {context,page};}
 async function ready(page) {await page.locator('.calendar-month-title h1').waitFor();await page.locator('.calendar-grid').waitFor();await page.waitForFunction(()=>document.querySelector('.calendar-grid')?.getAttribute('aria-busy')==='false');await page.evaluate(()=>document.fonts.ready);}
 // Presentation changes must retain the exact temporal occurrence and viewer node.
 async function sourcePresentation(page) {
  const viewer=page.locator('#source-viewer'),original=await viewer.evaluateHandle(node=>node);
  const excerpt=await viewer.locator('mark').first().textContent();
  await viewer.getByRole('button',{name:'Subtle references',exact:true}).click();
  assert.equal(await viewer.getByRole('button',{name:'Subtle references',exact:true}).getAttribute('aria-pressed'),'true');
  await viewer.getByRole('button',{name:'Focus mode',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.focusWorkspace==='true'&&document.documentElement.dataset.focusTarget==='source-viewer');
  assert.equal(await viewer.evaluate(node=>Math.round(node.getBoundingClientRect().width)),page.viewportSize().width);
  await page.locator('.focus-controls .presentation-focus').click();
  await page.waitForFunction(()=>document.documentElement.dataset.focusWorkspace==='false');
  assert.equal(await viewer.evaluate((node,original)=>node===original,original),true);
  assert.equal(await viewer.locator('mark').first().textContent(),excerpt);
  await viewer.getByRole('button',{name:'Focus mode',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.documentElement.dataset.focusWorkspace==='false');
  assert.equal(await viewer.getByRole('button',{name:'Subtle references',exact:true}).getAttribute('aria-pressed'),'true');
  await viewer.getByRole('button',{name:'Subtle references',exact:true}).click();
  await original.dispose();
 }
 async function targetSizes(page,selector) {const sizes=await page.locator(selector).evaluateAll(elements=>elements.filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.width&&r.height;}).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')??e.textContent.trim().slice(0,40),width:r.width,height:r.height,left:r.left,right:r.right};}));for(const size of sizes){assert.ok(size.width>=43.9&&size.height>=43.9,JSON.stringify(size));assert.ok(size.left>=-.1&&size.right<=page.viewportSize().width+.1,JSON.stringify(size));}return sizes;}
 const desktop=await context(1440),page=desktop.page;await page.goto(`${base}/?vault=${vault.id}&view=calendar`);await ready(page);
 assert.equal(await page.getByRole('combobox',{name:'Calendar content',exact:true}).inputValue(),'linked');
 assert.equal(await page.locator('.calendar-periods .calendar-entry').count(),2);assert.equal((await page.locator('[data-date="2026-10-01"]').textContent()).trim(),'1');
 await targetSizes(page,'.calendar-main button,.calendar-main label.calendar-filter-toggle');await screenshot(page,'calendar-desktop-month');checks.push('Curated-first month, coarse periods outside exact day cells, 44px controls');

 // Same civil label retains independent calendar identity, curation, and drafts.
 assert.equal(store.get("SELECT status FROM temporal_relations WHERE entity_id=? AND property_id IS NOT NULL",authoredEvent.id).status,'accepted');
 await page.locator('[data-date="2026-10-23"]').click();await page.getByLabel('Notes',{exact:true}).fill('Gregorian identity draft');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await page.getByRole('combobox',{name:'Civil calendar',exact:true}).selectOption('julian');await ready(page);await page.locator('[data-date="2026-10-23"]').click();await page.getByLabel('Title',{exact:true}).waitFor();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Julian checkpoint');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'');await page.getByLabel('Notes',{exact:true}).fill('Julian identity draft');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await page.getByRole('combobox',{name:'Civil calendar',exact:true}).selectOption('gregorian');await ready(page);await page.locator('[data-date="2026-10-23"]').click();assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Gregorian identity draft');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await page.getByRole('combobox',{name:'Civil calendar',exact:true}).selectOption('julian');await ready(page);await page.locator('[data-date="2026-10-23"]').click();assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Julian identity draft');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await page.getByRole('combobox',{name:'Civil calendar',exact:true}).selectOption('gregorian');await ready(page);
 checks.push('Gregorian/Julian identical civil labels retain independent drafts and curation; explicit native typed property is accepted server-side');
 await page.locator('.calendar-periods > summary').filter({hasText:'Open a date or historical period'}).click();
 for(const [expression,id,label] of [['44 BCE','gregorian:year:-0044','44 BCE'],['circa 1815','gregorian:year:~1815','circa 1815'],['19th century','gregorian:century:C19','19th century'],['1815/1816','gregorian:interval:1815/1816','1815 – 1816']]) {
  await page.getByRole('textbox',{name:'Date or period',exact:true}).fill(expression);await page.getByRole('button',{name:'Open date',exact:true}).click();await page.locator(`.calendar-inspector .date-overview[data-date-id="${id}"]`).waitFor();assert.match(await page.locator('.calendar-inspector .date-overview').innerText(),new RegExp(label));assert.equal(await page.locator('.calendar-month-title h1').innerText(),'October 2026');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 }
 await page.locator('.calendar-periods > summary').filter({hasText:'Open a date or historical period'}).click();checks.push('BCE, approximation, century and bounded interval open canonical Date Overview without inventing an exact day or invalid grid month');

 // New month controls, persisted layout preferences and container-aware inspector.
 async function layoutPreferences(start,weeks) {
  await page.getByRole('button',{name:'Calendar settings',exact:true}).click();
  await page.getByRole('combobox',{name:'Start week on',exact:true}).click();await page.getByRole('option',{name:start?'Monday':'Sunday',exact:true}).click();
  await page.getByLabel('Show civil week numbers',{exact:true}).setChecked(weeks);
  await page.getByRole('button',{name:'Done',exact:true}).click();await ready(page);
 }
 async function jump(month,year){await page.getByRole('button',{name:'Go to month',exact:true}).click();await page.locator('#calendar-jump-form').getByLabel('Month',{exact:true}).selectOption(month);await page.locator('#calendar-jump-form').getByLabel('Year',{exact:true}).fill(year);await page.locator('#calendar-jump-form').getByRole('button',{name:'Go',exact:true}).click();await ready(page);}
 await page.getByRole('button',{name:'Go to month',exact:true}).click();await page.locator('#calendar-jump-form').getByLabel('Year',{exact:true}).fill('0');await page.locator('#calendar-jump-form').getByRole('button',{name:'Go',exact:true}).click();await page.getByText('Enter a year from 1 to 9999.',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#calendar-jump-form').count(),0);
 for(const start of [0,1]) {
  await layoutPreferences(start,true);
  assert.equal(await page.locator('.calendar-weekdays [role=columnheader]').nth(1).innerText(),start?'Mon':'Sun');
  await page.locator('[data-date="2026-10-23"]').focus();await page.keyboard.press('Home');await page.waitForFunction(date=>document.activeElement.dataset.date===date,start?'2026-10-19':'2026-10-18');
  await page.keyboard.press('End');await page.waitForFunction(date=>document.activeElement.dataset.date===date,start?'2026-10-25':'2026-10-24');
  await jump('01','2021');assert.match(await page.locator('.calendar-week-number').first().getAttribute('title'),start?/2020-W53/:/2021-W01/);
  if(start===0)assert.match(await page.locator('#calendar-week-help').innerText(),/Week 1 contains 1 January/);
  await page.locator('[data-date="2021-01-01"]').focus();await page.keyboard.press('Home');await page.waitForFunction(date=>document.activeElement.dataset.date===date,start?'2020-12-28':'2020-12-27');
  await page.keyboard.press('End');await page.waitForFunction(date=>document.activeElement.dataset.date===date,start?'2021-01-03':'2021-01-02');
  await jump('10','2026');
 }
 await page.reload();await ready(page);assert.equal(await page.locator('.calendar-weekdays [role=columnheader]').nth(1).innerText(),'Mon');assert.ok(await page.locator('.calendar-week-number').count()>0);await layoutPreferences(0,false);
 await page.locator('[data-date="2026-10-23"]').click();await page.getByLabel('Notes',{exact:true}).fill('Resize draft');await page.getByLabel('Notes',{exact:true}).evaluate(input=>{input.focus();input.setSelectionRange(2,5);});
 for(const width of [900,751,1100,1440]) {
  await page.setViewportSize({width,height:1040});
  await page.waitForFunction(modal=>!!document.querySelector('.calendar-sheet[open]')===modal,width<1288);
  assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Resize draft');
  await page.waitForFunction(()=>document.activeElement.id==='calendar-annotation');
  assert.deepEqual(await page.getByLabel('Notes',{exact:true}).evaluate(input=>[input.selectionStart,input.selectionEnd]),[2,5]);
  await targetSizes(page,'.calendar-main button,.calendar-main label.calendar-filter-toggle');
 }
 await page.getByRole('button',{name:'Next month',exact:true}).click();await ready(page);await page.getByRole('button',{name:'Show selected date',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Resize draft');
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 let releaseRefresh,refreshSeen;const heldRefresh=new Promise(resolve=>releaseRefresh=resolve),seenRefresh=new Promise(resolve=>refreshSeen=resolve);
 await page.route('**/api/temporal/dates?*',async route=>{refreshSeen();await heldRefresh;await route.continue();});await page.getByRole('button',{name:'Refresh calendar',exact:true}).click();await seenRefresh;
 assert.equal(await page.locator('.calendar-grid').getAttribute('aria-busy'),'true');assert.match(await page.locator('[data-date="2026-10-23"]').getAttribute('aria-label'),/Project milestone/);releaseRefresh();await ready(page);await page.unroute('**/api/temporal/dates?*');
 checks.push('Both persisted week starts, civil week-year boundaries, jump validation, modal resize with draft/caret, selected-date return and stable refresh');
 await page.locator('[data-date="2026-10-23"]').click();await page.getByLabel('Title',{exact:true}).waitFor();await screenshot(page,'calendar-desktop-inspector');
 await page.getByLabel('Notes',{exact:true}).fill('An unsaved curation draft stays with the date.');
 await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.locator('.calendar-evidence .calendar-evidence-link').first().click();await page.locator('#page-title').waitFor();await page.locator('.page-search-passage').waitFor();
 await page.getByRole('button',{name:'Return to Calendar',exact:true}).click();await ready(page);await page.getByRole('button',{name:'Overview',exact:true}).click();assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'An unsaved curation draft stays with the date.');
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Date details saved.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await page.getByRole('combobox',{name:'Calendar content',exact:true}).selectOption('all');await ready(page);await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-13"]')?.getAttribute('aria-label').includes('occurrence'));
 await page.getByRole('combobox',{name:'Calendar content',exact:true}).selectOption('linked');await ready(page);
 await page.locator('.calendar-facets > summary').click();await targetSizes(page,'.calendar-facets label.calendar-filter-toggle');await page.getByLabel('Personal',{exact:true}).uncheck();await page.waitForFunction(()=>!document.querySelector('[data-date="2026-10-23"]')?.textContent.includes('Project milestone'));await page.getByLabel('Personal',{exact:true}).check();await ready(page);await page.locator('.calendar-facets > summary').click();
 await page.getByRole('button',{name:'Agenda',exact:true}).click();await page.locator('.calendar-agenda').waitFor();await screenshot(page,'calendar-desktop-agenda');await page.getByRole('button',{name:'Month',exact:true}).click();await page.locator('.calendar-periods .calendar-entry').filter({hasText:'October research'}).click();await page.getByText('month precision · no exact day assigned',{exact:true}).waitFor();await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await page.locator('[data-date="2026-10-12"]').click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByRole('button',{name:'Load more references',exact:true}).waitFor();assert.equal(await page.locator('.calendar-evidence .calendar-evidence-link').count(),20);await page.getByRole('button',{name:'Load more references',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-evidence .calendar-evidence-link').length===25);checks.push('Inspector evidence pagination and curation draft retained across repeated evidence navigation');
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await page.locator('[data-date="2026-10-27"]').click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByText('Stale evidence',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Open supporting passage',exact:true}).count(),0);await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 // Error/retry, then an interrupted evidence request must never navigate late.
 let fail=true;await page.route('**/api/temporal/dates/gregorian%3Aday%3A2026-10-23?*',route=>fail?(fail=false,route.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic interrupted request"}'})):route.continue());
 await page.locator('[data-date="2026-10-23"]').click();await page.getByRole('button',{name:'Retry date',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.locator('.calendar-evidence .calendar-evidence-link').first().waitFor();
 let release;const held=new Promise(resolve=>release=resolve);let seen;const requested=new Promise(resolve=>seen=resolve);
 await page.route('**/api/temporal/mentions/*',async route=>{seen();await held;try{await route.continue();}catch{/* Aborted on workspace navigation. */}});
 await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.locator('.calendar-evidence .calendar-evidence-link').first().click();await requested;await page.getByRole('button',{name:'Pages',exact:true}).first().click();release();await page.locator('.calendar-workspace').waitFor({state:'detached'});await page.waitForTimeout(150);assert.equal(await page.locator('#page-title').count(),0);await page.unroute('**/api/temporal/mentions/*');checks.push('Stale evidence, interrupted request, error/retry and no late evidence navigation');
 // A draft and its exact caret survive save-flushing Calendar transitions and history.
 await page.goto(`${base}/?vault=${vault.id}&page=${working.id}`);const content=page.locator('[data-block-id="work"] .block-content');await content.waitFor();await content.locator('[data-note-date]').first().waitFor();await content.evaluate(e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});await page.keyboard.type(' Draft retained.');
 const expected=await content.textContent();await page.getByRole('button',{name:'Calendar',exact:true}).click();await ready(page);await page.goBack();await content.waitFor();assert.equal(await content.textContent(),expected);
 await page.waitForFunction(()=>getSelection()?.anchorNode?.parentElement?.closest('[data-block-id]')?.dataset.blockId==='work');assert.deepEqual(await content.evaluate(selectionOffsets),{anchor:expected.length,focus:expected.length});
 // Repeat with a backward selection across formatting/date nodes, then an interior
 // caret after a surrogate pair. Both endpoints use the editor's UTF-16 coordinate system.
 for(const bookmark of [{anchor:expected.length-1,focus:6},{anchor:6,focus:6}]) {
  await content.evaluate((element,bookmark)=>{
   const point=offset=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){if(offset<=node.textContent.length)return [node,offset];offset-=node.textContent.length;}throw new Error('Fixture selection exceeds editor text');};
   element.focus();const [anchor,anchorOffset]=point(bookmark.anchor),[focus,focusOffset]=point(bookmark.focus);
   getSelection().setBaseAndExtent(anchor,anchorOffset,focus,focusOffset);document.dispatchEvent(new Event('selectionchange'));
  },bookmark);
  assert.deepEqual(await content.evaluate(selectionOffsets),bookmark);
  await page.getByRole('button',{name:'Calendar',exact:true}).click();await ready(page);
  await page.goBack();await content.waitFor();
  await page.waitForFunction(()=>getSelection()?.anchorNode?.parentElement?.closest('[data-block-id]')?.dataset.blockId==='work');
  assert.equal(await content.textContent(),expected);
  assert.deepEqual(await content.evaluate(selectionOffsets),bookmark);
  // Range text uses the same DOM/UTF-16 coordinates; Selection.toString() can omit rendered boundary whitespace.
  assert.equal(await page.evaluate(()=>getSelection().getRangeAt(0).toString()),expected.slice(Math.min(bookmark.anchor,bookmark.focus),Math.max(bookmark.anchor,bookmark.focus)));
 }
 checks.push('Page draft, exact UTF-16 caret and backward multi-node selection survive repeated Calendar/history navigation');
 // Editor Date Overview shares canonical navigation and returns to the precise origin.
 await content.evaluate(element=>{element.focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});await page.keyboard.type(' Date overview return draft.');const originText=await content.textContent();
 await content.locator('[data-note-date]').first().click();await page.locator('#note-date-panel').waitFor();await page.getByRole('button',{name:'Open in Calendar',exact:true}).click();await ready(page);await page.locator('.calendar-inspector .date-overview[data-date-id="gregorian:day:2026-10-23"]').waitFor();
 await page.getByRole('button',{name:'Return to original note',exact:true}).click();await content.waitFor();assert.equal(await content.textContent(),originText);await page.locator('#note-date-panel').waitFor();await page.waitForFunction(()=>document.activeElement?.dataset.noteDate==='gregorian:day:2026-10-23');await page.getByRole('button',{name:'Close date details',exact:true}).click();
 checks.push('Editor Date Overview flushes an unsaved draft, opens full canonical identity in Calendar, and returns to the original date occurrence');

 await page.getByRole('button',{name:'Calendar',exact:true}).click();await ready(page);const first=page.locator('[data-date="2026-10-01"]');await first.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement.dataset.date==='2026-10-02');await page.keyboard.press('PageDown');await page.getByRole('heading',{name:'November 2026',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement.dataset.date==='2026-11-02');await page.keyboard.press('PageUp');await page.keyboard.press('Enter');await page.getByRole('heading',{name:'October 2, 2026',exact:true}).waitFor();checks.push('Roving calendar keyboard, month boundaries and exact empty-day inspector');
 // Source evidence uses the exact repeated occurrence, then keeps the original
 // manual relationship stale when reprocessing leaves another identical date.
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await page.locator('[data-date="2026-10-23"]').click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.locator('.calendar-source-evidence').nth(1).waitFor();
 await page.locator('.calendar-source-evidence').nth(1).click();await page.locator('#source-viewer [data-cited-node] mark').waitFor();assert.equal(await page.locator('#source-viewer [data-cited-node] mark').textContent(),'23 October 2026');assert.ok(await page.locator('#source-viewer [data-cited-node] mark').evaluate(e=>{const range=document.createRange();range.selectNodeContents(e.closest('[data-cited-node]').querySelector('div'));range.setEndBefore(e);return range.toString().includes('first. Again on ');}),'Must highlight the second occurrence');await sourcePresentation(page);await screenshot(page,'calendar-source-exact-evidence');await page.getByRole('button',{name:'Close source viewer',exact:true}).click();
 await page.getByRole('button',{name:'Connections',exact:true}).click();await page.locator('.calendar-link-disclosure > summary').click();await page.getByLabel('Entity',{exact:true}).selectOption(typedEvent.id);await page.getByLabel('Relationship',{exact:true}).selectOption('discusses');const originalSource=index.detail(vault.id,'gregorian:day:2026-10-23').sources[1];await page.getByLabel('Supporting evidence',{exact:true}).selectOption('source:'+originalSource.id);await page.getByRole('button',{name:'Create relationship',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByRole('button',{name:'Open supporting source passage',exact:true}).waitFor();
 store.run('UPDATE source_files SET text=? WHERE id=?','Only another 23 October 2026 remains.',sourceFile.id);new SourcePassages(store,text=>text.length).synchronize(vault.id);index.refresh(vault.id);await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();await page.getByText('Stale evidence',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Open supporting source passage',exact:true}).count(),0);assert.equal(index.sources.resolve(vault.id,originalSource.id).status,'stale');
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();assert.equal((await page.locator('[data-date="2026-10-29"]').textContent()).trim(),'29');await page.getByRole('combobox',{name:'Calendar content',exact:true}).selectOption('all');await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-29"]')?.textContent.includes('Typed date proposal'));await page.locator('[data-date="2026-10-29"]').click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByRole('button',{name:'Accept relationship',exact:true}).click();await page.getByText('Verified original date property',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Calendar content',exact:true}).selectOption('linked');await ready(page);await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-29"]')?.textContent.includes('Typed date proposal'));checks.push('Strict repeated source occurrence, explicit source relationship, stale generation without redirect, and typed property review');checks.push('Source presentation toggles and Focus/Escape retain mounted temporal evidence on desktop and mobile');
 // Independent, opt-in universal supplement uses observed days and cached data.
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await page.getByRole('button',{name:'Calendar settings',exact:true}).click();assert.equal(await page.getByLabel('Show a liturgical calendar',{exact:true}).isChecked(),false);await page.getByRole('button',{name:'Done',exact:true}).click();
 const beforeOverlay=store.get('SELECT count(*) n FROM temporal_dates').n;let overlayRequests=0;page.on('request',request=>{if(/\/temporal\/liturgical\/\d+/.test(request.url()))overlayRequests++;});
 await calendarSetting(page,'Show a liturgical calendar',true);await page.locator('[data-date="2026-10-04"] .calendar-liturgical-cell').waitFor({state:'attached'});assert.equal(overlayRequests,1);
 assert.equal(await page.locator('[data-date="2026-10-23"] .calendar-optional-marker').count(),1);assert.equal(await page.locator('[data-date="2026-10-04"] .calendar-optional-marker').count(),0);
 await page.locator('[data-date="2026-10-23"]').click();await page.getByText('Saint John of Capestrano, Priest',{exact:true}).waitFor();assert.match(await page.locator('.calendar-liturgical-panel .calendar-observance-title').first().innerText(),/Friday/);assert.equal(await page.locator('[data-date="2026-10-23"] .calendar-liturgical-color').getAttribute('data-color'),'green');await page.getByRole('button',{name:'Close date inspector',exact:true}).click();
 checks.push('Provider-only optional memorial indicator reveals choices without replacing principal weekday/color');
 await page.locator('[data-date="2026-10-04"]').click();await page.locator('.calendar-liturgical-panel').waitFor();assert.match(await page.locator('.calendar-liturgical-panel').innerText(),/Sunday/);assert.doesNotMatch(await page.locator('.calendar-liturgical-panel').innerText(),/Francis/);await screenshot(page,'calendar-desktop-liturgical');
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await calendarSetting(page,'Indicate available optional memorials',false);await page.locator('[data-date="2026-10-22"]').click();assert.doesNotMatch(await page.locator('.calendar-liturgical-panel').innerText(),/John Paul/);await calendarSetting(page,'Optional memorial detail',true);await page.getByText('Saint John Paul II, Pope',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close date inspector',exact:true}).click();await page.getByRole('button',{name:'Agenda',exact:true}).click();await page.locator('.calendar-liturgical-agenda summary').click();assert.equal(await page.locator('.calendar-liturgical-agenda button').count(),31);await page.getByRole('button',{name:'Month',exact:true}).click();
 await page.route('**/api/temporal/liturgical/*',route=>route.abort());await calendarSetting(page,'Show a liturgical calendar',false);await calendarSetting(page,'Show a liturgical calendar',true);await page.locator('[data-date="2026-10-04"] .calendar-liturgical-cell').waitFor({state:'attached'});assert.equal(overlayRequests,1);assert.equal(store.get('SELECT count(*) n FROM temporal_dates').n,beforeOverlay);await page.reload();await ready(page);await calendarSetting(page,'Show a liturgical calendar',true);await page.locator('[data-date="2026-10-04"] .calendar-liturgical-cell').waitFor({state:'attached'});assert.equal(overlayRequests,1);
 checks.push('Opt-in universal overlay: observed Sunday precedence, optional memorial, independent agenda, cached offline reuse and no temporal entities');
 await desktop.context.close();
 const mobile=await context(390),m=mobile.page;await m.goto(`${base}/?vault=${vault.id}&view=calendar`);await ready(m);assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile horizontal overflow');await targetSizes(m,'.calendar-main button,.calendar-main label.calendar-filter-toggle');await screenshot(m,'calendar-mobile-month');
 await m.locator('[data-date="2026-10-23"]').click();await m.locator('.calendar-sheet[open]').waitFor();assert.equal(await m.locator('.calendar-sheet').evaluate(e=>Math.round(e.getBoundingClientRect().width)),390);assert.equal(await m.locator('.calendar-sheet').evaluate(e=>Math.round(e.getBoundingClientRect().height)),1040);await m.getByLabel('Title',{exact:true}).waitFor();await screenshot(m,'calendar-mobile-sheet');await targetSizes(m,'.calendar-sheet button,.calendar-sheet label.calendar-check');
 assert.equal(await m.evaluate(()=>!!document.activeElement.closest('.calendar-sheet')),true);await m.keyboard.press('Escape');await m.locator('.calendar-sheet').waitFor({state:'detached'});await m.waitForFunction(()=>document.activeElement.dataset.date==='2026-10-23');
 await m.locator('[data-date="2026-10-23"]').click();await m.getByLabel('Title',{exact:true}).waitFor();await m.getByRole('button',{name:'Evidence',exact:true}).click();await m.locator('.calendar-source-evidence').first().click();await m.locator('#source-viewer mark').waitFor();assert.equal(await m.locator('.calendar-sheet').evaluate(e=>e.open),false);await sourcePresentation(m);await m.getByRole('button',{name:'Close source viewer',exact:true}).click();await m.locator('.calendar-sheet[open]').waitFor();await m.locator('.calendar-evidence .calendar-evidence-link').first().click();await m.locator('#page-title').waitFor();await m.getByRole('button',{name:'Return to Calendar',exact:true}).click();await ready(m);await m.locator('.calendar-sheet[open]').waitFor();await m.getByRole('button',{name:'Overview',exact:true}).click();assert.equal(await m.getByLabel('Title',{exact:true}).inputValue(),'Project milestone');checks.push('390px native modal sheet, focus restoration, 44px targets and repeated evidence return');
 await m.getByRole('button',{name:'Close date inspector',exact:true}).click();await calendarSetting(m,'Show a liturgical calendar',true);await m.locator('[data-date="2026-10-04"] .calendar-liturgical-cell').waitFor({state:'attached'});await targetSizes(m,'.calendar-main button,.calendar-main label.calendar-filter-toggle');await m.locator('[data-date="2026-10-04"]').click();await m.locator('.calendar-liturgical-panel').waitFor();assert.match(await m.locator('[data-date="2026-10-23"]').getAttribute('aria-label'),/Friday of the 29th Week of Ordinary Time.*optional memorial/);assert.equal(await m.locator('[data-date="2026-10-23"] .calendar-mobile-count').isVisible(),true);assert.equal(await m.locator('[data-date="2026-10-23"] .calendar-liturgical-cell').isVisible(),false);await screenshot(m,'calendar-mobile-liturgical');await m.getByRole('button',{name:'Close date inspector',exact:true}).click();
 await calendarSetting(m,'Show a liturgical calendar',false);await m.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('noema.liturgical.v2:'))localStorage.removeItem(key);});await m.reload();await ready(m);await m.route('**/api/temporal/liturgical/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic provider failure"}'}));await calendarSetting(m,'Show a liturgical calendar',true);await m.getByRole('button',{name:'Retry supplement',exact:true}).waitFor();await m.locator('[data-date="2026-10-23"]').click();await m.getByLabel('Title',{exact:true}).waitFor();checks.push('Mobile supplement sheet and generation error preserve civil navigation');
 await mobile.context.close();const narrow=await context(320);await narrow.page.goto(`${base}/?vault=${vault.id}&view=calendar`);await ready(narrow.page);await narrow.page.getByRole('button',{name:'Calendar settings',exact:true}).click();await narrow.page.getByRole('combobox',{name:'Start week on',exact:true}).click();await narrow.page.getByRole('option',{name:'Monday',exact:true}).click();await narrow.page.getByLabel('Show civil week numbers',{exact:true}).check();await narrow.page.getByRole('button',{name:'Done',exact:true}).click();await ready(narrow.page);assert.match(await narrow.page.locator('.calendar-week-number').first().getAttribute('title'),/2026-W40/);assert.ok(await narrow.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px horizontal overflow');await targetSizes(narrow.page,'.calendar-main button,.calendar-main label.calendar-filter-toggle');await narrow.context.close();checks.push('320px minimum-width grid retains 44px targets without overflow');
 // Computed styles and reflow only: no screenshot capture is needed for this matrix.
 const contrast=(a,b)=>{const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 for(const width of [1440,390])for(const mode of ['light','dark'])for(const theme of ['ink','juniper','atlantic']){
  const fixture=await context(width);await fixture.context.addInitScript(({mode,theme})=>{localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme}));localStorage.setItem('noema.calendar.settings.v1',JSON.stringify({enabled:true,calendarId:'grc-en',optional:false,weekStart:0,weekNumbers:true,optionalIndicators:true}));},{mode,theme});
  await fixture.page.goto(`${base}/?vault=${vault.id}&view=calendar`);await ready(fixture.page);await fixture.page.locator('[data-date="2026-10-04"] .calendar-liturgical-cell').waitFor({state:'attached'});
  const colors=await fixture.page.evaluate(()=>{const root=getComputedStyle(document.documentElement);return {text:root.getPropertyValue('--text-muted').trim(),surface:root.getPropertyValue('--surface').trim()};});
  // Resolve token color syntax through computed style before numeric contrast calculation.
  const pair=await fixture.page.evaluate(({text,surface})=>{const e=document.createElement('span');e.style.color=text;e.style.backgroundColor=surface;document.body.append(e);const s=getComputedStyle(e),pair=[s.color,s.backgroundColor];e.remove();return pair;},colors);assert.ok(contrast(...pair)>=4.5,JSON.stringify({width,mode,theme,pair}));
  await targetSizes(fixture.page,'.calendar-main button,.calendar-main label.calendar-filter-toggle');
  if(width===390){await fixture.page.evaluate(()=>document.body.style.zoom='2');assert.ok(await fixture.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% CSS zoom overflow');}
  await fixture.context.close();
 }
 checks.push('Light/dark × all accents × desktop/mobile: secondary text contrast, targets, and 200% CSS zoom reflow without screenshots');
 assert.deepEqual(errors,[]);const activity=store.all('SELECT action,status,prompt_bytes FROM ai_activity');assert.ok(activity.every(row=>row.prompt_bytes==null&&['failed','skipped'].includes(row.status)),JSON.stringify(activity));
 const result={browser:await browser.version(),checks,errors,artifacts,syntheticOnly:true};await writeFile(join(artifacts,'calendar-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) {if(lastPage&&!lastPage.isClosed()){await screenshot(lastPage,'calendar-failure');console.error((await lastPage.locator('body').innerText()).slice(0,3500));}console.error({errors});throw error;} finally {globalThis.fetch=originalFetch;if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(resolve=>server.close(resolve));if(db)db.close();await rm(directory,{recursive:true,force:true});}
