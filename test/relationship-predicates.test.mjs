import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {canonicalRelationshipLabel,relationshipDisplayLabel} from '../src/shared/relationship-predicates.ts';
import {setupEntityDOM} from './helpers/entity-dom.mjs';

test('canonical predicates normalize known direction-preserving variants and preserve custom meanings',()=>{
 assert.equal(canonicalRelationshipLabel(' wrote '),'Author of');
 assert.equal(canonicalRelationshipLabel('MEMBER OF'),'Member of');
 assert.equal(canonicalRelationshipLabel(' studied alongside '),'studied alongside');
 // Inverse inputs must not be silently reversed into a different stored assertion.
 assert.equal(canonicalRelationshipLabel('Authored by'),'Authored by');
 const relation={id:'r',source_id:'author',target_id:'work',label:'wrote'};
 assert.equal(relationshipDisplayLabel(relation,'author'),'Author of');
 assert.equal(relationshipDisplayLabel(relation,'work'),'Authored by');
 assert.deepEqual(relation,{id:'r',source_id:'author',target_id:'work',label:'wrote'});
 assert.equal(relationshipDisplayLabel({...relation,label:'studied alongside'},'work'),'Incoming · studied alongside');
});

test('relationship editor displays inverse from the original record and preserves custom drafts after failed saves',async t=>{
 const env=await setupEntityDOM(t),{root,dom,click}=env;
 const {RelationshipEditor}=await import('../src/client/knowledge/EntityDetails.tsx');
 const entity={id:'work',vault_id:'v',name:'A work',type:'creativework',subtypes:[],aliases:[],description:'',updated_at:'',properties:[],propertyNames:[],incomingProperties:[],relationships:[{id:'incoming',source_id:'author',target_id:'work',label:'wrote'}]};
 const author={...entity,id:'author',name:'An author',type:'person'};
 const saved=[],removed=[];let fail=true;
 try{
  await act(async()=>root.render(React.createElement(RelationshipEditor,{entity,entities:[entity,author],mention:id=>React.createElement('span',null,id),onSave:async(input,id)=>{saved.push({input,id});if(fail)throw new Error('Storage unavailable');},onRemove:async id=>removed.push(id)})));
  assert.equal(document.querySelector('.entity-relationship-target strong').textContent,'Authored by');
  assert.match(document.querySelector('.entity-relationship-target').title,/An author · wrote · A work/);
  assert.equal(document.querySelector('.entity-relationship-actions'),null);
  await click('.entity-add-connection');
  const label=document.querySelector('[aria-label="Relationship name"]'),target=document.querySelector('[aria-label="Related entity"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(label,'studied alongside');
  await act(async()=>label.dispatchEvent(new dom.window.Event('input',{bubbles:true})));
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(target,'author');
  await act(async()=>target.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
  const submit=(repeat=false)=>act(async()=>{const form=document.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));if(repeat)form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  await submit(true);assert.equal(saved.length,1);assert.equal(label.value,'studied alongside');assert.match(document.querySelector('[role="alert"]').textContent,/Could not save/);
  fail=false;await submit();assert.equal(document.querySelector('form'),null);
  assert.deepEqual(saved,[{input:{label:'studied alongside',target_id:'author'},id:undefined},{input:{label:'studied alongside',target_id:'author'},id:undefined}]);
  assert.deepEqual(removed,[]);assert.equal(entity.relationships.length,1);
 }finally{await env.close();}
});
