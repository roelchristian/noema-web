import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';

async function fixture(t,{associations=[],pages=[]}={},work) {
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const {createRoot}=await import('react-dom/client');
 const {PageEntityAssociationsDialog}=await import('../src/client/editor/PageEntityAssociationsDialog.tsx');
 const page={id:'page',vault_id:'vault',title:'Notes',blocks:[],sourceIds:[],revision:1,updated_at:''};
 const entity=(id,name,extra={})=>({id,vault_id:'vault',name,type:'person',description:'',subtypes:[],updated_at:'',...extra});
 const entities=[entity('ada','Ada Lovelace',{aliases:['Countess']}),entity('grace','Grace Hopper'),entity('archived','Archived',{archived_at:'2026-01-01'}),entity('source','Source',{type:'source'}),entity('foreign','Foreign',{vault_id:'other'})];
 const read=t.mock.method(api,'pageEntityAssociations',async()=>associations);
 const save=t.mock.method(api,'associateEntityPage',async()=>({}));
 const remove=t.mock.method(api,'removeEntityPage',async()=>({}));
 let changed=0,opened='';
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const props={page,pages,entities,onClose(){},onChanged:async()=>{changed++;},onOpenEntity:id=>{opened=id;}};
 const click=async label=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(button,label);await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
 const input=async(selector,value)=>{const node=document.querySelector(selector);const prototype=node.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);await act(async()=>node.dispatchEvent(new Event('input',{bubbles:true})));};
 try {await act(async()=>root.render(React.createElement(PageEntityAssociationsDialog,props)));await work({click,input,save,remove,read,dom,changed:()=>changed,opened:()=>opened});} finally {await env.close();}
}

test('page associations filter names and aliases, exclude archived/source/foreign entities and save optional pin and annotation in the page vault',async t=>{
 await fixture(t,{},async({click,input,save,read,changed})=>{
  assert.deepEqual(read.mock.calls[0].arguments,['vault','page']);
  assert.equal(document.querySelector('dialog').getAttribute('aria-labelledby'),'page-entity-dialog-title');
  const candidates=document.querySelector('.page-entity-candidates');
  assert.match(candidates.textContent,/Ada Lovelace/);assert.match(candidates.textContent,/Grace Hopper/);
  assert.doesNotMatch(candidates.textContent,/Archived|Source|Foreign/);
  await input('.connect-picker input[type=search]','Countess');
  assert.doesNotMatch(candidates.textContent,/Grace Hopper/);
  await input('.connect-picker textarea','A useful introduction.');
  await act(async()=>document.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await click('Ada Lovelaceperson');
  assert.deepEqual(save.mock.calls[0].arguments,['vault','ada','page',{pinned:true,annotation:'A useful introduction.'}]);
  assert.equal(changed(),1);assert.match(document.querySelector('.page-entity-existing').textContent,/Pinned/);
 });
});

test('unpin keeps the association, remove unlinks, and open navigates to the entity homepage',async t=>{
 await fixture(t,{associations:[{entityId:'ada',pinned:true,annotation:'First reference'}]},async({click,save,remove,opened})=>{
  await click('Unpin page');
  assert.deepEqual(save.mock.calls[0].arguments,['vault','ada','page',{pinned:false}]);
  assert.ok(document.querySelector('.page-entity-association'));assert.equal(remove.mock.callCount(),0);
  await click('Ada Lovelace');assert.equal(opened(),'ada');
  await click('Remove association');assert.deepEqual(remove.mock.calls[0].arguments,['vault','ada','page']);
  assert.equal(document.querySelector('.page-entity-association'),null);
 });
});

test('failed connection retains optional note and feature settings for retry',async t=>{
 await fixture(t,{},async({click,input,save,changed})=>{
  save.mock.mockImplementation(async()=>{throw new Error('Storage unavailable');});
  await input('.connect-picker textarea','Keep this draft.');
  await act(async()=>document.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  const submit=()=>click('Ada Lovelaceperson');
  await submit();assert.match(document.querySelector('[role=alert]').textContent,/Storage unavailable/);
  assert.equal(document.querySelector('.connect-picker textarea').value,'Keep this draft.');assert.equal(document.querySelector('input[type=checkbox]').checked,true);assert.equal(changed(),0);
  save.mock.mockImplementation(async()=>({}));await submit();assert.equal(changed(),1);assert.equal(document.querySelector('[role=alert]'),null);
 });
});

test('annotation edit preserves the draft after a failed save and does not alter pin state',async t=>{
 await fixture(t,{associations:[{entityId:'ada',pinned:true,annotation:'Original'}]},async({click,input,save})=>{
  save.mock.mockImplementation(async()=>{throw new Error('Try again');});
  await input('.page-entity-association textarea','Revised annotation');await click('Save annotation');
  assert.deepEqual(save.mock.calls[0].arguments,['vault','ada','page',{annotation:'Revised annotation'}]);
  assert.equal(document.querySelector('.page-entity-association textarea').value,'Revised annotation');
  assert.equal(document.querySelector('.page-entity-association textarea').maxLength,2000);
  assert.match(document.querySelector('.page-entity-association-heading').textContent,/Pinned/);
  assert.match(document.querySelector('[role=alert]').textContent,/Try again/);
  assert.equal(document.querySelector('.connect-picker input[type=search]').disabled,false);
  assert.ok(!document.body.textContent.includes('Retry loading'));
 });
});


test('choosing a target connects immediately with defaults and Undo removes only the association',async t=>{
 await fixture(t,{},async({click,save,remove})=>{
  await click('Ada Lovelaceperson');
  assert.deepEqual(save.mock.calls[0].arguments,['vault','ada','page',{pinned:false,annotation:''}]);
  assert.match(document.querySelector('[role=status]').textContent,/Connection updated/);
  await click('Undo');
  assert.deepEqual(remove.mock.calls[0].arguments,['vault','ada','page']);
  assert.equal(document.querySelector('.page-entity-association'),null);
 });
});

test('repeated target actions while save is pending produce one write',async t=>{
 await fixture(t,{},async({click,save})=>{
  let finish;save.mock.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const target=[...document.querySelectorAll('.connect-picker-results button')][0];
  await act(async()=>{target.dispatchEvent(new MouseEvent('click',{bubbles:true}));target.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  assert.equal(save.mock.callCount(),1);assert.equal(target.disabled,true);
  await act(async()=>finish({}));
  assert.equal(document.querySelectorAll('.page-entity-association').length,1);
 });
});

