import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {ChatWorkspace} from '../src/client/chat/ChatWorkspace.tsx';
import {chatAPI} from '../src/client/chat/api.ts';
import {api} from '../src/client/api.ts';
import {readChatDrafts,writeChatDrafts} from '../src/client/chat/chat-session.ts';

function chatClock(t) {
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 return async()=>{
  assert.ok(document.querySelector('.chat-progress'),'Answer is still staged before the typing beat');
  // Each promise continuation schedules the next beat; flush React between ticks.
  await act(async()=>t.mock.timers.tick(300));
  assert.ok(document.querySelector('.chat-progress.is-leaving'),'Typing exits before the answer appears');
  await act(async()=>t.mock.timers.tick(140));
  assert.equal(document.querySelector('.chat-progress'),null,'The completed turn leaves the busy state');
 };
}

test('drafts follow saved threads across switches and remounts, isolated from another vault and temporary chat',async t=>{
 const env=setupDOM(t);let root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const threads=['a','b'].map(id=>({id,vaultId:'default',title:'Thread '+id,scope:{kind:'vault'},messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));
 t.mock.method(chatAPI,'list',async()=>threads);t.mock.method(chatAPI,'get',async(_vault,id)=>threads.find(thread=>thread.id===id));
 const props={vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}};
 const click=selector=>act(async()=>document.querySelector(selector).click());
 const edit=value=>act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 await click('[data-thread-id=a]');await edit('Draft for A');await click('[data-thread-id=b]');await edit('Draft for B');await click('[data-thread-id=a]');
 assert.equal(document.getElementById('chat-question').value,'Draft for A');assert.equal(readChatDrafts('default').b.draft,'Draft for B');assert.deepEqual(readChatDrafts('other'),{});
 await act(async()=>root.unmount());root=createRoot(document.querySelector('#mount'));
 await act(async()=>root.render(createElement(ChatWorkspace,{...props,restoreSession:true})));
 assert.equal(document.getElementById('chat-question').value,'Draft for A');await click('[data-thread-id=b]');assert.equal(document.getElementById('chat-question').value,'Draft for B');
 await click('[aria-label="New conversation"]');
 await act(async()=>{const checkbox=document.querySelector('.chat-check input');checkbox.click();});
 await edit('TEMPORARY_SECRET');assert.doesNotMatch(JSON.stringify(readChatDrafts('default')),/TEMPORARY_SECRET/);
 await act(async()=>root.render(createElement(ChatWorkspace,{...props,visible:false})));
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 assert.equal(document.getElementById('chat-question').value,'');assert.doesNotMatch(env.dom.window.sessionStorage.getItem('noema-chat-drafts:default'),/TEMPORARY_SECRET/);
});

test('draft storage validates bounded fields and isolates vault keys',t=>{
 setupDOM(t);writeChatDrafts('one',{thread:{draft:'Saved',mentions:[{id:'id',name:'Subject'}],deep:true}});
 assert.equal(readChatDrafts('one').thread.draft,'Saved');assert.deepEqual(readChatDrafts('two'),{});
 window.sessionStorage.setItem('noema-chat-drafts:one',JSON.stringify({thread:{draft:7,mentions:[{},null,{id:'a',name:'A'}],deep:'yes'}}));
 assert.deepEqual(readChatDrafts('one').thread,{draft:'',mentions:[{id:'a',name:'A'}],deep:false});
});

test('retrying a restored failure retains original request depth and the independently drafted next question',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const completeAnswer=chatClock(t);
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));
 const thread={id:'failed',vaultId:'default',title:'Failed research',scope:{kind:'page',id:'note'},createdAt:'',updatedAt:new Date().toISOString(),messages:[{id:'user',role:'user',text:'Original question',mentions:[],searchDepth:'deep',createdAt:''},{id:'failure',role:'assistant',text:'Failure',status:'failed',createdAt:''}]};
 t.mock.method(chatAPI,'list',async()=>[thread]);t.mock.method(chatAPI,'get',async()=>thread);
 let sent;const encoder=new TextEncoder();t.mock.method(globalThis,'fetch',async(_url,options)=>{sent=JSON.parse(options.body);return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'answer',result:{threadId:'failed',message:{id:'new-answer',role:'assistant',text:'Validated answer',createdAt:''},diagnostics:{passes:2,evidenceCount:0,depth:'deep'}}})+'\n\n'));controller.close();}}));});
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
 await act(async()=>document.querySelector('[data-thread-id=failed]').click());
 await act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'Next draft'}});});
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Try again').click());
 assert.equal(sent.question,'Original question');assert.equal(sent.deep,true);assert.deepEqual(sent.scope,{kind:'page',id:'note'});assert.equal(sent.retryMessageId,'failure');assert.equal(sent.regenerateMessageId,undefined);
 assert.equal(document.getElementById('chat-question').value,'Next draft');assert.equal(document.getElementById('chat-question').disabled,false);
 await completeAnswer();
 assert.equal(document.querySelectorAll('.is-user').length,1);assert.equal(document.querySelectorAll('.is-assistant').length,1);assert.match(document.querySelector('.is-assistant').textContent,/Validated answer/);
});

test('closing a pending temporary turn tears down private retry and draft state',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let activeSignal,requestId;const cancellations=[];
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));t.mock.method(chatAPI,'list',async()=>[]);t.mock.method(chatAPI,'cancel',async(vault,id)=>{cancellations.push({vault,id});return {cancelled:true};});
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  activeSignal=options.signal;requestId=JSON.parse(options.body).requestId;
  return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});}}));
 });
 const props={vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}};
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 await act(async()=>document.querySelector('.chat-check input').click());
 await act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'PRIVATE_PENDING_QUESTION'}});});
 await act(async()=>document.querySelector('.chat-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(activeSignal.aborted,false);
 await act(async()=>root.render(createElement(ChatWorkspace,{...props,visible:false})));
 assert.equal(activeSignal.aborted,true);assert.deepEqual(cancellations,[{vault:'default',id:requestId}]);
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 assert.doesNotMatch(document.body.textContent,/PRIVATE_PENDING_QUESTION|Try again/);assert.equal(document.getElementById('chat-question').value,'');assert.equal(document.querySelector('.chat-typing'),null);
 assert.doesNotMatch(JSON.stringify(readChatDrafts('default')),/PRIVATE_PENDING_QUESTION/);
});

async function retryFixture(t,{threads=[],entities=[]}={}) {
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const completeAnswer=chatClock(t);
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));t.mock.method(chatAPI,'list',async()=>threads);
 const edit=value=>act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
 const send=()=>act(async()=>document.querySelector('.chat-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const retry=()=>act(async()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Try again');assert.ok(button,'A failed turn offers direct retry');button.click();});
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities,pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
 return {edit,send,retry,completeAnswer};
}
function retryStream(events) {
 const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){for(const event of events)controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));controller.close();}}));
}
const retryAnswer=(id,text='Recovered validated answer')=>({type:'answer',result:{message:{id,role:'assistant',text,createdAt:'',status:'completed'},diagnostics:{passes:1,evidenceCount:0,depth:'standard'}}});

test('temporary retry retains original inherited subjects and prior questions while the next draft changes',async t=>{
 const subject={id:'subject',vault_id:'default',type:'person',name:'Subject'},next={id:'next',vault_id:'default',type:'person',name:'Next'};
 const f=await retryFixture(t,{entities:[subject,next]}),requests=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?retryStream([retryAnswer('first')]):retryStream([{type:'error',message:'Synthetic failure'}]);});
 await act(async()=>document.querySelector('.chat-check input').click());
 await f.edit('Explain @Subject');await act(async()=>document.querySelector('[data-context-id=subject]').click());await f.send();await f.completeAnswer();
 await f.edit('What follows from that?');await f.send();
 assert.equal(requests.length,2);assert.deepEqual(requests[1].contextMentions,[{id:'subject',name:'Subject'}]);assert.deepEqual(requests[1].previousQuestions,['Explain Subject']);
 await f.edit('Next draft @Next');await act(async()=>document.querySelector('[data-context-id=next]').click());await f.retry();
 assert.equal(requests.length,3);assert.equal(requests[2].question,requests[1].question);assert.deepEqual(requests[2].contextMentions,requests[1].contextMentions);assert.deepEqual(requests[2].previousQuestions,requests[1].previousQuestions);assert.deepEqual(requests[2].mentions,requests[1].mentions);
 assert.equal(document.getElementById('chat-question').value,'Next draft Next ');assert.equal(document.querySelectorAll('.is-user').length,2);assert.doesNotMatch(JSON.stringify(readChatDrafts('default')),/What follows|Next draft/);
});

test('a lost answer after a failed retry reconciles the completed saved tail without another dispatch',async t=>{
 const thread={id:'saved-retry',title:'Retry research',vaultId:'default',scope:{kind:'vault'},createdAt:'',updatedAt:new Date().toISOString(),messages:[{id:'original',role:'user',text:'Original question',createdAt:'',searchDepth:'deep',mentions:[]},{id:'marker',role:'assistant',text:'Failed',createdAt:'',status:'failed'}]};
 const f=await retryFixture(t,{threads:[thread]});let reads=0,dispatches=0;
 t.mock.method(chatAPI,'get',async()=>{reads++;return structuredClone(thread);});
 t.mock.method(globalThis,'fetch',async()=>{dispatches++;thread.messages[1]={id:'server-completed',role:'assistant',text:'Saved answer after lost transport',createdAt:'',status:'completed'};throw new TypeError('Synthetic response lost');});
 await act(async()=>document.querySelector('[data-thread-id=saved-retry]').click());await f.retry();assert.equal(dispatches,1);
 await f.edit('Keep this new draft');await f.retry();
 assert.equal(dispatches,1,'Reconciliation must not submit a completed retry again');assert.equal(reads,3);assert.match(document.querySelector('.is-assistant').textContent,/Saved answer after lost transport/);assert.equal(document.querySelectorAll('.is-user').length,1);assert.equal(document.getElementById('chat-question').value,'Keep this new draft');
});

test('unknown-thread missing recovery reuses the original id and running recovery blocks dispatch',async t=>{
 for(const status of ['missing','running'])await t.test(status,async t=>{
  const f=await retryFixture(t),requests=[],lookups=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{requests.push(JSON.parse(options.body));throw new TypeError('Synthetic failure before first thread event');});
  t.mock.method(chatAPI,'requestStatus',async(vault,id)=>{lookups.push({vault,id});return {status};});
  await f.edit('Lost original question');await f.send();await f.edit('Independent next draft');await f.retry();
  assert.equal(lookups.length,1);assert.deepEqual(lookups[0],{vault:'default',id:requests[0].requestId});
  assert.equal(requests.length,status==='missing'?2:1);
  if(status==='missing'){assert.equal(requests[1].requestId,requests[0].requestId);assert.equal(requests[1].question,'Lost original question');assert.deepEqual(requests[1].previousQuestions,[]);}
  else assert.match(document.body.textContent,/previous request is still running/);
  assert.equal(document.querySelectorAll('.is-user').length,1);assert.equal(document.getElementById('chat-question').value,'Independent next draft');
 });
});

test('unknown-thread failed recovery targets the resolved failure marker without duplicating the question',async t=>{
 const f=await retryFixture(t),requests=[];
 const thread={id:'recovered-thread',title:'Recovered thread',vaultId:'default',scope:{kind:'vault'},createdAt:'',updatedAt:'',messages:[{id:'persisted-user',role:'user',text:'Recover this question',mentions:[],searchDepth:'standard',createdAt:''},{id:'persisted-failure',role:'assistant',text:'Failed',status:'failed',createdAt:''}]};
 t.mock.method(globalThis,'fetch',async(_url,options)=>{requests.push(JSON.parse(options.body));if(requests.length===1)throw new TypeError('Synthetic lost thread event');return retryStream([{...retryAnswer('resolved-answer'),result:{...retryAnswer('resolved-answer').result,threadId:thread.id}}]);});
 t.mock.method(chatAPI,'requestStatus',async(vault,id)=>{assert.equal(vault,'default');assert.equal(id,requests[0].requestId);return {status:'failed',threadId:thread.id};});
 t.mock.method(chatAPI,'get',async(vault,id)=>{assert.equal(vault,'default');assert.equal(id,thread.id);return thread;});
 await f.edit('Recover this question');await f.send();await f.retry();
 assert.equal(requests.length,2);assert.equal(requests[1].threadId,thread.id);assert.equal(requests[1].retryMessageId,'persisted-failure');assert.notEqual(requests[1].requestId,requests[0].requestId);assert.equal(requests[1].question,requests[0].question);
 await f.completeAnswer();assert.equal(document.querySelectorAll('.is-user').length,1);assert.equal(document.querySelectorAll('.is-assistant').length,1);assert.match(document.querySelector('.is-assistant').textContent,/Recovered validated answer/);
});
