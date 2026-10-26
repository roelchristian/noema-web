import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {SourceEvidence} from '../src/client/sources/SourceEvidence.tsx';

test('OCR gaps expose recoveries, honest coverage limits, and correctly positioned page highlights',async t=>{
 const dom=new JSDOM('<div id="mount"></div>');
 const keys=['window','document','Node','Element','HTMLElement','MutationObserver','Event','IS_REACT_ACT_ENVIRONMENT'],prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const evidence={originalAvailable:true,rawExtraction:{ocrPages:2,pageEvidence:[{page:1,method:'ocr',coordinateSystem:'normalized-bottom-left',text:'Recovered text',coverage:{detectedRegions:10,unmatchedRegions:2,retriedRegions:2,recoveredRegions:1,unresolvedRegions:1},regions:[{bounds:[0.1,0.2,0.3,0.1],reason:'unmatched-detected-text',status:'recovered',recoveredText:'Regan Arts.'},{bounds:[2,0,1,1],reason:'low-confidence',status:'unresolved'}]},{page:2,method:'ocr',text:'Next page',regions:[]}]}};
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>evidence}));
 let page=1;const root=createRoot(document.querySelector('#mount'));
 const render=()=>root.render(React.createElement(SourceEvidence,{vaultId:'v',fileId:'f',pageCount:2,page,onPage:next=>{page=next;render();}}));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});});
 await act(async()=>render());
 assert.match(document.body.textContent,/1 recovered · 1 unresolved/);assert.match(document.body.textContent,/not a completeness guarantee/);assert.match(document.body.textContent,/Regan Arts/);
 const buttons=document.querySelectorAll('.source-evidence-regions button');
 await act(async()=>buttons[0].click());
 const highlight=document.querySelector('.source-evidence-region-box');assert.ok(highlight);assert.equal(highlight.style.left,'10%');assert.ok(Math.abs(parseFloat(highlight.style.top)-70)<0.001);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
 await act(async()=>buttons[1].click());assert.equal(document.querySelector('.source-evidence-region-box'),null,'invalid bounds must not produce page overlays');
 await act(async()=>buttons[0].click());
 await act(async()=>{const select=document.querySelector('select');select.value='2';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(page,2);assert.equal(document.querySelector('.source-evidence-region-box'),null);assert.match(document.body.textContent,/Next page/);
});

test('provider PDF baseline is labeled as transcription with localized uncertainty',async t=>{
 const dom=new JSDOM('<div id="mount"></div>');
 const keys=['window','document','Node','Element','HTMLElement','MutationObserver','Event','IS_REACT_ACT_ENVIRONMENT'],prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({originalAvailable:false,ingestion:{provider:'gemini',model:'fixture-model',text:'Faithful source 😀',uncertainty:['Equation on physical page 1 is unreadable.']}})}));
 const root=createRoot(document.querySelector('#mount'));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});});
 await act(async()=>root.render(React.createElement(SourceEvidence,{vaultId:'v',fileId:'f',pageCount:1,page:1,onPage:()=>{}})));
 assert.match(document.body.textContent,/Provider transcription/);assert.match(document.body.textContent,/not native extraction or independent OCR verification/);
 assert.match(document.body.textContent,/Faithful source 😀/);assert.match(document.body.textContent,/Equation on physical page 1 is unreadable/);
 assert.match(document.body.textContent,/accuracy still requires evidence inspection or user review/);
});

test('ingestion reader preserves heading, table spans and reversible page furniture',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {SourceDocumentView}=await import('../src/client/sources/SourceDocumentView.tsx');
 const range={startOffset:0,endOffset:12,startLine:1,endLine:1,startPage:1,endPage:1};
 const ingestion={kind:'heading',table:null,location:null,uncertainty:null,furniture:false,continues:null};
 const nodes=[{id:'h',kind:'heading',level:1,text:'Section title',range,ingestion},{id:'t',kind:'table',text:'A B',range,ingestion:{...ingestion,kind:'table',table:{rows:2,columns:2,cells:[{row:0,column:0,rowSpan:2,columnSpan:1,text:'A'},{row:0,column:1,rowSpan:1,columnSpan:1,text:'B'},{row:1,column:1,rowSpan:1,columnSpan:1,text:'C'}]},uncertainty:'One damaged cell'}},{id:'f',kind:'paragraph',text:'Journal running title',range,ingestion:{...ingestion,kind:'furniture',furniture:true}}];
 const markup=renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text:'Section title\nA B\nJournal running title',entries:nodes.map(node=>({node,path:[]})),selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}}));
 assert.match(markup,/<h2><span[^>]*>Section title<\/span><\/h2>/);assert.match(markup,/rowSpan="2"|rowspan="2"/i);assert.match(markup,/One damaged cell/);assert.match(markup,/<summary>Running page text<\/summary>/);assert.match(markup,/Journal running title/);assert.match(markup,/Faithful table transcription/);
});

test('creation monitor requires explicit unknown-cost recovery and ignores an old source action result',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const run={id:'r',fileId:'first',mode:'ingestion',state:'unknown',stage:'extraction',provider:'openai',model:'fixture-model',pageCount:42,completedPages:16,completedWindows:2,totalWindows:6,activePages:[17,18],pendingReview:2,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null,unknownOutcome:true,canResume:true};
 let finishResume;const calls=[];t.mock.method(globalThis,'fetch',async(route,options)=>{calls.push({route,options});if(options.method==='POST')return new Promise(resolve=>{finishResume=resolve;});return Response.json(route.includes('second')?{...run,fileId:'second',state:'completed',completedPages:42,unknownOutcome:false,canResume:false}:run);});
 const presence=()=>{};
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'first',onPresence:presence})));
 assert.match(document.body.textContent,/16 of 42 physical pages validated/);assert.match(document.body.textContent,/2 proposals need review/);
 const resume=[...document.querySelectorAll('button')].find(button=>button.textContent==='Resume unfinished work');assert.equal(resume.disabled,true);assert.equal(calls.filter(call=>call.options.method==='POST').length,0);
 const check=document.querySelector('input[type=checkbox]');await act(async()=>check.click());assert.equal(resume.disabled,false);
 await act(async()=>resume.click());assert.equal(calls.filter(call=>call.options.method==='POST').length,1);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{allowUnknown:true});
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'second',onPresence:presence})));
 assert.match(document.body.textContent,/42 of 42 physical pages validated/);
 await act(async()=>finishResume(Response.json({...run,state:'running',unknownOutcome:false})));
 assert.match(document.body.textContent,/42 of 42 physical pages validated/);assert.doesNotMatch(document.body.textContent,/unknown outcome/);
});

test('queued provider attachment mounts detailed monitor before any readable source document exists',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceAttachments}=await import('../src/client/knowledge/SourceAttachments.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const file={id:'queued.pdf',vault_id:'v',entity_id:'e',ingestion_origin:'gemini',status:'queued',enrichment_status:'pending',admitted:1,format:'pdf',name:'Queued PDF',original_filename:'queued.pdf',text:'',size:100,pages:42,progress:0,contains_math:0};
 const run={id:'r',fileId:file.id,mode:'ingestion',state:'pending',stage:'upload',provider:'gemini',model:'fixture-model',pageCount:42,completedPages:0,completedWindows:0,totalWindows:6,activePages:[],pendingReview:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null,unknownOutcome:false,canResume:false};
 t.mock.method(globalThis,'fetch',async()=>Response.json(run));
 await act(async()=>root.render(React.createElement(SourceAttachments,{vaultId:'v',entityId:'e',initial:[file]})));
 assert.ok(document.querySelector('[aria-label="PDF processing progress"]'));assert.match(document.body.textContent,/Uploading PDF/);assert.match(document.body.textContent,/0 of 42 physical pages validated/);assert.match(document.body.textContent,/Stop and keep progress/);
 assert.equal(document.querySelector('article.source-reader-document'),null);
});

test('ready provider attachment exposes optional retry without invalidating readable canonical source',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceAttachments}=await import('../src/client/knowledge/SourceAttachments.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const file={id:'ready.pdf',vault_id:'v',entity_id:'e',ingestion_origin:'openai',status:'ready',enrichment_status:'completed',admitted:1,format:'pdf',name:'Ready PDF',original_filename:'ready.pdf',text:'Canonical transcription remains readable.',size:100,pages:2,progress:100,contains_math:0};
 let run={id:'r',fileId:file.id,mode:'ingestion',state:'completed',stage:'indexing',provider:'openai',model:'fixture-model',pageCount:2,completedPages:2,completedWindows:1,totalWindows:1,activePages:[],pendingReview:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null,warnings:['Optional equation recovery failed.'],unknownOutcome:false,canResume:false,canRetryOptional:true};
 const calls=[];t.mock.method(globalThis,'fetch',async(route,options)=>{calls.push({route,options});if(options.method==='POST'){assert.equal(route,'/api/source-files/ready.pdf/ingestion/retry');run={...run,state:'pending',stage:'repair',warnings:[],canRetryOptional:false};}return Response.json(run);});
 let changed=0;await act(async()=>root.render(React.createElement(SourceAttachments,{vaultId:'v',entityId:'e',initial:[file],compact:true,onChange:()=>changed++})));
 const retry=[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry failed optional work');assert.ok(retry,'Completed provider files mount the monitor even in compact attachments');
 assert.equal(calls.filter(call=>call.options.method==='POST').length,0,'Inspecting completed work does not generate or retry anything');
 assert.ok(document.querySelector('a[href*="download-processed"]'));
 await act(async()=>retry.click());assert.equal(calls.filter(call=>call.options.method==='POST').length,1);assert.deepEqual(JSON.parse(calls.find(call=>call.options.method==='POST').options.body),{});
 assert.ok(calls.filter(call=>call.options.method==='GET').length>=2,'Optional retry restarts status polling after completed state');
 assert.match(document.body.textContent,/Checking unresolved passages/);assert.match(document.body.textContent,/Stop and keep progress/);assert.ok(document.querySelector('a[href*="download-processed"]'));
 assert.equal(file.status,'ready');assert.equal(file.text,'Canonical transcription remains readable.');assert.equal(changed,0,'Optional retry does not replace source attachment or canonical text');
});

test('completed clean provider monitor is a compact summary',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'r',fileId:'f',mode:'ingestion',state:'completed',stage:'indexing',provider:'gemini',model:'fixture-model',pageCount:2,completedPages:2,completedWindows:1,totalWindows:1,activePages:[],pendingReview:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null,unknownOutcome:false,canResume:false,canRetryOptional:false}));
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));
 assert.match(document.body.textContent,/PDF transcription published.*2 of 2 physical pages validated.*Gemini/);assert.equal(document.querySelector('progress'),null);assert.equal(document.querySelector('button'),null);
});
