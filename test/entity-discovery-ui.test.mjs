import {test} from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {EntityDiscovery} from '../src/client/knowledge/EntityDiscovery.tsx';
import {api, ApiError} from '../src/client/api.ts';
import {setEntityOverviewDraft, clearEntityDrafts} from '../src/client/knowledge/entity-drafts.ts';

const reference={id:'citation',sourceId:'source',fileId:'file',startLine:2,endLine:4,sourceHash:'hash',excerpt:'A primary account.'};
function saved(){return {id:'run',entityId:'entity',createdAt:'2026-10-23',model:'test-model',reasoningEffort:'low',overviewRevision:3,stale:false,evidence:[{id:'page-evidence',kind:'page',pageId:'page',title:'Research',excerpt:'Page evidence.'},{id:'source-evidence',kind:'source',title:'Primary source',excerpt:'A primary account.',reference}],suggestions:[{id:'synthesis',kind:'synthesis',status:'pending',rationale:'Supported by the pages.',evidenceIds:['page-evidence','source-evidence'],content:'## A proposed synthesis\nReview this account.'},{id:'relationship',kind:'relationship',status:'pending',rationale:'The page describes influence.',evidenceIds:['page-evidence'],targetId:'other',targetName:'Other entity',label:'influenced'},{id:'page',kind:'page',status:'pending',rationale:'An explicit association may be useful.',evidenceIds:['page-evidence'],pageId:'related',pageTitle:'Related study'}]};}
async function fixture(t,work){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost:5173'});
 const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','Event','CustomEvent','MutationObserver','getComputedStyle','IS_REACT_ACT_ENVIRONMENT'];
 const descriptors=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const requests={load:[],generate:[],review:[],updated:0,pages:[],entities:[],sources:[]};
 t.mock.method(api,'entityDiscovery',async(...args)=>{requests.load.push(args);return null;});
 t.mock.method(api,'generateEntityDiscovery',async(...args)=>{requests.generate.push(args);return saved();});
 t.mock.method(api,'reviewEntityDiscovery',async(...args)=>{requests.review.push(args);const result=saved();result.suggestions.find(item=>item.id===args[3].suggestionId).status=args[3].decision;return result;});
 const props={vaultId:'vault',id:'entity',refreshKey:'',onUpdated:async()=>{requests.updated++;},onOpenPage:id=>requests.pages.push(id),onOpenEntity:id=>requests.entities.push(id),onOpenSourcePassage:(reference,trigger)=>requests.sources.push({reference,trigger})};
 const root=createRoot(document.querySelector('#mount'));
 const render=async(next={})=>act(async()=>root.render(React.createElement(EntityDiscovery,{...props,...next})));
 const click=async(selector)=>{const target=document.querySelector(selector);assert.ok(target,selector);await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 try {await work({requests,props,root,render,click,dom});}
 finally {await act(async()=>root.unmount());clearEntityDrafts('vault');dom.window.close();keys.forEach((key,index)=>{if(descriptors[index])Object.defineProperty(globalThis,key,descriptors[index]);else delete globalThis[key];});}
}

test('discovery reads saved results on mount and generates only on explicit request',async t=>{
 await fixture(t,async({requests,render,click})=>{
  await render();assert.equal(requests.load.length,1);assert.equal(requests.generate.length,0);
  assert.match(document.body.textContent,/may incur charges/);
  await click('.eh-discovery-tools button');assert.equal(requests.generate.length,1);
  assert.match(document.body.textContent,/Provisional synthesis/);assert.match(document.body.textContent,/Proposed directed relationships/);assert.match(document.body.textContent,/Suggested associated pages/);
  assert.equal(requests.review.length,0);
  await click('[data-suggestion-id="synthesis"] .eh-discovery-actions button');
  assert.deepEqual(requests.review[0].slice(0,4),['vault','entity','run',{suggestionId:'synthesis',decision:'accepted',expectedOverviewRevision:3}]);assert.equal(requests.updated,1);
  assert.equal(document.querySelector('[data-suggestion-id="synthesis"] .eh-discovery-decision').textContent,'Accepted');
 });
});

test('discovery opens page and source evidence and keeps relationship direction explicit',async t=>{
 await fixture(t,async({requests,render,click})=>{
  t.mock.method(api,'entityDiscovery',async()=>saved());await render();
  await click('[data-suggestion-id="synthesis"] .eh-discovery-evidence div:first-of-type button');
  await click('[data-suggestion-id="synthesis"] .eh-discovery-evidence div:last-of-type button');
  await click('.eh-discovery-relationship button');await click('.eh-discovery-page');
  assert.deepEqual(requests.pages,['page','related']);assert.deepEqual(requests.entities,['other']);assert.deepEqual(requests.sources[0].reference,reference);assert.ok(requests.sources[0].trigger instanceof HTMLElement);
  assert.match(document.querySelector('.eh-discovery-relationship').textContent,/This entity → influenced → Other entity/);
 });
});

test('unsaved overview draft blocks synthesis acceptance but permits individual rejection',async t=>{
 await fixture(t,async({requests,render,click})=>{
  t.mock.method(api,'entityDiscovery',async()=>saved());await render();
  await act(async()=>setEntityOverviewDraft('vault','entity',{content:'My draft',baseline:'',revision:3}));
  assert.equal(document.querySelector('[data-suggestion-id="synthesis"] .eh-discovery-actions button').disabled,true);
  assert.equal(document.querySelector('[data-suggestion-id="relationship"] .eh-discovery-actions button').disabled,false);
  await click('[data-suggestion-id="synthesis"] .eh-discovery-actions button:last-child');
  assert.equal(requests.review[0][3].decision,'rejected');assert.equal(requests.updated,0);
 });
});

test('stale discovery and revision conflicts preserve evidence and disable acceptance',async t=>{
 await fixture(t,async({render,click,requests})=>{
  t.mock.method(api,'entityDiscovery',async()=>saved());t.mock.method(api,'reviewEntityDiscovery',async()=>{throw new ApiError(409,'Overview changed.');});await render();
  await click('[data-suggestion-id="synthesis"] .eh-discovery-actions button');
  assert.match(document.body.textContent,/Overview changed/);assert.match(document.body.textContent,/suggestions are preserved for comparison/);
  assert.equal(document.querySelectorAll('.eh-discovery-card').length,3);
  assert.equal(document.querySelector('[data-suggestion-id="page"] .eh-discovery-actions button').disabled,true);assert.equal(document.querySelector('[data-suggestion-id="page"] .eh-discovery-actions button:last-child').disabled,false);
  assert.equal(requests.updated,0);
 });
});

test('cancel and switching entities abort requests and ignore late generation',async t=>{
 await fixture(t,async({render,click})=>{
  let resolve,signal;t.mock.method(api,'generateEntityDiscovery',async(_vault,_id,value)=>{signal=value;return new Promise(done=>resolve=done);});
  await render();await click('.eh-discovery-tools button');assert.equal(signal.aborted,false);
  await click('.eh-discovery-tools button:last-child');assert.equal(signal.aborted,true);
  await act(async()=>resolve(saved()));assert.equal(document.querySelectorAll('.eh-discovery-card').length,0);
  await click('.eh-discovery-tools button');await render({id:'different'});assert.equal(signal.aborted,true);
  await act(async()=>resolve(saved()));assert.equal(document.querySelectorAll('.eh-discovery-card').length,0);
 });
});

test('provider setup failures retain saved candidates and expose an explicit retry',async t=>{
 await fixture(t,async({render,click})=>{
  t.mock.method(api,'entityDiscovery',async()=>saved());t.mock.method(api,'generateEntityDiscovery',async()=>{throw new ApiError(400,'Configure an API key first.');});await render();await click('.eh-discovery-tools button');
  assert.match(document.querySelector('[role="alert"]').textContent,/Configure an API key first/);assert.match(document.querySelector('[role="alert"]').textContent,/Settings → Intelligence/);
  assert.equal(document.querySelectorAll('.eh-discovery-card').length,3);assert.equal(document.querySelector('.eh-discovery-tools button').disabled,false);
 });
});

test('saved stale suggestions remain readable and rejectable without acceptance',async t=>{
 await fixture(t,async({render,click,requests})=>{
  t.mock.method(api,'entityDiscovery',async()=>({...saved(),stale:true}));await render();
  assert.equal(document.querySelector('[data-suggestion-id="relationship"] .eh-discovery-actions button').disabled,true);
  assert.equal(document.querySelectorAll('.eh-discovery-card').length,3);
  await click('[data-suggestion-id="relationship"] .eh-discovery-actions button:last-child');
  assert.equal(requests.review[0][3].decision,'rejected');
 });
});
