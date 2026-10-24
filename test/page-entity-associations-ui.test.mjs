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
 const pageRead=t.mock.method(api,'pageAssociations',async()=>[]);
 const pageSave=t.mock.method(api,'associatePages',async(_vault,_id,targetId,input)=>[{id:targetId,title:'Related notes',updated_at:'',created_at:'',pinned:false,annotation:'',...input}]);
 const pageRemove=t.mock.method(api,'removePageAssociation',async()=>[]);
 const save=t.mock.method(api,'associateEntityPage',async()=>({}));
 const remove=t.mock.method(api,'removeEntityPage',async()=>({}));
 let changed=0,opened='';
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let props={page,pages,entities,onClose(){},onChanged:async()=>{changed++;},onOpenEntity:id=>{opened=id;}};
 const click=async label=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(button,label);await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
 const input=async(selector,value)=>{const node=document.querySelector(selector);const prototype=node.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);await act(async()=>node.dispatchEvent(new Event('input',{bubbles:true})));};
 try {await act(async()=>root.render(React.createElement(PageEntityAssociationsDialog,props)));await work({click,input,save,remove,read,pageRead,pageSave,pageRemove,dom,render:async extra=>{props={...props,...extra};await act(async()=>root.render(React.createElement(PageEntityAssociationsDialog,props)));},changed:()=>changed,opened:()=>opened});} finally {await env.close();}
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


test('shared picker connects a whole page independently and Undo reverses only that association',async t=>{
 await fixture(t,{pages:[{id:'page',title:'Notes',updated_at:''},{id:'related',title:'Related notes',updated_at:''}]},async({click,pageRead,pageSave,pageRemove})=>{
  assert.deepEqual(pageRead.mock.calls[0].arguments,['vault','page']);
  assert.equal(document.querySelector('[aria-label="Connect Notes"]'),null);
  await click('Related notesPage');
  assert.deepEqual(pageSave.mock.calls[0].arguments,['vault','page','related',{pinned:false,annotation:''}]);
  assert.equal(document.querySelectorAll('[aria-label="Associated pages"] article').length,1);
  await click('Undo');assert.deepEqual(pageRemove.mock.calls[0].arguments,['vault','page','related']);
  assert.equal(document.querySelectorAll('[aria-label="Associated pages"] article').length,0);
 });
});


test('Undo reconciles pristine annotation while preserving a later unsaved draft',async t=>{
 await fixture(t,{associations:[{entityId:'ada',pinned:false,annotation:'Original'}]},async({click,input})=>{
  await input('.page-entity-association textarea','Saved revision');await click('Save annotation');
  await click('Undo');assert.equal(document.querySelector('.page-entity-association textarea').value,'Original');
  await input('.page-entity-association textarea','Second revision');await click('Save annotation');
  await input('.page-entity-association textarea','Unsaved draft');await click('Undo');
  assert.equal(document.querySelector('.page-entity-association textarea').value,'Unsaved draft');
 });
});

test('late association write cannot update or notify a newly selected page in the same dialog mount',async t=>{
 await fixture(t,{},async({click,save,render,changed})=>{
  let finish;save.mock.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await click('Ada Lovelaceperson');
  await render({page:{id:'next',vault_id:'vault',title:'Next page',blocks:[],sourceIds:[],revision:1,updated_at:''}});
  assert.match(document.querySelector('.connect-picker-from').textContent,/Next page/);
  await act(async()=>finish({}));
  assert.equal(document.querySelectorAll('.page-entity-association').length,0);
  assert.equal(document.querySelectorAll('button').length>0,true);assert.equal(changed(),0);
  assert.equal(document.querySelector('.connect-picker input[type=search]').disabled,false);
 });
});

test('relationship picker scopes page-only options and excludes them from entity saves',async t=>{
 const env=setupDOM(t);const {createRoot}=await import('react-dom/client');
 const {ConnectPicker}=await import('../src/client/knowledge/ConnectPicker.tsx');
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const saves=[];
 await act(async()=>root.render(React.createElement(ConnectPicker,{sourceLabel:'Ada',relationships:true,entities:[{id:'grace',name:'Grace',type:'person',aliases:[]}],pages:[{id:'notes',title:'Notes'}],onConnect:async(...values)=>{saves.push(values);}})));
 assert.equal(document.querySelector('summary').textContent,'Page association options');
 const textarea=document.querySelector('textarea');Object.getOwnPropertyDescriptor(env.dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'Page note');
 await act(async()=>textarea.dispatchEvent(new Event('input',{bubbles:true})));
 await act(async()=>document.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
 const click=async text=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===text);await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
 await click('Entities');assert.equal(document.querySelector('details'),null);
 await click('Graceperson');assert.equal(saves[0][1].annotation,'');assert.equal(saves[0][1].pinned,false);
 await click('Pages');assert.equal(document.querySelector('input[list]'),null);assert.ok(document.querySelector('details'));
 await env.close();
});
