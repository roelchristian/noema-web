import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {api,ApiError} from '../src/client/api.ts';
import {RelatedNotes,sameRelatedNotes} from '../src/client/intelligence/RelatedNotes.tsx';
import {watchSuggestions,requestSuggestionCheck} from '../src/client/intelligence/suggestion-refresh.ts';
const note=(id,title=id,score=1)=>({pageId:id,title,score,excerpt:'Synthetic '+id});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t){
 const env=setupDOM(t);t.mock.timers.enable({apis:['setTimeout','setInterval']});
 let page={id:'one',vault_id:'vault',revision:1},version='1',response={notes:[note('a'),note('b')],pending:false,retainedPageIds:[]},calls=0,versions=0;
 t.mock.method(api,'suggestionVersion',async()=>{versions++;return {version};});
 t.mock.method(api,'relatedNotesState',async()=>{calls++;return response;});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const open=()=>{};
 const render=async (patch={})=>{const {inactive,pages,...fields}=patch;page={...page,...fields};await act(async()=>root.render(React.createElement(RelatedNotes,{page,pages,inactive,onOpenPage:open})));};
 const tick=async()=>act(async()=>{t.mock.timers.tick(401);});
 const refresh=async next=>{response=next;version=String(Number(version)+1);requestSuggestionCheck(page.vault_id,page.id);await tick();};
 await render();
 return {env,render,tick,refresh,calls:()=>calls,versions:()=>versions,setResponse:next=>response=next,setVersion:v=>version=v};
}
test('retains rows through delayed and partial ranking, updates only meaningful changes, and distinguishes completed empty',async t=>{
 const f=await fixture(t);assert.match(document.body.textContent,/Finding related notes/);await f.tick();
 const row=document.querySelector('.page-sources-open'),list=document.querySelector('ul');row.focus();list.scrollTop=40;
 const wait=deferred();f.setResponse(wait.promise);f.setVersion('2');requestSuggestionCheck('vault','one');await f.tick();
 assert.equal(document.querySelector('ul'),list);assert.equal(document.activeElement,row);assert.ok(document.querySelector('[aria-label="Updating related notes…"]'));
 await act(async()=>wait.resolve({notes:[],pending:true,retainedPageIds:['a','b']}));assert.equal(document.querySelector('ul'),list);assert.equal(document.activeElement,row);assert.equal(list.scrollTop,40);
 await f.refresh({notes:[note('a','a',.6),note('b','b',.5)],pending:false,retainedPageIds:[]});
 assert.equal(document.querySelector('ul'),list);assert.equal(document.activeElement,row);assert.equal(document.querySelector('[aria-label="Updating related notes…"]'),null);
 await f.refresh({notes:[note('b','Changed'),note('a')],pending:false,retainedPageIds:[]});assert.equal(document.querySelector('.page-sources-name').textContent,'Changed');assert.equal(document.querySelectorAll('li')[1].querySelector('button'),row);
 await f.refresh({notes:[],pending:false,retainedPageIds:[]});assert.equal(document.querySelector('ul'),null);assert.match(document.body.textContent,/No related notes yet/);
});
test('failures retain results with recoverable polite feedback; access loss clears them',async t=>{
 const f=await fixture(t);await f.tick();const row=document.querySelector('li');
 const wait=deferred();f.setResponse(wait.promise);f.setVersion('2');requestSuggestionCheck('vault','one');await f.tick();await act(async()=>wait.reject(Error('Offline')));
 assert.equal(document.querySelector('li'),row);assert.match(document.querySelector('p[role=status]').textContent,/Offline.*Retry/);assert.equal(document.querySelector('[role=alert]'),null);
 f.setResponse({notes:[note('a')],pending:false,retainedPageIds:[]});await act(async()=>document.querySelector('.summary-toggle').click());await f.tick();assert.equal(document.querySelectorAll('li').length,1);
 t.mock.method(api,'suggestionVersion',async()=>{throw new ApiError(403,'Vault locked');});requestSuggestionCheck('vault','one');await f.tick();assert.equal(document.querySelector('ul'),null);
 t.mock.method(api,'suggestionVersion',async()=>({version:'2'}));requestSuggestionCheck('vault','one');await f.tick();assert.equal(document.querySelectorAll('li').length,1);assert.equal(document.querySelector('[role=alert]'),null);
});
test('rapid revisions coalesce, unchanged versions skip ranking, and obsolete responses cannot commit',async t=>{
 const f=await fixture(t);await f.tick();assert.equal(f.calls(),1);
 for(let revision=2;revision<=12;revision++)await f.render({revision});await f.tick();assert.equal(f.calls(),1);assert.equal(f.versions(),2);
 const wait=deferred();f.setResponse(wait.promise);f.setVersion('2');requestSuggestionCheck('vault','one');await f.tick();await f.render({revision:13});await f.tick();
 f.setResponse({notes:[note('new')],pending:false,retainedPageIds:[]});await act(async()=>wait.resolve({notes:[note('stale')],pending:false,retainedPageIds:[]}));assert.doesNotMatch(document.body.textContent,/stale/);
 // The queued newer check can now complete with the latest response.
 f.setResponse({notes:[note('new')],pending:false,retainedPageIds:[]});requestSuggestionCheck('vault','one');await f.tick();assert.match(document.body.textContent,/new/);
});
test('identity switches and inactive panels never display another page or vault; late requests are aborted',async t=>{
 const f=await fixture(t);await f.tick();const wait=deferred();f.setResponse(wait.promise);f.setVersion('2');requestSuggestionCheck('vault','one');await f.tick();
 await f.render({id:'two'});assert.equal(document.querySelector('ul'),null);await f.tick();
 f.setResponse({notes:[note('foreign')],pending:false,retainedPageIds:[]});await f.render({vault_id:'other'});assert.equal(document.querySelector('ul'),null);await f.tick();
 await act(async()=>wait.resolve({notes:[note('stale')],pending:false,retainedPageIds:[]}));assert.doesNotMatch(document.body.textContent,/stale/);assert.match(document.body.textContent,/foreign/);
 await f.render({inactive:true});assert.equal(document.querySelector('.knowledge-related-notes'),null);
});
test('pending snapshots remove ineligible retained entries immediately and shared checks deduplicate listeners',async t=>{
 const f=await fixture(t);let sources=0;const stop=watchSuggestions('vault','one',async()=>{sources++;return true;},()=>{});f.env.defer(stop);await f.tick();assert.equal(f.versions(),1);assert.equal(sources,1);
 await f.render({pages:[{id:'b',title:'b'}]});assert.equal(document.querySelectorAll('li').length,1);
 await f.refresh({notes:[],pending:true,retainedPageIds:['b']});assert.equal(document.querySelectorAll('li').length,1);assert.equal(document.querySelector('.page-sources-name').textContent,'b');
 for(let i=0;i<20;i++)window.dispatchEvent(new Event('noema:ai-activity'));await f.tick();assert.equal(f.versions(),3);assert.equal(f.calls(),2);
});
test('display equality ignores scores but detects titles, excerpts, IDs and order',()=>{
 assert.equal(sameRelatedNotes([note('a')],[note('a','a',.8)]),true);
 for(const next of [[note('b')],[note('a','Changed')],[{...note('a'),excerpt:'Changed'}],[]])assert.equal(sameRelatedNotes([note('a')],next),false);
 assert.equal(sameRelatedNotes([note('a'),note('b')],[note('b'),note('a')]),false);
});
test('initial read failure retries to a genuine empty list without inventing cached results',async t=>{
 const f=await fixture(t),wait=deferred();f.setResponse(wait.promise);await f.tick();assert.match(document.body.textContent,/Finding related notes/);
 await act(async()=>wait.reject(Error('Initial read failed')));assert.match(document.querySelector('[role=alert]').textContent,/Initial read failed.*Retry/);assert.equal(document.querySelector('ul'),null);
 f.setResponse({notes:[],pending:false,retainedPageIds:[]});await act(async()=>document.querySelector('.summary-toggle').click());await f.tick();assert.match(document.body.textContent,/No related notes yet/);assert.equal(document.querySelector('[role=alert]'),null);
 await f.refresh({notes:[],pending:true,retainedPageIds:[]});assert.equal(document.querySelector('ul'),null);assert.match(document.body.textContent,/No related notes yet/);assert.ok(document.querySelector('[aria-label="Updating related notes…"]'));
});
