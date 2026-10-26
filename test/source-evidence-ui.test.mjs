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
 assert.match(document.body.textContent,/PDF transcription published.*OpenAI · fixture-model/);assert.doesNotMatch(document.body.textContent,/Building search index/);
 assert.ok(document.querySelector('a[href*="enriched-json"]'));
 await act(async()=>retry.click());assert.equal(calls.filter(call=>call.options.method==='POST').length,1);assert.deepEqual(JSON.parse(calls.find(call=>call.options.method==='POST').options.body),{});
 assert.ok(calls.filter(call=>call.options.method==='GET').length>=2,'Optional retry restarts status polling after completed state');
 assert.match(document.body.textContent,/Checking unresolved passages/);assert.match(document.body.textContent,/Stop and keep progress/);assert.ok(document.querySelector('a[href*="enriched-json"]'));
 assert.equal(file.status,'ready');assert.equal(file.text,'Canonical transcription remains readable.');assert.equal(changed,0,'Optional retry does not replace source attachment or canonical text');
});

test('completed provider benchmark summary retains model and stable recorded wall time',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'r',fileId:'f',mode:'ingestion',state:'completed',stage:'indexing',provider:'gemini',model:'fixture-model',pageCount:2,completedPages:2,completedWindows:1,totalWindows:1,activePages:[],pendingReview:0,startedAt:'2026-10-25T00:00:00.000Z',updatedAt:'2026-10-25T00:02:05.000Z',error:null,unknownOutcome:false,canResume:false,canRetryOptional:false}));
 t.mock.method(Date,'now',()=>Date.parse('2026-10-26T00:00:00.000Z'));
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));
 assert.match(document.body.textContent,/PDF transcription published.*Gemini · fixture-model.*2 of 2 physical pages validated.*1 of 1 windows complete.*0 proposals need review/);
 assert.match(document.body.textContent,/2m 5s recorded wall time.*Includes queueing, pauses and retries/);
 assert.match(document.body.textContent,/AI activity log, or Export CSV/);
 assert.doesNotMatch(document.body.textContent,/Building search index/);
 assert.equal(document.querySelector('progress').value,100);assert.equal(document.querySelector('button'),null);
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));
 assert.match(document.body.textContent,/2m 5s recorded wall time/,'Reopening completed work must not count time since completion');
});

test('unreadable provider page recovery is explicit, page-bound and creates only a manually reviewed derivative',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const calls=[];let finishRecovery;const baseline='Existing faithful transcription on this source.';
 t.mock.method(globalThis,'fetch',async(route,options)=>{calls.push({route,options});if(options.method==='POST')return new Promise(resolve=>{finishRecovery=resolve;});const page=Number(new URL(route,'http://localhost').searchParams.get('page'));return Response.json({originalAvailable:true,ingestion:{provider:'openai',model:'fixture-frozen-model',page,pageState:page===1?'unreadable':page===2?'content':'image-only',role:page===3?'context':'owned',canRecoverPage:true,text:page===1?'':baseline,uncertainty:['Localized unreadable content']}});});
 let selectedPage=1;const render=()=>root.render(React.createElement(SourceEvidence,{vaultId:'v',fileId:'provider.pdf',pageCount:3,page:selectedPage,onPage:page=>{selectedPage=page;render();}}));
 await act(async()=>render());
 const recover=[...document.querySelectorAll('button')].find(button=>button.textContent==='Recover unreadable page');assert.ok(recover);assert.equal(calls.filter(call=>call.options.method==='POST').length,0,'Inspecting an unreadable page does not generate');assert.match(document.body.textContent,/additional provider request.*Provider charges may apply/s);assert.match(document.body.textContent,/separate revision requiring manual review/);
 await act(async()=>{recover.click();recover.click();});assert.equal(calls.filter(call=>call.options.method==='POST').length,1);const action=calls.find(call=>call.options.method==='POST');assert.equal(action.route,'/api/source-files/provider.pdf/ingestion/recover-page');assert.deepEqual(JSON.parse(action.options.body),{page:1});assert.equal(recover.disabled,true);
 await act(async()=>finishRecovery(Response.json({state:'pending',stage:'repair'})));
 assert.match(document.body.textContent,/original transcription remains unchanged/);assert.match(document.body.textContent,/manual acceptance in revision review/);assert.equal(document.querySelector('.source-evidence-comparison pre').textContent,'','The PDF baseline is not replaced with a fabricated all-added diff');
 await act(async()=>{const select=document.querySelector('select');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(document.querySelector('.source-evidence-comparison pre').textContent,baseline);assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Recover unreadable page'),false,'Readable pages cannot request missing-page recovery');
 await act(async()=>{const select=document.querySelector('select');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Recover unreadable page'),false,'Context-only pages cannot own recovery output');assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
});

test('failed PDF monitor shows retained checkpoints and details without retrying',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const calls=[];
 const run={id:'r',fileId:'f',mode:'ingestion',state:'failed',stage:'extraction',provider:'openai',model:'fixture-model',pageCount:15,completedPages:5,completedWindows:1,totalWindows:3,activePages:[],pendingReview:0,startedAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:02:00Z',error:'Incompatible continued block kinds or table dimensions',unknownOutcome:false,canResume:true,windows:[{id:'w1',number:1,kind:'extraction',pages:[1,2,3,4,5],state:'completed',repairState:'pending',attempts:1,error:null},{id:'w2',number:2,kind:'extraction',pages:[6,7,8,9,10],state:'failed',repairState:'pending',attempts:2,error:'Incompatible continued block kinds or table dimensions'}]};
 t.mock.method(globalThis,'fetch',async(route,options)=>{calls.push({route,options});return Response.json(run);});
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));
 assert.match(document.body.textContent,/PDF processing failed/);
 const checkpoints=document.querySelectorAll('[aria-label="PDF processing checkpoints"] li');assert.equal(checkpoints.length,5);assert.equal(checkpoints[0].dataset.status,'completed');assert.equal(checkpoints[1].dataset.status,'failed');assert.equal(checkpoints[2].dataset.status,'waiting');
 const progress=document.querySelector('progress');assert.ok(progress.value>0&&progress.value<100);assert.equal(progress.max,100);
 await act(async()=>document.querySelector('.source-ingestion-details summary').click());
 assert.ok(document.querySelector('.source-ingestion-details').open);assert.match(document.body.textContent,/Physical pages: 6, 7, 8, 9, 10.*Failed.*Attempts: 2/);assert.match(document.body.textContent,/Processing is stopped/);
 assert.ok(calls.every(call=>call.options.method==='GET'),'Viewing checkpoints and opening details must never retry or generate');
 assert.equal([...document.querySelectorAll('button')].filter(button=>/Resume unfinished work|Retry failed work/.test(button.textContent)).length,1);
});

test('failed processing monitor observes server-side recovery without sending a retry',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const run={id:'r',fileId:'f',mode:'ingestion',state:'failed',stage:'validation',provider:'openai',model:'fixture',pageCount:5,completedPages:5,completedWindows:1,totalWindows:1,activePages:[],pendingReview:0,startedAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:01:00Z',error:'Previous validation failure',unknownOutcome:false,canResume:true};
 const methods=[];t.mock.method(globalThis,'fetch',async(route,options)=>{methods.push(options.method);return Response.json(run);});
 const originalTimeout=globalThis.setTimeout;let poll;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay===1500){poll=()=>callback(...args);return 0;}return originalTimeout(callback,delay,...args);});
 await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));assert.match(document.body.textContent,/PDF processing failed/);assert.equal(typeof poll,'function');
 Object.assign(run,{state:'completed',stage:'indexing',error:null,canResume:false});await act(async()=>poll());
 assert.match(document.body.textContent,/PDF transcription published/);assert.doesNotMatch(document.body.textContent,/Previous validation failure/);assert.equal(document.querySelector('progress').value,100);assert.deepEqual(methods,['GET','GET']);
});

test('definite printed footnote relations render links and endnotes without rewriting source offsets',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {SourceDocumentView,sourceRelationFootnotes}=await import('../src/client/sources/SourceDocumentView.tsx');
 const prose='The Court refers the case;1',note='1 Exact source note.',start=prose.length+2;
 const range=(from,to)=>({startOffset:from,endOffset:to,startLine:1,endLine:1,startPage:1,endPage:1});
 const nodes=[{id:'p',kind:'paragraph',text:prose,range:range(0,prose.length)},{id:'n',kind:'footnote',text:note,range:range(start,start+note.length)}],entries=nodes.map(node=>({node,path:[node]}));
 const relations=[{kind:'footnote-callout',from:'p',to:'n',uncertain:false}];
 const markup=renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text:prose+'\n\n'+note,entries,ingestionRelations:relations,endnotes:true,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}}));
 const dom=new JSDOM(markup),link=dom.window.document.querySelector('a[data-footnote-reference]');assert.ok(link);assert.equal(link.textContent,'1');assert.equal(Number(link.dataset.sourceStart),prose.length-1);assert.equal(Number(link.dataset.sourceEnd),prose.length);assert.equal(link.hash,'#source-passage-f-n-footnote');assert.equal(dom.window.document.querySelectorAll('[id="source-passage-f-n-footnote"]').length,1);assert.equal(dom.window.document.querySelectorAll('[id="source-passage-f-n"]').length,1);
 const noteRow=dom.window.document.querySelector('[aria-label="Endnotes"] .source-reader-footnote');assert.ok(noteRow);assert.equal(noteRow.querySelector('.source-reader-footnote-label').textContent,'1');assert.equal(noteRow.querySelector('.source-reader-text').textContent,'Exact source note.');assert.equal(noteRow.querySelector('[data-source-start]').dataset.sourceStart,String(start));assert.equal(noteRow.querySelector('.source-reader-text [data-source-start]').dataset.sourceStart,String(start+2));assert.equal(dom.window.document.querySelectorAll('[data-source-node="n"]').length,1);assert.equal(nodes[0].text,prose);
 assert.equal(sourceRelationFootnotes(entries,[{...relations[0],uncertain:true}],'f').links.size,0);
 const ambiguous=[{node:{...nodes[0],text:'Number 1; another reference;1'},path:[]},entries[1]];assert.equal(sourceRelationFootnotes(ambiguous,relations,'f').links.size,0);
});

test('canonical provider furniture participates in the reader display toggle without hiding prose',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {SourceDocumentView,sourceFurnitureNodeIds}=await import('../src/client/sources/SourceDocumentView.tsx');
 const range={startOffset:0,endOffset:7,startLine:1,endLine:1,startPage:1,endPage:1};const nodes=[{id:'header',kind:'paragraph',text:'Running header',range,ingestion:{kind:'furniture',furniture:true,table:null,location:null,uncertainty:null,continues:null}},{id:'body',kind:'paragraph',text:'Substantive source prose.',range}];const entries=nodes.map(node=>({node,path:[node]}));
 const hidden=sourceFurnitureNodeIds(entries);assert.deepEqual([...hidden],['header']);
 const render=show=>new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text:'unchanged',entries,hiddenNodeIds:show?undefined:hidden,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}}))).window.document;
 assert.equal(render(false).querySelector('[data-source-node="header"]').hidden,true);assert.equal(render(false).querySelector('[data-source-node="body"]').hidden,false);assert.equal(render(true).querySelector('[data-source-node="header"]').hidden,false);assert.equal(nodes[0].text,'Running header');
});

test('IR footnotes share Noema Markdown note rows and show each note once in either layout',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {SourceDocumentView}=await import('../src/client/sources/SourceDocumentView.tsx');const {SourceReaderText}=await import('../src/client/sources/SourceReaderText.tsx');
 let text='';const nodes=[],relations=[];const add=(id,kind,value)=>{const start=text.length;text+=value+'\n\n';nodes.push({id,kind,text:value,range:{startOffset:start,endOffset:start+value.length,startLine:1,endLine:1,startPage:1,endPage:1}});};
 for(let label=1;label<=4;label++){add('p'+label,'paragraph','Source passage;'+label);add('n'+label,'footnote',label+' Note body '+label+'.');relations.push({kind:'footnote-callout',from:'p'+label,to:'n'+label,uncertain:false});}
 for(const endnotes of [false,true]){
  const html=renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text,entries:nodes.map(node=>({node,path:[node]})),ingestionRelations:relations,endnotes,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}})),doc=new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll('sup.source-reader-footnote-reference a').length,4);assert.equal(doc.querySelectorAll('.source-reader-footnote').length,4);assert.equal(doc.querySelectorAll('.source-reader-footnote-back').length,4);
  for(let label=1;label<=4;label++){const target='source-passage-f-n'+label+'-footnote';const row=doc.getElementById(target);assert.equal(doc.querySelectorAll('[id="'+target+'"]').length,1);assert.equal(doc.querySelectorAll('[id="source-passage-f-n'+label+'"]').length,1);assert.equal(row.querySelector('.source-reader-footnote-label').textContent,String(label));assert.equal(row.querySelector('.source-reader-text').textContent,'Note body '+label+'.');assert.equal(doc.querySelectorAll('[data-source-node="n'+label+'"]').length,1);assert.equal(!!row.closest('.source-reader-endnotes'),endnotes);}
 }
 const markdown=new JSDOM(renderToStaticMarkup(React.createElement(SourceReaderText,{text:'[^1]: Note body 1.',footnotePrefix:'f'}))).window.document;
 assert.ok(markdown.querySelector('.source-reader-footnote > .source-reader-footnote-label + .source-reader-text + .source-reader-footnote-back'));
});

test('reading prose hides processing jargon while preserving genuine transcription uncertainty',async()=>{
 const {readerTranscriptionUncertainty}=await import('../src/client/sources/SourceDocumentView.tsx');
 assert.equal(readerTranscriptionUncertainty('An inconsistent provider heading-parent relation was omitted. Both text blocks are retained; their relationship requires review.'),null);
 assert.equal(readerTranscriptionUncertainty('The signature is partly unreadable. An inconsistent provider caption relation was omitted.'),'The signature is partly unreadable.');
 assert.equal(readerTranscriptionUncertainty('One damaged cell'),'One damaged cell');
});

test('PDF monitor replaces structural validator jargon with an actionable review note and opens source details',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const {SourceIngestionProgress}=await import('../src/client/knowledge/SourceIngestionProgress.tsx');const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const warning='An inconsistent provider heading-parent relation was omitted. Both text blocks are retained; their relationship requires review.';
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'r',fileId:'f',sourceId:'source',mode:'ingestion',state:'completed',stage:'indexing',provider:'openai',model:'fixture-model',pageCount:5,completedPages:5,completedWindows:1,totalWindows:1,activePages:[],pendingReview:0,pendingMetadata:2,startedAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:02:00Z',warnings:[warning,warning],error:null,unknownOutcome:false,canResume:false}));
 let opened;window.addEventListener('noema:open-source-metadata',event=>{opened=event.detail;});await act(async()=>root.render(React.createElement(SourceIngestionProgress,{vaultId:'v',fileId:'f',onPresence:()=>{}})));
 assert.doesNotMatch(document.body.textContent,/heading-parent|inconsistent provider/i);const notes=document.querySelector('[aria-label="Source review notes"]');assert.equal(notes.querySelectorAll('li').length,1);assert.match(notes.textContent,/Compare the headings, lists and tables with the original PDF/);
 const review=[...document.querySelectorAll('button')].find(button=>button.textContent==='Review source details (2)');await act(async()=>review.click());assert.deepEqual(opened,{vaultId:'v',fileId:'f',sourceId:'source'});
});

test('direct footnote clicks scroll and focus the unique note aside, and backlink returns to callout',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t);const {SourceDocumentView}=await import('../src/client/sources/SourceDocumentView.tsx');
 const scrolled=[];env.dom.window.HTMLElement.prototype.scrollIntoView=function(options){scrolled.push({element:this,options});};
 const prose='Reference;1',note='1 Exact note body.',start=prose.length+2,range=(from,to)=>({startOffset:from,endOffset:to,startLine:1,endLine:1,startPage:1,endPage:1});
 const nodes=[{id:'p',kind:'paragraph',text:prose,range:range(0,prose.length)},{id:'n',kind:'footnote',text:note,range:range(start,start+note.length)}];
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text:prose+'\n\n'+note,entries:nodes.map(node=>({node,path:[node]})),ingestionRelations:[{kind:'footnote-callout',from:'p',to:'n',uncertain:false}],endnotes:true,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}})));
 const callout=document.querySelector('a[data-footnote-reference]'),target=callout.dataset.footnoteReference;assert.equal(document.querySelectorAll('[id="'+target+'"]').length,1);
 await act(async()=>callout.click());const noteAside=document.getElementById(target);assert.equal(noteAside.tagName,'ASIDE');assert.equal(noteAside.getAttribute('role'),'doc-footnote');assert.equal(scrolled.at(-1).element,noteAside);assert.equal(scrolled.at(-1).options.block,'center');assert.equal(document.activeElement,noteAside);
 await act(async()=>noteAside.querySelector('.source-reader-footnote-back').click());assert.equal(scrolled.at(-1).element,callout);assert.equal(document.activeElement,callout);
});

test('Unicode superscript IR callouts link mid-sentence without changing canonical spans or duplicating notes',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {SourceDocumentView,sourceRelationFootnotes}=await import('../src/client/sources/SourceDocumentView.tsx');
 let text='';const nodes=[],relations=[];
 const add=(id,kind,value)=>{const start=text.length;text+=value+'\n\n';nodes.push({id,kind,text:value,range:{startOffset:start,endOffset:start+value.length,startLine:1,endLine:1,startPage:1,endPage:1}});};
 add('p1','paragraph','Netto [3, pp. 148–149].¹ and we follow the proof.');add('n1','footnote','1 Earlier work by Cayley.');
 add('p2','paragraph','Groups of order p² have this property.² Write this as follows.');add('n2','footnote','2 Related to the pigeonhole principle.');
 for(const label of [1,2])relations.push({kind:'footnote-callout',from:'p'+label,to:'n'+label,uncertain:false});
 const entries=nodes.map(node=>({node,path:[node]})),before=JSON.stringify({text,nodes});
 for(const endnotes of [false,true]){
  const doc=new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text,entries,ingestionRelations:relations,endnotes,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}}))).window.document;
  assert.equal(doc.querySelectorAll('a[data-footnote-reference]').length,2);assert.equal(doc.querySelectorAll('[role="doc-footnote"]').length,2);
  for(const [label,marker] of [[1,'¹'],[2,'²']]){
   const node=nodes.find(node=>node.id==='p'+label),at=node.text.lastIndexOf(marker),link=doc.querySelector('[aria-label="Footnote '+label+'"] a')??doc.querySelector('a[aria-label="Footnote '+label+'"]');
   assert.ok(link);assert.equal(link.textContent,marker);assert.equal(Number(link.dataset.sourceStart),node.range.startOffset+at);assert.equal(Number(link.dataset.sourceEnd),node.range.startOffset+at+marker.length);
   const target=doc.getElementById(link.dataset.footnoteReference);assert.equal(target.getAttribute('role'),'doc-footnote');assert.equal(doc.querySelectorAll('[id="'+target.id+'"]').length,1);assert.equal(doc.querySelectorAll('[data-source-node="n'+label+'"]').length,1);assert.equal(!!target.closest('.source-reader-endnotes'),endnotes);
  }
 }
 assert.equal(JSON.stringify({text,nodes}),before);
 const p=nodes[0],ambiguous=[{node:{...p,text:'Repeated.¹ Another.¹'},path:[]},entries[1]];
 assert.equal(sourceRelationFootnotes(ambiguous,[relations[0]],'f').links.size,0);
 const exponent=[{node:{...nodes[2],text:'One group has order p²'},path:[]},entries[3]];
 assert.equal(sourceRelationFootnotes(exponent,[relations[1]],'f').links.size,0,'ordinary mathematical exponents are not callouts');
 assert.equal(sourceRelationFootnotes(entries,relations.map(r=>({...r,uncertain:true})),'f').links.size,0);
});

test('definite unique plain footnote labels link mid-sentence after punctuation and outside LaTeX',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {SourceDocumentView,sourceRelationFootnotes}=await import('../src/client/sources/SourceDocumentView.tsx');
 let text='';const nodes=[],relations=[];
 const add=(id,kind,value)=>{const start=text.length;text+=value+'\n\n';nodes.push({id,kind,text:value,range:{startOffset:start,endOffset:start+value.length,startLine:1,endLine:1,startPage:1,endPage:1}});};
 add('p1','paragraph','Netto [3, pp. 148–149].1 and we follow the proof.');add('n1','footnote','1 Earlier work.');
 add('p2','paragraph','Elements lie in a common $x^iH$.2 Write this as $x^iH$.');add('n2','footnote','2 Related principle.');
 for(const label of [1,2])relations.push({kind:'footnote-callout',from:'p'+label,to:'n'+label,uncertain:false});
 const entries=nodes.map(node=>({node,path:[node]})),before=JSON.stringify({text,nodes});
 for(const endnotes of [false,true]){
  const doc=new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text,entries,ingestionRelations:relations,endnotes,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}}))).window.document;
  assert.equal(doc.querySelectorAll('a[data-footnote-reference]').length,2);assert.equal(doc.querySelectorAll('[role="doc-footnote"]').length,2);
  for(const label of [1,2]){const node=nodes.find(node=>node.id==='p'+label),at=node.text.indexOf('.'+label)+1,link=doc.querySelector('a[aria-label="Footnote '+label+'"]');assert.equal(Number(link.dataset.sourceStart),node.range.startOffset+at);assert.equal(Number(link.dataset.sourceEnd),node.range.startOffset+at+1);assert.equal(link.textContent,String(label));assert.equal(doc.querySelectorAll('[id="'+link.dataset.footnoteReference+'"]').length,1);}
 }
 assert.equal(JSON.stringify({text,nodes}),before);
 const check=value=>sourceRelationFootnotes([{node:{...nodes[0],text:value},path:[]},entries[1]],[relations[0]],'f').links.size;
 assert.equal(check('Theorem 1 states the result.'),0);assert.equal(check('The value is $x^1$.'),0);assert.equal(check('Reference.1 Another.1'),0);assert.equal(check('A value.1x'),0);
});

test('LaTeX superscript footnote labels use Noema notes and retain complete canonical marker spans',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t);const {SourceDocumentView,sourceRelationFootnotes}=await import('../src/client/sources/SourceDocumentView.tsx');
 let text='';const nodes=[],relations=[];
 const add=(id,kind,value)=>{const start=text.length;text+=value+'\n\n';nodes.push({id,kind,text:value,range:{startOffset:start,endOffset:start+value.length,startLine:1,endLine:1,startPage:1,endPage:1}});};
 add('p1','paragraph','Netto [3, pp. 148–149].$^1$ and a group of order $p^2$.');add('n1','footnote','$^1$The special case $p = 2$ was treated earlier.');
 add('p2','paragraph','A common coset $x^iH$.$^{2}$ Write the argument.');add('n2','footnote','$^{2}$This is related to the pigeonhole principle.');
 for(const label of [1,2])relations.push({kind:'footnote-callout',from:'p'+label,to:'n'+label,uncertain:false});
 const entries=nodes.map(node=>({node,path:[node]})),before=JSON.stringify({text,nodes}),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 env.dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 for(const endnotes of [false,true]){
  await act(async()=>root.render(React.createElement(SourceDocumentView,{article:React.createRef(),fileId:'f',name:'Fixture',text,entries,ingestionRelations:relations,endnotes,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}})));
  assert.equal(document.querySelectorAll('a[data-footnote-reference]').length,2);assert.equal(document.querySelectorAll('[role="doc-footnote"]').length,2);
  for(const [label,marker] of [[1,'$^1$'],[2,'$^{2}$']]){
   const prose=nodes.find(node=>node.id==='p'+label),note=nodes.find(node=>node.id==='n'+label),at=prose.range.startOffset+prose.text.indexOf(marker),link=document.querySelector('a[aria-label="Footnote '+label+'"]'),row=document.getElementById(link.dataset.footnoteReference);
   assert.equal(link.textContent,String(label));assert.equal(link.querySelector('.katex'),null,'callout uses the Noema superscript link');assert.equal(Number(link.dataset.sourceStart),at);assert.equal(Number(link.dataset.sourceEnd),at+marker.length);assert.equal(Number(link.firstElementChild.dataset.sourceEnd),at+marker.length);
   const labelSpan=row.querySelector('.source-reader-footnote-label');assert.equal(labelSpan.textContent,String(label));assert.equal(labelSpan.querySelector('.katex'),null);assert.equal(Number(labelSpan.firstElementChild.dataset.sourceEnd),note.range.startOffset+marker.length);
   const body=row.querySelector('.source-reader-text');assert.equal(Number(body.querySelector('[data-source-start]').dataset.sourceStart),note.range.startOffset+marker.length);assert.equal(body.textContent.startsWith(label===1?'The special case':'This is related'),true);assert.equal(document.querySelectorAll('[id="'+row.id+'"]').length,1);assert.equal(!!row.closest('.source-reader-endnotes'),endnotes);
   await act(async()=>link.click());assert.equal(document.activeElement,row);await act(async()=>row.querySelector('.source-reader-footnote-back').click());assert.equal(document.activeElement,link);
  }
  assert.ok(document.querySelector('[data-source-node="p1"] .katex'),'legitimate powers still use KaTeX');
 }
 assert.equal(JSON.stringify({text,nodes}),before);
 const ambiguous=[{node:{...nodes[0],text:'Repeated.$^1$ Another.$^1$'},path:[]},entries[1]];assert.equal(sourceRelationFootnotes(ambiguous,[relations[0]],'f').links.size,0);
 assert.equal(sourceRelationFootnotes(entries,relations.map(r=>({...r,uncertain:true})),'f').links.size,0);
});
