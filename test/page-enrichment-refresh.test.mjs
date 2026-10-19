import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {Workspace} from '../src/client/state/workspace.ts';
import {IntelligencePanel} from '../src/client/intelligence/IntelligencePanel.tsx';
import {api} from '../src/client/api.ts';
import {TAXONOMY_VERSION} from '../src/shared/domains.ts';

const domains={primaryDomainId:'mathematics',secondaryDomainIds:[],origin:'inferred',status:'inferred',taxonomyVersion:TAXONOMY_VERSION,revision:1};
const note=()=>({id:'note',vault_id:'vault',title:'Untitled',revision:1,updated_at:'',sourceIds:[],blocks:[{id:'p',type:'paragraph',checked:false,content:[{text:'A detailed note about algebra and mathematical structures.'}]}]});
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function workspaceFixture(t) {
  const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem(){},removeItem(){}}});
  const vault={id:'vault',name:'Vault',locked:false};let stored=note();
  t.mock.method(api,'vaults',async()=>[vault]);t.mock.method(api,'pages',async()=>[stored]);
  t.mock.method(api,'page',async()=>structuredClone(stored));t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'pageMetadata',async()=>structuredClone(stored));
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  const workspace=new Workspace();
  t.after(()=>{workspace.titler.dispose();workspace.saver.dispose();if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;});
  await workspace.selectVault('vault');await workspace.openPage('note');
  return {workspace,store:page=>{stored=page;}};
}
test('autosave immediately applies a completed title to the editor and sidebar',async t=>{
  const {workspace}=await workspaceFixture(t);
  t.mock.method(api,'savePage',async(_v,_id,page)=>({...page,revision:2,title:'Algebra and structures'}));
  workspace.updatePage({blocks:[{...note().blocks[0],content:[{text:'A newer persisted paragraph about algebra and structures.'}]}]});
  await workspace.saver.flush();
  assert.equal(workspace.snapshot().page.title,'Algebra and structures');
  assert.equal(workspace.snapshot().pages.find(page=>page.id==='note').title,'Algebra and structures');
});
test('a newer manual title survives a late autosave with a generated title',async t=>{
  const {workspace}=await workspaceFixture(t);let finish;let sends=0;const titles=[];
  t.mock.method(api,'savePage',async(_v,_id,page)=>{titles.push(page.title);return ++sends===1?new Promise(resolve=>{finish=()=>resolve({...page,revision:2,title:'Generated title'});}):{...page,revision:3};});
  workspace.updatePage({blocks:[{...note().blocks[0],content:[{text:'The first changed paragraph about algebra and structures.'}]}]});
  const saving=workspace.saver.flush();await settle();
  workspace.updatePage({title:'My manual title'});finish();await saving;
  assert.equal(workspace.snapshot().page.title,'My manual title');assert.deepEqual(titles,['Untitled','My manual title']);
});
test('queued body edits keep an arriving generated title on their next save',async t=>{
  const {workspace}=await workspaceFixture(t);let finish;const sent=[];
  t.mock.method(api,'savePage',async(_v,_id,page)=>{sent.push(structuredClone(page));return sent.length===1?new Promise(resolve=>{finish=()=>resolve({...page,revision:2,title:'Generated title'});}):{...page,revision:3};});
  workspace.updatePage({blocks:[{...note().blocks[0],content:[{text:'The first changed paragraph about algebra and structures.'}]}]});
  const saving=workspace.saver.flush();await settle();
  workspace.updatePage({blocks:[{...note().blocks[0],content:[{text:'The second paragraph, typed while saving the first edit.'}]}]});
  finish();await saving;
  assert.equal(sent[1].title,'Generated title');assert.equal(workspace.snapshot().page.title,'Generated title');
  assert.equal(workspace.snapshot().page.blocks[0].content[0].text,'The second paragraph, typed while saving the first edit.');
});
test('background metadata updates preserve the editor body object and do not save or navigate',async t=>{
  const {workspace,store}=await workspaceFixture(t);
  t.mock.timers.enable({apis:['setTimeout']});
  const save=t.mock.method(api,'savePage',async()=>assert.fail('Observation must not save'));
  const bodyRead=t.mock.method(api,'page',async()=>assert.fail('Observation must not reload the editor'));
  const original=workspace.snapshot().page,body=original.blocks;
  store({...original,title:'Completed title',pageDomains:domains,summaryContentHash:'fresh',enrichmentPending:false});
  workspace.titler.observe(original,true);t.mock.timers.tick(2000);await settle();
  assert.equal(workspace.snapshot().page.title,'Completed title');assert.deepEqual(workspace.snapshot().page.pageDomains,domains);
  assert.equal(workspace.snapshot().page.summaryContentHash,'fresh');assert.equal(workspace.snapshot().page.blocks,body);
  assert.equal(workspace.snapshot().view,'pages');assert.equal(workspace.snapshot().loadingPageId,null);assert.equal(save.mock.callCount(),0);
  assert.equal(bodyRead.mock.callCount(),0);
});

async function panelFixture(t,work) {
  const dom=new JSDOM('<div id="editor" contenteditable="true">Writing here</div><div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost'});
  const keys=['window','document','Node','Element','HTMLElement','Event','MutationObserver','getComputedStyle','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'];
  const prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='ResizeObserver'?class{observe(){}disconnect(){}}:dom.window[key]});
  t.mock.method(api,'suggestionVersion',async()=>({version:'unchanged'}));
  t.mock.method(api,'pageBacklinks',async()=>[]);t.mock.method(api,'relatedNotes',async()=>[]);t.mock.method(api,'suggestedSources',async()=>[]);
  const root=createRoot(document.querySelector('#mount'));
  const render=page=>root.render(React.createElement(IntelligencePanel,{page,pages:[],entities:[],onOpenPage(){},onFlush:async()=>page,onClose(){},onSettings(){},onReview(){},onSourcesChange(){},onCreateEntity(){},onOpenEntity(){}}));
  try {await work({dom,render});}finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});}
}
const summary=text=>[{kind:'summary',data:{summary:text},revision:1,contentHash:'fresh',model:'test',reasoningEffort:'low'}];
test('a completed background summary appears in its existing panel without moving editor focus or selection',async t=>{
  await panelFixture(t,async({render})=>{
    let items=[];t.mock.method(api,'enrichments',async()=>items);
    await act(async()=>render({...note(),title:'Algebra',pageDomains:domains}));
    const panel=document.querySelector('#intelligence-panel'),editor=document.querySelector('#editor');
    editor.focus();const range=document.createRange();range.setStart(editor.firstChild,3);range.collapse(true);document.getSelection().removeAllRanges();document.getSelection().addRange(range);
    items=summary('New background summary');
    await act(async()=>window.dispatchEvent(new Event('noema:ai-activity')));
    assert.equal(document.querySelector('#knowledge-summary-text').textContent,'New background summary');
    assert.equal(document.querySelector('#intelligence-panel'),panel);assert.equal(document.activeElement,editor);
    assert.equal(document.getSelection().anchorNode,editor.firstChild);assert.equal(document.getSelection().anchorOffset,3);
    const summaryDiv=document.querySelector('#knowledge-summary-text');items=summary('Updated background summary');
    await act(async()=>window.dispatchEvent(new Event('focus')));
    assert.equal(document.querySelector('#knowledge-summary-text'),summaryDiv);assert.equal(summaryDiv.textContent,'Updated background summary');
  });
});
test('a summary read finishing after navigation cannot replace the next page summary',async t=>{
  await panelFixture(t,async({render})=>{
    let finish,calls=0;t.mock.method(api,'enrichments',async(_vault,id)=>id==='other'?summary('Other page summary'):++calls===1?[]:new Promise(resolve=>{finish=resolve;}));
    await act(async()=>render(note()));
    await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(typeof finish,'function');
    await act(async()=>render({...note(),id:'other'}));
    await act(async()=>finish(summary('Old page summary')));
    assert.equal(document.querySelector('#knowledge-summary-text').textContent,'Other page summary');
  });
});
test('the visible summary refreshes on its timer without any activity notification or page change',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  await panelFixture(t,async({render})=>{
    let items=summary('Original summary');t.mock.method(api,'enrichments',async()=>items);
    await act(async()=>render(note()));
    items=summary('Completed summary');
    await act(async()=>t.mock.timers.tick(1999));assert.equal(document.querySelector('#knowledge-summary-text').textContent,'Original summary');
    await act(async()=>t.mock.timers.tick(1));assert.equal(document.querySelector('#knowledge-summary-text').textContent,'Completed summary');
  });
});
