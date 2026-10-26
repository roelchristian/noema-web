import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {ChatEvidencePanel} from '../src/client/chat/ChatEvidencePanel.tsx';
import {chatEvidenceLabel,groupChatEvidence,clampEvidenceWidth,sameChatEvidence} from '../src/client/chat/chat-evidence.ts';
const source={id:'E1',kind:'source',objectId:'original',title:'Original source',excerpt:'A recorded source passage.',fingerprint:'source-v1',locator:'Page 4',status:'current'};
const second={...source,id:'E2',excerpt:'Another original passage.',locator:'Page 6'};
const note={...source,id:'E3',kind:'own_note',objectId:'original',title:'Secondary note',origin:'ai_generated',fingerprint:'note-v1',status:'stale'};
const fact={...source,id:'E4',kind:'entity_fact',objectId:'person',title:'Recorded person',fingerprint:'fact-v1'};
const overview={...fact,id:'E5',kind:'entity_overview',fingerprint:'overview-v1'};

test('evidence groups preserve original source, secondary note and structured entity boundaries',()=>{
 const groups=groupChatEvidence([source,second,note,fact,overview]);
 assert.deepEqual(groups.map(group=>[group.kind,group.items.map(item=>item.id)]),[['source',['E1','E2']],['note',['E3']],['entity',['E4','E5']]]);
 assert.equal(chatEvidenceLabel(note),'AI-generated secondary note');
 assert.equal(chatEvidenceLabel({...note,origin:'mixed'}),'Note with AI-generated text');
 assert.equal(sameChatEvidence(source,{...source,fingerprint:'changed'}),false);
 assert.equal(clampEvidenceWidth(900,1000),640);assert.equal(clampEvidenceWidth(100,1000),260);assert.equal(clampEvidenceWidth(640,700),360);
});

test('evidence index lists grouped passages; detail preserves stale provenance and precise selection',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let inspected,opened=0,closed=0,index=0;
 const props={evidence:[source,second,note],selected:null,mobile:false,verifying:false,onInspect:(item,trigger)=>{inspected={item,trigger};},onOpenOriginal:()=>opened++,onClose:()=>closed++,onShowIndex:()=>index++};
 await act(async()=>root.render(createElement(ChatEvidencePanel,props)));
 assert.match(document.querySelector('.chat-evidence h2').textContent,/3 references/);
 assert.equal(document.querySelectorAll('.chat-evidence-group').length,2);
 assert.equal(document.querySelector('.chat-evidence-detail'),null,'reference count entry shows index rather than an arbitrary passage');
 const passage=document.querySelectorAll('.chat-evidence-group button')[1];
 await act(async()=>passage.click());assert.equal(inspected.item.id,'E2');assert.equal(inspected.trigger,passage);assert.equal(opened,0);
 await act(async()=>root.render(createElement(ChatEvidencePanel,{...props,selected:note})));
 assert.match(document.querySelector('.chat-evidence-kind').textContent,/AI-generated secondary note/);
 assert.match(document.querySelector('[role=status]').textContent,/changed since the answer/);
 assert.equal(document.querySelector('blockquote').textContent,note.excerpt);
 assert.equal(document.querySelector('.chat-evidence-detail .button').disabled,true);
 assert.match(document.querySelector('[aria-current=true]').textContent,/E3/);
 await act(async()=>document.querySelector('.chat-evidence-index-link').click());assert.equal(index,1);
 await act(async()=>root.render(createElement(ChatEvidencePanel,{...props,selected:{...source,status:'deleted'}})));
 assert.match(document.querySelector('[role=status]').textContent,/no longer available/);
 assert.equal(document.querySelector('.chat-evidence-detail .button').disabled,true);
 await act(async()=>document.querySelector('.chat-evidence').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(closed,1);
});

test('desktop evidence resize supports keyboard and mobile panel traps focus and restores scroll',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const props={evidence:[source],selected:null,mobile:false,verifying:false,onInspect(){},onOpenOriginal(){},onShowIndex(){},onClose(){}};
 await act(async()=>root.render(createElement('section',{className:'chat-workspace'},createElement(ChatEvidencePanel,props))));
 const workspace=document.querySelector('.chat-workspace');Object.defineProperty(workspace,'clientWidth',{configurable:true,value:1200});
 const handle=document.querySelector('[role=separator]');
 await act(async()=>handle.dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true})));
 assert.equal(handle.getAttribute('aria-valuenow'),'640');assert.equal(workspace.style.getPropertyValue('--chat-evidence-width'),'640px');
 await act(async()=>handle.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
 assert.equal(handle.getAttribute('aria-valuenow'),'616');
 document.body.style.overflow='scroll';
 await act(async()=>root.render(createElement('section',{className:'chat-workspace'},createElement(ChatEvidencePanel,{...props,mobile:true}))));
 assert.equal(document.querySelector('[role=separator]'),null);assert.equal(document.querySelector('[role=dialog]').getAttribute('aria-modal'),'true');assert.equal(document.body.style.overflow,'hidden');
 const close=document.querySelector('[aria-label="Close evidence panel"]'),last=document.querySelector('.chat-evidence-list button');
 close.focus();await act(async()=>close.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));assert.equal(document.activeElement,last);
 await act(async()=>last.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,close);
 await act(async()=>root.render(null));assert.equal(document.body.style.overflow,'scroll');
});

async function evidenceWorkspace(t) {
 const {ChatWorkspace}=await import('../src/client/chat/ChatWorkspace.tsx');
 const {chatAPI}=await import('../src/client/chat/api.ts');
 const {api}=await import('../src/client/api.ts');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const alternative={...source,title:'Different source',objectId:'other-source',excerpt:'A different recorded quotation.',fingerprint:'other-fingerprint'};
 const answer=(id,item)=>({id,role:'assistant',text:'An evidence-backed answer.',createdAt:'',status:'completed',claims:[{text:'A supported claim.',attribution:'supported',citationIds:[item.id]}],evidence:[item]});
 const thread={id:'evidence-thread',vaultId:'default',title:'Evidence research',scope:{kind:'vault'},createdAt:'',updatedAt:new Date().toISOString(),messages:[answer('first-answer',source),answer('second-answer',alternative)]};
 t.mock.method(api,'intelligence',async()=>({personaId:'oxford_don'}));
 t.mock.method(chatAPI,'list',async()=>[thread]);t.mock.method(chatAPI,'get',async()=>thread);t.mock.method(chatAPI,'cancel',async()=>({cancelled:true}));
 await act(async()=>root.render(createElement(ChatWorkspace,{vaultId:'default',vaultName:'Test',initialScope:{kind:'vault'},entities:[],pages:[],visible:true,onClose(){},onOpenEvidence(){throw new Error('A cancelled navigation must never open evidence.');}})));
 await act(async()=>document.querySelector('[data-thread-id="evidence-thread"]').click());
 return {chatAPI,alternative};
}

test('switching answer citations clears the previous excerpt while the new revision is being verified',async t=>{
 const {chatAPI,alternative}=await evidenceWorkspace(t);
 let resolveVerification;
 t.mock.method(chatAPI,'verify',async(_vault,evidence)=>evidence[0].fingerprint===source.fingerprint?evidence:new Promise(resolve=>{resolveVerification=resolve;}));
 const citations=document.querySelectorAll('.chat-citation');
 await act(async()=>citations[0].click());assert.equal(document.querySelector('blockquote').textContent,source.excerpt);
 await act(async()=>citations[1].click());
 assert.equal(document.querySelector('.chat-evidence-detail'),null,'the previous answer excerpt must not appear as the new answer selection');
 assert.equal(document.querySelector('.chat-citation[aria-pressed="true"]'),null);
 await act(async()=>resolveVerification([alternative]));
 assert.equal(document.querySelector('blockquote').textContent,alternative.excerpt);
 assert.equal(citations[1].getAttribute('aria-pressed'),'true');
 assert.equal(citations[0].getAttribute('aria-pressed'),'false');
});

test('sending a new question aborts pending evidence navigation and ignores a late verification result',async t=>{
 const {chatAPI}=await evidenceWorkspace(t);
 let verifyCount=0,resolveVerification,verificationSignal;
 t.mock.method(chatAPI,'verify',async(_vault,evidence,signal)=>{if(++verifyCount===1)return evidence;verificationSignal=signal;return new Promise(resolve=>{resolveVerification=resolve;});});
 t.mock.method(globalThis,'fetch',async(_url,options)=>new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
 await act(async()=>document.querySelector('.chat-citation').click());
 await act(async()=>document.querySelector('.chat-evidence-detail .button').click());
 assert.equal(verificationSignal.aborted,false);
 await act(async()=>{const input=document.getElementById('chat-question');input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'A new question changes the current operation.'}});});
 await act(async()=>document.querySelector('.chat-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(verificationSignal.aborted,true,'a newly submitted turn cancels verification tied to the prior reading operation');
 await act(async()=>resolveVerification([source]));
 assert.equal(document.querySelector('.chat-evidence'),null,'late verification must not reopen the closed evidence panel');
 assert.equal(document.querySelector('.chat-composer-area [role=alert]'),null);
});
