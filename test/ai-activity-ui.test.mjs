import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {AIActivityLog} from '../src/client/settings/AIActivityLog.tsx';
import {api} from '../src/client/api.ts';
test('AI explanation entries render in the log and update when generation finishes',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 let status='running',opened;
 const item=()=>({id:'explanation-attempt',action:'block_explanation',status,startedAt:'2026-10-17T00:00:00Z',finishedAt:null,durationMs:null,httpStatus:null,vaultId:'default',objectKind:'page',objectId:'note',objectTitle:'Source note',revision:1,available:true,promptBytes:123,model:'test',reasoningEffort:'low'});
 const request=t.mock.method(api,'aiActivity',async()=>({items:[item()],nextCursor:null}));
 const root=createRoot(document.querySelector('#mount'));
 try{
  await act(async()=>root.render(React.createElement(AIActivityLog,{onClose(){},onOpenPage:async(vault,id)=>{opened=[vault,id];}})));
  assert.match(document.querySelector('tbody').textContent,/AI Explanation/);assert.equal(document.querySelector('.ai-activity-status').textContent,'running');
  status='completed';await act(async()=>window.dispatchEvent(new Event('noema:ai-activity')));
  assert.equal(document.querySelector('.ai-activity-status').textContent,'completed');assert.equal(request.mock.callCount(),2);
  await act(async()=>document.querySelector('.ai-activity-link').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));assert.deepEqual(opened,['default','note']);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});

import {AIActivityDebug} from '../src/client/settings/AIActivityDebug.tsx';
import {AIDebugSettings} from '../src/client/settings/AIDebugSettings.tsx';
import {setupDOM} from './helpers/dom.mjs';
function mountDebug(t) {
 const fixture=setupDOM(t);
 fixture.dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 fixture.dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const root=createRoot(document.querySelector('#mount'));
 fixture.defer(()=>act(async()=>root.unmount()));
 return {...fixture,root};
}
const debugPayload=(overrides={})=>({activityId:'trace',status:'completed',endpoint:'/v1/responses',request:'{"inputBytes":1200}',response:'{"stream":{"eventCount":347},"elapsedMs":6280}',responseBody:'',responseStatus:200,responseHeaders:null,error:null,updatedAt:'2026-10-22T00:00:00Z',events:[],mode:'compact',revision:2,retainedBytes:500,...overrides});
test('compact diagnostics load summaries without events and stop polling completed requests',async t=>{
 const {root}=mountDebug(t);
 const request=t.mock.method(api,'aiActivityDebug',async()=>debugPayload());
 const timers=[];t.mock.method(globalThis,'setTimeout',(fn,delay)=>{timers.push(delay);return 0;});
 await act(async()=>root.render(React.createElement(AIActivityDebug,{id:'trace',onClose(){}})));
 assert.equal(request.mock.callCount(),1);
 assert.deepEqual(request.mock.calls[0].arguments[2],{events:false,after:undefined});
 assert.equal(timers.includes(2000),false);
 assert.match(document.body.textContent,/Compact trace/);assert.match(document.body.textContent,/347/);assert.match(document.body.textContent,/6.28s/);
 assert.equal(document.body.textContent.includes('Raw response body'),false);assert.match(document.body.textContent,/Diagnostic events/);
 assert.equal(document.querySelector('details[open]'),null);
});
test('running diagnostics poll by revision and retain the summary on unchanged responses',async t=>{
 const {root}=mountDebug(t);let refresh,calls=0;
 const request=t.mock.method(api,'aiActivityDebug',async()=>++calls===1?debugPayload({status:'running'}):debugPayload({unchanged:true,status:'completed',request:null,response:null}));
 t.mock.method(globalThis,'setTimeout',(fn,delay)=>{if(delay===2000)refresh=fn;return 0;});
 await act(async()=>root.render(React.createElement(AIActivityDebug,{id:'trace',onClose(){}})));
 assert.equal(typeof refresh,'function');
 await act(async()=>refresh());
 assert.deepEqual(request.mock.calls[1].arguments[2],{events:false,after:2});
 assert.match(document.body.textContent,/347/);
});
test('legacy stream events are fetched lazily in bounded pages',async t=>{
 const {root,dom}=mountDebug(t);
 const request=t.mock.method(api,'aiActivityDebug',async(_id,_signal,options)=>options.events?debugPayload({mode:'legacy',events:[{sequence:1,type:'response.created',data:'{}',receivedAt:'2026-10-22T00:00:00Z'}],nextEventCursor:1,hasMoreEvents:true}):debugPayload({mode:'legacy'}));
 await act(async()=>root.render(React.createElement(AIActivityDebug,{id:'trace',onClose(){}})));
 assert.equal(request.mock.callCount(),1);
 const detail=[...document.querySelectorAll('details')].find(element=>element.textContent.includes('Saved stream events'));
 await act(async()=>{detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));});
 assert.equal(request.mock.callCount(),2);
 assert.equal(request.mock.calls[1].arguments[2].limit,100);
 assert.match(document.body.textContent,/response.created/);
 assert.match(document.body.textContent,/Load more events/);
});
test('debug setting defaults to compact and full capture requires a short deliberate session',async t=>{
 const {root,dom}=mountDebug(t);
 t.mock.method(api,'aiDebugSettings',async()=>({enabled:false,mode:'off',fullUntil:null}));
 const save=t.mock.method(api,'saveAIDebugSettings',async(enabled,minutes)=>({enabled,mode:minutes?'full':'compact',fullUntil:minutes?new Date(Date.now()+minutes*60000).toISOString():null}));
 await act(async()=>root.render(React.createElement(AIDebugSettings)));
 const compact=[...document.querySelectorAll('button')].find(button=>button.textContent==='Compact');
 await act(async()=>compact.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 assert.deepEqual(save.mock.calls[0].arguments,[true,0]);
 const full=[...document.querySelectorAll('button')].find(button=>button.textContent==='Capture full traces for 15 minutes');
 await act(async()=>full.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 assert.deepEqual(save.mock.calls[1].arguments,[true,15]);
 assert.match(document.body.textContent,/Full capture enabled until/);
});
test('compact JSON downloads include selected diagnostic events',async t=>{
 const {root,dom}=mountDebug(t);let exported;
 t.mock.method(api,'aiActivityDebug',async(_id,_signal,options)=>debugPayload({events:options.events?[{sequence:1,type:'validation.failed',data:'{"stage":"parser"}',receivedAt:'2026-10-22T00:00:00Z'}]:[],hasMoreEvents:false}));
 t.mock.method(URL,'createObjectURL',blob=>{exported=blob;return 'blob:debug-test';});
 t.mock.method(URL,'revokeObjectURL',()=>{});
 t.mock.method(dom.window.HTMLAnchorElement.prototype,'click',()=>{});
 t.mock.method(globalThis,'setTimeout',()=>0);
 await act(async()=>root.render(React.createElement(AIActivityDebug,{id:'trace',onClose(){}})));
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Download JSON').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 assert.equal(JSON.parse(await exported.text()).events[0].type,'validation.failed');
});
test('oversized legacy JSON downloads stop before accumulating events',async t=>{
 const {root,dom}=mountDebug(t);
 const request=t.mock.method(api,'aiActivityDebug',async()=>debugPayload({mode:'legacy',request:'x'.repeat(4*1024*1024)}));
 await act(async()=>root.render(React.createElement(AIActivityDebug,{id:'trace',onClose(){}})));
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Download JSON').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 assert.equal(request.mock.callCount(),1);
 assert.match(document.querySelector('[role="alert"]').textContent,/4 MiB download limit/);
});

test('speech activity shows the Realtime model and source page without a reasoning setting',async t=>{
 const {root,dom}=mountDebug(t);let opened;
 t.mock.method(api,'aiActivity',async()=>({items:[{id:'speech-attempt',action:'text_to_speech',status:'completed',startedAt:'2026-10-24T00:00:00Z',finishedAt:'2026-10-24T00:00:01Z',durationMs:1000,httpStatus:200,vaultId:'default',objectKind:'page',objectId:'note',objectTitle:'Read this page',revision:1,available:true,promptBytes:120,model:'gpt-realtime-2.1-mini',reasoningEffort:'none',inputTokens:50,outputTokens:100,debugRecorded:false}],nextCursor:null}));
 await act(async()=>root.render(React.createElement(AIActivityLog,{onClose(){},onOpenPage:async(vault,id)=>{opened=[vault,id];}})));
 assert.match(document.querySelector('tbody').textContent,/Speak \(OpenAI TTS\)/);
 assert.match(document.querySelector('.ai-activity-model').textContent,/gpt-realtime-2.1-mini/);
 assert.equal(document.querySelector('.ai-activity-reasoning'),null);
 await act(async()=>document.querySelector('.ai-activity-title').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 assert.deepEqual(opened,['default','note']);
});
