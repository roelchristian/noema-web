import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {enrichCitationPages} from '../src/server/modules/source-references.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {processedSourceDocument,sourceGenerationDocument} from '../src/server/modules/source-document.ts';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
import {SourcePageDraft} from '../src/server/modules/source-pages.ts';
import {citationKey,citationLocation,citationContextLabel} from '../src/shared/citations.ts';
import {semanticPassages,SemanticPassageText} from '../src/client/sources/SourceViewer.tsx';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {createApp} from '../src/server/http.ts';

const text='# Chapter 1\n\n## Axioms\n\nTheorem 1. A group has an identity.\n\nProof. The identity axiom gives the result.\n\nA final observation.';
const file={id:'file',entity_id:'source',text,format:'txt',name:'Axioms',structural_nodes:'[]',page_start_lines:'[]'};
function draftFor(file,citation){
 const draft=new SourcePageDraft(()=>{},file.text,file);
 draft.feed(JSON.stringify({type:'title',title:'Group axioms',language:'en'})+'\n');
 draft.feed(JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'Groups have identities.',citations:[citation]})+'\n');
 draft.finish();return draft;
}
test('semantic node IDs verify evidence and retain hierarchy without line markers',()=>{
 const document=processedSourceDocument(file),entries=sourceDocumentEntries(document);
 const leaf=entries.find(({node})=>node.text?.includes('A group has an identity'));
 const generation=sourceGenerationDocument(document,text);
 assert.equal(JSON.stringify(generation).includes('"lines"'),false);
 assert.ok(JSON.stringify(generation).includes(leaf.node.id));
 const draft=draftFor(file,{nodeId:leaf.node.id,quote:'A group has an identity.'});
 const reference=draft.blocks[0].content.find(segment=>segment.sourceReference)?.sourceReference;
 assert.equal(reference.nodeId,leaf.node.id);
 assert.equal(citationLocation(reference),'Thm. 1');
 assert.equal(reference.excerpt,leaf.node.text);
 assert.equal(draft.blocks[0].content.some(segment=>segment.text?.includes('[L:')),false);
 assert.equal(semanticPassages(document,reference).filter(entry=>entry.cited).length,1);
 assert.notEqual(citationKey(reference),citationKey({...reference,nodeId:'another-node'}));
 for(const citation of [{nodeId:'missing'},{nodeId:leaf.node.id,quote:'Every group is cyclic.'},{startLine:5,endLine:5}]){
  const bad=draftFor(file,citation);
  assert.equal(bad.blocks[0].content.some(segment=>segment.sourceReference),false);
  assert.ok(bad.blocks[0].content.some(segment=>segment.text?.includes('[??]')));
 }
});
test('semantic citations survive validation, persistence and matching-context HTTP reads',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-semantic-citations-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db);
 const files=new SourceFiles(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
 const server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const added=files.add('default','axioms.md',Buffer.from(text));
  knowledge.create('default',{name:'Group axioms',type:'source',attachmentIds:[added.id]});await files.tick();
  const ready=files.require('default',added.id),document=processedSourceDocument(ready);
  const leaf=sourceDocumentEntries(document).find(({node})=>node.text?.includes('A group has an identity'));
  const draft=draftFor(ready,{nodeId:leaf.node.id});
  const validated=pages.validateBlocks('default',draft.blocks);
  const reference=validated[0].content.find(segment=>segment.sourceReference).sourceReference;
  assert.equal(reference.nodeId,leaf.node.id);assert.match(reference.contextLabel,/Axioms/);
  const page=pages.create('default',{title:'Citation persistence'});
  store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(validated),page.id);
  const restored=pages.get('default',page.id).blocks[0].content.find(segment=>segment.sourceReference).sourceReference;
  assert.equal(restored.nodeId,leaf.node.id);assert.equal(restored.startOffset,reference.startOffset);
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(`${base}/api/source-files/${ready.id}?fingerprint=1&context=1&sourceHash=${reference.sourceHash}`,{headers:{'X-Vault-Id':'default'}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.textHash,reference.sourceHash);assert.deepEqual(body.document,document);
  const legacy={...reference};delete legacy.nodeId;delete legacy.contextLabel;
  const legacyBlocks=[{...validated[0],content:[{text:'[L: 5]',sourceReference:legacy}]}];
  store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(legacyBlocks),page.id);
  assert.match(pages.get('default',page.id).blocks[0].content[0].sourceReference.contextLabel,/Axioms/);
  // Raw and math-cleaned versions can coexist in the same note.
  const cleaned={...ready,text:ready.text.replace('A group has an identity.','A group has an identity $e$.')};
  store.run('INSERT INTO source_math_documents(file_id,raw_hash,cleaned_text,uncertainty_json,updated_at,algorithm_version) VALUES(?,?,?,?,?,?)',ready.id,createHash('sha256').update(ready.text).digest('hex'),cleaned.text,'[]',new Date().toISOString(),2);
  const cleanedLeaf=sourceDocumentEntries(processedSourceDocument(cleaned)).find(({node})=>node.text?.includes('The identity axiom'));
  const cleanedRef=draftFor(cleaned,{nodeId:cleanedLeaf.node.id}).blocks[0].content.find(segment=>segment.sourceReference).sourceReference;
  cleanedRef.contextLabel='Outdated label';
  const mixed=[{...validated[0],content:[{text:'[ref]',sourceReference:reference},{text:'[ref]',sourceReference:cleanedRef}]}];
  enrichCitationPages(store,mixed);
  assert.match(cleanedRef.contextLabel,/Proof/);
  const cleanedResponse=await fetch(`${base}/api/source-files/${ready.id}?fingerprint=1&context=1&sourceHash=${cleanedRef.sourceHash}`,{headers:{'X-Vault-Id':'default'}});
  const cleanedBody=await cleanedResponse.json();assert.equal(cleanedBody.textHash,cleanedRef.sourceHash);
  assert.deepEqual(cleanedBody.document,processedSourceDocument(cleaned));
  store.run('UPDATE source_files SET text=? WHERE id=?','Changed source',ready.id);
  const stale=pages.get('default',page.id).blocks[0].content[0].sourceReference;
  assert.equal(stale.stale,true);
 }finally{await new Promise(resolve=>server.close(resolve));files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('semantic evidence is independent of the old thirty-line range ceiling',()=>{
 const long={...file,text:'```\n'+Array.from({length:50},(_,i)=>`item ${i}`).join('\n')+'\n```'};
 const node=sourceDocumentEntries(processedSourceDocument(long))[0].node;
 const draft=draftFor(long,{nodeId:node.id});
 const reference=draft.blocks[0].content.find(segment=>segment.sourceReference).sourceReference;
 assert.ok(reference.endLine-reference.startLine>30);
 assert.equal(reference.nodeId,node.id);
});

test('legacy exact passages in large semantic nodes retain narrow highlights',()=>{
 const text='prefix '.repeat(1000)+'A precise passage.'+' suffix'.repeat(1000);
 const markup=renderToStaticMarkup(React.createElement(SemanticPassageText,{text,cited:true,reference:{excerpt:'A precise passage.'}}));
 assert.match(markup,/<mark>A precise passage\.<\/mark>/);
 assert.ok(markup.length<500);
});

test('citation locations prefer the source’s section and subsection titles',()=>{
 const sectional={...file,text:`# Chapter 2

## Section 2.1 Groups

### 2.1.1 Identities

An identity leaves each element unchanged.`};
 const document=processedSourceDocument(sectional),leaf=sourceDocumentEntries(document).find(({node})=>node.text);
 const reference=draftFor(sectional,{nodeId:leaf.node.id}).blocks[0].content.find(segment=>segment.sourceReference).sourceReference;
 assert.equal(citationLocation(reference),'§ 2.1.1');
 assert.ok(!citationLocation(reference).includes('Paragraph'));
});

test('reference labels use shorthand and retain full saved context',()=>{
 for(const [full,short] of [
  ['Chapter 2: Groups › Section 2.1 Groups › Theorem 2.3.','Thm. 2.3'],
  ['Chapter IV: Examples','Ch. IV'],
  ['Introduction › Lemma A.2','Lem. A.2'],
  ['Groups › Proposition 4.1','Prop. 4.1'],
  ['Groups › Corollary 3','Cor. 3'],
  ['Groups › Definition 2','Def. 2'],
  ['Groups › Example 7','Ex. 7'],
  ['Chapter 2 › Section 2.1 Identity › Proof.','§ 2.1 · Proof'],
  ['Chapter 2 › Identity and inverse › Paragraph','Identity and inverse'],
 ])assert.equal(citationContextLabel(full),short);
 const ref={contextLabel:'Chapter 1 › Section 1.2 Groups › Theorem 1.3.',startPage:4,endPage:4};
 assert.equal(citationLocation(ref),'Thm. 1.3 · p. 4');
 assert.equal(ref.contextLabel,'Chapter 1 › Section 1.2 Groups › Theorem 1.3.');
 assert.equal(citationLocation({...ref,contextLabel:'Paragraph'}),'p. 4');
 assert.equal(citationContextLabel('Chapter Introduction'),'Chapter Introduction');
});
