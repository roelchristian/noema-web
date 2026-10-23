import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {CreateEntityDialog} from '../src/client/knowledge/CreateEntityDialog.tsx';
import {api} from '../src/client/api.ts';
import {builtinProperties,builtinSubtypes} from '../src/shared/entity-schema.ts';
import {setupDOM} from './helpers/dom.mjs';

async function fixture(t,{upload,onSubmit=async()=>{}}={}) {
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount')),requests=[],created=[];
  let closed=0;
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  env.defer(()=>act(async()=>root.unmount()));
  t.mock.method(api,'entitySchema',async()=>({properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{}}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{
    requests.push({route,options});
    return upload?upload(route,options):Response.json({id:'11111111-1111-4111-8111-111111111111.txt',name:new URL(route,'http://localhost').searchParams.get('name')??'URL.txt'});
  });
  await act(async()=>root.render(createElement(CreateEntityDialog,{vaultId:'synthetic-vault',initial:{source:true},onClose(){closed++;},async onSubmit(input){created.push(input);await onSubmit(input);}})));
  function props(element){return element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];}
  const method=value=>act(async()=>{const element=document.querySelector('[aria-label="Add source from"]');props(element).onChange({target:{value}});});
  const enter=(element,value)=>act(async()=>props(element).onChange({target:{value}}));
  const form=()=>document.querySelector('dialog form');
  const submit=()=>act(async()=>form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  return {env,requests,created,method,enter,submit,form,closed:()=>closed,textarea:()=>document.querySelector('textarea')};
}

test('Paste text stages an exact UTF-8 original and creates a genuine Source without an invented URL',async t=>{
  const f=await fixture(t);await f.method('text');
  const original='  Café e\u0301 中文 😀\r\n\r\nSecond paragraph.\n\n<script>plain text</script>  ';
  await f.enter(f.textarea(),original);
  assert.equal(f.requests.length,0,'Typing never uploads or calls AI');
  assert.equal(document.querySelector('[name="entity-name"]').value,'Pasted text');
  assert.match(document.querySelector('.source-policy').textContent,/Intelligence.*OpenAI/);
  await f.submit();
  assert.equal(f.requests.length,1);
  const {route,options}=f.requests[0],url=new URL(route,'http://localhost');
  assert.equal(url.pathname,'/api/source-files');assert.equal(url.searchParams.get('name'),'Pasted text.txt');
  assert.equal(options.headers['X-Vault-Id'],'synthetic-vault');
  assert.equal(options.body.type,'text/plain');assert.equal(await options.body.text(),original);
  assert.equal(f.created.length,1);assert.equal(f.created[0].type,'source');
  assert.deepEqual(f.created[0].attachmentIds,['11111111-1111-4111-8111-111111111111.txt']);
  assert.equal(f.created[0].name,'Pasted text');assert.ok(!('url' in f.created[0]));assert.equal(f.closed(),1);
});

test('Paste text validation, failed upload and method switches retain the draft; cancel never creates a source',async t=>{
  const f=await fixture(t,{upload:async()=>{throw new Error('Synthetic upload failed');}});await f.method('text');
  for(const value of ['  \n\t','before\0after']) {
    await f.enter(f.textarea(),value);await f.submit();
    assert.equal(f.requests.length,0);assert.equal(f.created.length,0);assert.equal(f.textarea().value,value);
    assert.ok(document.querySelector('[role="alert"]'));
  }
  const draft='Keep this paragraph.\n\nAnd this one.';
  await f.enter(f.textarea(),draft);await f.method('url');await f.method('text');
  assert.equal(f.textarea().value,draft);
  await f.submit();assert.equal(f.requests.length,1);assert.equal(f.created.length,0);assert.equal(f.textarea().value,draft);
  assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic upload failed/);
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click());
  assert.equal(f.closed(),1);assert.equal(f.requests.length,1);
});

test('pending paste creation rejects repeated submits and reuses its staged original after entity failure',async t=>{
  let finishUpload,failEntity=true;
  const f=await fixture(t,{upload:()=>new Promise(resolve=>{finishUpload=resolve;}),onSubmit:async()=>{if(failEntity)throw new Error('Synthetic entity save failed');}});
  await f.method('text');await f.enter(f.textarea(),'Retain my original\n\n第二段 😀');
  await f.enter(document.querySelector('[name="entity-name"]'),'Interview / notes');
  await act(async()=>{f.form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(f.requests.length,1);assert.equal(f.textarea().disabled,true);assert.equal(f.closed(),0);
  assert.ok([...document.querySelectorAll('button')].some(button=>button.textContent==='Creating…'&&button.disabled));
  await act(async()=>finishUpload(Response.json({id:'11111111-1111-4111-8111-111111111111.txt',name:'Interview _ notes.txt'})));
  assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic entity save failed/);
  assert.equal(f.textarea().value,'Retain my original\n\n第二段 😀');
  assert.equal(document.querySelector('[name="entity-name"]').value,'Interview / notes');
  failEntity=false;await f.submit();
  assert.equal(f.requests.length,1,'Retry attaches the same staged original instead of uploading a duplicate');
  assert.equal(f.created.length,2);assert.deepEqual(f.created[0].attachmentIds,f.created[1].attachmentIds);
  assert.equal(f.closed(),1);
});

test('existing file and URL source paths still stage an attachment',async t=>{
  const f=await fixture(t);await f.method('file');
  const input=document.querySelector('input[type=file]'),file=new File(['Existing file'],'existing.txt',{type:'text/plain'});
  await act(async()=>input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{files:[file]}}));
  await f.submit();assert.equal(f.requests[0].options.body,file);assert.equal(f.created[0].type,'source');
  await f.method('url');await f.enter(document.querySelector('input[type=url]'),'https://example.com/reference.txt');
  await f.submit();assert.equal(f.requests[1].route,'/api/source-files/url');
  assert.equal(JSON.parse(f.requests[1].options.body).url,'https://example.com/reference.txt');
  assert.equal(f.created[1].type,'source');assert.equal(f.requests.length,2);
});
