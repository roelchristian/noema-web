// Optional browser harness: install playwright-core outside the project, then set
// PLAYWRIGHT_MODULE to its absolute index.mjs. Uses the system Chromium on Linux.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const repo=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'noema-editor-browser-'));
let server,browser;
try {
  await symlink(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
  await writeFile(join(directory,'index.html'),'<!doctype html><div id="mount"></div><script type="module" src="/fixture.tsx"></script>');
  await writeFile(join(directory,'fixture.tsx'),`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {immutableBlocks} from '/@fs/${repo}/src/shared/immutable-blocks.ts';
import {BlockEditor} from '/@fs/${repo}/src/client/editor/BlockEditor.tsx';
import {useDocumentHistory} from '/@fs/${repo}/src/client/editor/use-document-history.ts';
import {CitationPresentationContext} from '/@fs/${repo}/src/client/sources/CitationPresentation.tsx';
import {noteCitations} from '/@fs/${repo}/src/shared/citations.ts';
import {api} from '/@fs/${repo}/src/client/api.ts';
api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
function App(){
 const [page,setPage]=useState({id:'fictitious',vault_id:'fixture',title:'Fictitious note',sourceIds:[],revision:1,blocks:immutableBlocks(Array.from({length:200},(_,i)=>({id:'b'+(i+1),type:'paragraph',checked:false,content:[{text:i===199?'':'Fictitious paragraph '+(i+1)}]})))});
 const [entities,setEntities]=useState([]);
 const history=useDocumentHistory(page,patch=>setPage(current=>({...current,...patch})));
 window.fixture={page,setPage,setEntities,history};
 return React.createElement(CitationPresentationContext.Provider,{value:{style:'references',entries:noteCitations(page.blocks)}},React.createElement('article',{className:'page',onCompositionStart:e=>{e.currentTarget.dataset.entityComposing='true';},onCompositionEnd:e=>{delete e.currentTarget.dataset.entityComposing;}},React.createElement(BlockEditor,{vaultId:'fixture',blocks:page.blocks,entities,onChange:blocks=>history.change({blocks}),onOpenEntity(){},onCreateEntity(){},onAddAlias:async()=>{},onSave(){}})));
}
createRoot(document.querySelector('#mount')).render(React.createElement(App));`);
  server=await createServer({configFile:false,root:directory,server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]}},plugins:[{name:'measure-editor',enforce:'pre',transform(code,id){
    if(id.endsWith('/BlockEditor.tsx'))return code.replace('  const register=useCallback((element:HTMLElement|null)=>actions.register','  (globalThis as any).__editorMetrics?.rows.push(block.id);\n  const register=useCallback((element:HTMLElement|null)=>actions.register');
    if(id.endsWith('/segments.tsx'))return code.replace('  const changed = !segmentsEqual','  (globalThis as any).__editorMetrics?.syncs.push(location.blockId);\n  const changed = !segmentsEqual');
    if(id.endsWith('/preserve-caret.ts'))return code.replace('export function replaceEditableHTML(element: HTMLElement, html: string) {','export function replaceEditableHTML(element: HTMLElement, html: string) {\n  (globalThis as any).__editorMetrics?.replacements.push(element.closest<HTMLElement>(\'[data-block-id]\')?.dataset.blockId);');
  }}]});
  await server.listen();
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const host=page.locator('[data-block-id="b87"] .block-content');await host.waitFor();
  async function caret(id,offset){await page.evaluate(({id,offset})=>{const el=document.querySelector('[data-block-id="'+id+'"] .block-content');el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),text=offset==='end'?Array.from((function*(){let n;while(n=walker.nextNode())yield n;})()).at(-1):walker.nextNode();const range=document.createRange();range.setStart(text,offset==='end'?text.length:offset);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);},{id,offset});}
  await caret('b87','end');
  await page.evaluate(()=>{window.nativeNode=getSelection().anchorNode;window.__editorMetrics={rows:[],syncs:[],replacements:[]};});
  await page.keyboard.type('x');
  const metrics=await page.evaluate(()=>({...window.__editorMetrics,caretPreserved:getSelection().anchorNode===window.nativeNode,offset:getSelection().anchorOffset}));
  assert.deepEqual(metrics.rows,['b87']);assert.deepEqual(metrics.syncs,['b87']);assert.deepEqual(metrics.replacements,[]);assert.ok(metrics.caretPreserved);
  const typed=await host.textContent();assert.equal(typed,'Fictitious paragraph 87x');
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.fixture.page.blocks[86].content[0].text==='Fictitious paragraph 87');
  await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>window.fixture.page.blocks[86].content[0].text==='Fictitious paragraph 87x');
  await caret('b87',5);await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.fixture.page.blocks[86].content[0].text==='Ficti');
  assert.equal(await page.evaluate(()=>window.fixture.page.blocks[87].content[0].text),'tious paragraph 87x');
  await page.keyboard.press('Backspace');await page.waitForFunction(()=>window.fixture.page.blocks.length===200);
  assert.equal(await host.textContent(),'Ficti tious paragraph 87x');
  await caret('b87','end');await page.evaluate(()=>navigator.clipboard.writeText(' fictitious paste'));await page.keyboard.press('Control+v');
  await page.waitForFunction(()=>window.fixture.page.blocks[86].content.map(s=>s.text??'').join('').includes('fictitious paste'));
  await caret('b87',0);await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');
  await page.keyboard.press('Control+b');await host.locator('strong,b').waitFor();
  // A cross-block text selection survives an unrelated parent render.
  await page.evaluate(()=>{const a=document.querySelector('[data-block-id="b85"] .block-content'),b=document.querySelector('[data-block-id="b86"] .block-content'),r=document.createRange();r.setStart(a.firstChild.firstChild,2);r.setEnd(b.firstChild.firstChild,4);getSelection().removeAllRanges();getSelection().addRange(r);window.selectedText=getSelection().toString();window.fixture.setPage(p=>({...p,revision:p.revision+1}));});
  assert.ok(await page.evaluate(()=>getSelection().toString()===window.selectedText));
  await caret('b88','end');const cdp=await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'語',selectionStart:1,selectionEnd:1});
  assert.ok(await page.evaluate(()=>document.querySelector('article').hasAttribute('data-entity-composing')));
  await cdp.send('Input.insertText',{text:'語'});
  await page.waitForFunction(()=>window.fixture.page.blocks.find(b=>b.id==='b88').content.map(s=>s.text??'').join('').endsWith('語'));
  assert.ok(await page.evaluate(()=>!document.querySelector('article').hasAttribute('data-entity-composing')));
  await page.evaluate(()=>window.fixture.setPage(p=>({...p,blocks:p.blocks.map(b=>b.id==='b89'?{...b,content:[{entityId:'fictitious-entity'}]}:b)})));
  await page.evaluate(()=>window.fixture.setEntities([{id:'fictitious-entity',name:'Fictitious Person',type:'person',subtypes:[]}]));
  await page.waitForFunction(()=>document.querySelector('[data-block-id="b89"]').textContent.includes('Fictitious Person'));
  await page.evaluate(()=>window.fixture.setEntities([{id:'fictitious-entity',name:'Renamed Fiction',type:'organization',subtypes:[]}]));
  await page.waitForFunction(()=>document.querySelector('[data-block-id="b89"] .mention.organization')?.textContent.includes('Renamed Fiction'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:await browser.version(),typingMetrics:metrics,passed:['native typing/caret','undo/redo with current history','split/merge','native clipboard paste','format shortcut','cross-block selection','CDP IME composition/commit','entity rename/type'],errors}));
} finally {if(browser)await browser.close();if(server)await server.close();await rm(directory,{recursive:true,force:true});}
