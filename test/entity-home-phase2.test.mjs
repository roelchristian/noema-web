import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import {entityTypes} from '../src/shared/domain.ts';
import {clearEntityDrafts,getEntityOverviewDraft,setEntityOverviewDraft,hasUnsavedEntityDrafts,pruneEntityDrafts} from '../src/client/knowledge/entity-drafts.ts';

async function fixture(t,work) {
 const env=setupDOM(t),{dom}=env;
 const {createRoot}=await import('react-dom/client');
 const {EntityHome}=await import('../src/client/knowledge/EntityHome.tsx');
 let entity={id:'ada',vault_id:'v',name:'Ada',type:'person',description:'Short description',subtypes:[],aliases:[],domainIds:[],updated_at:'',properties:[],propertyNames:[],relationships:[],incomingProperties:[],pageMentions:[],linkedPages:[],overview:{content:'Original overview',revision:1}};
 const page={id:'page',title:'History',updated_at:'',icon:''};
 t.mock.method(api,'entity',async()=>entity);
 t.mock.method(api,'entitySchema',async()=>({properties:Object.fromEntries(entityTypes.map(type=>[type,[]])),subtypes:[],subtypeProperties:{}}));
 const save=t.mock.method(api,'saveEntityOverview',async(_vault,_id,input)=>{entity={...entity,overview:{content:input.content,revision:input.revision+1}};return entity;});
 const associate=t.mock.method(api,'associateEntityPage',async(_vault,_id,pageId,input)=>{const prior=entity.linkedPages.find(page=>page.id===pageId);entity={...entity,linkedPages:[...entity.linkedPages.filter(page=>page.id!==pageId),{...page,id:pageId,created_at:'',pinned:false,annotation:'',...prior,...input}]};return entity;});
 const remove=t.mock.method(api,'removeEntityPage',async(_vault,_id,pageId)=>{entity={...entity,linkedPages:entity.linkedPages.filter(page=>page.id!==pageId)};return entity;});
 let props={vaultId:'v',id:'ada',entities:[entity],pages:[page,{...page,id:'other',title:'Other page'}],refreshKey:'',onOpen(){},onOpenPage(){},onUpdated:async()=>{},onError(){}};
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const render=async(extra={})=>{props={...props,...extra};await act(async()=>root.render(React.createElement(EntityHome,props)));};
 const refresh=async(update)=>{entity={...entity,...update};await render({refreshKey:props.refreshKey+'1'});};
 const click=async(selector)=>{const node=document.querySelector(selector);assert.ok(node,selector);await act(async()=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
 const clickText=async(text)=>{const node=[...document.querySelectorAll('button')].find(button=>button.textContent===text && !button.hidden);assert.ok(node,text);await act(async()=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
 const input=async(selector,value)=>{const node=document.querySelector(selector);assert.ok(node,selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(node,value);await act(async()=>node.dispatchEvent(new Event('input',{bubbles:true})));};
 try {await render();await work({root,render,refresh,click,clickText,input,save,associate,remove,page,entity:()=>entity});} finally {clearEntityDrafts('v');await env.close();}
}

test('overview renders complete user-authored Markdown with safe HTML, links and math, separate from description',async t=>{
 await fixture(t,async({refresh})=>{
  const content='# Heading\n\n**Bold** and *emphasis* [reference](https://example.com) $x^2$\n\n- First\n- Second\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n'+('word '.repeat(350))+'FINAL_SENTINEL';
  await refresh({overview:{content,revision:2}});
  const overview=document.querySelector('.eh-overview .eh-markdown');
  assert.equal(overview.querySelector('h3').textContent,'Heading');assert.equal(overview.querySelector('strong').textContent,'Bold');assert.equal(overview.querySelector('em').textContent,'emphasis');assert.equal(overview.querySelectorAll('li').length,2);
  assert.ok(overview.querySelector('.katex'));assert.equal(overview.querySelector('a').getAttribute('href'),'https://example.com');
  assert.equal(overview.querySelector('script'),null);assert.equal(overview.querySelector('a[href^="javascript"]'),null);assert.match(overview.textContent,/<script>alert\(1\)<\/script>/);assert.match(overview.textContent,/FINAL_SENTINEL/);
  assert.equal(document.querySelector('.eh-short-description').textContent,'Short description');
 });
});

test('overview draft survives entity navigation, retries failed save and leaves short description unchanged',async t=>{
 await fixture(t,async({render,clickText,input,save})=>{
  await clickText('Edit overview');await input('.eh-overview-editor textarea','# My synthesis');
  assert.equal(getEntityOverviewDraft('v','ada').content,'# My synthesis');assert.equal(hasUnsavedEntityDrafts(),true);
  await render({id:'elsewhere'});await render({id:'ada'});
  assert.equal(document.querySelector('.eh-overview-editor textarea').value,'# My synthesis');
  save.mock.mockImplementationOnce(async()=>{throw new Error('Disk unavailable');});
  await clickText('Save overview');assert.match(document.querySelector('.eh-overview [role=alert]').textContent,/Disk unavailable/);assert.equal(document.querySelector('.eh-overview-editor textarea').value,'# My synthesis');
  await clickText('Retry save');assert.deepEqual(save.mock.calls[1].arguments,['v','ada',{content:'# My synthesis',revision:1}]);
  assert.equal(getEntityOverviewDraft('v','ada'),undefined);assert.equal(document.querySelector('.eh-overview h3').textContent,'My synthesis');assert.equal(document.querySelector('.eh-short-description').textContent,'Short description');
 });
});

test('overview revision conflict requires explicit comparison and rebase; cancel clears draft',async t=>{
 await fixture(t,async({refresh,clickText,input,save})=>{
  await clickText('Edit overview');await input('.eh-overview-editor textarea','My draft');
  await refresh({overview:{content:'Changed elsewhere',revision:2}});
  assert.ok(document.querySelector('.eh-overview-conflict'));assert.equal([...document.querySelectorAll('button')].find(button=>button.textContent==='Save overview').disabled,true);
  assert.equal(document.querySelector('.eh-overview-editor textarea').value,'My draft');assert.equal(save.mock.callCount(),0);
  await clickText('Keep my draft against this version');await clickText('Save overview');assert.deepEqual(save.mock.calls[0].arguments,['v','ada',{content:'My draft',revision:2}]);
  await clickText('Edit overview');await input('.eh-overview-editor textarea','Discard');await clickText('Cancel');assert.equal(getEntityOverviewDraft('v','ada'),undefined);assert.equal(document.querySelector('.eh-overview-editor'),null);
 });
});

test('pinning mentions deduplicates homepage page count, unpin retains association and remove leaves mentions',async t=>{
 await fixture(t,async({refresh,clickText,click,associate,remove,page})=>{
  await refresh({pageMentions:[{...page,mentionCount:2,excerpt:'An inline mention'}]});await click('#entity-home-tab-mentions');await clickText('Pin page');
  assert.deepEqual(associate.mock.calls[0].arguments,['v','ada','page',{pinned:true}]);assert.match(document.querySelector('.eh-counts').textContent,/1 page0 connections/);
  await click('#entity-home-tab-overview');assert.equal(document.querySelectorAll('.eh-linked-page').length,1);await clickText('Unpin');assert.equal(remove.mock.callCount(),0);assert.equal(document.querySelectorAll('.eh-linked-page').length,1);
  await clickText('Remove');assert.deepEqual(remove.mock.calls[0].arguments,['v','ada','page']);assert.equal(document.querySelectorAll('.eh-linked-page').length,0);assert.match(document.querySelector('.eh-counts').textContent,/1 page0 connections/);assert.match(document.querySelector('.entity-page-mentions').textContent,/An inline mention/);
 });
});

test('attach search excludes linked pages and annotation remains editable on a failed save',async t=>{
 await fixture(t,async({clickText,input,associate})=>{
  await clickText('Attach existing page');await input('.eh-page-picker input','Hist');assert.equal(document.querySelectorAll('.eh-page-picker li').length,1);await clickText('Attach & pin');
  assert.deepEqual(associate.mock.calls[0].arguments,['v','ada','page',{pinned:true}]);assert.equal(document.querySelectorAll('.eh-page-picker li').length,0);
  await clickText('Add note');await input('.eh-annotation-form input','Read this first.');associate.mock.mockImplementationOnce(async()=>{throw new Error('Storage unavailable');});
  const submit=()=>act(async()=>document.querySelector('.eh-annotation-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await submit();assert.match(document.querySelector('[role=alert]').textContent,/Storage unavailable/);assert.equal(document.querySelector('.eh-annotation-form input').value,'Read this first.');assert.ok(document.querySelector('[aria-label="Unpin History"]'));
  await submit();assert.equal(document.querySelector('.eh-annotation-form'),null);assert.match(document.querySelector('.eh-page-open').textContent,/Read this first/);
 });
});

test('late create-associated-page response cannot change navigation after leaving the entity',async t=>{
 await fixture(t,async({render,clickText})=>{
  let resolvePage,opened;const pending=new Promise(resolve=>{resolvePage=resolve;});
  await render({onCreatePage:()=>pending,onOpenPage:id=>{opened=id;}});await clickText('Create associated page');await render({id:'elsewhere'});
  await act(async()=>resolvePage({id:'new',title:'New',updated_at:''}));assert.equal(opened,undefined);
 });
});

test('vault cleanup and entity pruning remove overview drafts from unsaved tracking',()=>{
 clearEntityDrafts('v');setEntityOverviewDraft('v','ada',{content:'Draft',baseline:'',revision:0});assert.equal(hasUnsavedEntityDrafts(),true);
 pruneEntityDrafts('v',[]);assert.equal(getEntityOverviewDraft('v','ada'),undefined);assert.equal(hasUnsavedEntityDrafts(),false);
 setEntityOverviewDraft('v','ada',{content:'Draft',baseline:'',revision:0});clearEntityDrafts('v');assert.equal(hasUnsavedEntityDrafts(),false);
});


test('overview can save against a newer revision that restored the original baseline content',async t=>{
 await fixture(t,async({refresh,clickText,input,save})=>{
  await clickText('Edit overview');await input('.eh-overview-editor textarea','My unchanged draft');
  await refresh({overview:{content:'Original overview',revision:3}});
  assert.equal(document.querySelector('.eh-overview-conflict'),null);assert.equal(getEntityOverviewDraft('v','ada').revision,3);
  assert.equal(document.querySelector('.eh-overview-editor textarea').maxLength,100000);
  await clickText('Save overview');assert.deepEqual(save.mock.calls[0].arguments,['v','ada',{content:'My unchanged draft',revision:3}]);
 });
});
