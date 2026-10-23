import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {EntityPanel} from '../src/client/knowledge/EntityPanel.tsx';
import {entityTypes} from '../src/shared/domain.ts';
import {api} from '../src/client/api.ts';
import {entityDraftValues,setEntityDraft,hasEntityDraft,clearEntityDrafts} from '../src/client/knowledge/entity-drafts.ts';

async function fixture(t,work){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost:5173'});
 const keys=['window','document','Node','Element','HTMLElement','HTMLSelectElement','HTMLInputElement','Event','CustomEvent','MutationObserver','getComputedStyle','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLElement.prototype.scrollTo=function(){};
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 dom.window.HTMLElement.prototype.attachEvent=function(){};
 dom.window.HTMLElement.prototype.detachEvent=function(){};
 const entity={id:'e',vault_id:'v',name:'Ada',type:'person',description:'A mathematician.',subtypes:[],domainIds:[],aliases:['A.'],mentionCase:'canonical',properties:[],propertyNames:['Born'],relationships:[],incomingProperties:[],pageMentions:[],attachments:[],updated_at:'2026-10-19'};
 const other={...entity,id:'other',name:'London',type:'place'};
 t.mock.method(api,'entity',async()=>entity);
 t.mock.method(api,'entitySchema',async()=>({properties:Object.fromEntries(entityTypes.map(type=>[type,[]])),subtypes:[],subtypeProperties:{}}));
 const props={vaultId:'v',id:'e',entities:[entity,other],refreshKey:'',onOpen(){},onClose(){},onUpdated:async()=>{},onError(error){throw error;},onOpenPage(){},onCreatePageFromSource(){}};
 const root=createRoot(document.querySelector('#mount'));
 const click=async selector=>{const target=document.querySelector(selector);assert.ok(target,selector);await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 try{await act(async()=>root.render(React.createElement(EntityPanel,props)));await click('#entity-tab-edit');await work({entity,click,dom,props,root});}
 finally{await act(async()=>root.unmount());clearEntityDrafts('v');dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}

test('entity editor preserves drafts across tabs and saves from its primary action',async t=>{
 await fixture(t,async({entity,click})=>{
  let saved;
  t.mock.method(api,'updateEntity',async(_vault,_id,input)=>{saved=input;return {...entity,...input};});
  const baseline=entityDraftValues(entity);
  await act(async()=>setEntityDraft('v','e',baseline,{...baseline,name:'Ada Lovelace',description:'Computing pioneer.'}));
  await click('#entity-tab-overview');await click('#entity-tab-edit');
  assert.equal(document.querySelector('[aria-label="Entity name"]').value,'Ada Lovelace');
  assert.match(document.querySelector('#entity-saved').textContent,/Unsaved/);
  await act(async()=>document.querySelector('#entity-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(saved.name,'Ada Lovelace');assert.equal(saved.description,'Computing pioneer.');
  assert.equal(hasEntityDraft('v','e'),false);
  assert.equal(document.querySelector('[aria-label="Save entity details"]').disabled,true);
 });
});
test('property and relationship forms open deliberately and cancel without saving',async t=>{
 await fixture(t,async({click})=>{
  const save=t.mock.method(api,'saveProperty',async()=>assert.fail('Cancelled property was saved'));
  const relationship=t.mock.method(api,'saveRelationship',async()=>assert.fail('Cancelled relationship was saved'));
  assert.equal(document.querySelector('form[aria-label="Add property"]'),null);
  await click('.entity-property-unset button');
  assert.equal(document.querySelector('[aria-label="Property name"]').value,'Born');
  await click('[aria-label="Close property editor"]');
  assert.equal(document.querySelector('form[aria-label="Add property"]'),null);
  assert.equal(document.querySelector('[aria-label="Relationship name"]'),null);
  await click('.entity-add-connection');
  assert.ok(document.querySelector('[aria-label="Relationship name"]'));
  assert.equal(document.querySelector('.entity-relationship-form [type="submit"]').disabled,true);
  await click('[aria-label="Close relationship editor"]');
  assert.equal(document.querySelector('[aria-label="Relationship name"]'),null);
  assert.equal(save.mock.calls.length,0);assert.equal(relationship.mock.calls.length,0);
 });
});

test('advanced and inline property forms share drafts without changing identity Save/Discard',async t=>{
 const {setPropertyDraft,getPropertyDraft,propertyDraftSignature}=await import('../src/client/knowledge/entity-property-drafts.ts');
 await fixture(t,async({click,dom,entity})=>{
  let saved;
  t.mock.method(api,'saveProperty',async(_vault,_id,input)=>{saved=input;return {...entity,properties:[{id:'new-born',entity_id:'e',name:'Born',value:input.value,target_id:null}]};});
  await click('.entity-property-unset button');
  await act(async()=>setPropertyDraft('v','e','new:Born',{kind:'text',value:'  ',target:'',baseline:propertyDraftSignature({kind:'text',value:'',target:''})}));
  assert.equal(document.querySelector('[aria-label="Property value"]').value,'  ');
  assert.equal(document.querySelector('[aria-label="Save entity details"]').disabled,true);
  await click('#entity-tab-overview');assert.equal(document.querySelector('.entity-inline-edit textarea').value,'  ');
  await click('#entity-tab-edit');assert.equal(document.querySelector('[aria-label="Property value"]').value,'  ');
  await act(async()=>setPropertyDraft('v','e','new:Born',{...getPropertyDraft('v','e','new:Born'),value:'1815'}));
  await act(async()=>document.querySelector('form[aria-label="Add property"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(saved,{name:'Born',value:'1815'});assert.equal(getPropertyDraft('v','e','new:Born'),undefined);
 });
});
