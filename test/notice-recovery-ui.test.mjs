import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
function fixture(t) {
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  t.mock.timers.enable({apis:['setTimeout','Date']});
  return {...env,render:element=>act(async()=>root.render(element)),tick:ms=>act(async()=>t.mock.timers.tick(ms))};
}

test('confirmation failures stay in the native modal and retain explicit retry and cancel',async t=>{
  const env=fixture(t);
  const {ConfirmDialog}=await import('../src/client/components/ConfirmDialog.tsx');
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let attempts=0,closed=0,finish;
  await env.render(createElement(ConfirmDialog,{title:'Archive page',description:'Archive this page?',action:'Archive',danger:true,onConfirm:()=>new Promise((resolve,reject)=>{attempts++;finish=()=>attempts===1?reject(new Error('Archive failed. Retry.')):resolve();}),onClose:()=>closed++}));
  const dialog=document.querySelector('dialog'),action=document.querySelector('.confirmation-action');
  assert.ok(dialog.open);assert.ok(action.classList.contains('is-danger'));
  await act(async()=>action.click());assert.ok(action.disabled);
  await act(async()=>finish());assert.equal(closed,0);
  assert.match(dialog.querySelector('.inline-notice[role="alert"]').textContent,/Archive failed/);
  assert.equal(document.querySelector('.toast-item'),null);
  assert.equal(action.disabled,false);assert.equal(document.querySelector('.confirmation-cancel').disabled,false);
  await act(async()=>action.click());await act(async()=>finish());assert.equal(closed,1);
});

test('draft recovery warning remains until authoritative resolution and keeps modal choices',async t=>{
  const env=fixture(t);
  const {PageDraftRecoveryNotice}=await import('../src/client/editor/PageDraftRecoveryNotice.tsx');
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const recovery={title:'Protected draft',drafts:[{id:'draft-1',updatedAt:0,baseRevision:2,snapshot:{title:'Draft title',blocks:[]}}]};
  await env.render(createElement(PageDraftRecoveryNotice,{recovery,page:{id:'page-1',vault_id:'vault-1',editLocked:false},entities:[],pages:[],onRestore:async()=>{},onDiscard:async()=>{}}));
  await env.tick(60000);
  const warning=document.querySelector('.inline-notice[data-tone="warning"]');
  assert.match(warning.textContent,/Protected draft/);assert.equal(warning.querySelector('.notice-close'),null);
  const review=[...warning.querySelectorAll('button')].find(button=>button.textContent==='Review draft');
  await act(async()=>review.click());
  const dialog=document.querySelector('dialog');assert.ok(dialog.open);
  for(const label of ['Discard recovered drafts','Keep for later','Restore this draft'])assert.ok([...dialog.querySelectorAll('button')].some(button=>button.textContent===label));
  await act(async()=>[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Keep for later').click());
  assert.equal(document.querySelector('dialog'),null);assert.ok(document.querySelector('.inline-notice[data-tone="warning"]'));
});
