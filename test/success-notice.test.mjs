import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FormNotice,useFormNotice} from '../src/client/notifications/FormNotice.tsx';
import {InboxTriage} from '../src/client/organization/InboxTriage.tsx';
import {api} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';

function fixture(t) {
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  t.mock.timers.enable({apis:['setTimeout','Date']});
  return {...env,render:element=>act(async()=>root.render(element)),tick:ms=>act(async()=>t.mock.timers.tick(ms))};
}

test('each repeated confirmation gets four seconds without extending on unrelated renders',async t=>{
  const env=fixture(t);
  function Harness() {
    const [message,show,occurrence]=useFormNotice(),[renders,setRenders]=useState(0);
    return createElement('div',null,
      createElement('button',{id:'show',onClick:()=>show('Saved.')},'Save'),
      createElement('button',{id:'render',onClick:()=>setRenders(renders+1)},'Render'),
      createElement(FormNotice,{message,occurrence,onDismiss:()=>show('')}));
  }
  await env.render(createElement(Harness));
  await act(async()=>document.querySelector('#show').click());
  await env.tick(3900);
  await act(async()=>document.querySelector('#show').click());
  await env.tick(100);assert.ok(document.querySelector('.form-notice-region'));
  await env.tick(3800);
  await act(async()=>document.querySelector('#render').click());
  await env.tick(99);assert.ok(document.querySelector('.form-notice-region'));
  await env.tick(1);assert.equal(document.querySelector('.form-notice-region'),null);
});

test('actionable notices pause on hover and keyboard focus, dismiss manually, and clean up',async t=>{
  const env=fixture(t);let dismissed=0,actions=0;
  const render=(occurrence,onDismiss=()=>dismissed++)=>env.render(createElement(FormNotice,{message:'Page archived.',occurrence,onDismiss,action:createElement('button',{id:'undo',onClick:()=>actions++},'Undo')}));
  await render(1);
  assert.ok(document.querySelector('[role="status"]'));
  await env.tick(3900);
  await act(async()=>document.querySelector('.form-notice-region').dispatchEvent(new env.dom.window.MouseEvent('mouseover',{bubbles:true})));
  await env.tick(6000);assert.equal(dismissed,0);
  await act(async()=>document.querySelector('#undo').focus());
  await render(2);
  await act(async()=>document.querySelector('.form-notice-region').dispatchEvent(new env.dom.window.MouseEvent('mouseout',{bubbles:true})));
  await env.tick(6000);assert.equal(dismissed,0);
  await act(async()=>document.querySelector('#undo').click());assert.equal(actions,1);
  await act(async()=>document.querySelector('[aria-label="Dismiss notification"]').focus());
  await env.tick(6000);assert.equal(dismissed,0,'Moving focus within the notice keeps it paused');
  await act(async()=>document.querySelector('[aria-label="Dismiss notification"]').blur());
  await env.tick(3999);assert.equal(dismissed,0);
  await env.tick(1);assert.equal(dismissed,1);
  await render(3);
  await act(async()=>document.querySelector('[aria-label="Dismiss notification"]').click());assert.equal(dismissed,2);
  await render(4,()=>dismissed+=10);
  await env.tick(3900);
  await render(4,()=>dismissed+=100);
  await env.tick(100);assert.equal(dismissed,102,'Timer calls the latest dismissal callback');
  await render(5);
  await env.render(null);
  await env.tick(6000);assert.equal(dismissed,102,'Unmount clears the timer');
});

test('skipping consecutive Inbox pages renews the identical confirmation',async t=>{
  const env=fixture(t);
  t.mock.method(api,'pagePreview',async(_vault,id)=>({id,blocks:[]}));
  const pages=['a','b','c'].map(id=>({id,title:id,updated_at:'2026-01-01',vault_id:'synthetic'})),noop=()=>{};
  await env.render(createElement(InboxTriage,{vaultId:'synthetic',pages,allPages:pages,entities:[],data:{collections:[],folders:[],locations:[],memberships:[],favourites:[]},checked:new Set(),onToggle:noop,onChanged:noop,onOpenPage:noop,onOpenEntity:noop,onArchive:async()=>{},onTrash:noop,onBusyChange:noop,onSelectAll:noop}));
  const skip=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Skip for now');
  await act(async()=>skip().click());await env.tick(3900);
  await act(async()=>skip().click());await env.tick(100);
  assert.match(document.querySelector('.form-notice-region').textContent,/Skipped for this session/);
  await env.tick(3899);assert.ok(document.querySelector('.form-notice-region'));
  await env.tick(1);assert.equal(document.querySelector('.form-notice-region'),null);
});

test('form lifetime resumes the remaining visible time after independent pauses',async t=>{
  const env=fixture(t);let dismissed=0;
  await env.render(createElement(FormNotice,{message:'Saved.',occurrence:1,onDismiss:()=>dismissed++}));
  await env.tick(3000);
  const region=document.querySelector('.form-notice-region'),close=document.querySelector('[aria-label="Dismiss notification"]');
  await act(async()=>region.dispatchEvent(new env.dom.window.MouseEvent('mouseover',{bubbles:true})));
  await act(async()=>close.focus());
  await env.tick(5000);
  await act(async()=>region.dispatchEvent(new env.dom.window.MouseEvent('mouseout',{bubbles:true})));
  await env.tick(5000);assert.equal(dismissed,0,'focus remains an independent pause');
  Object.defineProperty(document,'hidden',{configurable:true,value:true});
  await act(async()=>document.dispatchEvent(new env.dom.window.Event('visibilitychange')));
  await act(async()=>close.blur());
  await env.tick(5000);assert.equal(dismissed,0,'hidden document remains an independent pause');
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  await act(async()=>document.dispatchEvent(new env.dom.window.Event('visibilitychange')));
  await env.tick(999);assert.equal(dismissed,0);
  await env.tick(1);assert.equal(dismissed,1,'only one second remained');
});

