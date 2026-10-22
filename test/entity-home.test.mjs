import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {EntityPanel} from '../src/client/knowledge/EntityPanel.tsx';
import {EntityHome} from '../src/client/knowledge/EntityHome.tsx';
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
