import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
 const keys=['window','document','Node','Element','HTMLElement','MutationObserver','Event','CustomEvent','KeyboardEvent','MouseEvent','localStorage','getSelection','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'];
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
 const bookmark={id:'bookmark-1',label:'Saved passage',anchor:{fileId:'file',revision:file.textHash,offset:16,quote:'A stable paragraph for citation.',prefix:'Teaching Dante\n\n',suffix:'',atEnd:false},resolution:{status:'resolved',offset:16}};
 const attachment=()=>({...file,enrichment_status:completed?'completed':'running',structural_nodes:completed?JSON.stringify([{text:'Teaching Dante',startLine:1,level:2,kind:'section'}]):'[]'});
 const canonicalDocument=processedSourceDocument(file),revisedText=text.replace('A stable paragraph for citation.','A revised paragraph for reading.');
 const revisedDocument=processedSourceDocument({...file,text:revisedText});
 const originalEntries=sourceDocumentEntries(canonicalDocument).filter(entry=>entry.node.text!==undefined);
 const revisedEntries=sourceDocumentEntries(revisedDocument).filter(entry=>entry.node.text!==undefined);
 const revision={...JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8')),id:'revision',fileId:'file',baseHash:'snapshot-fingerprint-distinct-from-text-hash',stale:false,status:'completed',original:{text,document:canonicalDocument},reprocessed:{text:revisedText,document:revisedDocument},nodeLinks:originalEntries.map((entry,index)=>({originalNodeId:entry.node.id,reprocessedNodeIds:[revisedEntries[index].node.id]}))};
 revision.report.chunksCompleted=revision.report.chunksTotal;
 globalThis.fetch=async(url,options)=>{
  if(url==='/api/entities/source'){detailReads++;return Response.json({attachments:[attachment()]});}
  if(url==='/api/source-files/file?fingerprint=1&context=1'){documentReads++;const current=attachment();return Response.json({...current,document:processedSourceDocument(current)});}
  if(url==='/api/source-files/file/reading-locations?revisionId=revision')return Response.json({resume:null,bookmarks:[]});
  if(url==='/api/source-files/file/highlights?revisionId=revision')return Response.json([{id:'persisted-highlight',fileId:'file',sourceId:'source',sourceHash:createHash('sha256').update(revisedText).digest('hex'),startOffset:16,endOffset:revisedText.length,excerpt:revisedText.slice(16),color:'yellow',createdAt:'2026-10-25'}]);
  if(url==='/api/source-files/file/reading-notes?revisionId=revision')return Response.json([{pageId:'note-1',title:'My annotation',text:'A connection to revisit.',sourceHash:createHash('sha256').update(revisedText).digest('hex'),startOffset:16,endOffset:revisedText.length}]);
  if(url==='/api/source-files/file/reading-locations')return Response.json({resume:null,bookmarks:[bookmark]});
  if(url==='/api/source-files/file/reading-locations/bookmark-1'){assert.equal(options.method,'PATCH');bookmark.label=JSON.parse(options.body).label;return Response.json({ok:true});}
  if(url==='/api/source-files/file/reprocessing')return Response.json([{...revision,patchCount:0,pendingCount:0}]);
  if(url==='/api/source-files/file/reprocessing/revision')return Response.json(revision);
  if(url==='/api/source-files/file/highlights')return Response.json([{id:'highlight-1',fileId:'file',sourceId:'source',sourceHash:file.textHash,startOffset:16,endOffset:text.length,excerpt:'A stable paragraph for citation.',color:'yellow',createdAt:'2026-10-25'}]);
  if(url==='/api/source-files/file/highlights/highlight-1')return Response.json({ok:true});
  if(url==='/api/source-files/file/highlights/persisted-highlight'){const body=JSON.parse(options.body);assert.equal(body.revisionId,'revision');assert.equal(body.color,'blue');return Response.json({id:'persisted-highlight',fileId:'file',sourceId:'source',sourceHash:createHash('sha256').update(revisedText).digest('hex'),startOffset:16,endOffset:revisedText.length,excerpt:revisedText.slice(16),color:body.color,createdAt:'2026-10-25'});}
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
  assert.equal(activityPanel().querySelector('[aria-label="Bookmark label"]'),null,'bookmark rows keep edit fields hidden');
  assert.ok(activityPanel().querySelector('[aria-label="Rename bookmark"] svg'));
  await act(async()=>activityPanel().querySelector('[aria-label="Rename bookmark"]').click());
  const bookmarkLabel=activityPanel().querySelector('[aria-label="Bookmark label"]');
  await act(async()=>{
   Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(bookmarkLabel,'Revisit this');
   bookmarkLabel.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
   bookmarkLabel.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key:'s',bubbles:true}));
  });
  await act(async()=>activityPanel().querySelector('.source-activity-rename').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(bookmark.label,'Revisit this');
  assert.equal(activityPanel().querySelector('[aria-label="Bookmark label"]'),null,'successful rename returns to the compact row');
  assert.match(activityPanel().textContent,/Revisit this/);

  assert.equal(activityPanel().querySelector('.source-activity-body').dataset.previewLines,'2');
  await act(async()=>activityPanel().querySelector('[aria-label="One-line previews"]').click());
  assert.equal(activityPanel().querySelector('.source-activity-body').dataset.previewLines,'1');
  assert.equal(localStorage.getItem('noema:source-activity-lines'),'1');
  assert.ok(activityPanel().querySelector('[aria-label="One-line previews"] svg'));

  const activityTab=name=>[...activityPanel().querySelectorAll('[role="tab"]')].find(button=>button.textContent.startsWith(name));
  await act(async()=>activityTab('Annotations').click());
  assert.match(activityPanel().textContent,/My annotation/);
  assert.match(activityPanel().textContent,/A connection to revisit/);
  assert.match(activityPanel().querySelector('.source-activity-context').textContent,/Line 3/);
  assert.match(activityPanel().querySelector('.source-activity-context').textContent,/A stable paragraph/);
  assert.ok(activityPanel().querySelector('[aria-label="Open note"] svg'));

  await act(async()=>[...activityPanel().querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Open note').click());
  assert.equal(openedNote,'note-1','annotations open their saved reading note');
  await act(async()=>activityTab('Highlights').click());
  assert.match(activityPanel().textContent,/A stable paragraph for citation/);
  await act(async()=>[...activityPanel().querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Remove highlight').click());
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
  assert.equal(document.querySelector('.source-reader').classList.contains('has-revision-diff'),false,'Version selection starts in Changes applied');
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Diff').click());
  const mountedContent=document.querySelector('.source-reader-content');
  assert.ok(document.querySelector('.source-reader').classList.contains('has-revision-diff'));
  assert.equal(mountedContent.hidden,true,'Diff occupies the reader while keeping its document mounted');
  assert.ok(document.querySelector('.source-revision-diff'));
  assert.equal(document.querySelector('.source-reader-document'),originalArticle,'Opening diff preserves the mounted reading document');
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Changes applied').click());
  assert.equal(document.querySelector('.source-reader-content'),mountedContent);
  assert.equal(mountedContent.hidden,false,'Changes applied restores the existing reading surface');
  assert.equal(document.querySelector('.source-reader').classList.contains('has-revision-diff'),false);
  assert.equal(document.querySelector('.source-reader-document'),originalArticle,'version changes preserve the article element');
  assert.match(originalArticle.textContent,/A revised paragraph for reading/);
  assert.ok(scrolls.some(value=>value.top===100),'semantic node links preserve the viewport position after presentation changes');
  await act(async()=>{await new Promise(resolve=>originalTimeout(resolve,30));});
  assert.ok(document.querySelector('.source-reading-continuity'),'reading activity stays available in reprocessed versions');
  assert.ok(originalArticle.querySelector('[data-highlight-id="persisted-highlight"]'),'highlights use projected editorial offsets');
  assert.ok(originalArticle.querySelector('.source-reading-note-inline-text'),'annotations remain attached to the reprocessed passage');
  await act(async()=>originalArticle.querySelector('[data-highlight-id="persisted-highlight"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  assert.ok(document.querySelector('.source-reading-menu'),'selection tools are available on reprocessed passages');
  await act(async()=>document.querySelector('[aria-label="Change highlight to blue"]').click());
  assert.equal(originalArticle.querySelector('[data-highlight-id="persisted-highlight"]').dataset.color,'blue','highlight edits retain revision coordinates');
  await act(async()=>document.querySelector('.source-reader-toolbar button[aria-label="Reading activity"]').click());
  await act(async()=>activityTab('Annotations').click());
  assert.match(activityPanel().textContent,/My annotation/);
  assert.match(activityPanel().querySelector('.source-activity-context').textContent,/A revised paragraph/);
  await act(async()=>activityPanel().querySelector('.panel-top button').click());
  const revisedBody=[...originalArticle.querySelectorAll('.source-reader-passage')].find(node=>node.textContent.includes('A revised paragraph'));
  await act(async()=>revisedBody.querySelector('button').click());
  assert.equal(document.querySelector('[aria-label="Selected passage"] blockquote')?.textContent,'A stable paragraph for citation.','editorial citation resolves the recorded original node and quotes canonical text');
  await act(async()=>{versions.value='original';versions.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(document.querySelector('.source-reader-document'),originalArticle);
  assert.match(originalArticle.textContent,/A stable paragraph for citation/);
  assert.ok(scrolls.some(value=>value.top===-100),'returning to Original processed restores the same semantic position');
  revision.nodeLinks=[];
  await act(async()=>{versions.value='revision';versions.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Changes applied').click());
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

test('accepted page shows the selected snapshot immediately while its background reading request is pending',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t),{dom}=env;
 for(const [key,value] of Object.entries({localStorage:dom.window.localStorage,ResizeObserver:class{observe(){}disconnect(){}}})){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});env.defer(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});
 }
 Object.defineProperty(document,'fonts',{value:{ready:Promise.resolve()}});dom.window.Range.prototype.getClientRects=()=>[];
 const text='Canonical reading paragraph.',file={id:'file',vault_id:'default',entity_id:'source',name:'article.txt',format:'txt',status:'ready',admitted:1,text,textHash:'canonical',pages:0,page_start_lines:'[]',structural_nodes:'[]',enrichment_status:'completed',generated_name:null,language:null,source_url:null};
 const original={text,document:processedSourceDocument(file)},base=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));
 const snapshot=(id,text,versionNumber)=>({...base,id,fileId:'file',versionNumber,status:'completed',stale:false,patches:[],original,reprocessed:{text,document:processedSourceDocument({...file,text})},report:{...base.report,chunksCompleted:base.report.chunksTotal}});
 const preferred=snapshot('preferred','Preferred reading paragraph.',1),selected=snapshot('selected','Selected reading paragraph.',2);
 localStorage.setItem('noema:source-reading:default:file',preferred.id);
 let selectedReads=0,releaseReading;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url==='/api/entities/source')return Response.json({attachments:[file]});
  if(url==='/api/source-files/file?fingerprint=1&context=1')return Response.json({...file,document:original.document});
  if(url==='/api/source-files/file/reprocessing')return Response.json([selected,preferred]);
  if(url==='/api/source-files/file/reprocessing/preferred')return Response.json(preferred);
  if(url==='/api/source-files/file/reprocessing/selected'){
   if(++selectedReads===1)return new Promise(resolve=>{releaseReading=()=>resolve(Response.json(selected));});
   return Response.json(selected);
  }
  if(url.startsWith('/api/source-files/file/reading-locations'))return Response.json({resume:null,bookmarks:[]});
  if(url.startsWith('/api/source-files/file/highlights')||url.startsWith('/api/source-files/file/reading-notes'))return Response.json([]);
  throw Error(`Unexpected request: ${url}`);
 });
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));const noop=()=>{};
 await act(async()=>root.render(React.createElement(SourceReader,{vaultId:'default',source:{id:'source',name:'Article',subtypes:[],updated_at:'fixed'},entities:[],onOpenEntity:noop,onCreatePageFromSource:noop,onError:noop,onAddPassage:noop,onAnnotate:noop,onReadingNoteCreated:noop,onOpenReadingNote:noop,onRemoveReadingNote:noop})));
 const picker=document.querySelector('[aria-label="Reading version"]');
 await act(async()=>{picker.value=selected.id;picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(typeof releaseReading,'function');assert.equal(selectedReads,2,'The diff detail is available while the reading request is delayed');
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Changes applied').click());
 const article=document.querySelector('.source-reader-document');
 assert.equal(document.querySelector('.source-reader-content').hidden,false);assert.match(article.textContent,/Selected reading paragraph/);assert.doesNotMatch(article.textContent,/Preferred reading paragraph/);
 assert.equal(localStorage.getItem('noema:source-reading:default:file'),'preferred');
 await act(async()=>releaseReading());assert.match(article.textContent,/Selected reading paragraph/);
});

test('selected accepted page recovery labels recovered reading without rewriting original unreadable evidence',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t),{dom}=env;
 for(const [key,value] of Object.entries({localStorage:dom.window.localStorage,ResizeObserver:class{observe(){}disconnect(){}}})){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});env.defer(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});
 }
 Object.defineProperty(document,'fonts',{value:{ready:Promise.resolve()}});dom.window.Range.prototype.getClientRects=()=>[];
 const text='<!-- Page 1 -->\nOriginal first page.\n<!-- Page 2 -->\n',file={id:'file',vault_id:'default',entity_id:'source',name:'article.pdf',format:'pdf',status:'ready',admitted:1,text,textHash:'canonical',pages:2,page_start_lines:'[1,3]',structural_nodes:'[]',enrichment_status:'completed',generated_name:null,language:null,source_url:null};
 const pages=[{number:1,role:'owned',state:'content',printedLabel:null,unresolved:[]},{number:2,role:'owned',state:'unreadable',printedLabel:null,unresolved:[{description:'Original unreadable scan',blockId:null}]}],original={text,document:processedSourceDocument(file)};original.document.ingestion={pages};
 const recoveredText=text+'Recovered second page.',recoveredDocument=processedSourceDocument({...file,text:recoveredText});recoveredDocument.ingestion={pages,readingMapping:{nodes:[],relations:[],recoveredNodes:[{readingId:'recovered',originalId:null,page:2}]}};
 const base=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8')),revision={...base,id:'recovered',fileId:'file',versionNumber:1,status:'completed',stale:false,patches:[],original,reprocessed:{text:recoveredText,document:recoveredDocument},report:{...base.report,chunksCompleted:base.report.chunksTotal}};
 t.mock.method(globalThis,'fetch',async url=>{
  if(url==='/api/entities/source')return Response.json({attachments:[file]});
  if(url==='/api/source-files/file?fingerprint=1&context=1')return Response.json({...file,document:original.document});
  if(url==='/api/source-files/file/reprocessing')return Response.json([revision]);
  if(url==='/api/source-files/file/reprocessing/recovered')return Response.json(revision);
  if(url.startsWith('/api/source-files/file/reading-locations'))return Response.json({resume:null,bookmarks:[]});
  if(url.startsWith('/api/source-files/file/highlights')||url.startsWith('/api/source-files/file/reading-notes'))return Response.json([]);
  throw Error(`Unexpected request: ${url}`);
 });
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));const noop=()=>{};
 await act(async()=>root.render(React.createElement(SourceReader,{vaultId:'default',source:{id:'source',name:'Article',subtypes:[],updated_at:'fixed'},entities:[],onOpenEntity:noop,onCreatePageFromSource:noop,onError:noop,onAddPassage:noop,onAnnotate:noop,onReadingNoteCreated:noop,onOpenReadingNote:noop,onRemoveReadingNote:noop})));
 assert.match(document.querySelector('[aria-label="PDF transcription issues"]').textContent,/unreadable region.*Original unreadable scan/);
 const picker=document.querySelector('[aria-label="Reading version"]');await act(async()=>{picker.value=revision.id;picker.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.match(document.querySelector('[aria-label="PDF transcription issues"]').textContent,/Recovered reading; original transcription unavailable/);assert.match(document.querySelector('.source-reader-document').textContent,/Recovered second page/);
 assert.equal(file.text,text);assert.equal(original.document.ingestion.pages[1].state,'unreadable');assert.equal(localStorage.getItem('noema:source-reading:default:file'),null,'Recovery is viewed only by explicit selection and never silently preferred');
});
