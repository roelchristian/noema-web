import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {revealEntityFact} from '../src/client/chat/entity-evidence-navigation.ts';

test('entity evidence reveals the exact full property and relationship IDs without invoking mutation controls',t=>{
 const dom=new JSDOM('<button id="entity-home-tab-overview" aria-selected="true"></button><button id="entity-home-tab-connections" aria-selected="false"></button><article class="entity-home"><div data-property-id="p1" tabindex="-1">short</div><details><summary>Properties</summary><div class="entity-property-card" data-property-id="p1" tabindex="-1">full property</div></details><div hidden id="connections"><details><summary>Relationships</summary><div data-relationship-id="r1" tabindex="-1">exact relationship</div></details></div><p data-entity-description tabindex="-1">description</p><section data-entity-overview tabindex="-1">overview</section></article>');
 const previous={document:global.document,HTMLDetailsElement:global.HTMLDetailsElement,CSS:global.CSS};Object.assign(global,{document:dom.window.document,HTMLDetailsElement:dom.window.HTMLDetailsElement,CSS:{escape:value=>value}});t.after(()=>{Object.assign(global,previous);dom.window.close();});
 dom.window.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
 const root=document.querySelector('article'),overview=document.getElementById('entity-home-tab-overview'),connections=document.getElementById('entity-home-tab-connections');
 connections.onclick=()=>{connections.setAttribute('aria-selected','true');overview.setAttribute('aria-selected','false');document.getElementById('connections').hidden=false;};
 overview.onclick=()=>{overview.setAttribute('aria-selected','true');connections.setAttribute('aria-selected','false');};
 assert.equal(revealEntityFact(root,'property:p1'),true);assert.equal(document.activeElement.textContent,'full property');assert.equal(document.activeElement.closest('details').open,true);
 assert.equal(revealEntityFact(root,'relationship:r1'),false,'select the correct tab before focusing its record');assert.equal(revealEntityFact(root,'relationship:r1'),true);assert.equal(document.activeElement.dataset.relationshipId,'r1');assert.equal(document.activeElement.closest('details').open,true);
 assert.equal(revealEntityFact(root,'description'),false);assert.equal(revealEntityFact(root,'description'),true);assert.equal(document.activeElement.textContent,'description');assert.equal(revealEntityFact(root,'overview'),true);assert.equal(document.activeElement.textContent,'overview');
 assert.equal(revealEntityFact(root,'property:missing'),false,'never navigate to a nearby substitute record');
});

test('Chat renders streamed claims before completion, replaces them once, and clears interrupted answers',async t=>{
 const {act,createElement}=await import('react');
 const {createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs');
 const {ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx');
 const {chatAPI}=await import('../src/client/chat/api.ts');
 for(const outcome of ['complete','stop','error','truncated'])await t.test(outcome,async t=>{
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  t.mock.method(chatAPI,'list',async()=>[]);t.mock.method(chatAPI,'cancel',async()=>({cancelled:true}));
  let stream;const encoder=new TextEncoder();
  t.mock.method(globalThis,'fetch',async(_url,options)=>new Response(new ReadableStream({start(controller){stream=controller;options.signal.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
  await act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'What does the source say?'}});});
  await act(async()=>document.querySelector('.chat-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  const evidence={id:'E1',kind:'source',objectId:'source',title:'Test source',excerpt:'A source excerpt.',fingerprint:'hash',locator:'Line 1',status:'current'};
  const first={text:'A streamed claim with café and 漢字.',attribution:'supported',citationIds:['E1']},second={text:'A second claim.',attribution:'inferred',citationIds:['E1']};
  const packet=value=>encoder.encode('data: '+JSON.stringify(value)+'\r\n\r\n');
  await act(async()=>stream.enqueue(packet({type:'thread',threadId:'early-thread'})));
  const {readChatSession}=await import('../src/client/chat/chat-session.ts');assert.equal(readChatSession('default').threadId,'early-thread');assert.equal(readChatSession('default').pending,true);
  await act(async()=>stream.enqueue(packet({type:'evidence',evidence:[evidence]})));
  assert.match(document.querySelector('.chat-progress').textContent,/Writing answer/);
  const bytes=packet({type:'claim',claim:first}),split=bytes.indexOf(0xc3)+1;
  await act(async()=>stream.enqueue(bytes.slice(0,split)));assert.equal(document.querySelector('.is-streaming'),null);
  await act(async()=>stream.enqueue(bytes.slice(split)));assert.match(document.querySelector('.is-streaming').textContent,/café and 漢字/);
  assert.equal(document.querySelectorAll('.chat-copy').length,0);assert.equal(document.getElementById('chat-question').disabled,true);
  assert.match(document.querySelector('.is-streaming .chat-citation').getAttribute('aria-label'),/Test source/);
  if(outcome==='complete'){
   const log=document.querySelector('.chat-messages');let scrolls=0;log.scrollTo=()=>scrolls++;Object.defineProperties(log,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:200}});
   await act(async()=>log.dispatchEvent(new Event('scroll')));
   await act(async()=>stream.enqueue(packet({type:'claim',claim:second})));assert.equal(document.querySelectorAll('.is-streaming .chat-claim').length,2);assert.equal(scrolls,0,'Reading older messages is not interrupted by streaming');
   await act(async()=>{stream.enqueue(packet({type:'answer',result:{message:{id:'final',role:'assistant',text:first.text+'\n\n'+second.text,claims:[first,second],evidence:[evidence],createdAt:'',status:'completed'},diagnostics:{depth:'standard',passes:1,evidenceCount:1}}}));stream.close();});
   assert.equal(document.querySelector('.is-streaming'),null);assert.equal(document.querySelectorAll('.is-assistant').length,1);assert.equal(document.querySelectorAll('.chat-claim').length,2);assert.equal(document.querySelectorAll('.chat-copy').length,1);
  }else if(outcome==='stop')await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Stop').click());
  else if(outcome==='error')await act(async()=>{stream.enqueue(packet({type:'error',message:'The evidence changed while answering.'}));stream.close();});
  else await act(async()=>stream.close());
  assert.equal(document.getElementById('chat-question').disabled,false);assert.equal(document.querySelector('.is-streaming'),null);
  if(outcome!=='complete'){assert.equal(document.querySelectorAll('.is-assistant').length,0);assert.match(document.body.textContent,outcome==='stop'?/Stopped/:outcome==='error'?/evidence changed/:/interrupted/);}
 });
});

test('conversation inbox groups and searches history, opens the selected scope, and keeps rename/delete working',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs'),{ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx'),{chatAPI}=await import('../src/client/chat/api.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const now=new Date().toISOString();let threads=[{id:'today',vaultId:'default',title:'Grace and evidence',scope:{kind:'source',id:'source-1'},createdAt:now,updatedAt:now,messages:[]},{id:'old',vaultId:'default',title:'Earlier questions',scope:{kind:'vault'},createdAt:'2020-01-01T00:00:00Z',updatedAt:'2020-01-01T00:00:00Z',messages:[]}];
 t.mock.method(chatAPI,'list',async()=>structuredClone(threads));
 t.mock.method(chatAPI,'get',async(vault,id)=>{assert.equal(vault,'default');return {...threads.find(thread=>thread.id===id),messages:[{id:'answer',role:'assistant',text:'Saved answer.',createdAt:now}]};});
 t.mock.method(chatAPI,'rename',async(_vault,id,title)=>{threads=threads.map(thread=>thread.id===id?{...thread,title}:thread);return threads.find(thread=>thread.id===id);});
 t.mock.method(chatAPI,'remove',async(_vault,id)=>{threads=threads.filter(thread=>thread.id!==id);return {deleted:true};});
 const edit=async(selector,value)=>act(async()=>{const input=document.querySelector(selector);input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test vault',initialScope:{kind:'vault'},entities:[{id:'source-1',vault_id:'default',name:'Original source'}],pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
 const inbox=document.querySelector('aside[aria-label="Chat inbox"]');assert.ok(inbox);assert.equal(document.querySelector('select[aria-label="Conversation history"]'),null);
 assert.deepEqual([...inbox.querySelectorAll('.chat-thread-group h3')].map(node=>node.textContent),['Today','Earlier']);
 await edit('input[aria-label="Search conversations"]','GRACE');assert.equal(document.querySelectorAll('.chat-thread').length,1);
 await edit('input[aria-label="Search conversations"]','no match');assert.match(inbox.textContent,/No matches/);
 await edit('input[aria-label="Search conversations"]','');await click('[data-thread-id=today]');
 assert.equal(document.querySelector('[aria-current=page]').dataset.threadId,'today');assert.match(document.querySelector('[data-chat-scope]').textContent,/Source · Original source/);assert.match(document.querySelector('.chat-heading h1').textContent,/Grace and evidence/);
 await click('[aria-label="Rename conversation"]');await edit('input[aria-label="Conversation title"]','Renamed conversation');
 await act(async()=>document.querySelector('.chat-rename').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.match(document.querySelector('[data-thread-id=today]').textContent,/Renamed conversation/);
 await click('[aria-label="Delete conversation"]');assert.equal(document.querySelector('[data-thread-id=today]'),null);assert.equal(document.querySelectorAll('.chat-message').length,0);
 await click('.chat-new');assert.match(document.querySelector('.chat-heading h1').textContent,/New chat/);
});

test('mobile inbox uses a modal drawer, restores focus on dismissal, and closes when a conversation opens',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs'),{ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx'),{chatAPI}=await import('../src/client/chat/api.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(window,'matchMedia',query=>({matches:query==='(max-width: 750px)',addEventListener(){},removeEventListener(){}}));
 t.mock.method(window,'requestAnimationFrame',callback=>{callback();return 1;});
 t.mock.method(globalThis,'requestAnimationFrame',callback=>{callback();return 1;});
 const now=new Date().toISOString(),thread={id:'saved',title:'A saved question',scope:{kind:'vault'},createdAt:now,updatedAt:now,messages:[]};
 t.mock.method(chatAPI,'list',async()=>[thread]);t.mock.method(chatAPI,'get',async()=>({...thread,messages:[{id:'answer',role:'assistant',text:'Saved mobile answer.',createdAt:now}]}));
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
 const toggle=document.querySelector('[aria-label="Show conversations"]');assert.equal(document.querySelector('.chat-history-pane'),null);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 await act(async()=>toggle.click());assert.equal(document.querySelector('.chat-history-dialog').open,true);assert.equal(document.querySelector('.chat-main').hasAttribute('inert'),true);assert.equal(document.activeElement.getAttribute('aria-label'),'Search conversations');
 await act(async()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{bubbles:true,cancelable:true})));
 assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,toggle);assert.equal(document.querySelector('.chat-main').hasAttribute('inert'),false);
 await act(async()=>toggle.click());await act(async()=>document.querySelector('[data-thread-id=saved]').click());
 assert.equal(document.querySelector('dialog'),null);assert.match(document.querySelector('.chat-messages').textContent,/Saved mobile answer/);assert.equal(document.querySelector('.chat-main').hasAttribute('inert'),false);
});

test('inbox recovers from history load failure without hiding a conversation error in the composer',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs'),{ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx'),{chatAPI}=await import('../src/client/chat/api.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));let attempts=0;
 t.mock.method(chatAPI,'list',async()=>{if(++attempts===1)throw new Error('History is unavailable.');return [];});
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}})));
 assert.match(document.querySelector('.chat-history-error').textContent,/History is unavailable/);assert.equal(document.querySelector('.chat-composer-area [role=alert]'),null);
 await act(async()=>document.querySelector('.chat-history-error button').click());assert.equal(attempts,2);assert.equal(document.querySelector('.chat-history-error'),null);assert.match(document.querySelector('.chat-inbox-empty').textContent,/Start a chat/);
});

test('refresh restores the saved conversation, scope, draft, mentions, search depth and reading position',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs'),{ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx'),{chatAPI}=await import('../src/client/chat/api.ts');
 const {readChatSession}=await import('../src/client/chat/chat-session.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const now=new Date().toISOString(),thread={id:'saved-thread',title:'A continuing discussion',scope:{kind:'page',id:'page-1'},createdAt:now,updatedAt:now,messages:[{id:'first',role:'user',text:'A saved question',createdAt:now},{id:'second',role:'assistant',text:'A saved answer',createdAt:now}]};
 t.mock.method(chatAPI,'list',async()=>[thread]);t.mock.method(chatAPI,'get',async(vault,id)=>{assert.equal(vault,'default');assert.equal(id,thread.id);return structuredClone(thread);});
 const props={vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[{id:'entity-1',vault_id:'default',name:'Augustine',type:'person'}],pages:[{id:'page-1',title:'A scoped page'}],visible:true,onClose(){},onOpenEvidence(){}};
 const edit=value=>act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
 await act(async()=>root.render(createElement(ChatWorkspace,props)));
 await act(async()=>document.querySelector('[data-thread-id=saved-thread]').click());
 await edit('@August');await act(async()=>document.querySelector('.chat-mention-list button').click());await edit('Draft follow-up about Augustine');
 await act(async()=>document.querySelector('[aria-label="Search more thoroughly"]').click());
 const log=document.querySelector('.chat-messages');Object.defineProperties(log,{scrollHeight:{configurable:true,value:1200},clientHeight:{configurable:true,value:300}});log.scrollTop=245;
 await act(async()=>log.dispatchEvent(new Event('scroll')));
 const before=readChatSession('default');assert.equal(before.open,true);assert.equal(before.threadId,thread.id);assert.equal(before.scrollTop,245);assert.equal(before.followBottom,false);assert.equal(before.mentions[0].id,'entity-1');assert.equal(readChatSession('other-vault'),null);
 assert.equal(env.dom.window.sessionStorage.getItem('noema-chat-session:default').includes('A saved answer'),false,'Transcript is reloaded from server storage');
 await act(async()=>root.render(null));await act(async()=>root.render(createElement(ChatWorkspace,{...props,restoreSession:true})));
 assert.match(document.querySelector('.chat-messages').textContent,/A saved answer/);assert.match(document.querySelector('[data-chat-scope]').textContent,/Page · A scoped page/);
 assert.equal(document.querySelector('[aria-current=page]').dataset.threadId,'saved-thread');assert.equal(document.getElementById('chat-question').value,'Draft follow-up about Augustine');assert.equal(document.querySelector('[aria-label="Search more thoroughly"]').getAttribute('aria-pressed'),'true');
 assert.equal(document.querySelector('.chat-messages').scrollTop,245);assert.equal(readChatSession('default').scrollTop,245);assert.ok(document.querySelector('.chat-jump'));
 await act(async()=>document.querySelector('[aria-label="Close Chat"]').click());assert.equal(readChatSession('default'),null,'Explicit dismissal stays closed after refresh');
});

test('refresh keeps an unsent draft and temporary chat never persists content in the browser',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs'),{ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx'),{chatAPI}=await import('../src/client/chat/api.ts');
 const {readChatSession}=await import('../src/client/chat/chat-session.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));t.mock.method(chatAPI,'list',async()=>[]);
 const props={vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){}};
 const edit=value=>act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});});
 await act(async()=>root.render(createElement(ChatWorkspace,props)));await edit('My unsent question');
 await act(async()=>root.render(null));await act(async()=>root.render(createElement(ChatWorkspace,{...props,restoreSession:true})));assert.equal(document.getElementById('chat-question').value,'My unsent question');
 await act(async()=>{const input=document.querySelector('.chat-options input[type=checkbox]');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{checked:true}});});
 await edit('Private temporary question');assert.equal(readChatSession('default'),null);assert.doesNotMatch([...Object.values(env.dom.window.sessionStorage)].join(''),/Private temporary question/);
});

test('Chat session parsing rejects bad scope and identity, bounds drafts, and tolerates blocked storage',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),{readChatSession,writeChatSession,clearChatSession}=await import('../src/client/chat/chat-session.ts');
 const env=setupDOM(t),key='noema-chat-session:default';
 for(const value of ['broken','null','{"scope":{"kind":"unknown"}}','{"scope":{"kind":"page"}}','{"scope":{"kind":"vault"},"threadId":4}']){window.sessionStorage.setItem(key,value);assert.equal(readChatSession('default'),null);}
 window.sessionStorage.setItem(key,JSON.stringify({open:true,scope:{kind:'vault'},draft:'a'.repeat(3000),scrollTop:-4}));assert.equal(readChatSession('default').draft.length,2000);assert.equal(readChatSession('default').scrollTop,0);
 t.mock.getter(env.dom.window,'sessionStorage',()=>{throw new Error('Storage blocked');});assert.equal(readChatSession('default'),null);assert.doesNotThrow(()=>writeChatSession('default',{open:true,scope:{kind:'vault'}}));assert.doesNotThrow(()=>clearChatSession('default'));
});
