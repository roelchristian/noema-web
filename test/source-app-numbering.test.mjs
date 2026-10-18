import {test} from 'node:test';
import assert from 'node:assert/strict';
import {numberSourceNodes,sourceDocumentEntries,sourceNodeLocator,sourceReferenceLocator} from '../src/shared/source-document.ts';
import {processedSourceDocument,sourceGenerationDocument} from '../src/server/modules/source-document.ts';
import {citationLocation} from '../src/shared/citations.ts';

const text=`Preamble.

# Chapter 99

An introduction.

## Unnumbered section

First paragraph.

Second paragraph.

### Details

Lemma 42. A claim.

Proof. A reason.

## Another section

A closing paragraph.

# Chapter 400

Final paragraph.`;
const file={id:'file',text,name:'Example',format:'md',structural_nodes:'[]',page_start_lines:'[]'};

test('local numbering is deterministic, hierarchical, and separate from source numbering',()=>{
 const document=processedSourceDocument(file),again=processedSourceDocument(file);
 assert.deepEqual(document,again);
 assert.equal(file.text,text);
 const entries=sourceDocumentEntries(document);
 const headings=entries.filter(({node})=>['chapter','section','subsection','heading'].includes(node.kind));
 assert.deepEqual(headings.map(({node})=>node.appNumber),['1','1.1','1.1.1','1.2','2']);
 assert.equal(headings[0].node.title,'Chapter 99');
 assert.equal(headings.at(-1).node.title,'Chapter 400');
 assert.deepEqual(numberSourceNodes(document.semantic.children),document.semantic.children);
 const original=JSON.stringify(document.semantic.children);
 numberSourceNodes(document.semantic.children);
 assert.equal(JSON.stringify(document.semantic.children),original);
 const withMoreProse=processedSourceDocument({...file,text:text.replace('An introduction.','An introduction.\n\nExtra prose.')});
 assert.deepEqual(sourceDocumentEntries(withMoreProse).filter(({node})=>['chapter','section','subsection','heading'].includes(node.kind)).map(({node})=>node.appNumber),headings.map(({node})=>node.appNumber));
});

test('citations use exact app block locations, including ranges in older references',()=>{
 const entries=sourceDocumentEntries(processedSourceDocument(file));
 const first=entries.find(({node})=>node.text==='First paragraph.'),second=entries.find(({node})=>node.text==='Second paragraph.');
 assert.equal(sourceNodeLocator(first.path),'§ 1.1 · ¶ 1');
 assert.equal(sourceNodeLocator(second.path),'§ 1.1 · ¶ 2');
 const ref={startLine:first.node.range.startLine,endLine:second.node.range.endLine};
 assert.equal(sourceReferenceLocator(entries,ref),'§ 1.1 · ¶ 1–2');
 assert.equal(sourceReferenceLocator(entries,{...ref,startOffset:first.node.range.startOffset,endOffset:second.node.range.endOffset}),'§ 1.1 · ¶ 1–2');
 const lemma=entries.find(({node})=>node.text==='A claim.');
 assert.equal(sourceNodeLocator(lemma.path),'§ 1.1.1 · Lem. 1');
 assert.equal(citationLocation({appLocator:sourceNodeLocator(lemma.path),contextLabel:'Chapter 99 › Lemma 42.',startPage:7,endPage:7}),'§ 1.1.1 · Lem. 1');
});

test('documents without headings still receive local paragraph numbers and model input copies local addresses',()=>{
 const document=processedSourceDocument({...file,text:'First.\n\nSecond.'});
 assert.deepEqual(sourceDocumentEntries(document).map(({path})=>sourceNodeLocator(path)),['¶ 1','¶ 2']);
 const generated=sourceGenerationDocument(document,'First.\n\nSecond.');
 assert.deepEqual(generated.content.map(node=>[node.appNumber,node.appLocator]),[['1','¶ 1'],['2','¶ 2']]);
});

test('app locators persist through page saves and older citations gain them on read',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const path=await import('node:path');
 const {openDatabase}=await import('../src/server/database.ts');
 const {Store}=await import('../src/server/store.ts');
 const {Knowledge}=await import('../src/server/modules/knowledge.ts');
 const {SourceFiles}=await import('../src/server/modules/source-files.ts');
 const {SourceDocuments,sourceDocumentBuilderVersion}=await import('../src/server/modules/source-documents.ts');
 const {Pages}=await import('../src/server/modules/pages.ts');
 const {SourcePageDraft}=await import('../src/server/modules/source-pages.ts');
 const dir=mkdtempSync(path.join(tmpdir(),'noema-app-locators-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db);
 const files=new SourceFiles(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
 try{
  const added=files.add('default','numbering.md',Buffer.from(text));
  knowledge.create('default',{name:'Numbering example',type:'source',attachmentIds:[added.id]});await files.tick();
  const ready=files.require('default',added.id),document=new SourceDocuments(store).get(ready);
  assert.equal(store.get('SELECT builder_version FROM source_documents WHERE file_id=?',ready.id).builder_version,sourceDocumentBuilderVersion);
  const entry=sourceDocumentEntries(document).find(({node})=>node.text==='Second paragraph.');
  const draft=new SourcePageDraft(()=>{},ready.text,ready);
  draft.feed(JSON.stringify({type:'title',title:'Cited paragraph',language:'en'})+'\n');
  draft.feed(JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'The second paragraph.',citations:[{nodeId:entry.node.id}]})+'\n');draft.finish();
  const created=pages.create('default',{title:'App numbering'});
  const saved=pages.update('default',created.id,{title:created.title,blocks:draft.blocks,revision:created.revision});
  const reference=saved.blocks[0].content.find(segment=>segment.sourceReference).sourceReference;
  assert.equal(reference.appLocator,'§ 1.1 · ¶ 2');
  assert.equal(pages.get('default',saved.id).blocks[0].content.find(segment=>segment.sourceReference).sourceReference.appLocator,reference.appLocator);
  delete reference.nodeId;delete reference.appLocator;
  const migrated=pages.update('default',saved.id,{title:saved.title,blocks:saved.blocks,revision:saved.revision});
  assert.equal(migrated.blocks[0].content.find(segment=>segment.sourceReference).sourceReference.appLocator,'§ 1.1 · ¶ 2');
  assert.equal(files.require('default',added.id).text,ready.text);
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
