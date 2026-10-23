import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {EntityScanReview} from '../src/client/intelligence/EntityScanReview.tsx';
import {api} from '../src/client/api.ts';

const suggestion=(id='mira',extra={})=>({id,name:id==='mira'?'Mira':'Sora',type:'person',subtypes:[],evidence:id==='mira'?'Mira':'Sora',reason:'Named in note',status:'pending',existingId:null,...extra});
const entity=(id,extra={})=>({id,vault_id:'default',name:'Mira',type:'person',subtypes:[],description:'',updated_at:'2026-10-23',...extra});
async function fixture(t,options={}){
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let page={id:'page',vault_id:'default',revision:1,title:'Review',sourceIds:[],blocks:[{id:'b',type:'paragraph',content:[{text:'Mira met Sora. Mira left.'}]}],...options.page};
 let scan={id:'scan',revision:1,suggestions:[suggestion('mira',{evidenceAnchor:{blockId:'b',start:0,end:4}})],...options.scan};
 const calls=[];
 const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:options.entities??[],disabled:false,onFlush:async()=>page,onScan:result=>{scan=result;render();},onReview:async(scanId,ids,decision,edits)=>{
  calls.push({scanId,ids,decision,edits});
  if(options.onReview)return options.onReview(scanId,ids,decision,edits);
  return {...scan,suggestions:scan.suggestions.map(item=>ids.includes(item.id)?{...item,status:decision}:item),subtypeSuggestions:scan.subtypeSuggestions?.map(item=>ids.includes(item.id)?{...item,status:decision}:item)};
 }}));
 const click=async element=>{assert.ok(element,'Expected a clickable control');await act(async()=>element.click());};
 const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
 const input=async(element,value)=>{assert.ok(element);await act(async()=>{
  element.focus();Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(element,value);
  element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  element.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key:'a',bubbles:true}));
 });};
 await act(async()=>render());await click(document.querySelector('.entity-detect-action'));
 return {env,click,button,input,calls,get scan(){return scan;},async update(next){if(next.page)page={...page,...next.page};if(next.scan)scan={...scan,...next.scan};await act(async()=>render());}};
}

test('subtype-only one-by-one review exposes pending work and reaches subtype decisions',async t=>{
 const f=await fixture(t,{scan:{suggestions:[],subtypeSuggestions:[{id:'sub',name:'Researcher',type:'person',status:'pending'}]}});
 await f.click(f.button('Review one by one'));
 assert.match(document.querySelector('dialog').textContent,/1 subtype suggestion/);
 await f.click(f.button('Review subtypes'));
 assert.ok(document.querySelector('.entity-review-subtype-proposals'));
 await f.click(document.querySelector('[aria-label="Accept subtype: Researcher"]'));
 assert.equal(f.scan.subtypeSuggestions[0].status,'accepted');
});

test('reviewed checkpoint says this batch is reviewed until the full scan completes',async t=>{
 const f=await fixture(t,{scan:{continuation:{token:'checkpoint'},suggestions:[suggestion('mira',{status:'accepted'})]}});
 assert.match(document.querySelector('.entity-review-empty-state').textContent,/This batch is reviewed/);
 assert.doesNotMatch(document.querySelector('.entity-review-empty-state').textContent,/All suggestions reviewed/);
 assert.ok(f.button('Continue scanning'));
 await f.update({scan:{continuation:undefined}});
 assert.match(document.querySelector('.entity-review-empty-state').textContent,/All suggestions reviewed/);
 assert.equal(f.button('Continue scanning'),undefined);
});

test('query and review filters discard hidden bulk selections',async t=>{
 const f=await fixture(t,{scan:{suggestions:[suggestion(),suggestion('sora')]}});
 await f.click(f.button('Review as a list'));
 await f.click(document.querySelector('[aria-label="Select all visible pending suggestions"]'));
 assert.match(document.querySelector('.entity-review-selection').textContent,/2 selected/);
 await f.input(document.querySelector('[aria-label="Search suggestions"]'),'Mira');
 assert.match(document.querySelector('.entity-review-selection').textContent,/0 selected/);
 await f.input(document.querySelector('[aria-label="Search suggestions"]'),'');
 assert.equal(document.querySelector('[aria-label="Select Sora"]').checked,false);
 await f.click(document.querySelector('[aria-label="Select all visible pending suggestions"]'));
 await f.click(document.querySelector('[data-filter="reviewed"]'));
 await f.click(document.querySelector('[data-filter="pending"]'));
 assert.match(document.querySelector('.entity-review-selection').textContent,/0 selected/);
});

test('Create new explains ambiguous, source and duplicate-name restrictions',async t=>{
 const cases=[
  {name:'ambiguous exact matches',entities:[entity('first'),entity('second',{type:'concept'})],reason:/several existing entities match/i},
  {name:'source without an original file',suggestion:suggestion('mira',{type:'source'}),entities:[],reason:/sources need an attached original file/i},
  {name:'duplicate canonical name',entities:[entity('first')],reason:/an entity with this name already exists/i},
 ];
 for(const item of cases)await t.test(item.name,async child=>{
  const f=await fixture(child,{entities:item.entities,scan:{suggestions:[item.suggestion??suggestion()]}});
  await f.click(f.button('Review one by one'));
  assert.equal(f.button('Create new').disabled,true);
  assert.match(document.querySelector('.entity-context-resolution').textContent,item.reason);
  assert.equal(document.querySelector('.scan-row-accept').disabled,true);
  await f.env.close();
 });
});

test('a saved existing match resolves ambiguity and acceptance carries the selected identity',async t=>{
 const f=await fixture(t,{entities:[entity('first'),entity('second',{type:'concept'})],scan:{suggestions:[suggestion('mira',{existingId:'first'})]}});
 await f.click(f.button('Review one by one'));
 const accept=document.querySelector('.scan-row-accept');
 assert.equal(accept.disabled,false);
 await f.click(accept);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].decision,'accepted');
 assert.equal(f.calls[0].edits?.[0]?.existingId,'first');
});

test('Choose mentions exposes exact linkable occurrences and updates the selected count',async t=>{
 const f=await fixture(t,{page:{blocks:[{id:'b',type:'paragraph',content:[{text:'Mira met Mimi. Mira left.'}]}]},scan:{suggestions:[suggestion('mira',{aliases:['Mimi'],evidenceAnchor:{blockId:'b',start:0,end:4}})]}});
 await f.click(f.button('Review one by one'));
 assert.match(document.querySelector('.entity-decision-outcome').textContent,/1 selected to link/);
 await f.click(f.button('Choose mentions'));
 const occurrences=[...document.querySelectorAll('.scan-occurrence input')];
 assert.equal(occurrences.length,2,'Alias-only matches are not offered as exact evidence occurrences');
 assert.equal(occurrences[0].checked,true);
 await f.click(occurrences[1]);
 assert.match(document.querySelector('.entity-decision-outcome').textContent,/2 selected to link/);
 await f.click(document.querySelector('.scan-row-accept'));
 assert.equal(f.calls[0].edits[0].additionalOccurrences.length,1);
});

test('primary scan status prioritizes stale results and errors over checkpoint messages',async t=>{
 const f=await fixture(t,{scan:{continuation:{token:'checkpoint'}}});
 await f.update({page:{revision:2}});
 const messages=()=>document.querySelector('.entity-review-messages');
 assert.match(messages().textContent,/Note changed/);
 assert.doesNotMatch(messages().textContent,/checkpoint|More text remains/);
 t.mock.method(api,'scanEntities',async()=>{throw new Error('Scan unavailable');});
 await f.click([...messages().querySelectorAll('button')][0]);
 assert.match(messages().querySelector('[role="alert"]').textContent,/Scan unavailable/);
 assert.doesNotMatch(messages().textContent,/Note changed|checkpoint/);
});

test('subtype rows respect search and entity type without showing an empty section',async t=>{
 const f=await fixture(t,{scan:{suggestions:[],subtypeSuggestions:[{id:'person-sub',name:'Researcher',type:'person',status:'pending'},{id:'place-sub',name:'Observatory',type:'place',status:'pending'}]}});
 await f.click(f.button('Review as a list'));
 const type=document.querySelector('select[aria-label="Filter by entity type"]');
 await act(async()=>{type.value='person';type.dispatchEvent(new window.Event('change',{bubbles:true}));});
 assert.ok(document.querySelector('[aria-label="Accept subtype: Researcher"]'));
 assert.equal(document.querySelector('[aria-label="Accept subtype: Observatory"]'),null);
 await f.input(document.querySelector('[aria-label="Search suggestions"]'),'Observatory');
 assert.equal(document.querySelector('.entity-review-subtype-proposals'),null);
 assert.match(document.querySelector('.entity-review-empty-state').textContent,/No matching suggestions/);
 await act(async()=>{type.value='place';type.dispatchEvent(new window.Event('change',{bubbles:true}));});
 assert.ok(document.querySelector('[aria-label="Accept subtype: Observatory"]'));
});

test('list review provides a direct action for a blocking subtype decision',async t=>{
 const f=await fixture(t,{scan:{suggestions:[suggestion('mira',{proposedSubtypeIds:['sub']})],subtypeSuggestions:[{id:'sub',name:'Researcher',type:'person',status:'pending'}]}});
 await f.click(f.button('Review as a list'));
 assert.equal(document.querySelector('.scan-row-accept').disabled,true);
 await f.click(f.button('Review subtype'));
 assert.ok(document.querySelector('.entity-review-editor'));
 assert.match(document.querySelector('.entity-review-editor').textContent,/Accept “Researcher” with this entity/);
});
