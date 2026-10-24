import {citationSourceIds} from '../src/shared/citations.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBibliography} from '../src/shared/bibliography.ts';
import {bibliographicCsl,formatScholarlyCitations,publicationCitations,citationKeyMarkup,noteBibliographicCitations} from '../src/shared/bibliographic-citations.ts';
import {setupDOM} from './helpers/dom.mjs';
const entry=parseBibliography('@book{Doe2020,author={Doe, Jane and {Research Council}},title={Synthetic Study},year={2020},publisher={Test Press}}').entries[0];
const record={...entry,sourceId:'source-1',revision:1,provenance:{}};
test('publication identity deduplicates locators and renders actual APA/IEEE CSL locally',()=>{
 const refs=[{id:'one',sourceId:'source-1',locator:'12'},{id:'two',sourceId:'source-1',locator:'26'}];
 assert.equal(publicationCitations(refs).size,1);
 assert.deepEqual(citationSourceIds([{id:'association',type:'paragraph',checked:false,content:refs.map(bibliographicReference=>({text:'[ref]',bibliographicReference}))}]),['source-1']);
 const apa=formatScholarlyCitations([record],refs,'apa');assert.equal(apa.bibliography.length,1);assert.match(apa.bibliography[0],/Doe, J\./);assert.match(apa.bibliography[0],/Research Council/);assert.match(apa.citation,/12/);
 const ieee=formatScholarlyCitations([record],refs,'ieee');assert.equal(ieee.bibliography.length,1);assert.match(ieee.bibliography[0],/\[1\]/);assert.notEqual(ieee.bibliography[0],apa.bibliography[0]);
 assert.throws(()=>formatScholarlyCitations([],refs),/missing/);
});
test('CSL retains corporate creators/historical literal dates; markup rejects syntax injection',()=>{
 const csl=bibliographicCsl({...record,fields:{...record.fields,date:'1776/1789',abstract:'Actual publication abstract'}});
 assert.deepEqual(csl.issued,{literal:'1776/1789'});assert.deepEqual(csl.author[1],{literal:'Research Council'});assert.equal(csl.abstract,'Actual publication abstract');
 assert.equal(citationKeyMarkup('Doe2020','latex'),'\\cite{Doe2020}');assert.equal(citationKeyMarkup('Doe2020','pandoc','p. 12'),'[@Doe2020, p. 12]');assert.throws(()=>citationKeyMarkup('x}\\evil{','latex'),/unsupported/);
});
test('bibliographic atoms round-trip editor DOM without file IDs and retain passage atoms',async t=>{
 setupDOM(t,{html:'<!doctype html><div id="root"></div>'});
 const {segmentHTML,readSegments}=await import('../src/client/editor/segments.tsx');
 const ref={id:'bib1',sourceId:'source-1',locator:'9',label:'page'};
 const passage={id:'p1',sourceId:'source-1',fileId:'f1',sourceHash:'hash',startLine:1,endLine:2,excerpt:'text'};
 const content=[{text:'before '},{text:' [ref]',bibliographicReference:ref},{text:' and '},{text:' [ref]',sourceReference:passage}];
 const root=document.getElementById('root');root.innerHTML=segmentHTML(content,[]);assert.deepEqual(readSegments(root),content);
 assert.equal(root.querySelector('[data-bibliographic-reference]').contentEditable,undefined);assert.equal(root.querySelector('[data-bibliographic-reference]').getAttribute('contenteditable'),'false');
 assert.equal(noteBibliographicCitations([{id:'b',type:'paragraph',checked:false,content}]).length,1);
});

test('live document CSL disambiguates earlier author-date citations and numbers repeated Sources once',async()=>{
 const {formatScholarlyDocument,bibliographicCitationKey}=await import('../src/shared/bibliographic-citations.ts');
 const records=['Alpha','Beta'].map((title,index)=>({sourceId:'s'+index,citationKey:'key'+index,entryType:'book',fields:{author:'Doe, Jane',title,year:'2020'}}));
 const refs=[{id:'c0',sourceId:'s0',locator:'12'},{id:'c1',sourceId:'s1'},{id:'c2',sourceId:'s0',locator:'26'}];
 const apa=formatScholarlyDocument(records,refs,'apa');assert.equal(apa.labels.get(bibliographicCitationKey(refs[0])),'(Doe, 2020a, p. 12)');assert.equal(apa.labels.get(bibliographicCitationKey(refs[1])),'(Doe, 2020b)');assert.equal(apa.bibliography.length,2);
 const ieee=formatScholarlyDocument(records,refs,'ieee');assert.equal(ieee.labels.get(bibliographicCitationKey(refs[0])),'[1, p. 12]');assert.equal(ieee.labels.get(bibliographicCitationKey(refs[2])),'[1, p. 26]');assert.match(ieee.bibliography[1],/^\[2\]/);
});

test('changing inline style preserves saved atoms, passage citation identity and the neighboring caret',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');const env=setupDOM(t);
 const {segmentHTML,readSegments,syncEditableSegments}=await import('../src/client/editor/segments.tsx');
 const {formatScholarlyDocument}=await import('../src/shared/bibliographic-citations.ts');
 const ref={id:'live1',sourceId:'source-1',locator:'9',label:'page'};
 const passage={id:'p1',sourceId:'source-1',fileId:'f1',sourceHash:'hash',startLine:1,endLine:2,excerpt:'text'};
 const content=[{text:'before '},{text:' [ref]',bibliographicReference:ref},{text:' between '},{text:' [ref]',sourceReference:passage},{text:' after'}];
 const presentation=style=>({style:'references',entries:new Map(),scholarly:{...formatScholarlyDocument([record],[ref],style),style}});
 const root=document.querySelector('#mount');root.setAttribute('contenteditable','true');root.innerHTML=segmentHTML(content,[],undefined,false,presentation('apa'));
 syncEditableSegments(root,content,[],{blockId:'b',matches:[]},presentation('apa'));
 const atom=root.querySelector('[data-bibliographic-reference]'),passageAtom=root.querySelector('[data-source-reference]'),after=root.lastChild.firstChild;
 const range=document.createRange();range.setStart(after,3);range.collapse(true);document.getSelection().removeAllRanges();document.getSelection().addRange(range);
 syncEditableSegments(root,content,[],{blockId:'b',matches:[]},presentation('ieee'));
 assert.equal(root.querySelector('[data-bibliographic-reference]'),atom);assert.equal(root.querySelector('[data-source-reference]'),passageAtom);assert.equal(atom.textContent,'[1, p. 9]');assert.equal(document.getSelection().anchorNode,after);assert.equal(document.getSelection().anchorOffset,3);assert.deepEqual(readSegments(root),content);
 await env.close();
});

test('per-note style preference updates inline labels and bibliography together and rejects stale metadata',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs');const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const {useBibliographicPresentation}=await import('../src/client/sources/bibliographic-presentation.ts');
 const {CitationPresentationContext}=await import('../src/client/sources/CitationPresentation.tsx');
 const {NoteBibliographicReferences}=await import('../src/client/sources/NoteBibliographicReferences.tsx');
 let finish; t.mock.method(globalThis,'fetch',async()=>new Promise(resolve=>{finish=resolve;}));
 const ref={id:'persisted',sourceId:'source-1',locator:'12'},blocks=[{id:'b',type:'paragraph',checked:false,content:[{text:' [ref]',bibliographicReference:ref}]}];
 function Probe({pageId}) {const scholarly=useBibliographicPresentation(blocks,'vault',pageId);return createElement(CitationPresentationContext.Provider,{value:{style:'references',entries:new Map(),scholarly}},createElement('p',{'data-inline':true},[...scholarly.labels.values()].join('')),createElement(NoteBibliographicReferences));}
 const render=pageId=>act(async()=>root.render(createElement(Probe,{pageId})));
 await render('a');const stale=finish;await render('b');await act(async()=>stale(Response.json({...record,fields:{...record.fields,title:'Stale title'}})));assert.equal(document.querySelector('[data-inline]').textContent,'');
 await act(async()=>finish(Response.json(record)));assert.match(document.querySelector('[data-inline]').textContent,/2020/);
 const select=document.querySelector('[aria-label="Bibliography style"]');await act(async()=>{select.value='ieee';select.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(document.querySelector('[data-inline]').textContent,'[1, p. 12]');assert.match(document.querySelector('.note-references li').textContent,/\[1\]/);assert.equal(window.localStorage.getItem('noema:bibliography-style:vault/b'),'ieee');
 await render('a');await act(async()=>finish(Response.json(record)));assert.match(document.querySelector('[data-inline]').textContent,/2020/);await render('b');await act(async()=>finish(Response.json(record)));assert.equal(document.querySelector('[data-inline]').textContent,'[1, p. 12]');
 const {bibliographyChanged}=await import('../src/client/sources/bibliography-events.ts');
 await act(async()=>bibliographyChanged('vault','source-1'));await act(async()=>finish(Response.json({...record,fields:{...record.fields,title:'Updated canonical title'}})));assert.match(document.querySelector('.note-references li').textContent,/Updated canonical title/);
});
