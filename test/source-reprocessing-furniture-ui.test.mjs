import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {SourceDocumentView,passageAnchor} from '../src/client/sources/SourceDocumentView.tsx';
test('furniture presentation hides and restores nodes while retaining canonical anchors and text',async t=>{
 const dom=new JSDOM('<div id="mount"></div>');const keys=['window','document','HTMLElement','Node','IS_REACT_ACT_ENVIRONMENT'],prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 keys.forEach(key=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]}));
 const root=createRoot(document.querySelector('#mount'));t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(prior[index])Object.defineProperty(globalThis,key,prior[index]);else delete globalThis[key];});});
 const text='HEADER\nBody text.',entries=[{node:{id:'header',kind:'paragraph',text:'HEADER',range:{startOffset:0,endOffset:6,startLine:1,endLine:1,startPage:1,endPage:1}},path:[]}];
 const props={article:{current:null},fileId:'f',name:'Synthetic source',text,entries,selected:null,annotations:'clean',structureLabels:false,canonicalNode:()=> 'original-header',onSelect:()=>{}};
 await act(async()=>root.render(React.createElement(SourceDocumentView,props)));
 const node=document.getElementById(passageAnchor('f','header'));assert.equal(node.hidden,false);assert.equal(node.dataset.canonicalNode,'original-header');
 await act(async()=>root.render(React.createElement(SourceDocumentView,{...props,hiddenNodeIds:new Set(['header'])})));
 assert.equal(node.hidden,true);assert.equal(node.textContent.includes('HEADER'),true);assert.equal(entries[0].node.range.startOffset,0);assert.equal(document.getElementById(passageAnchor('f','header')),node);
 await act(async()=>root.render(React.createElement(SourceDocumentView,props)));assert.equal(node.hidden,false);assert.equal(node.dataset.canonicalNode,'original-header');
 let reviewed;await act(async()=>root.render(React.createElement(SourceDocumentView,{...props,changeForNode:()=>({id:'one',patchIds:['one','two'],count:2,quiet:true,label:'2 editorial changes in this passage'}),onReview:(id,ids)=>{reviewed={id,ids};}})));
 const indicator=document.querySelector('.source-reader-change-indicator');assert.equal(indicator.textContent,'2');assert.equal(indicator.getAttribute('aria-label'),'2 editorial changes in this passage');assert.equal(indicator.classList.contains('is-quiet'),true);await act(async()=>indicator.click());assert.deepEqual(reviewed,{id:'one',ids:['one','two']});
});

test('furniture mapping tolerates PDF object markers but never hides adjacent substantive text',async()=>{
 const {classifiedFurnitureNodes}=await import('../src/client/sources/source-furniture-presentation.ts');
 const entry=(id,text,startOffset=0,endOffset=text.length)=>({node:{id,kind:'paragraph',text,range:{startOffset,endOffset,startPage:1,endPage:1}},path:[]});
 const canonical='DOCKET HEADER\uFFFC Dated this 24 April 2026',entries=[entry('original',canonical)];
 const header=entry('header','DOCKET HEADER\uFFFC'),body=entry('body','Dated this 24 April 2026',15);
 const revision={furniture:[{text:'DOCKET HEADER',kind:'header',page:1,startOffset:0,endOffset:13}],nodeLinks:[{originalNodeId:'original',reprocessedNodeIds:['header','body','merged']}]};
 assert.deepEqual([...classifiedFurnitureNodes(revision,entries,[header,body])],[['header','header']]);
 assert.equal(classifiedFurnitureNodes(revision,entries,[entry('merged',canonical)]).size,0);
 assert.equal(classifiedFurnitureNodes(revision,entries,[{...header,node:{...header.node,kind:'heading'}}]).size,0);
 assert.equal(classifiedFurnitureNodes({...revision,nodeLinks:[]},entries,[header]).size,0);
});


test('page dividers remain when furniture is hidden and omit unknown or repeated pages',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const entry=(id,page)=>({node:{id,kind:'paragraph',text:id,range:{startOffset:0,endOffset:id.length,startLine:1,endLine:1,startPage:page,endPage:page}},path:[]});
 const entries=[entry('body',1),entry('unknown',null),entry('header',2),entry('next-body',2),entry('last-body',3)];
 const props={article:{current:null},fileId:'f',name:'Pages',text:'body',entries,selected:null,annotations:'clean',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{},furnitureKind:id=>id==='header'?'header':undefined};
 for(const hiddenNodeIds of [undefined,new Set(['header'])]){
  const dom=new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{...props,hiddenNodeIds})));
  const dividers=[...dom.window.document.querySelectorAll('[role="separator"]')];
  assert.deepEqual(dividers.map(item=>item.getAttribute('aria-label')),['Page 2','Page 3']);
  assert.equal(dividers[0].nextElementSibling.dataset.sourceNode,'header');
  assert.equal(dom.window.document.querySelector('[data-page-furniture="header"]').hidden,!!hiddenNodeIds);
  assert.equal(dom.window.document.querySelector('[data-source-node="next-body"]').hidden,false);
  dom.window.close();
 }
});


test('endnotes collect standalone and mixed definitions once, preserving links and raw offsets',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const parts=['First claim[^p1-1].\n\n[^p1-1]: First note.\n    Continued note.', 'Later claim[^p2-1].', '[^p2-1]: Second note.', '```\n[^example]: literal code\n```'];
 const text=parts.join('\n\n');let offset=0;
 const entries=parts.map((value,index)=>{const startOffset=offset;offset+=value.length+2;return {node:{id:'n'+index,kind:index===2?'footnote':index===3?'code':'paragraph',text:value,range:{startOffset,endOffset:startOffset+value.length,startLine:1,endLine:1,startPage:index+1,endPage:index+1}},path:[]};});
 const props={article:{current:null},fileId:'f',name:'Notes',text,entries,selected:null,annotations:'contextual',structureLabels:false,canonicalNode:id=>id,onSelect:()=>{}};
 for(const endnotes of [false,true]){
  const dom=new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{...props,endnotes})));
  const document=dom.window.document,notes=[...document.querySelectorAll('.source-reader-footnote')];
  assert.equal(notes.length,2);assert.equal(document.querySelectorAll('[id="f-note-p1-1"]').length,1);
  assert.equal(document.querySelectorAll('.source-reader-endnotes').length,endnotes?1:0);
  assert.equal(notes.every(note=>!!note.closest('.source-reader-endnotes')===endnotes),true);
  assert.match(notes[0].textContent,/Continued note/);
  assert.equal(document.querySelector('[data-source-node="n1"]').closest('.source-reader-endnotes'),null);
  assert.equal(!!document.getElementById(passageAnchor('f','n2')).closest('.source-reader-endnotes'),endnotes);
  for(const reference of document.querySelectorAll('[data-footnote-reference]'))assert.ok(document.getElementById(reference.dataset.footnoteReference));
  for(const leaf of document.querySelectorAll('.source-reader-footnote [data-source-start]'))assert.equal(text.slice(Number(leaf.dataset.sourceStart),Number(leaf.dataset.sourceEnd)),leaf.textContent);
  assert.match(document.querySelector('pre').textContent,/\[\^example\]: literal code/);
  dom.window.close();
 }
 const fallback=new JSDOM(renderToStaticMarkup(React.createElement(SourceDocumentView,{...props,entries:[],endnotes:true})));
 assert.equal(fallback.window.document.querySelectorAll('.source-reader-endnotes .source-reader-footnote').length,2);
 fallback.window.close();
});


test('printed checkboxes use editor styling deterministically while preserving source characters and offsets',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {SourceReaderText}=await import('../src/client/sources/SourceReaderText.tsx');
 const text='☐ The Office of Public Counsel for the Defence\n☑ Selected office\n☒ Other office\n\n`☐ literal code`\n\nA \\| table pipe.';
 const startOffset=17;
 const dom=new JSDOM(renderToStaticMarkup(React.createElement(SourceReaderText,{text,startOffset})));
 const document=dom.window.document,boxes=[...document.querySelectorAll('.source-reader-checkbox')];
 assert.equal(boxes.length,3);
 assert.deepEqual(boxes.map(box=>box.getAttribute('aria-checked')),['false','true','true']);
 assert.ok(boxes.every(box=>box.getAttribute('aria-disabled')==='true'));
 for(const box of boxes){
  const leaf=box.parentElement,start=Number(leaf.dataset.sourceStart),end=Number(leaf.dataset.sourceEnd);
  assert.equal(end-start,1);assert.equal(leaf.dataset.sourceAtomic,'true');
  assert.equal(text.slice(start-startOffset,end-startOffset),box.textContent);
 }
 assert.equal(document.querySelector('code').textContent,'☐ literal code');
 assert.match(document.body.textContent,/☐ The Office of Public Counsel for the Defence/);
 assert.match(document.body.textContent,/A \| table pipe/);
 assert.equal(document.querySelectorAll('input,button').length,0,'Printed checkboxes never modify source content');
 dom.window.close();
});
