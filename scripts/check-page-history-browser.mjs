// Disposable data, loopback requests only, DOM assertions; no screenshots or AI providers.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {PageHistory} from '../src/server/modules/page-history.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const directory=await mkdtemp(join(tmpdir(),'noema-history-browser-')),repo=resolve(import.meta.dirname,'..');
let db,api,vite,browser;
try {
 db=openDatabase(join(directory,'fixture.sqlite'));const store=new Store(db),pages=new Pages(store,new Knowledge(store)),history=new PageHistory(store);
 const block=text=>({id:'stable-history-block',type:'paragraph',checked:false,content:[{text}]});
 let note=pages.create('default',{title:'Synthetic history note'});note=pages.update('default',note.id,{...note,blocks:[block('Earlier synthetic paragraph')]});
 const earlier=history.checkpoint('default',note.id,{revision:note.revision,name:'Earlier synthetic checkpoint'});
 note=pages.update('default',note.id,{...note,blocks:[block('Current synthetic paragraph')]});
 const other=pages.create('default',{title:'Synthetic navigation destination'}),errors=[];
 api=createApp(store,join(repo,'dist/client'));api.listen(0,'127.0.0.1');await once(api,'listening');
 vite=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${api.address().port}`,changeOrigin:true,headers:{origin:`http://127.0.0.1:${api.address().port}`}}}}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
 await page.getByRole('button',{name:'Synthetic history note',exact:false}).first().click();await page.locator('#page-title').waitFor();
 const open=async()=>{await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Version history',exact:true}).click();await page.getByRole('dialog').waitFor();};
 const preview=async()=>{await page.getByRole('button',{name:'Earlier synthetic checkpoint',exact:false}).click();await page.locator('.page-history-preview').getByText('Earlier synthetic paragraph',{exact:true}).waitFor();};
 const restore=async()=>{await page.getByRole('button',{name:'Restore this version',exact:true}).click();await page.getByRole('button',{name:'Confirm restore',exact:true}).click();};
 await open();await preview();assert.equal(await page.locator('.page-history-preview [contenteditable=true]').count(),0);assert.equal(pages.get('default',note.id).blocks[0].content[0].text,'Current synthetic paragraph');
 await page.getByLabel('Compare blocks with current page').check();await page.getByText('Modified block',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 // The action flushes the deliberately delayed autosave before taking its revision.
 let releaseSave,delayedSave=false;await page.route('**/api/pages/'+note.id,async route=>{if(route.request().method()!=='PUT'||delayedSave)return route.continue();delayedSave=true;await new Promise(resolve=>{releaseSave=resolve;});await route.continue();});
 await page.locator('.block-content[contenteditable=true]').first().fill('Pending synthetic paragraph');
 await open();await preview();await restore();await page.waitForFunction(()=>document.querySelector('.page-history-drawer')?.textContent.includes('Restoring'));
 assert.equal(pages.get('default',note.id).blocks[0].content[0].text,'Current synthetic paragraph');
 for(let i=0;i<100&&!releaseSave;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releaseSave);releaseSave();
 await page.locator('.page-history-drawer').waitFor({state:'hidden'}).catch(async error=>{console.log('RESTORE DIALOG:',await page.locator('.page-history-drawer').innerText());throw error;});assert.equal(pages.get('default',note.id).blocks[0].content[0].text,'Earlier synthetic paragraph');
 assert.ok(history.list('default',note.id).some(v=>history.get('default',note.id,v.id).snapshot.blocks.some(b=>b.content.some(s=>s.text==='Pending synthetic paragraph'))));
 await page.unroute('**/api/pages/'+note.id);
 // Failed atomic capture leaves both the editor's current page and persisted state intact.
 db.exec("CREATE TRIGGER synthetic_browser_rollback BEFORE INSERT ON page_versions WHEN NEW.kind='restore' BEGIN SELECT RAISE(ABORT,'synthetic browser rollback'); END");
 await open();await preview();const before=pages.get('default',note.id).revision;await restore();await page.locator('.page-history-message').filter({hasText:'An unexpected error occurred'}).waitFor();assert.equal(pages.get('default',note.id).revision,before);db.exec('DROP TRIGGER synthetic_browser_rollback');
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 // Navigation dismisses preview; a delayed version fetch cannot replace another editor.
 let releasePreview;await page.route('**/history/'+earlier.id,async route=>{await new Promise(resolve=>{releasePreview=resolve;});await route.continue();});
 await open();await page.getByRole('button',{name:'Earlier synthetic checkpoint',exact:false}).click();
 for(let i=0;i<100&&!releasePreview;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releasePreview);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.evaluate(id=>{history.pushState({...history.state},'', '/?vault=default&page='+id);dispatchEvent(new PopStateEvent('popstate',{state:history.state}));},other.id);releasePreview();
 await page.waitForFunction(()=>document.querySelector('#page-title')?.value==='Synthetic navigation destination');assert.equal(await page.locator('.page-history-drawer').count(),0);assert.equal(pages.get('default',other.id).title,'Synthetic navigation destination');assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.mode='dark');await open();const mobile=await page.getByRole('dialog').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};});assert.ok(mobile.left>=0&&mobile.right<=391&&mobile.height>=840);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 console.log('Synthetic browser history passed: read-only preview, block comparison, pending-save restore, rollback, stale navigation.');
} finally {await browser?.close();await vite?.close();if(api){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}db?.close();await rm(directory,{recursive:true,force:true});}
