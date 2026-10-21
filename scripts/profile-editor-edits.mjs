// Synthetic browser profile. Run from the checkout being measured:
// PLAYWRIGHT_MODULE=/tmp/noema-browser-tools/node_modules/playwright-core/index.mjs node scripts/profile-editor-edits.mjs
// To measure main, copy this script there unchanged. No production counters/API data.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve('.'),directory=await mkdtemp(join(tmpdir(),'noema-edit-profile-'));
let server,browser;
try {
 await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
 await writeFile(join(directory,'index.html'),'<!doctype html><div id="mount"></div><script type="module" src="/fixture.tsx"></script>');
 await writeFile(join(directory,'fixture.tsx'),`
import React,{Profiler,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Workspace} from '/@fs/${repo}/src/client/state/workspace.ts';
import {api} from '/@fs/${repo}/src/client/api.ts';
import {PageEditor} from '/@fs/${repo}/src/client/editor/PageEditor.tsx';
import {pageHeadings} from '/@fs/${repo}/src/client/editor/page-headings.ts';
import {useDocumentHistory} from '/@fs/${repo}/src/client/editor/use-document-history.ts';
const mixed=${process.env.MIXED_BLOCKS==='1'};
const count=Number(new URLSearchParams(location.search).get('blocks'));
let saved={id:'synthetic',vault_id:'fixture',title:'Synthetic profiling note',aiStatus:'regular',sourceIds:[],revision:1,updated_at:'2026-10-21T00:00:00Z',blocks:Array.from({length:count},(_,i)=>({id:'b'+i,type:'paragraph',checked:false,content:[{text:i===count-1?'':('Synthetic prose '+i+' with formatting and reference context. ').repeat(8),bold:i%3===0,skipAutoTag:true}],...(mixed&&i%17===16?{type:'table',rows:[[[{text:'Synthetic cell A'}],[{text:'Synthetic cell B'}]]]}:mixed&&i%13===12?{semantic:'ai-explanation'}:{})}))};
api.vaults=async()=>[{id:'fixture',name:'Synthetic',locked:false}];api.pages=async()=>[saved];api.entities=async()=>[];api.organization=async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]});
api.page=async()=>structuredClone(saved);api.pageMetadata=async()=>saved;
api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});api.entityMatches=async()=>({revision:saved.revision,matches:[],key:'synthetic'});
api.savePage=async(_v,_id,page)=>{JSON.stringify(page);saved={...page,revision:page.revision+1};return structuredClone(saved);};
const workspace=new Workspace();await workspace.selectVault('fixture');await workspace.openPage('synthetic');
window.workspace=workspace;
function App(){
 const state=useSyncExternalStore(workspace.subscribe,workspace.snapshot),page=state.page;
 const history=useDocumentHistory(page,patch=>workspace.updatePage(patch));
 window.fixture={history,page};
 return <Profiler id="editor" onRender={(_id,_phase,duration)=>{if(window.meter){window.meter.commits++;window.meter.reactMs+=duration;}}}><PageEditor page={page} entities={state.entities} pages={state.pages} headings={pageHeadings(page.blocks,state.entities)} onChange={history.change} onOpenEntity={()=>{}} onOpenPage={()=>{}} onCreateEntity={()=>{}} onAddAlias={async()=>{}} onSave={()=>workspace.saver.flush()} onIdentify={workspace.identifyEntities} saveStatus={workspace.pageSaveStatus(page.vault_id,page.id)}/></Profiler>;
}
createRoot(document.querySelector('#mount')).render(<App/>);
const clone=window.structuredClone,stringify=JSON.stringify,parse=JSON.parse,setItem=Storage.prototype.setItem,segment=Intl.Segmenter.prototype.segment;
const sizes=v=>v?.blocks?.length??v?.snapshot?.blocks?.length??v?.lastSent?.blocks?.length??(Array.isArray(v)&&v[0]?.id&&v[0]?.content?v.length:0);
window.resetMeter=()=>{window.meter={fullClone:0,fullStringify:0,fullParse:0,blockClone:0,blockStringify:0,cloneMs:0,stringifyMs:0,journalWrites:0,journalBytes:0,wordCalls:0,wordChars:0,html:0,rows:0,commits:0,reactMs:0};};
window.structuredClone=function(v,...args){const m=window.meter,start=performance.now();try{return clone(v,...args);}finally{if(m){if(sizes(v)>=count)m.fullClone++;if(v?.id&&v?.content)m.blockClone++;m.cloneMs+=performance.now()-start;}}};
JSON.stringify=function(v,...args){const m=window.meter,start=performance.now();try{return stringify(v,...args);}finally{if(m){if(sizes(v)>=count)m.fullStringify++;if(v?.id&&v?.content)m.blockStringify++;m.stringifyMs+=performance.now()-start;}}};
JSON.parse=function(v,...args){const result=parse(v,...args);if(window.meter&&sizes(result)>=count)window.meter.fullParse++;return result;};
Storage.prototype.setItem=function(k,v){if(window.meter&&k.startsWith('noema:page-draft:')){window.meter.journalWrites++;window.meter.journalBytes+=v.length;}return setItem.call(this,k,v);};
Intl.Segmenter.prototype.segment=function(v){if(window.meter&&this.resolvedOptions().granularity==='word'){window.meter.wordCalls++;window.meter.wordChars+=v.length;}return segment.call(this,v);};
window.ready=true;
`);
 server=await createServer({configFile:false,root:directory,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}},plugins:[{name:'profile',enforce:'pre',transform(code,id){
  if(id.endsWith('/segments.tsx'))return code.replace('  const ranges = review ?', '  if((globalThis as any).meter)(globalThis as any).meter.html++;\n  const ranges = review ?');
  if(id.endsWith('/BlockEditor.tsx'))return code.replace('  const register=useCallback((element:HTMLElement|null)=>actions.register','  if((globalThis as any).meter)(globalThis as any).meter.rows++;\n  const register=useCallback((element:HTMLElement|null)=>actions.register');
 }}]});await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results=[];
 for(const blocks of (process.env.PROFILE_BLOCKS?.split(',').map(Number)??[200,1000,2000]))for(const edits of [1,10]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?blocks='+blocks);await page.waitForFunction(()=>window.ready&&window.fixture);
  const id='b'+Math.floor(blocks/2);
  await page.evaluate(id=>{const el=document.querySelector('[data-block-id="'+id+'"] .block-content');el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);window.resetMeter();},id);
  const start=performance.now();await page.keyboard.type('x'.repeat(edits));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  const editWallMs=performance.now()-start;
  const immediate=await page.evaluate(()=>({...window.meter}));
  await page.evaluate(()=>window.resetMeter());
  await page.evaluate(()=>window.workspace.saver.flush());
  const saveBoundary=await page.evaluate(()=>({...window.meter}));
  await page.evaluate(()=>window.fixture.history.undo());
  await page.waitForFunction(()=>!window.fixture.page.blocks[Math.floor(window.fixture.page.blocks.length/2)].content[0].text.endsWith('x'));
  const grouped=await page.evaluate(()=>!window.fixture.history.canUndo);
  assert.ok(grouped,'contiguous input is one undo transaction');
  await page.evaluate(()=>window.fixture.history.redo());
  await page.waitForFunction(edits=>window.fixture.page.blocks[Math.floor(window.fixture.page.blocks.length/2)].content[0].text.endsWith('x'.repeat(edits)),edits);
  if(process.env.EXPECT_INCREMENTAL==='1') {
    for(const field of ['fullClone','fullStringify','fullParse'])assert.equal(immediate[field],0,field);
    assert.equal(immediate.blockClone,edits);assert.equal(immediate.wordCalls,edits);assert.equal(immediate.html,edits);assert.equal(immediate.rows,edits);assert.equal(immediate.journalWrites,edits);
    assert.ok(immediate.journalBytes<edits*1300);
  }
  if(errors.length)throw Error(errors.join('\n'));
  results.push({blocks,edits,editWallMs,immediate,saveBoundary,groupedUndo:grouped});await page.close();
 }
 // Reload immediately after continuous native input, without an explicit save.
 const crash=await browser.newPage();
 await crash.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?blocks=200');await crash.waitForFunction(()=>window.ready&&window.fixture);
 await crash.evaluate(()=>{const el=document.querySelector('[data-block-id="b100"] .block-content');el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});await crash.keyboard.type('z'.repeat(40));
 const finalText=await crash.evaluate(()=>window.fixture.page.blocks[100].content[0].text);
 await crash.reload();await crash.waitForFunction(()=>window.ready&&window.fixture);
 assert.equal(await crash.evaluate(()=>window.fixture.page.blocks[100].content[0].text),finalText,'reload retains final continuous input before idle');
 await crash.close();
 console.log(JSON.stringify({fixture:process.env.MIXED_BLOCKS==='1'?'mixed prose, tables and AI explanations':'prose',reloadBeforeIdle:'passed',scope:'Native middle-block input → history → Workspace → synchronous recovery journal → PageEditor/BlockEditor commit. Save/recognition/checkpoint boundary measured separately. Browser dev build, synthetic local-only API. Wall time includes automation/RAF; operation timings are scoped.',results},null,2));
}finally{await browser?.close();await server?.close();await rm(directory,{recursive:true,force:true});}
