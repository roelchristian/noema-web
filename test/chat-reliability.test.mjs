import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {ChatWorkspace} from '../src/client/chat/ChatWorkspace.tsx';
import {chatAPI} from '../src/client/chat/api.ts';
import {api} from '../src/client/api.ts';
import {readChatDrafts,writeChatDrafts} from '../src/client/chat/chat-session.ts';

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
 await act(async()=>new Promise(resolve=>setTimeout(resolve,500)));
 assert.equal(document.querySelectorAll('.is-user').length,1);assert.equal(document.querySelectorAll('.is-assistant').length,1);assert.match(document.querySelector('.is-assistant').textContent,/Validated answer/);
});

test('closing a pending temporary turn tears down private retry and draft state',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));t.mock.method(chatAPI,'list',async()=>[]);t.mock.method(chatAPI,'cancel',async()=>({cancelled:true}));
 t.mock.method(globalThis,'fetch',async(_url,options)=>new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});}})));
 const props={vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}};
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 await act(async()=>document.querySelector('.chat-check input').click());
 await act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'PRIVATE_PENDING_QUESTION'}});});
 await act(async()=>document.querySelector('.chat-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await act(async()=>root.render(createElement(ChatWorkspace,{...props,visible:false})));
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 assert.doesNotMatch(document.body.textContent,/PRIVATE_PENDING_QUESTION|Try again/);assert.equal(document.getElementById('chat-question').value,'');assert.equal(document.querySelector('.chat-typing'),null);
 assert.doesNotMatch(JSON.stringify(readChatDrafts('default')),/PRIVATE_PENDING_QUESTION/);
});
