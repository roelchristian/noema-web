import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {EntityPanel} from '../src/client/knowledge/EntityPanel.tsx';
import {EntityHome} from '../src/client/knowledge/EntityHome.tsx';
import {ReviewDestination} from '../src/client/review/review-destination.ts';
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
 const entity={id:'e',vault_id:'v',name:'Ada',type:'person',description:'A mathematician.',subtypes:[],domainIds:[],aliases:['A.'],mentionCase:'canonical',properties:[{id:'prop',entity_id:'e',name:'Place',target_id:'other',value:''}],propertyNames:['Born'],relationships:[{id:'out',source_id:'e',target_id:'other',label:'visited'},{id:'in',source_id:'other',target_id:'e',label:'commemorates'}],incomingProperties:[{id:'incoming',entity_id:'other',name:'Honours',target_id:'e'}],pageMentions:[{id:'page',title:'History',icon:'',mentionCount:2,excerpt:'Ada studied mathematics.'}],attachments:[],updated_at:'2026-10-19'};
 const other={...entity,id:'other',name:'London',type:'place'};
 t.mock.method(api,'entity',async()=>entity);
 t.mock.method(api,'entityEvidence',async()=>({groups:[],hasMore:false,truncated:false}));
 t.mock.method(api,'entityOverviewEvidence',async()=>({groups:[],hasMore:false,truncated:false}));
 t.mock.method(api,'entitySchema',async()=>({properties:Object.fromEntries(entityTypes.map(type=>[type,[]])),subtypes:[],subtypeProperties:{}}));
 const props={vaultId:'v',id:'e',entities:[entity,other],refreshKey:'',onOpen(){},onClose(){},onUpdated:async()=>{},onError(error){throw error;},onOpenPage(){},onCreatePageFromSource(){}};
 const root=createRoot(document.querySelector('#mount'));
 const click=async selector=>{const target=document.querySelector(selector);assert.ok(target,selector);await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 try{await act(async()=>root.render(React.createElement(EntityHome,props)));await work({entity,click,dom,props,root});}
 finally{await act(async()=>root.unmount());clearEntityDrafts('v');dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}

test('entity homepage shows real knowledge and keeps relationship directions distinct', async t => {
 await fixture(t, async ({click,props,root,dom}) => {
  let openedEntity, openedPage;
  await act(async () => root.render(React.createElement(EntityHome, {...props,onOpen:id=>openedEntity=id,onOpenPage:id=>openedPage=id})));
  assert.equal(document.querySelector('h1').textContent,'Ada');
  assert.match(document.querySelector('.eh-counts').textContent,/1 page4 connections/);
  await click('#entity-home-tab-connections');
  const content=document.querySelector('#entity-home-panel-connections');
  assert.match(content.textContent,/Outgoing · visited/);
  assert.match(content.textContent,/Incoming · commemorates/);
  assert.match(content.textContent,/Referenced via Honours/);
  await click('#entity-home-panel-connections .entity-connection-list button');
  assert.equal(openedEntity,'other');
  await click('#entity-home-tab-mentions');
  assert.match(document.querySelector('#entity-home-panel-mentions').textContent,/Ada studied mathematics/);
  await click('#entity-home-panel-mentions .entity-page-mentions button');
  assert.equal(openedPage,'page');
  await act(async()=>document.querySelector('#entity-home-tab-mentions').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  assert.equal(document.activeElement.id,'entity-home-tab-sources');
  assert.equal(document.querySelector('#entity-home-tab-sources').getAttribute('aria-selected'),'true');
 });
});

test('homepage and contextual panel share unsaved details and persist through the same API', async t => {
 await fixture(t, async ({entity,props,root,click}) => {
  const baseline=entityDraftValues(entity);
  await act(async()=>setEntityDraft('v','e',baseline,{...baseline,name:'Ada Lovelace'}));
  await click('#entity-home-tab-edit');
  assert.equal(document.querySelector('[aria-label="Entity name"]').value,'Ada Lovelace');
  await act(async()=>root.render(React.createElement(EntityPanel,props)));
  assert.equal(document.querySelector('[aria-label="Entity name"]').value,'Ada Lovelace');
  await act(async()=>root.render(React.createElement(EntityHome,props)));
  assert.equal(document.querySelector('#entity-home-tab-edit').getAttribute('aria-selected'),'true');
  let saved;
  t.mock.method(api,'updateEntity',async(_vault,_id,input)=>{saved=input;return {...entity,...input};});
  await act(async()=>document.querySelector('#entity-home-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(saved.name,'Ada Lovelace');
  assert.equal(hasEntityDraft('v','e'),false);
  assert.equal(document.querySelector('h1').textContent,'Ada Lovelace');
 });
});

test('contextual panel promotes the current entity without changing its record', async t => {
 await fixture(t, async ({props,root,click}) => {
  let opened;
  await act(async()=>root.render(React.createElement(EntityPanel,{...props,onOpenHome:id=>opened=id})));
  await click('.entity-preview-navigation button');
  assert.equal(opened,'e');
 });
});

test('type-aware homepages emphasize recorded event and publication details without empty schema fields',async t=>{
 await fixture(t,async({entity,props,root})=>{
  entity.type='event';entity.properties=[{id:'place',entity_id:'e',name:'location',value:'London',target_id:null},{id:'date',entity_id:'e',name:'start date',value:'1843-01-01',target_id:null}];
  await act(async()=>root.render(React.createElement(EntityHome,{...props,key:'event'})));
  const overview=document.querySelector('#entity-home-panel-overview');
  assert.equal(overview.querySelector('h2').textContent,'Event details');
  assert.equal(overview.querySelector('dt').textContent,'start date');
  assert.ok(!overview.textContent.includes('Not set'));
  assert.ok(overview.textContent.indexOf('Event details')<overview.textContent.indexOf('Overview'));
  entity.type='creativework';entity.properties=[{id:'date',entity_id:'e',name:'release date',value:'1843',target_id:null},{id:'author',entity_id:'e',name:'author',value:'Ada',target_id:null}];
  await act(async()=>root.render(React.createElement(EntityHome,{...props,key:'work'})));
  assert.equal(document.querySelector('#entity-home-panel-overview h2').textContent,'Publication and authorship');
  assert.equal(document.querySelector('#entity-home-panel-overview dt').textContent,'author');
  assert.equal(document.querySelectorAll('.eh-overview').length,1,'one shared authored overview');
 });
});

test('homepage keeps grouped lists default and exposes optional neighborhood and discovery without generation',async t=>{
 await fixture(t,async({props,root,click})=>{
  let opened,inspected;
  const graph=t.mock.method(api,'entityNeighborhood',async()=>({rootId:'e',nodes:props.entities,edges:[{id:'r',sourceId:'e',targetId:'other',kind:'relationship',label:'visited'}],relationTypes:['visited'],truncated:false}));
  const generate=t.mock.method(api,'generateEntityDiscovery',async()=>assert.fail('Opening Discovery must not generate'));
  t.mock.method(api,'entityDiscovery',async()=>null);
  await act(async()=>root.render(React.createElement(EntityHome,{...props,onOpen:id=>opened=id,onInspect:id=>inspected=id})));
  await click('#entity-home-tab-connections');
  assert.equal(graph.mock.callCount(),0);
  const toggle=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Explore neighborhood');
  await act(async()=>toggle.click());
  assert.equal(graph.mock.callCount(),1);
  const nodes=document.querySelectorAll('.entity-neighborhood svg [role="button"]');
  await act(async()=>nodes[1].dispatchEvent(new document.defaultView.MouseEvent('click',{bubbles:true})));
  assert.equal(opened,'other');
  await click('.en-inspect button');assert.equal(inspected,'other');
  await click('#entity-home-tab-discovery');
  assert.match(document.querySelector('.eh-discovery').textContent,/Explore with AI/);
  assert.equal(generate.mock.callCount(),0);
 });
});


test('Review Centre Discovery intent overrides saved tabs and retains an already loaded entity',async t=>{
 await fixture(t,async({props,root,click})=>{
  t.mock.method(api,'entityDiscovery',async()=>null);
  const generate=t.mock.method(api,'generateEntityDiscovery',async()=>assert.fail('Navigation must not generate discovery'));
  const render=async value=>act(async()=>root.render(React.createElement(ReviewDestination.Provider,{value},React.createElement(EntityHome,props))));
  await render(null);await click('#entity-home-tab-connections');
  const heading=document.querySelector('.entity-home h1');
  const destination={id:'discovery:e:run',category:'discovery',originId:'e',title:'Ada',runId:'run',group:'decisions',state:'pending',decision:'Review saved discovery',count:1,updatedAt:''};
  await render(destination);
  assert.equal(document.querySelector('.entity-home h1'),heading,'same entity stays loaded on context change');
  assert.equal(document.querySelector('#entity-home-tab-discovery').getAttribute('aria-selected'),'true');
  assert.equal(generate.mock.callCount(),0);
  await click('#entity-home-tab-overview');assert.equal(document.querySelector('#entity-home-tab-overview').getAttribute('aria-selected'),'true');
  await act(async()=>root.render(null));await render(destination);
  assert.equal(document.querySelector('#entity-home-tab-discovery').getAttribute('aria-selected'),'true','review intent takes priority over saved Overview');
 });
});
