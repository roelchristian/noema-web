import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBibliography} from '../src/shared/bibliography.ts';
import {bibliographicCsl,formatScholarlyCitations,publicationCitations,citationKeyMarkup,noteBibliographicCitations} from '../src/shared/bibliographic-citations.ts';
import {JSDOM} from 'jsdom';
const entry=parseBibliography('@book{Doe2020,author={Doe, Jane and {Research Council}},title={Synthetic Study},year={2020},publisher={Test Press}}').entries[0];
const record={...entry,sourceId:'source-1',revision:1,provenance:{}};
test('publication identity deduplicates locators and renders actual APA/IEEE CSL locally',()=>{
 const refs=[{id:'one',sourceId:'source-1',locator:'12'},{id:'two',sourceId:'source-1',locator:'26'}];
 assert.equal(publicationCitations(refs).size,1);
 const apa=formatScholarlyCitations([record],refs,'apa');assert.equal(apa.bibliography.length,1);assert.match(apa.bibliography[0],/Doe, J\./);assert.match(apa.bibliography[0],/Research Council/);assert.match(apa.citation,/12/);
 const ieee=formatScholarlyCitations([record],refs,'ieee');assert.equal(ieee.bibliography.length,1);assert.match(ieee.bibliography[0],/\[1\]/);assert.notEqual(ieee.bibliography[0],apa.bibliography[0]);
 assert.throws(()=>formatScholarlyCitations([],refs),/missing/);
});
test('CSL retains corporate creators/historical literal dates; markup rejects syntax injection',()=>{
 const csl=bibliographicCsl({...record,fields:{...record.fields,date:'1776/1789',abstract:'Actual publication abstract'}});
 assert.deepEqual(csl.issued,{literal:'1776/1789'});assert.deepEqual(csl.author[1],{literal:'Research Council'});assert.equal(csl.abstract,'Actual publication abstract');
 assert.equal(citationKeyMarkup('Doe2020','latex'),'\\cite{Doe2020}');assert.equal(citationKeyMarkup('Doe2020','pandoc','p. 12'),'[@Doe2020, p. 12]');assert.throws(()=>citationKeyMarkup('x}\\evil{','latex'),/unsupported/);
});
test('bibliographic atoms round-trip editor DOM without file IDs and retain passage atoms',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>');for(const key of ['window','document','HTMLElement','Element','Node','HTMLAnchorElement'])globalThis[key]=dom.window[key];
 const {segmentHTML,readSegments}=await import('../src/client/editor/segments.tsx');
 const ref={id:'bib1',sourceId:'source-1',locator:'9',label:'page'};
 const passage={id:'p1',sourceId:'source-1',fileId:'f1',sourceHash:'hash',startLine:1,endLine:2,excerpt:'text'};
 const content=[{text:'before '},{text:' [ref]',bibliographicReference:ref},{text:' and '},{text:' [ref]',sourceReference:passage}];
 const root=document.getElementById('root');root.innerHTML=segmentHTML(content,[]);assert.deepEqual(readSegments(root),content);
 assert.equal(root.querySelector('[data-bibliographic-reference]').contentEditable,undefined);assert.equal(root.querySelector('[data-bibliographic-reference]').getAttribute('contenteditable'),'false');
 assert.equal(noteBibliographicCitations([{id:'b',type:'paragraph',checked:false,content}]).length,1);
 dom.window.close();
});
