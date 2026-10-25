import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourcePages,SourcePageDraft} from '../src/server/modules/source-pages.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {materializeSourceRevision,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {sourceTextHash} from '../src/server/modules/source-math-text.ts';

async function fixture(t){
 const directory=mkdtempSync(path.join(tmpdir(),'noema-reading-revisions-')),db=openDatabase(path.join(directory,'db.sqlite')),store=new Store(db),files=new SourceFiles(store),reading=new SourceReading(store);
 t.after(()=>{files.close();db.close();rmSync(directory,{recursive:true,force:true});});
 const added=files.add('default','annotation-revisions.md',Buffer.from('# Synthetic geometry\n\nA brief introduction.\n\nA fictional triangle has three invented sides and supports a unique geometric proof.\n\nA closing observation gives enough distinct context to resolve the saved reading position.'));
 const source=new Knowledge(store).create('default',{type:'source',name:'Synthetic geometry',attachmentIds:[added.id]});await files.tick();
 const file=files.require('default',added.id),original={text:file.text,document:processedSourceDocument(file)};
 function selection(text,excerpt,revisionId){const startOffset=text.indexOf(excerpt);assert.ok(startOffset>=0);return {sourceId:source.id,fileId:file.id,sourceHash:sourceTextHash(text),startOffset,endOffset:startOffset+excerpt.length,excerpt,...(revisionId?{revisionId}:{})};}
 function revision(edits){
  const id=randomUUID(),timestamp=new Date().toISOString(),r={id,fileId:file.id,createdAt:timestamp,updatedAt:timestamp,status:'completed',instructions:'Synthetic annotation persistence fixture',baseHash:sourceRevisionBaseHash(original),stale:false,original:structuredClone(original),reprocessed:structuredClone(original),patches:edits.map(([before,after])=>{const startOffset=file.text.indexOf(before);assert.ok(startOffset>=0);return {id:randomUUID(),nodeIds:[],range:{startOffset,endOffset:startOffset+before.length,startLine:1,endLine:1},original:before,replacement:after,category:'formatting',reason:'Synthetic revision fixture',confidence:1,decision:'accepted'};}),report:{promptVersion:'fixture',model:'fixture',reasoningEffort:'low',startedAt:timestamp,finishedAt:timestamp,durationMs:0,chunksTotal:1,chunksCompleted:1,charactersTotal:file.text.length,charactersReviewed:file.text.length,inputTokens:null,outputTokens:null,reasoningTokens:null,cachedInputTokens:null,diagnostics:[],error:null}};
  materializeSourceRevision(r);
  store.run('INSERT INTO source_reprocessing (id,file_id,vault_id,status,created_at,updated_at,payload) VALUES (?,?,?,?,?,?,?)',id,file.id,'default','completed',timestamp,timestamp,JSON.stringify(r));r.versionNumber=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',id).payload).versionNumber;return r;
 }
 return {store,files,reading,file,source,original,selection,revision,sources:new SourcePages(store,new Knowledge(store),new Pages(store,new Knowledge(store)))};
}

test('page generation selects accepted revision text and markup without metadata or classified furniture',async t=>{
 const f=await fixture(t),r=f.revision([['three invented sides','three $\\sqrt{3}$ sides']]);
 r.furniture=[{id:'header',startOffset:f.file.text.indexOf('A brief introduction.'),endOffset:f.file.text.indexOf('A brief introduction.')+'A brief introduction.'.length,text:'A brief introduction.',page:1,kind:'header',hidden:false,reason:'Fixture classified header'}];
 f.store.run('UPDATE source_reprocessing SET payload=? WHERE id=?',JSON.stringify(r),r.id);
 const prepared=f.sources.prepare('default',f.source.id,{requestId:randomUUID(),sourceRevisionId:r.id}),payload=JSON.parse(prepared.input);
 const text=JSON.stringify(payload.untrusted_source);
 assert.match(text,/sqrt/);assert.ok(!text.includes('three invented sides'));assert.ok(!text.includes('A brief introduction.'));
 assert.deepEqual(Object.keys(payload.untrusted_source),['document']);assert.ok(!text.includes('coordinates'));assert.ok(!text.includes('physical'));assert.ok(!text.includes('processing'));
 assert.equal(prepared.sourceRevisionId,r.id);
 const versions=f.sources.versions('default',f.source.id);assert.equal(versions.fileId,f.file.id);assert.equal(versions.versions[0].id,'');assert.ok(versions.versions.some(item=>item.id===r.id));
 const original=f.sources.prepare('default',f.source.id,{requestId:randomUUID()});assert.match(original.input,/three invented sides/);
 assert.throws(()=>f.sources.prepare('default',f.source.id,{requestId:prepared.requestId,sourceRevisionId:42}),{status:400});
});
test('revision citations are verified against revised nodes and stored against original text',async t=>{
 const f=await fixture(t),r=f.revision([['three invented sides','three carefully invented sides']]);
 const prepared=f.sources.prepare('default',f.source.id,{requestId:randomUUID(),sourceRevisionId:r.id});
 const entry=sourceDocumentEntries(prepared.sourceVersion.document).find(entry=>entry.node.text?.includes('three carefully'));
 const draft=new SourcePageDraft(()=>{},prepared.sourceVersion.file.text,prepared.sourceVersion.file,'',prepared.sourceVersion.document);
 draft.feed(JSON.stringify({type:'title',title:'An example',language:'en'})+'\n');
 draft.feed(JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'The triangle has three sides.',citations:[{nodeId:entry.node.id,quote:'three carefully invented sides'}]})+'\n');draft.finish();
 const review=f.sources.stage('default',prepared,draft,'fixture');
 assert.equal(review.sourceRevisionId,r.id);assert.equal(f.sources.latest('default',f.source.id).sourceRevisionId,r.id);
 const ref=review.blocks.flatMap(block=>block.content).find(segment=>segment.sourceReference).sourceReference;
 assert.equal(ref.sourceHash,sourceTextHash(f.file.text));assert.match(ref.excerpt,/three invented sides/);assert.equal(f.file.text.slice(ref.startOffset,ref.endOffset),ref.excerpt);
 const accepted=f.sources.accept('default',f.source.id,review.id);assert.ok(accepted.created);
 assert.equal(accepted.page.blocks.flatMap(block=>block.content).find(segment=>segment.sourceReference).sourceReference.stale,false);
});
test('unavailable revisions are excluded and request fingerprints distinguish source versions',async t=>{
 const f=await fixture(t),r=f.revision([['three invented sides','three imagined sides']]),requestId=randomUUID();
 const prepared=f.sources.prepare('default',f.source.id,{requestId,sourceRevisionId:r.id});
 const node=sourceDocumentEntries(prepared.sourceVersion.document).find(entry=>entry.node.text?.includes('three imagined')).node;
 const draft=new SourcePageDraft(()=>{},prepared.sourceVersion.file.text,prepared.sourceVersion.file,'',prepared.sourceVersion.document);
 draft.feed(JSON.stringify({type:'title',title:'An example',language:'en'})+'\n'+JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'An example.',citations:[{nodeId:node.id}]})+'\n');draft.finish();f.sources.stage('default',prepared,draft,'fixture');
 assert.throws(()=>f.sources.prepare('default',f.source.id,{requestId}),{status:409});
 f.store.run("UPDATE source_reprocessing SET status='running',payload=json_set(payload,'$.status','running') WHERE id=?",r.id);
 assert.deepEqual(f.sources.versions('default',f.source.id).versions.map(item=>item.id),['']);
 assert.throws(()=>f.sources.prepare('default',f.source.id,{requestId:randomUUID(),sourceRevisionId:r.id}),{status:409});
 assert.throws(()=>f.sources.prepare('default',f.source.id,{requestId:randomUUID(),sourceRevisionId:randomUUID()}),{status:404});
});
