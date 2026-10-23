import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {EntityPropertyList} from '../src/client/knowledge/EntityPropertyList.tsx';
import {getPropertyDraft,setPropertyDraft,clearPropertyDrafts,propertyDraftSignature} from '../src/client/knowledge/entity-property-drafts.ts';
import {hasUnsavedEntityDrafts} from '../src/client/knowledge/entity-drafts.ts';

async function fixture(work){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost'});
 const keys=['window','document','Node','Element','HTMLElement','HTMLSelectElement','HTMLInputElement','HTMLTextAreaElement','Event','CustomEvent','MutationObserver','getComputedStyle','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
 const entity={id:'e',vault_id:'property-test',name:'Ada',type:'person',subtypes:[],description:'',properties:[{id:'birth',entity_id:'e',name:'birth date',value:'circa 1815',target_id:null}],propertyNames:['birth date','birthplace'],relationships:[],incomingProperties:[],updated_at:''};
 const entities=[{...entity,id:'place',name:'London',type:'place',aliases:['Londinium']},{...entity,id:'person',name:'Charles',type:'person'}];
 let saves=[],removes=[];
 const props={vaultId:'property-test',entity,entities,mention:id=>React.createElement('span',null,id),onSave:async(input,id)=>{saves.push({input,id});},onRemove:async id=>{removes.push(id);}};
 let root=createRoot(document.querySelector('#mount'));
 const render=async(p=props)=>act(async()=>root.render(React.createElement(EntityPropertyList,p)));
 const click=async(selector)=>{const target=document.querySelector(selector);assert.ok(target,selector);await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 const edit=async(patch)=>act(async()=>{const draft=getPropertyDraft('property-test','e','birth');setPropertyDraft('property-test','e','birth',{...draft,...patch});});
 try{await render();await work({dom,props,entity,saves,removes,click,edit,render,remount:async()=>{await act(async()=>root.unmount());root=createRoot(document.querySelector('#mount'));await render();}});}
 finally{await act(async()=>root.unmount());clearPropertyDrafts('property-test');dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}

test('inline values preserve authored dates and retain failed drafts across navigation with explicit retry',async()=>{
 await fixture(async({props,click,edit,render,remount,saves,dom})=>{
  assert.equal(document.querySelector('dt').textContent,'Birth Date');
  await click('[aria-label="Edit Birth Date"]');await edit({value:'about 1816'});
  assert.equal(hasUnsavedEntityDrafts(),true);
  await remount();assert.equal(document.querySelector('textarea').value,'about 1816');
  await render({...props,onSave:async()=>{throw new Error('offline');}});
  await act(async()=>document.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.match(document.querySelector('[role="alert"]').textContent,/retained/);
  await render();await click('.entity-inline-actions button:last-child');
  assert.deepEqual(saves,[{input:{name:'birth date',value:'about 1816'},id:'birth'}]);
  assert.equal(getPropertyDraft('property-test','e','birth'),undefined);
 });
});
test('reference picker infers permitted targets and retains explicit unresolved text route',async()=>{
 await fixture(async({click})=>{
  await click('[aria-label="Edit Birthplace"]');
  assert.ok(document.querySelector('option[value="place"]'));
  assert.equal(document.querySelector('option[value="person"]'),null);
  const button=[...document.querySelectorAll('.entity-inline-kind button')].find(button=>button.textContent==='Unresolved text');
  await act(async()=>button.click());assert.ok(document.querySelector('textarea[aria-label="Birthplace"]'));
 });
});
test('removal confirms before mutation and Escape discards without saving',async()=>{
 await fixture(async({click,edit,saves,removes,dom})=>{
  await click('[aria-label="Remove Birth Date"]');assert.equal(removes.length,0);
  await click('[role="alertdialog"] button:last-child');assert.equal(removes.length,0);
  await click('[aria-label="Edit Birth Date"]');await edit({value:'different'});
  await act(async()=>document.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(document.querySelector('textarea'),null);assert.equal(saves.length,0);
  await click('[aria-label="Remove Birth Date"]');await click('[role="alertdialog"] button');assert.deepEqual(removes,['birth']);
 });
});
test('Enter on Discard and entity search never submits an unintended edit',async()=>{
 await fixture(async({click,edit,saves,dom})=>{
  await click('[aria-label="Edit Birth Date"]');await edit({value:'different'});
  const discard=document.querySelector('.entity-inline-actions button');
  await act(async()=>discard.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.equal(saves.length,0);
  await click('.entity-inline-actions button');await click('[aria-label="Edit Birthplace"]');
  const initial={kind:'entity',target:'place',value:''};await act(async()=>setPropertyDraft('property-test','e','new:birthplace',{...initial,baseline:propertyDraftSignature({...initial,target:''})}));
  await act(async()=>document.querySelector('input[type="search"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.equal(saves.length,0);
 });
});

test('different field saves serialize full-detail mutations without dropping a queued blur commit',async()=>{
 await fixture(async({props,click,edit,render,dom})=>{
  let release;const calls=[];
  await render({...props,onSave:async(input)=>{calls.push(input.name);if(input.name==='birth date')await new Promise(resolve=>release=resolve);}});
  await click('[aria-label="Edit Birth Date"]');await edit({value:'1816'});
  await act(async()=>document.querySelector('textarea[aria-label="Birth Date"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  await click('[aria-label="Edit Birthplace"]');
  const draft=getPropertyDraft('property-test','e','new:birthplace');
  await act(async()=>setPropertyDraft('property-test','e','new:birthplace',{...draft,target:'place'}));
  await click('.entity-inline-suggestions .entity-inline-actions button:last-child');
  assert.deepEqual(calls,['birth date']);
  await act(async()=>release());assert.deepEqual(calls,['birth date','birthplace']);
 });
});
test('retry reconciles a lost create response and refuses another create when reconciliation is unavailable',async()=>{
 await fixture(async({props,click,render})=>{
  let creates=0,readFails=true;
  const committed={id:'server-new',entity_id:'e',name:'birthplace',target_id:'place',value:null};
  await render({...props,onSave:async()=>{creates++;throw new Error('response lost');},onRefresh:async()=>{if(readFails)throw new Error('offline');return {...props.entity,properties:[...props.entity.properties,committed]};}});
  await click('[aria-label="Edit Birthplace"]');
  const draft=getPropertyDraft('property-test','e','new:birthplace');
  await act(async()=>setPropertyDraft('property-test','e','new:birthplace',{...draft,target:'place'}));
  await click('.entity-inline-suggestions .entity-inline-actions button:last-child');assert.equal(creates,1);
  assert.equal(document.querySelector('.entity-inline-suggestions input[type=search]').disabled,true,'uncertain create keeps the attempted value fixed until reconciliation');
  assert.equal(document.querySelector('.entity-inline-suggestions select').disabled,true);
  await click('.entity-inline-suggestions .entity-inline-actions button:last-child');assert.equal(creates,1);assert.ok(getPropertyDraft('property-test','e','new:birthplace'));
  readFails=false;await click('.entity-inline-suggestions .entity-inline-actions button:last-child');
  assert.equal(creates,1);assert.equal(getPropertyDraft('property-test','e','new:birthplace'),undefined);
 });
});

test('persisted definitions select typed controls while incompatible authored values remain editable explicitly',async()=>{
 const {builtinPropertyDefinitions}=await import('../src/shared/property-definitions.ts');
 await fixture(async({props,render,click})=>{
  await render({...props,definitions:builtinPropertyDefinitions,entity:{...props.entity,properties:[{...props.entity.properties[0],metadata:{definition_id:'builtin:person:birth_date',compatibility:'legacy_incompatible',reason:'Preserve original precision'}}]}});
  await click('[aria-label="Edit Birth Date"]');
  assert.equal(document.querySelector('.entity-property-compatibility input').checked,true);
  assert.equal(document.querySelector('textarea').value,'circa 1815');
  assert.equal(hasUnsavedEntityDrafts(),false,'activation alone preserves baseline compatibility state');
  await act(async()=>document.querySelector('.entity-property-compatibility input').click());
  assert.ok(document.querySelector('input[aria-label="Birth Date"]'));
  assert.match(document.querySelector('.entity-inline-edit').textContent,/calendar notation/);
 });
});
test('typed URL save submits definition identity and validation errors leave new draft editable',async()=>{
 const {builtinPropertyDefinitions}=await import('../src/shared/property-definitions.ts');
 const {ApiError}=await import('../src/client/api.ts');
 await fixture(async({props,render,click,dom})=>{
  await render({...props,definitions:builtinPropertyDefinitions,entity:{...props.entity,propertyNames:['website']},onSave:async()=>{throw new ApiError(400,'Enter an HTTP or HTTPS URL');}});
  await click('[aria-label="Edit Website"]');assert.ok(document.querySelector('input[type="url"]'));
  const draft=getPropertyDraft('property-test','e','new:website');
  await act(async()=>setPropertyDraft('property-test','e','new:website',{...draft,value:'invalid'}));
  await act(async()=>document.querySelector('input[type="url"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.match(document.querySelector('[role="alert"]').textContent,/HTTP/);
  assert.equal(document.querySelector('input[type="url"]').disabled,false);
  assert.equal(getPropertyDraft('property-test','e','new:website').uncertainCreate,undefined);
 });
});
test('reference picker requests bounded server pages and creates then returns to the unfinished property',async t=>{
 const {api}=await import('../src/client/api.ts');let requested=[],created=[];
 t.mock.method(api,'entityReferenceOptions',async(_vault,options)=>{requested.push(options);return {items:[{id:'page-'+options.offset,name:'Place '+options.offset,type:'place',subtypes:[],aliases:[]}],nextOffset:options.offset===0?30:null,total:31};});
 t.mock.method(api,'createEntity',async(_vault,input)=>{created.push(input);return {id:'created-place',name:input.name,type:input.type,subtypes:[],aliases:[]};});
 await fixture(async({click,dom,remount})=>{
  await click('[aria-label="Edit Birthplace"]');assert.equal(requested.at(-1).limit,30);assert.deepEqual(requested.at(-1).types,['place']);
  const more=[...document.querySelectorAll('.entity-reference-picker button')].find(button=>button.textContent==='More matches');await act(async()=>more.click());assert.equal(requested.at(-1).offset,30);
  const create=[...document.querySelectorAll('.entity-reference-picker button')].find(button=>button.textContent==='Create a new entity');await act(async()=>create.click());
  const draft=getPropertyDraft('property-test','e','new:birthplace');await act(async()=>setPropertyDraft('property-test','e','new:birthplace',{...draft,referenceCreation:{open:true,name:'New place',type:'place',uncertain:false}}));await remount();
  const submit=[...document.querySelectorAll('.entity-reference-create button')].find(button=>button.textContent==='Create and select');await act(async()=>submit.click());
  assert.deepEqual(created,[{name:'New place',type:'place',subtypes:[]}]);
  assert.equal(getPropertyDraft('property-test','e','new:birthplace').target,'created-place');
  assert.equal(document.querySelector('.entity-reference-create'),null);
 });
});
test('uncertain reference creation survives remount and cannot repeat a create request',async t=>{
 const {api}=await import('../src/client/api.ts');let creates=0;
 t.mock.method(api,'entityReferenceOptions',async()=>({items:[],nextOffset:null,total:0}));
 t.mock.method(api,'createEntity',async()=>{creates++;throw new Error('response lost');});
 await fixture(async({click,dom,remount})=>{
  await click('[aria-label="Edit Birthplace"]');
  await act(async()=>[...document.querySelectorAll('.entity-reference-picker button')].find(button=>button.textContent==='Create a new entity').click());
  const draft=getPropertyDraft('property-test','e','new:birthplace');await act(async()=>setPropertyDraft('property-test','e','new:birthplace',{...draft,referenceCreation:{open:true,name:'Uncertain place',type:'place',uncertain:false}}));await remount();
  await act(async()=>[...document.querySelectorAll('.entity-reference-create button')].find(button=>button.textContent==='Create and select').click());
  assert.equal(creates,1);assert.equal(hasUnsavedEntityDrafts(),true);
  await remount();assert.equal(document.querySelector('.entity-reference-create input').value,'Uncertain place');
  assert.equal(document.querySelector('.entity-reference-create input').disabled,true);
  assert.equal([...document.querySelectorAll('.entity-reference-create button')].find(button=>button.textContent==='Create and select').disabled,true);
  assert.equal(creates,1);
 });
});

test('new approximate dates submit the exact authored expression with typed definition identity',async()=>{
 const {builtinPropertyDefinitions}=await import('../src/shared/property-definitions.ts');
 await fixture(async({props,render,click,dom,saves})=>{
  await render({...props,definitions:builtinPropertyDefinitions,entity:{...props.entity,properties:[],propertyNames:['birth date']}});
  await click('[aria-label="Edit Birth Date"]');
  const draft=getPropertyDraft('property-test','e','new:birth date');await act(async()=>setPropertyDraft('property-test','e','new:birth date',{...draft,value:'circa 1815'}));
  await act(async()=>document.querySelector('input[aria-label="Birth Date"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.deepEqual(saves,[{input:{name:'birth date',value:'circa 1815',definition_id:'builtin:person:birth_date'},id:undefined}]);
 });
});

test('persisted display labels change presentation while keeping immutable stored names',async()=>{
 await fixture(async({props,render,click,saves})=>{
  const definition={id:'custom:birth',key:'birth_date',legacyName:'birth date',label:'Recorded Date',description:'',scope:{kind:'main_type',type:'person'},valueKind:'short_text',cardinality:'many',allowedTargetTypes:[],allowedTargetSubtypes:[],validation:{},origin:'user_defined',visibility:'additional',sortOrder:1,editable:true,compatibility:'legacy'};
  await render({...props,definitions:[definition]});
  assert.equal(document.querySelector('dt').textContent,'Recorded Date');await click('[aria-label="Edit Recorded Date"]');
  assert.equal(document.querySelector('textarea[aria-label="Recorded Date"]').value,'circa 1815');assert.equal(saves.length,0);
 });
});
