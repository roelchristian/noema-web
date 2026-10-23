import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupEntityDOM} from './helpers/entity-dom.mjs';
import {EntityPanel} from '../src/client/knowledge/EntityPanel.tsx';
import {entityTypes} from '../src/shared/domain.ts';
import {api} from '../src/client/api.ts';
import {entityDraftValues,setEntityDraft,hasEntityDraft} from '../src/client/knowledge/entity-drafts.ts';

async function fixture(t,work){
 const env=await setupEntityDOM(t),{dom,root,click}=env;
 const entity={id:'e',vault_id:'v',name:'Ada',type:'person',description:'A mathematician.',subtypes:[],domainIds:[],aliases:['A.'],mentionCase:'canonical',properties:[],propertyNames:['Born'],relationships:[],incomingProperties:[],pageMentions:[],attachments:[],updated_at:'2026-10-19'};
 const other={...entity,id:'other',name:'London',type:'place'};
 t.mock.method(api,'entity',async()=>entity);
 t.mock.method(api,'entitySchema',async()=>({properties:Object.fromEntries(entityTypes.map(type=>[type,[]])),subtypes:[],subtypeProperties:{}}));
 const props={vaultId:'v',id:'e',entities:[entity,other],refreshKey:'',onOpen(){},onClose(){},onUpdated:async()=>{},onError(error){throw error;},onOpenPage(){},onCreatePageFromSource(){}};
 try{await act(async()=>root.render(React.createElement(EntityPanel,props)));await click('#entity-tab-edit');await work({entity,click,dom,props,root});}
 finally{await env.close();}
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

test('classification edits preview before explicit legacy retention and keep drafts on preview failure',async t=>{
 await fixture(t,async({entity,click,dom})=>{
  let saved,previews=0;
  t.mock.method(api,'updateEntity',async(_vault,_id,input)=>{saved=input;return {...entity,...input};});
  const preview=t.mock.method(api,'entityClassificationImpact',async()=>{previews++;throw new Error('Impact preview unavailable');});
  const baseline=entityDraftValues(entity);
  await act(async()=>setEntityDraft('v','e',baseline,{...baseline,type:'place'}));
  await act(async()=>document.querySelector('#entity-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(saved,undefined);assert.equal(hasEntityDraft('v','e'),true);assert.match(document.querySelector('#entity-saved').textContent,/Impact preview unavailable/);
  preview.mock.mockImplementation(async()=>({fingerprint:'fresh-impact',requiresConfirmation:true,outgoing:[{propertyId:'old',reason:'Existing value will retain its original definition.'}],incoming:[],structuralBlockers:[]}));
  await act(async()=>document.querySelector('#entity-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(saved,undefined);assert.match(document.querySelector('[aria-label="Classification impact"]').textContent,/original definition/);
  await click('.entity-classification-impact button');assert.equal(saved.classification_mode,'retain_legacy');assert.equal(saved.impact_fingerprint,'fresh-impact');assert.equal(saved.type,'place');assert.equal(hasEntityDraft('v','e'),false);
 });
});
