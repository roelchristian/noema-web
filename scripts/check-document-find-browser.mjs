// Synthetic, editor-only browser verification. Optional playwright-core lives outside the project.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-find-browser-'));
const shots=process.env.SCREENSHOT_DIR??'/tmp/noema-find-screenshots';await mkdir(shots,{recursive:true});
let server,browser;
try{
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<!doctype html><div id="mount" style="width:100%;min-width:0"></div><script type="module" src="/fixture.tsx"></script>');
 await writeFile(join(directory,'fixture.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {BlockEditor} from '/@fs/${repo}/src/client/editor/BlockEditor.tsx';
import {DocumentFind} from '/@fs/${repo}/src/client/editor/DocumentFind.tsx';
import {useDocumentHistory} from '/@fs/${repo}/src/client/editor/use-document-history.ts';
import {immutableBlocks} from '/@fs/${repo}/src/shared/immutable-blocks.ts';
import {api} from '/@fs/${repo}/src/client/api.ts';
import '/@fs/${repo}/src/client/styles/tokens.css';import '/@fs/${repo}/src/client/styles.css';import '/@fs/${repo}/src/client/editor/document-find.css';
api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
const entities=[{id:'ada',vault_id:'fixture',name:'Ada Lovelace',aliases:['Countess'],type:'person',subtypes:[],description:'Mathematician',updated_at:''}];
const initial={id:'one',vault_id:'fixture',title:'target title excluded',sourceIds:[],revision:1,blocks:immutableBlocks([
{id:'b1',type:'paragraph',checked:false,content:[{text:'target ',bold:true},{text:'target',italic:true},{text:' and '},{entityId:'ada',mentionText:'Countess'},{text:' [[Other|linked]] target'}]},
{id:'t',type:'table',checked:false,content:[],rows:[[[{text:'target café'}],[{text:'target',href:'https://example.com'}]]]},
...Array.from({length:198},(_,i)=>({id:'b'+(i+2),type:'paragraph',checked:false,content:[{text:'Synthetic paragraph '+i}]}))])};
function App(){const [page,setPage]=useState(()=>JSON.parse(localStorage.getItem('synthetic-page')??'null')??initial);const history=useDocumentHistory(page,patch=>setPage(p=>({...p,...patch})));window.fixture={page,setPage,history};return <><button id="outside">Outside editor</button><button onClick={()=>document.dispatchEvent(new Event("noema:document-find"))}>Find in page</button><button id="switch" onClick={()=>setPage({...initial,id:page.id==='one'?'two':'one'})}>Switch page</button><article className="page"><DocumentFind key={page.vault_id+page.id} blocks={page.blocks} entities={entities} disabled={!!page.editLocked} onChange={blocks=>history.change({blocks})}/><h1>Find and replace · synthetic page</h1><BlockEditor vaultId="fixture" blocks={page.blocks} entities={entities} onChange={blocks=>history.change({blocks})} onOpenEntity={()=>{}} onCreateEntity={()=>{}} onAddAlias={async()=>{}} onSave={()=>{}}/></article></>};createRoot(document.querySelector('#mount')).render(<App/>);`);
 server=await createServer({configFile:false,root:directory,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}},plugins:[{name:'find-metrics',enforce:'pre',transform(code,id){
 if(id.endsWith('/segments.tsx'))return code.replace('  const changed = !segmentsEqual','  (globalThis as any).__syncs?.push(location.blockId);\n  const changed = !segmentsEqual');
 }}]});await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
 // Cold Vite dependency optimization is fixture setup, separate from 7s interaction deadlines.
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{timeout:30000});
 const host=page.locator('[data-block-id="b1"] .block-content');await host.waitFor();
 await host.click();await page.keyboard.press('Control+End');await page.keyboard.type(' unsaved');
 await page.keyboard.press('Control+f');await page.getByLabel('Find text',{exact:true}).fill('target');
 await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('of 5'));
 assert.equal(await page.getByLabel('Replace with',{exact:true}).count(),0);assert.equal(await page.getByLabel('Matching snippets',{exact:true}).count(),0);assert.equal(await page.getByLabel('Search mode',{exact:true}).count(),0);assert.ok(await page.locator('.document-find').evaluate(el=>el.getBoundingClientRect().height<=60));
 await page.getByRole('button',{name:'Search options',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Show matches',exact:true}).click();assert.equal(await page.getByLabel('Matching snippets',{exact:true}).count(),1);await page.getByRole('button',{name:'Search options',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Show matches',exact:true}).click();
 await page.getByLabel('Find text',{exact:true}).fill('Synthetic paragraph 197');await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('of 1'));assert.ok(await page.evaluate(()=>{const widget=document.querySelector('.document-find').getBoundingClientRect(),match=document.querySelector('[data-document-find=active]').getBoundingClientRect();return match.top>=widget.bottom&&document.activeElement===document.querySelector('.document-find-query');}));await page.getByLabel('Find text',{exact:true}).fill('target');await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('of 5'));
 async function matchOption(name){await page.getByRole('button',{name:'Search options',exact:true}).click();await page.getByRole('menuitem',{name:'Match options',exact:true}).click();await page.getByRole('menuitemcheckbox',{name,exact:true}).click();}
 async function searchMode(name){await page.getByRole('button',{name:'Search options',exact:true}).click();await page.getByRole('menuitem',{name:'Search in',exact:true}).click();await page.getByRole('menuitemcheckbox',{name,exact:true}).click();}
 await matchOption('Match case');await matchOption('Match case');await matchOption('Whole word');await matchOption('Whole word');
 await page.evaluate(()=>window.__syncs=[]);
 await page.getByLabel('Find text',{exact:true}).fill('target ');await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>window.__syncs),[],'query updates do not resync editables');
 await host.click();await page.keyboard.press('End');await page.keyboard.type(' edit');assert.deepEqual([...new Set(await page.evaluate(()=>window.__syncs))],['b1']);
 const cdp=await context.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'語',selectionStart:1,selectionEnd:1});await cdp.send('Input.insertText',{text:'語'});await page.waitForFunction(()=>window.fixture.page.blocks[0].content.some(s=>s.text?.includes('語')));
 await page.getByLabel('Find text',{exact:true}).focus();
 await page.getByLabel('Find text',{exact:true}).fill('target');await page.getByRole('button',{name:'Replace…',exact:true}).click();await page.getByLabel('Replace with',{exact:true}).fill('changed');await page.waitForTimeout(450);
 await page.screenshot({path:join(shots,'desktop.png'),fullPage:false});
 await page.getByRole('button',{name:'Replace all',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.page.blocks[0].content.map(s=>s.text??'').join('').startsWith('changed changed'));
 assert.equal(await page.evaluate(()=>window.fixture.page.title),'target title excluded');
 await page.evaluate(()=>window.fixture.history.undo());await page.waitForFunction(()=>window.fixture.page.blocks[0].content[0].text==='target ');
 await page.evaluate(()=>window.fixture.history.redo());await page.waitForFunction(()=>window.fixture.page.blocks[0].content[0].text==='changed');
 // Save and reload a synthetic local fixture; production save/history paths are covered by the full suite.
 await page.evaluate(()=>localStorage.setItem('synthetic-page',JSON.stringify(window.fixture.page)));await page.reload();await host.waitFor();assert.ok(await page.evaluate(()=>window.fixture.page.blocks[0].content[0].text==='changed'));await page.getByRole('button',{name:'Find in page',exact:true}).click();
 await searchMode('Linked entities');await page.getByLabel('Filter entities',{exact:true}).fill('Ada');await page.getByRole('combobox',{name:'Linked identity',exact:true}).click();await page.getByRole('option',{name:'Ada Lovelace · person',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('of 1'));
 assert.ok(await page.evaluate(()=>CSS.highlights.get('document-find')?.size===1));
 await page.getByLabel('Filter entities',{exact:true}).fill('Countess');assert.equal(await page.locator('select[aria-label="Linked identity"]').locator('option').count(),2);
 await searchMode('Page text');await matchOption('Regular expression');await page.getByLabel('Find text',{exact:true}).fill('[');await page.waitForFunction(()=>document.querySelector('.document-find-feedback')?.textContent.includes('Invalid'));
 await page.getByLabel('Find text',{exact:true}).fill('(?:)');await page.waitForFunction(()=>document.body.textContent.includes('Zero-width matches skipped.'));
 await page.evaluate(()=>window.fixture.setPage(p=>({...p,blocks:[{id:'pathological',type:'paragraph',checked:false,content:[{text:'a'.repeat(60000)+'!'}]}]})));
 await page.getByLabel('Find text',{exact:true}).fill('(a+)+$');
 await page.waitForFunction(()=>document.querySelector('.document-find-feedback')?.textContent.includes('timed out'));
 await page.getByLabel('Find text',{exact:true}).fill('!');await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('of 1'));
 await page.getByRole('button',{name:'Replace…',exact:true}).click();
 await page.evaluate(()=>window.fixture.setPage(p=>({...p,blocks:[{id:'capped',type:'paragraph',checked:false,content:[{text:'a '.repeat(3000)}]}]})));await page.getByLabel('Find text',{exact:true}).fill('a');await page.waitForFunction(()=>document.querySelector('.document-find-feedback')?.textContent.includes('limit reached'));assert.ok(await page.getByRole('button',{name:'Replace all',exact:true}).isDisabled());
 await page.evaluate(()=>window.fixture.setPage(p=>({...p,blocks:[{id:'oversized',type:'paragraph',checked:false,content:[{text:'x'.repeat(2_000_001)}]}]})));await page.waitForFunction(()=>document.querySelector('.document-find-feedback')?.textContent.includes('2 million'));assert.ok(await page.getByRole('button',{name:'Replace all',exact:true}).isDisabled());
 await page.evaluate(()=>window.fixture.setPage(p=>({...p,blocks:[]})));await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('No matches'));
 await page.getByRole('button',{name:'Switch page',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Find in page',exact:true}).count(),1);
 await host.click();await page.keyboard.press('Control+f');assert.equal(await page.getByLabel('Find text',{exact:true}).inputValue(),'');
 await page.getByLabel('Find text',{exact:true}).fill('target');await page.waitForTimeout(450);await page.keyboard.press('Escape');assert.ok(await page.evaluate(()=>document.activeElement?.classList.contains('block-content')));
 await page.locator('#outside').focus();const prevented=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);return e.defaultPrevented;});assert.equal(prevented,true);assert.ok(await page.getByLabel('Find text',{exact:true}).evaluate(el=>document.activeElement===el));await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Find in page',exact:true}).click();await page.getByLabel('Find text',{exact:true}).fill('target');await page.waitForTimeout(450);
 await page.screenshot({path:join(shots,'mobile.png'),fullPage:false});
 const findTargets=await page.locator('.document-find button').evaluateAll(buttons=>buttons.map(button=>({label:button.getAttribute('aria-label'),height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width,hidden:!!button.closest('[hidden]')})));const visibleTargets=findTargets.filter(button=>button.width>0&&button.height>0);assert.ok(visibleTargets.length>=8,JSON.stringify(findTargets));assert.ok(visibleTargets.every(button=>button.height>=44&&button.width>=44),JSON.stringify(findTargets));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.ok(await page.locator('.document-find').evaluate(el=>el.getBoundingClientRect().height<=110));
 const next=page.getByRole('button',{name:'Next',exact:true});await next.click();await page.getByRole('button',{name:'Previous',exact:true}).click();
 await page.setViewportSize({width:320,height:700});const narrow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:Array.from(document.querySelectorAll('body *')).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.right>innerWidth+1).slice(0,15)}));assert.ok(narrow.scroll<=narrow.width,JSON.stringify(narrow));await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Replace…',exact:true}).click();await page.evaluate(()=>window.fixture.setPage(p=>({...p,editLocked:true})));await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Replace all')?.disabled);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'Chromium',checks:'replacement history, unsaved draft, entities/aliases, invalid/zero-width/pathological regex, focus, shortcuts, page switch, mobile, editable isolation',screenshots:[join(shots,'desktop.png'),join(shots,'mobile.png')]}));
}finally{await browser?.close();await server?.close();await rm(directory,{recursive:true,force:true});}

// Production bundle + disposable SQLite: verify actual autosave, undo/redo and reload.
const {openDatabase}=await import('../dist/server/database.js');
const {Store}=await import('../dist/server/store.js');
const {Knowledge}=await import('../dist/server/modules/knowledge.js');
const {Pages}=await import('../dist/server/modules/pages.js');
const http=await import('node:http');
const {createRuntime}=await import('../dist/server/runtime.js');
const {createTransportHandler,trackConnections}=await import('../dist/server/transport.js');
const {Intelligence}=await import('../dist/server/modules/intelligence.js');
const {readNetworkConfig}=await import('../dist/server/network.js');
const {once}=await import('node:events');
const appDirectory=await mkdtemp(join(tmpdir(),'noema-find-app-'));
const db=openDatabase(join(appDirectory,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
const presentationEntity=knowledge.create('default',{name:'Synthetic Rowan',type:'person',description:'Fictional presentation fixture'});
let note=pages.create('default',{title:'Synthetic target title'});
note=pages.update('default',note.id,{...note,blocks:[{id:'body',type:'paragraph',checked:false,content:[{text:'target ',bold:true},{text:'target',italic:true}]},{id:'table',type:'table',checked:false,content:[],rows:[[[{text:'target',href:'https://example.com'}],[{text:'untouched'}]]]},{id:'references',type:'paragraph',checked:false,content:[{text:'Notes about '},{entityId:presentationEntity.id,mentionText:'Synthetic Rowan'},{text:' and an unchanged association.'}]},{id:'sample-code',type:'code',checked:false,content:[{text:'const example = "'+ 'x'.repeat(180) +'";'}]}]});
// SQLite assessment triggers also enqueue directly when the background index settles.
// Clear only fixture AI-enrichment jobs after insertion without interrupting any index trigger.
db.exec('CREATE TEMP TRIGGER find_fixture_enrichment AFTER INSERT ON page_enrichment_jobs BEGIN DELETE FROM page_enrichment_jobs WHERE page_id=NEW.page_id; END');
store.run('DELETE FROM page_enrichment_jobs');
const other=pages.create('default',{title:'Other target page'});
const otherBefore=JSON.stringify(pages.get('default',other.id));
const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls are forbidden in the DocumentFind fixture');});
const runtime=createRuntime(store,ai,readNetworkConfig());
// Find/presentation data fidelity is independent of automatic AI enrichment.
// Disable only that disposable fixture scheduler; retain the real HTTP handlers and all equality assertions.
runtime.enrichmentScheduler.dispose();
const sockets=new Set(),app=http.createServer(createTransportHandler(runtime,join(repo,'dist/client'),sockets));
trackConnections(app,runtime.networkAccess,sockets);app.on('listening',()=>runtime.start());app.on('close',()=>runtime.close());app.listen(0,'127.0.0.1');await once(app,'listening');
let appBrowser;
try{
 appBrowser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await appBrowser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto(`http://127.0.0.1:${app.address().port}/?vault=default&page=${note.id}`);
 const body=page.locator('[data-block-id="body"] .block-content[contenteditable="true"]');await body.waitFor();await body.click();await page.keyboard.press('Control+h');
 await page.getByLabel('Find text',{exact:true}).fill('target');await page.getByLabel('Replace with',{exact:true}).fill('revised');
 await page.waitForFunction(()=>document.querySelector('.document-find output')?.textContent.includes('of 3'));
 await page.getByRole('button',{name:'Replace all',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-block-id="body"] .block-content')?.textContent==='revised revised');
 await page.keyboard.press('Escape');await body.focus();await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelector('[data-block-id="body"] .block-content')?.textContent==='target target');
 await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>document.querySelector('[data-block-id="body"] .block-content')?.textContent==='revised revised');await page.keyboard.press('Control+s');
 for(let tries=0;tries<50&&pages.get('default',note.id).blocks[0].content[0].text!=='revised';tries++)await new Promise(resolve=>setTimeout(resolve,100));
 const saved=pages.get('default',note.id);assert.equal(saved.blocks[0].content[0].text,'revised');assert.equal(saved.blocks[0].content[0].bold,true);assert.equal(saved.blocks[1].rows[0][0][0].href,'https://example.com');assert.equal(saved.title,note.title);assert.equal(JSON.stringify(pages.get('default',other.id)),otherBefore);
 await page.reload();await body.waitFor();assert.equal(await body.innerText(),'revised revised');
 await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Find in page',exact:true}).click();assert.equal(await page.getByLabel('Find text',{exact:true}).inputValue(),'');await page.getByLabel('Find text',{exact:true}).fill('revised');await page.waitForFunction(()=>document.querySelector('.document-find output')?.textContent.includes('of 3'));
 assert.ok(await page.locator('.document-find').evaluate(el=>el.getBoundingClientRect().height<=60));assert.ok(await page.evaluate(()=>{const widget=document.querySelector('.document-find').getBoundingClientRect(),body=document.querySelector('[data-block-id=body]').getBoundingClientRect();return widget.bottom<body.top;}));await page.screenshot({path:join(shots,'app-desktop.png'),fullPage:false});await page.getByRole('button',{name:'Replace…',exact:true}).click();await page.screenshot({path:join(shots,'app-desktop-replace.png'),fullPage:false});await page.getByRole('button',{name:'Replace…',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(shots,'app-mobile.png'),fullPage:false});
 await page.setViewportSize({width:320,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Close find',exact:true}).click();await page.locator('#page-title').focus();await page.locator('#page-title').evaluate(el=>el.setSelectionRange(2,6));await page.getByRole('button',{name:'More page actions',exact:true}).click();await page.getByRole('menuitem',{name:'Find in page',exact:true}).click();await page.keyboard.press('Escape');assert.deepEqual(await page.locator('#page-title').evaluate(el=>[document.activeElement===el,el.selectionStart,el.selectionEnd]),[true,2,6]);
 // Presentation modes exercise the production shell, real persistence and editor.
 await page.setViewportSize({width:1440,height:1000});
 const chooseFor=async(target,mode,touch=false)=>{
  const activate=button=>touch?button.tap():button.click();
  const focused=await target.evaluate(()=>document.documentElement.dataset.focusWorkspace==='true');
  if(focused&&mode==='Focus')return;
  if(focused)await activate(target.locator('.focus-controls').getByRole('button',{name:'Exit Focus',exact:true}));
  if(await target.getByRole('button',{name:'View',exact:true}).isVisible()) {
   await activate(target.getByRole('button',{name:'View',exact:true}));
   await activate(target.getByRole('menuitemcheckbox',{name:mode,exact:true}));
  } else {
   await activate(target.locator('.topbar .presentation-control').getByRole('button',{name:'Presentation mode',exact:true}));
   await activate(target.getByRole('menuitemcheckbox',{name:mode,exact:true}));
  }
  // Reference emphasis, Focus layout and touch feedback animate. Assert settled styles and boxes.
  await target.waitForFunction(()=>[...document.querySelectorAll('#content > .page, #blocks .mention, .presentation-selector button, .presentation-icon-pair > .icon')].every(el=>el.getAnimations().every(animation=>!animation.pending&&animation.playState!=='running')));
 };
 const choose=mode=>chooseFor(page,mode);
 const inFocus=()=>page.evaluate(()=>document.documentElement.dataset.focusWorkspace==='true');
 const dataBeforeModes=JSON.stringify(pages.get('default',note.id));
 await page.getByRole('button',{name:'Show page knowledge',exact:true}).click();
 await page.locator('#intelligence-panel').waitFor();
 await page.locator('.sidebar-scroll-region').evaluate(el=>el.scrollTop=40);
 const arrangement=await page.evaluate(()=>({knowledge:localStorage.getItem('noema-knowledge-panel-open'),toc:localStorage.getItem('noema-table-of-contents-visible'),scroll:document.querySelector('.sidebar-scroll-region').scrollTop}));
 const mention=page.locator('#blocks .mention').first();await mention.waitFor();
 await choose('Standard');const normalStyle=await mention.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderBottomStyle}));
 await page.screenshot({path:join(shots,'presentation-desktop-standard.png')});
 await choose('Subtle');const subtleStyle=await mention.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderBottomStyle}));assert.notDeepEqual(normalStyle,subtleStyle);
 await page.screenshot({path:join(shots,'presentation-desktop-subtle.png')});
 const pressMode=async(mode,key)=>{
  if(await page.getByRole('button',{name:'View',exact:true}).isVisible()) {
   await page.getByRole('button',{name:'View',exact:true}).focus();await page.keyboard.press('ArrowDown');
   await page.getByRole('menuitemcheckbox',{name:mode,exact:true}).focus();await page.keyboard.press(key);
  } else {await page.getByRole('button',{name:mode,exact:true}).focus();await page.keyboard.press(key);}
 };
 await pressMode('Standard','Space');assert.equal(await page.evaluate(()=>document.documentElement.dataset.focusedReading),'false');
 await pressMode('Subtle','Enter');assert.equal(await page.evaluate(()=>document.documentElement.dataset.focusedReading),'true');
 for(let i=0;i<2;i++) {
  await choose('Focus');assert.ok(await inFocus());assert.ok(!await page.locator('.sidebar').isVisible());assert.ok(!await page.locator('#intelligence-panel').isVisible());
  assert.deepEqual(await mention.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderBottomStyle})),subtleStyle);
  const layout=await page.locator('article.page').boundingBox();assert.ok(Math.abs(layout.x+layout.width/2-720)<2);
  await page.locator('[data-block-id=body] .block-handle').click({force:true});await page.locator('.block-action-menu').waitFor();await page.keyboard.press('Escape');assert.ok(await inFocus());
  await body.focus();await page.keyboard.press('Control+f');await page.getByLabel('Find text',{exact:true}).fill('revised');await page.keyboard.press('Escape');assert.ok(await inFocus());
  await body.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.ok(await inFocus());
  await page.keyboard.press('Escape');assert.ok(!await inFocus());assert.ok(await page.locator('#intelligence-panel').isVisible());
  assert.deepEqual(await page.evaluate(()=>({knowledge:localStorage.getItem('noema-knowledge-panel-open'),toc:localStorage.getItem('noema-table-of-contents-visible'),scroll:document.querySelector('.sidebar-scroll-region').scrollTop})),arrangement);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.focusedReading),'true');
 }
 await choose('Focus');await body.focus();await page.mouse.move(700,600);assert.ok(await page.locator('.focus-controls').getByRole('button',{name:'Exit Focus',exact:true}).isVisible());await page.screenshot({path:join(shots,'presentation-desktop-focus.png')});
 await page.locator('.focus-controls').getByRole('button',{name:'Exit Focus',exact:true}).focus();assert.equal(await page.locator('.focus-exit').count(),0);
 // Same-tab reload retains Focus and its previous Subtle mode.
 await page.reload();await body.waitFor();assert.ok(await inFocus());
 await page.goto(`http://127.0.0.1:${app.address().port}/?vault=default&page=${other.id}`);await page.locator('#blocks').waitFor();assert.ok(await inFocus());await page.goBack();await body.waitFor();assert.ok(await inFocus());await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.documentElement.dataset.focusedReading),'true');
 assert.equal(JSON.stringify(pages.get('default',note.id)),dataBeforeModes);
 // Full editing, selection and history remain available in Focus.
 await choose('Focus');await body.click();await page.keyboard.press('End');await page.keyboard.type(' focus edit');await page.keyboard.press('Control+z');assert.equal(await body.innerText(),'revised revised');await page.keyboard.press('Control+Shift+z');assert.match(await body.innerText(),/focus edit/);await page.keyboard.press('Control+z');await page.keyboard.press('Control+s');
 await page.getByRole('button',{name:'Exit Focus',exact:true}).click();
 // Mobile uses real touch emulation, all modes, and a narrow phone width.
 const mobileContext=await appBrowser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const mobilePage=await mobileContext.newPage();mobilePage.on('pageerror',e=>errors.push(e.message));
 await mobilePage.goto(`http://127.0.0.1:${app.address().port}/?vault=default&page=${note.id}`);await mobilePage.locator('#blocks').waitFor();
 for(const mode of ['Standard','Subtle','Focus']) {
  await chooseFor(mobilePage,mode,true);await mobilePage.waitForTimeout(150);
  await mobilePage.screenshot({path:join(shots,'presentation-mobile-'+mode.toLowerCase()+'.png')});
  assert.ok(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mode!=='Focus')assert.ok(await mobilePage.evaluate(()=>document.querySelector('.topbar').getBoundingClientRect().bottom<=document.querySelector('.page-title-heading').getBoundingClientRect().top));
  const target=await mobilePage.getByRole('button',{name:mode==='Focus'?'Exit Focus':'View',exact:true}).evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,transform:getComputedStyle(el).transform}));assert.ok(target.height>=44&&target.width>=44,JSON.stringify({mode,...target}));
 }
 await mobilePage.setViewportSize({width:320,height:700});assert.ok(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mobilePage.getByRole('button',{name:'Exit Focus',exact:true}).tap();await mobilePage.getByRole('button',{name:'View',exact:true}).tap();assert.equal(await mobilePage.getByRole('menuitemcheckbox',{name:'Subtle',exact:true}).getAttribute('aria-checked'),'true');await mobilePage.keyboard.press('Escape');
 await mobilePage.setViewportSize({width:390,height:844});
 await mobilePage.getByRole('button',{name:'Open navigation',exact:true}).tap();
 await mobilePage.getByRole('button',{name:'Vault options',exact:true}).tap();await mobilePage.getByRole('menuitem',{name:'Settings',exact:true}).tap();
 const settings=mobilePage.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('button',{name:'Focus',exact:true}).tap();
 await mobilePage.keyboard.press('Escape');assert.equal(await mobilePage.evaluate(()=>document.documentElement.dataset.focusWorkspace),'true');
 assert.equal(await mobilePage.locator('#workspace-navigation').getAttribute('open'),null);
 await mobilePage.getByRole('button',{name:'Exit Focus',exact:true}).tap();
 assert.ok(await mobilePage.getByRole('dialog',{name:'Workspace navigation',exact:true}).isVisible());await mobilePage.getByRole('button',{name:'Close navigation',exact:true}).tap();
 await mobileContext.close();
 await page.setViewportSize({width:1440,height:1000});await choose('Focus');
 await mention.click();await page.getByRole('button',{name:'Open entity details',exact:true}).click();assert.ok(!await inFocus());await page.locator('#entity-panel').waitFor();
 const inspectorNode=await page.locator('#entity-panel').evaluateHandle(el=>el);await choose('Focus');assert.ok(!await page.locator('#entity-panel').isVisible());await page.keyboard.press('Escape');assert.ok(await page.locator('#entity-panel').isVisible());assert.ok(await page.locator('#entity-panel').evaluate((el,original)=>el===original,inspectorNode));
 const finalBlocks=pages.get('default',note.id).blocks;assert.deepEqual(saved.blocks.map(block=>finalBlocks.find(item=>item.id===block.id)),saved.blocks);assert.ok(finalBlocks.filter(block=>!saved.blocks.some(item=>item.id===block.id)).every(block=>block.type==='paragraph'&&block.content.length===0));
 assert.equal(JSON.stringify(pages.get('default',other.id)),otherBefore);
 console.log(JSON.stringify({presentationModes:true,checks:'desktop/mobile screenshots, exact subtle styling, repeated restoration, IME, find Escape priority, reload, data fidelity, editing undo/redo, entity interactions, narrow screens',screenshots:['desktop','mobile'].flatMap(device=>['standard','subtle','focus'].map(mode=>join(shots,'presentation-'+device+'-'+mode+'.png')))}));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({productionApp:true,passed:['replace all single undo/redo','SQLite autosave and reload','styles and URL','unchanged title and other page','query reset on reload'],screenshots:[join(shots,'app-desktop.png'),join(shots,'app-mobile.png')]}));
}finally{await appBrowser?.close();await new Promise(resolve=>app.close(resolve));db.close();await rm(appDirectory,{recursive:true,force:true});}
