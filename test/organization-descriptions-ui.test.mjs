import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import {collectionDefinitionUnchanged} from '../src/client/organization/collection-draft.ts';

test('sidebar collection popover creates manual collections, retains failed drafts, and opens smart rules without a modal',async t=>{
 const env=setupDOM(t),{createRoot}=await import('react-dom/client'),{CollectionCreatePopover}=await import('../src/client/organization/CollectionCreatePopover.tsx'),root=createRoot(document.querySelector('#mount'));
 env.defer(()=>act(async()=>root.unmount()));
 const openPanels=new WeakSet(),originalMatches=env.dom.window.HTMLElement.prototype.matches;
 t.mock.method(env.dom.window.HTMLElement.prototype,'matches',function(selector){return selector===':popover-open'?openPanels.has(this):originalMatches.call(this,selector);});
 env.dom.window.HTMLElement.prototype.showPopover=function(){openPanels.add(this);};
 env.dom.window.HTMLElement.prototype.hidePopover=function(){openPanels.delete(this);};
 t.mock.method(env.dom.window.HTMLElement.prototype,'getBoundingClientRect',()=>({left:20,right:40,top:20,bottom:40,width:20,height:20}));
 const previousObserver=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
 Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {observe(){}disconnect(){}}});
 env.defer(()=>{if(previousObserver)Object.defineProperty(globalThis,'ResizeObserver',previousObserver);else delete globalThis.ResizeObserver;});
 const data={collections:[],folders:[],memberships:[],locations:[],favourites:[]},saves=[],changes=[];
 let fail=true,domainLoads=0;
 t.mock.method(api,'domains',async()=>{domainLoads++;return {domains:[]};});t.mock.method(api,'entities',async()=>[]);
 t.mock.method(api,'organize',async(vault,route,body,method)=>{saves.push({vault,route,body,method});if(fail)throw new Error('Please try again');return data;});
 await act(async()=>root.render(React.createElement(CollectionCreatePopover,{vaultId:'fixture',data,pages:[],disabled:false,onChanged:result=>changes.push(result)})));
 const click=async text=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith(text));assert.ok(button,text);await act(async()=>button.click());};
 const trigger=document.querySelector('[aria-label="Collection actions"]');
 await act(async()=>trigger.click());
 assert.equal(document.querySelectorAll('[role="menuitem"]').length,2);
 await click('Add collection');assert.equal(document.querySelector('dialog'),null);assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'),'Add collection');assert.equal(domainLoads,0);
 const name=document.querySelector('input');Object.getOwnPropertyDescriptor(env.dom.window.HTMLInputElement.prototype,'value').set.call(name,'Reading list');await act(async()=>name.dispatchEvent(new Event('input',{bubbles:true})));
 await click('Create collection');assert.match(document.querySelector('[role="alert"]').textContent,/Please try again/);assert.equal(name.value,'Reading list');assert.equal(changes.length,0);
 fail=false;await click('Create collection');assert.deepEqual(saves.at(-1),{vault:'fixture',route:'collections',body:{name:'Reading list',description:'',kind:'manual'},method:'POST'});assert.deepEqual(changes,[data]);assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(document.activeElement,trigger);
 await act(async()=>trigger.click());await click('Create Smart Collection');assert.equal(domainLoads,1);assert.match(document.querySelector('[role="dialog"]').textContent,/Matching method/);assert.ok(document.querySelector('.smart-rule-group'));assert.equal(document.querySelector('dialog'),null);
 await act(async()=>document.querySelector('[role="dialog"]').dispatchEvent(new env.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(document.activeElement,trigger);
});

test('human description saves bypass unavailable matching previews and send no matching configuration or provider action',async t=>{
 const env=setupDOM(t),{createRoot}=await import('react-dom/client'),{CollectionDialog}=await import('../src/client/organization/CollectionDialog.tsx'),root=createRoot(document.querySelector('#mount')),requests=[],saves=[];env.defer(()=>act(async()=>root.unmount()));t.mock.timers.enable({apis:['setTimeout']});
 env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'domains',async()=>({domains:[]}));t.mock.method(api,'entities',async()=>[]);t.mock.method(api,'organize',async(vault,route,body)=>{saves.push({vault,route,body});return {collections:[],folders:[],memberships:[],locations:[],favourites:[]};});
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,...options});return {ok:false,status:409,json:async()=>({error:'Saved matching inputs are unavailable'})};});
 for(const matching of ['semantic','examples']){
  const collection={id:matching,name:'Existing collection',description:'Old purpose',kind:'smart',matching,...(matching==='semantic'?{semantic:{version:1,description:'Matching scope',threshold:.55,minCoverage:.5}}:{examples:{version:1,positivePageIds:['missing-a','missing-b'],negativePageIds:[],threshold:.55,minCoverage:.5,negativeMargin:.05}})},data={collections:[collection],folders:[],memberships:[],locations:[],favourites:[]};
  await act(async()=>root.render(React.createElement(CollectionDialog,{key:matching,vaultId:'fixture',data,collection,onChanged:()=>{},onClose:()=>{}})));await act(async()=>t.mock.timers.tick(400));assert.match(document.body.textContent,/Saved matching inputs are unavailable/);
  const human=document.querySelector('textarea[aria-label="Description"]');assert.equal(human.value,'Old purpose');if(matching==='semantic')assert.equal(document.querySelector('textarea[aria-label="Matching description"]').value,'Matching scope');
  Object.getOwnPropertyDescriptor(env.dom.window.HTMLTextAreaElement.prototype,'value').set.call(human,'New human purpose');await act(async()=>human.dispatchEvent(new Event('input',{bubbles:true})));
  const save=[...document.querySelectorAll('button')].find(button=>button.textContent==='Save collection');assert.equal(save.disabled,false);await act(async()=>save.click());assert.deepEqual(saves.at(-1),{vault:'fixture',route:'collections/'+matching,body:{name:'Existing collection',description:'New human purpose'}});
  assert.equal(collectionDefinitionUnchanged(collection,{kind:'smart',matching,...(matching==='semantic'?{semantic:{minCoverage:.5,threshold:.55,description:'Matching scope',version:1}}:{examples:collection.examples})}),true);
  assert.equal(collectionDefinitionUnchanged(collection,{kind:'smart',matching:matching==='semantic'?'examples':'semantic'}),false);
 }
 assert.ok(requests.every(request=>request.url.endsWith('semantic-preview')||request.url.endsWith('example-preview')));assert.equal(saves.length,2);
});
