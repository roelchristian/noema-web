// Actual app + HTTP/SQLite with synthetic saved vectors. No external providers.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const dir=await mkdtemp(join(tmpdir(),'noema-related-browser-')),artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/workspace/shared/related-notes-evidence');await mkdir(artifacts,{recursive:true});
const db=openDatabase(join(dir,'db.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),segments=new PageSegments(store),index=new PageSegmentIndex(store);
const vector=[1,...Array(1535).fill(0)];
function note(title,text){let p=pages.create('default',{title});p=pages.update('default',p.id,{...p,blocks:Array.from({length:30},(_,i)=>({id:'p'+i,type:'paragraph',content:[{text:text+' '+i}]}))});segments.synchronize('default',p.id);for(const s of store.all('SELECT * FROM page_segments WHERE page_id=?',p.id))index.save(s,vector,10);return p;}
const active=note('Synthetic algebra notebook','A field is an algebraic structure with multiplicative inverses.'),related=note('Synthetic field connections','Fields, inverses and related algebraic structures.'),next=note('Synthetic second notebook','A separate synthetic note for identity isolation.');
const server=createApp(store,resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;let browser;const errors=[],screenshots=[];
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  await page.goto(`${url}/?vault=default&page=${active.id}`);await page.locator('#blocks .block-content').first().waitFor();await page.getByRole('button',{name:'Show page knowledge',exact:true}).click();
  const section=page.locator('.knowledge-related-notes');await section.locator('li').first().waitFor();assert.equal(await section.locator('li').count(),2);
  await section.scrollIntoViewIfNeeded();
  const focused=section.locator('button').first();await focused.focus();const before=await page.evaluate(()=>({scroll:document.querySelector('.intelligence-panel .panel-body').scrollTop,focus:document.activeElement.textContent}));
  await page.waitForTimeout(100);
  await page.evaluate(()=>{const editor=document.querySelector('#blocks');window.editorMutations=0;window.relatedMutations=0;window.editorNode=editor;window.resultNode=document.querySelector('.knowledge-related-notes ul');new MutationObserver(m=>window.editorMutations+=m.length).observe(editor,{subtree:true,childList:true,characterData:true,attributes:true});new MutationObserver(m=>window.relatedMutations+=m.length).observe(window.resultNode,{subtree:true,childList:true,characterData:true,attributes:true});});
  let release,started;const requested=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/related-notes?state=1**',async route=>{started();await gate;await route.continue();});
  store.run('UPDATE suggestion_versions SET version=version+1 WHERE vault_id=?','default');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await requested;
  await section.locator('[aria-label="Updating related notes…"]').waitFor();assert.equal(await section.locator('li').count(),2);assert.ok(await page.evaluate(()=>document.querySelector('.knowledge-related-notes ul')===window.resultNode));
  const path=join(artifacts,`${width}-retained-updating.png`);await page.screenshot({path,caret:'initial'});screenshots.push(path);release();await section.locator('[aria-label="Updating related notes…"]').waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>({scroll:document.querySelector('.intelligence-panel .panel-body').scrollTop,focus:document.activeElement.textContent})),before);
  assert.deepEqual(await page.evaluate(()=>({editor:window.editorMutations,list:window.relatedMutations,same:window.editorNode===document.querySelector('#blocks')})),{editor:0,list:0,same:true});
  // A real save leaves a semantic gap until new saved vectors exist.
  let saved=pages.get('default',active.id);saved=pages.update('default',active.id,{...saved,blocks:[{id:'replacement',type:'paragraph',content:[{text:'Edited synthetic body awaiting updated vectors and recalculation. Viewport '+width}]}]});segments.synchronize('default',active.id);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await section.locator('[aria-label="Updating related notes…"]').waitFor();assert.equal(await section.locator('li').count(),2);
  for(const s of store.all('SELECT * FROM page_segments WHERE page_id=?',active.id))index.save(s,vector,10);
  // Changed content is committed locally to the section after vectors become current.
  store.run('UPDATE pages SET title=? WHERE id=?','Updated synthetic connection',related.id);segments.synchronize('default',related.id);for(const s of store.all('SELECT * FROM page_segments WHERE page_id=?',related.id))index.save(s,vector,10);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await section.getByText('Updated synthetic connection',{exact:true}).waitFor();await section.locator('[aria-label="Updating related notes…"]').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.editorMutations),0);
  const changed=join(artifacts,`${width}-changed-results.png`);await page.screenshot({path:changed,caret:'initial'});screenshots.push(changed);
  // Delete a ranked candidate: refreshed eligibility must remove it.
  pages.delete('default',related.id);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await section.getByText('Updated synthetic connection',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await section.locator('li').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await context.close();
  // Reset synthetic fixture for the second viewport.
  if(width===1440){pages.restore('default',related.id);store.run('UPDATE pages SET title=? WHERE id=?','Synthetic field connections',related.id);segments.synchronize('default',related.id);for(const s of store.all('SELECT * FROM page_segments WHERE page_id=?',related.id))index.save(s,vector,10);}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:await browser.version(),passed:['desktop/mobile actual app','delayed retained list + accessible indicator','unchanged list: zero DOM mutations','editor: zero DOM mutations','focus/scroll stable','real save embedding gap','changed title','deletion eligibility','no horizontal overflow'],screenshots,errors},null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));index.close();db.close();await rm(dir,{recursive:true,force:true});}
