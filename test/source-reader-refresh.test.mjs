import test from 'node:test';
import {readFileSync} from 'node:fs';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
const loader=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
const {SourceReader}=await import('../src/client/sources/SourceReader.tsx');
loader.deregister();

test('delayed enrichment refreshes headings and navigation without reloading or losing an unchanged-text selection',async()=>{
 const dom=new JSDOM('<main><div id="mount"></div></main>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','MutationObserver','Event','CustomEvent','KeyboardEvent','localStorage','getSelection','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
 class ResizeObserverStub {observe(){}unobserve(){}disconnect(){}}
 for(const key of keys){
  const value=key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='ResizeObserver'?ResizeObserverStub:
   ['getSelection','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key];
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 Object.defineProperty(dom.window.document,'fonts',{value:{ready:Promise.resolve()}});
 dom.window.Range.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:100,bottom:20,width:100,height:20});
 dom.window.Range.prototype.getClientRects=()=>[];
 dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
 let poll,completed=false,detailReads=0,documentReads=0;
 globalThis.setTimeout=(callback,delay,...args)=>{if(delay===2000){poll=()=>callback(...args);return 2147483647;}return originalTimeout(callback,delay,...args);};
 const text='Teaching Dante\n\nA stable paragraph for citation.';
 const file={id:'file',vault_id:'default',entity_id:'source',name:'article.txt',format:'txt',status:'ready',admitted:1,text,textHash:'unchanged-text-version',pages:0,page_start_lines:'[]',structural_nodes:'[]',enrichment_status:'running',generated_name:null,language:null,source_url:null};
 const attachment=()=>({...file,enrichment_status:completed?'completed':'running',structural_nodes:completed?JSON.stringify([{text:'Teaching Dante',startLine:1,level:2,kind:'section'}]):'[]'});
 const canonicalDocument=processedSourceDocument(file),revisedText=text.replace('A stable paragraph for citation.','A revised paragraph for reading.');
 const revisedDocument=processedSourceDocument({...file,text:revisedText});
 const originalEntries=sourceDocumentEntries(canonicalDocument).filter(entry=>entry.node.text!==undefined);
 const revisedEntries=sourceDocumentEntries(revisedDocument).filter(entry=>entry.node.text!==undefined);
 const revision={...JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8')),id:'revision',fileId:'file',baseHash:'snapshot-fingerprint-distinct-from-text-hash',stale:false,status:'completed',original:{text,document:canonicalDocument},reprocessed:{text:revisedText,document:revisedDocument},nodeLinks:originalEntries.map((entry,index)=>({originalNodeId:entry.node.id,reprocessedNodeIds:[revisedEntries[index].node.id]}))};
 revision.report.chunksCompleted=revision.report.chunksTotal;
 globalThis.fetch=async url=>{
  if(url==='/api/entities/source'){detailReads++;return Response.json({attachments:[attachment()]});}
  if(url==='/api/source-files/file?fingerprint=1&context=1'){documentReads++;const current=attachment();return Response.json({...current,document:processedSourceDocument(current)});}
  if(url==='/api/source-files/file/reading-locations')return Response.json({resume:null,bookmarks:[]});
  if(url==='/api/source-files/file/reprocessing')return Response.json([{...revision,patchCount:0,pendingCount:0}]);
  if(url==='/api/source-files/file/reprocessing/revision')return Response.json(revision);
  if(url==='/api/source-files/file/highlights')return Response.json([{id:'highlight-1',fileId:'file',sourceId:'source',sourceHash:file.textHash,startOffset:16,endOffset:text.length,excerpt:'A stable paragraph for citation.',color:'yellow',createdAt:'2026-10-25'}]);
  if(url==='/api/source-files/file/highlights/highlight-1')return Response.json({ok:true});
  if(url==='/api/source-files/file/reading-notes')return Response.json([{pageId:'note-1',title:'My annotation',text:'A connection to revisit.',sourceHash:file.textHash,startOffset:16,endOffset:text.length}]);
  throw new Error(`Unexpected request: ${url}`);
 };
 let infoToggles=0,openedNote='';
 const errors=[],root=createRoot(document.querySelector('#mount'));
 const noop=()=>{};
 try{
  await act(async()=>root.render(React.createElement(SourceReader,{vaultId:'default',source:{id:'source',name:'Article',subtypes:[],updated_at:'fixed'},entities:[],onToggleInspector:()=>infoToggles++,onOpenEntity:noop,onCreatePageFromSource:noop,onError:message=>errors.push(message),onAddPassage:noop,onAnnotate:noop,onReadingNoteCreated:noop,onOpenReadingNote:id=>{openedNote=id;},onRemoveReadingNote:noop})));
  assert.equal(documentReads,1);
  const activity=document.querySelector('.source-reader-toolbar button[aria-label="Reading activity"]');
  assert.ok(activity,'Sources toolbar exposes central reading activity');
  await act(async()=>{activity.focus();activity.click();});
  const activityPanel=()=>document.querySelector('aside[aria-label="Reading activity"]');
  assert.ok(activityPanel());
  assert.ok(activityPanel().classList.contains('entity-panel'),'reading activity uses the source inspector panel frame');
  assert.ok(activityPanel().querySelector('.source-inspector-header .entity-detail-toolbar'));
  assert.equal(activityPanel().closest('.source-reader'),null,'side panel lives alongside the workspace');
  assert.ok(document.querySelector('[aria-label="Passage bookmarks"]'));
  const activityTab=name=>[...activityPanel().querySelectorAll('[role="tab"]')].find(button=>button.textContent.startsWith(name));
  await act(async()=>activityTab('Annotations').click());
  assert.match(activityPanel().textContent,/My annotation/);
  assert.match(activityPanel().textContent,/A connection to revisit/);
  await act(async()=>[...activityPanel().querySelectorAll('button')].find(button=>button.textContent==='Open note').click());
  assert.equal(openedNote,'note-1','annotations open their saved reading note');
  await act(async()=>activityTab('Highlights').click());
  assert.match(activityPanel().textContent,/A stable paragraph for citation/);
  await act(async()=>[...activityPanel().querySelectorAll('button')].find(button=>button.textContent==='Remove highlight').click());
  assert.match(activityPanel().textContent,/No highlights yet/);
  await act(async()=>activityTab('Highlights').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
  assert.equal(activityTab('Annotations').getAttribute('aria-selected'),'true');
  assert.equal(document.activeElement,activityTab('Annotations'));
  assert.equal(document.querySelector('.source-reader-document [data-highlight-id]'),null,'central removal updates the passage');
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(activityPanel(),null);
  assert.equal(document.activeElement,activity,'Escape restores the activity trigger');
  await act(async()=>document.querySelector('.source-reading-navigation button[aria-label="Reading activity"]').click());
  assert.ok(activityPanel(),'floating control opens the same activity view');
  await act(async()=>activityPanel().querySelector('.panel-top button').click());

  assert.equal(document.querySelector('.source-reader-document').dataset.annotations,'contextual');
  assert.equal(document.querySelector('[aria-label="Reader annotations"]').value,'contextual');
  await act(async()=>document.querySelector('button[aria-label="Info"]').click());
  assert.equal(infoToggles,1,'reader Info reveals the existing Inspector');
  assert.ok(document.querySelector('a[aria-label="Download"] svg'));
  assert.ok(document.querySelector('summary[aria-label="Display"] svg'));
  assert.equal(document.querySelector('.source-workspace-title').textContent,'Article');
  assert.match(document.querySelector('.source-workspace-eyebrow').textContent,/SourceTXT/);
  assert.equal(document.querySelector('.source-reader-document h3'),null);
  assert.match(document.querySelector('[aria-label="Source reading navigation"]').textContent,/Passage/);
  const body=[...document.querySelectorAll('.source-reader-passage')].find(node=>node.textContent.includes('A stable paragraph'));
  assert.ok(body);
  await act(async()=>body.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  assert.equal(document.querySelector('[aria-label="Selected passage"] blockquote').textContent,'A stable paragraph for citation.');
  const selectedId=body.dataset.sourceNode;
  assert.equal(typeof poll,'function','ready sources continue polling while enrichment is running');
  completed=true;
  await act(async()=>{poll();await new Promise(resolve=>originalTimeout(resolve,0));});
  assert.equal(detailReads,2);
  assert.equal(documentReads,2,'metadata changes trigger a fresh structured-document request');
  assert.equal(document.querySelector('.source-reader-document h3')?.textContent,'Teaching Dante');
  assert.match(document.querySelector('[aria-label="Source reading navigation"]').textContent,/Section/);
  assert.equal(document.querySelector('[aria-label="Selected passage"] blockquote')?.textContent,'A stable paragraph for citation.');
  assert.equal(document.querySelector('.source-reader-passage.is-selected')?.dataset.sourceNode,selectedId);
  const scrolls=[];
  dom.window.scrollBy=value=>scrolls.push(value);
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){const top=this.matches('.source-reader-passage')&&this.textContent.includes('Teaching Dante')?-200:this.closest('.source-reader-document')?.textContent.includes('A revised paragraph')?200:100;return {top,bottom:top+100,left:0,right:100,height:100,width:100};};
  const originalArticle=document.querySelector('.source-reader-document');
  const versions=document.querySelector('[aria-label="Reading version"]');
  await act(async()=>{versions.value='revision';versions.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(document.querySelector('.source-reader-document'),originalArticle,'version changes preserve the article element');
  assert.match(originalArticle.textContent,/A revised paragraph for reading/);
  assert.ok(scrolls.some(value=>value.top===100),'semantic node links preserve the viewport position after presentation changes');
  assert.equal(document.querySelector('.source-reading-continuity'),null,'editorial offsets cannot be persisted as canonical bookmarks');
  assert.equal(document.querySelector('.source-reading-tools'),null,'canonical highlight tools are unavailable on unverified editorial offsets');
  const revisedBody=[...originalArticle.querySelectorAll('.source-reader-passage')].find(node=>node.textContent.includes('A revised paragraph'));
  await act(async()=>revisedBody.querySelector('button').click());
  assert.equal(document.querySelector('[aria-label="Selected passage"] blockquote')?.textContent,'A stable paragraph for citation.','editorial citation resolves the recorded original node and quotes canonical text');
  await act(async()=>{versions.value='original';versions.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(document.querySelector('.source-reader-document'),originalArticle);
  assert.match(originalArticle.textContent,/A stable paragraph for citation/);
  assert.ok(scrolls.some(value=>value.top===-100),'returning to Original processed restores the same semantic position');
  revision.nodeLinks=[];
  await act(async()=>{versions.value='revision';versions.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.ok([...originalArticle.querySelectorAll('.source-reader-node-address')].every(button=>button.getAttribute('aria-disabled')==='true'),'missing semantic mappings never invent canonical citation coordinates');
  assert.equal(document.querySelector('.source-reader-document').dataset.annotations,'contextual','version switches retain display preferences');
  assert.deepEqual(errors,[]);
 }finally{
  await act(async()=>root.unmount());globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;dom.window.close();
  keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});
 }
});


test('legacy CRLF editorial coordinates fail closed while proven raw snapshots retain complete text',async()=>{
 const {editorialSnapshotHasRawRanges,sourceViewEntries}=await import('../src/client/sources/SourceDocumentView.tsx');
 const text='First paragraph.\r\n\r\nSecond complete paragraph.\r\nAnother line remains intact.';
 const document=processedSourceDocument({id:'legacy',text,name:'legacy.txt',format:'txt',structural_nodes:'[]',page_start_lines:'[]'});
 assert.equal(editorialSnapshotHasRawRanges(text,document),false,'legacy normalized ranges cannot be interpreted as raw offsets');
 const canonical=sourceViewEntries(text,document);
 assert.ok(canonical.some(({node})=>node.text?.includes('Second complete paragraph.\r\nAnother line remains intact.')),'canonical fallback still renders the complete original text');
 const rawDocument=structuredClone(document),offsets=[];
 for(let index=0;index<text.length;index++){offsets.push(index);if(text[index]==='\r'&&text[index+1]==='\n')index++;}
 offsets.push(text.length);
 for(const {node} of sourceDocumentEntries(rawDocument)){
  node.range.startOffset=offsets[node.range.startOffset];node.range.endOffset=offsets[node.range.endOffset];
  if(node.text!==undefined)node.text=text.slice(node.range.startOffset,node.range.endOffset);
 }
 assert.equal(editorialSnapshotHasRawRanges(text,rawDocument),true,'exact raw slices independently establish the coordinate system');
 const editorial=sourceViewEntries(text,rawDocument,true);
 assert.equal(editorial.at(-1).node.text,canonical.at(-1).node.text);
});
