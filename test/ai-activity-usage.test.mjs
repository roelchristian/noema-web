import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {AIActivityLog} from '../src/client/settings/AIActivityLog.tsx';
import {api} from '../src/client/api.ts';

test('token usage loads all pages, filters dates/actions/status, and counts token subsets once',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','MutationObserver','Event','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const now=new Date();now.setHours(12,0,0,0);
 const old=new Date(now);old.setDate(old.getDate()-60);
 const row=(id,fields={})=>({id,action:'page_summary',status:'completed',startedAt:now.toISOString(),model:'test',reasoningEffort:'low',promptBytes:100,durationMs:null,inputTokens:100,outputTokens:20,cachedInputTokens:40,cacheWriteTokens:10,reasoningTokens:5,...fields});
 const rows=[row('recent'),row('failed',{status:'failed',action:'entity_scan',inputTokens:50,outputTokens:10}),row('missing',{inputTokens:null,outputTokens:null,cachedInputTokens:null,cacheWriteTokens:null,reasoningTokens:null}),row('older',{startedAt:old.toISOString(),inputTokens:1000})];
 let unavailable=false;
 const request=t.mock.method(api,'aiActivity',async cursor=>{if(unavailable)throw new Error('Usage unavailable');return cursor?{items:rows.slice(2),nextCursor:null}:{items:rows.slice(0,2),nextCursor:10};});
 const {createRoot}=await import('react-dom/client');
 const root=createRoot(document.querySelector('#mount'));
 const change=async(element,value)=>act(async()=>{Object.getOwnPropertyDescriptor(element.tagName==='INPUT'?dom.window.HTMLInputElement.prototype:dom.window.HTMLSelectElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}));});
 const stats=()=>[...document.querySelectorAll('.ai-usage-stat strong')].map(element=>Number(element.textContent.replaceAll(',','')));
 try{
  await act(async()=>root.render(React.createElement(AIActivityLog,{onClose(){},onOpenPage:async()=>{}})));
  const logTab=document.querySelector('#ai-activity-tab-log');logTab.focus();
  await act(async()=>logTab.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  assert.equal(document.activeElement.id,'ai-activity-tab-usage');
  assert.equal(document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'),'ai-activity-tab-usage');
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'Token usage');
  assert.equal(document.querySelectorAll('.ai-usage .select-trigger').length,2,'uses Noema dropdowns');
  assert.ok(request.mock.calls.some(call=>call.arguments[0]===10),'older pages fetched');
  assert.deepEqual(stats(),[180,150,30,80]);
  assert.match(document.querySelector('.ai-usage [role=status]').textContent,/3 matching actions · 2 with reported token usage/);
  assert.equal(document.querySelectorAll('.ai-usage-column').length,7);
  const [action,status]=document.querySelectorAll('.ai-usage select');
  const choosePeriod=async label=>act(async()=>[...document.querySelectorAll('[aria-label="Usage period"] button')].find(button=>button.textContent===label).click());
  await change(action,'entity_scan');assert.deepEqual(stats().slice(0,3),[60,50,10]);
  await change(status,'completed');assert.equal(stats()[0],0);assert.match(document.querySelector('.ai-activity-empty').textContent,/No AI activity/);
  await change(action,'all');await change(status,'all');await choosePeriod('90 days');assert.equal(stats()[0],1200);
  await choosePeriod('60 days');assert.equal(stats()[0],180);
  await choosePeriod('Custom');
  const inputs=document.querySelectorAll('.ai-usage input');
  const key=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  await change(inputs[0],key(old));await change(inputs[1],key(old));assert.equal(stats()[0],1020);
  await change(inputs[0],key(now));assert.match(document.querySelector('[role=alert]').textContent,/start date/);assert.equal(stats()[0],0);
  // Updating custom date inputs also exercises local inclusive end-date handling.
  await choosePeriod('7 days');await change(action,'entity_scan');
  rows[1]={...rows[1],inputTokens:80};
  await act(async()=>window.dispatchEvent(new Event('noema:ai-activity')));assert.equal(stats()[0],90);
  unavailable=true;await act(async()=>window.dispatchEvent(new Event('noema:ai-activity')));assert.equal(stats()[0],0);assert.match(document.querySelector('[role=alert]').textContent,/Usage unavailable/);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
