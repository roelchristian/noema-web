import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleSourceIngestionDocument} from '../src/server/modules/source-ingestion-assembly.ts';
import {createSourceIngestionCorrectionRevision} from '../src/server/modules/source-ingestion-corrections.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {materializeSourceRevision,sourceRevisionBaseHash} from '../src/server/modules/source-reprocessing.ts';
import {restoreSourceRevision,restoreReprocessingCheckpoints} from '../src/server/modules/source-reprocessing-backup.ts';
const options={runId:'synthetic-run',documentId:'synthetic-document',model:'synthetic-provider-model',reviewPolicy:'verified',depth:'balanced'};
function fixture(text='The ﬁrst source paragraph preserves its words.',repair={original:'ﬁrst',replacement:'first',category:'ocr'}){
 const start=text.indexOf(repair.original);
 const ir={schemaVersion:1,metadata:{title:null,language:'en',synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'iv',role:'owned',state:'content',unresolved:[]}],blocks:[{id:'b1',page:1,order:0,kind:'paragraph',text,headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[],repairs:repair? [{blockId:'b1',start,end:start+repair.original.length,...repair,reason:'Synthetic fixture'}]:[]};
 const assembly=assembleSourceIngestionDocument(ir,{extractionId:'synthetic-extraction'});
 const file={id:'synthetic-file',vault_id:'default',name:'synthetic.pdf',original_filename:'synthetic.pdf',generated_name:null,format:'pdf',language:'en',source_url:null,text:assembly.text,pages:1,structural_nodes:'[]',page_start_lines:JSON.stringify(assembly.pageStartLines),enrichment_status:'completed'};
 const document=processedSourceDocument(file);
 return {ir,assembly,file,document,revision:(configuration=options)=>createSourceIngestionCorrectionRevision(file,document,assembly,configuration)};
}
test('clean transcription does not allocate an editorial revision',()=>{
 const f=fixture();f.assembly.repairs=[];
 assert.equal(f.revision(),null);
});
test('Verified accepts equivalent ligatures with reversible automatic audit and no generation chunks',()=>{
 const f=fixture(),r=f.revision();assert.equal(r.status,'completed');assert.equal(r.origin.documentId,options.documentId);
 assert.equal(r.report.chunksTotal,0);assert.equal(r.report.inputTokens,null);
 assert.equal(r.patches[0].decision,'accepted');assert.ok(r.patches[0].autoAcceptance.checks.includes('exact-ligature-soft-hyphen-or-nonbreaking-space-equivalence'));
 assert.equal(r.patches[0].decisionHistory[0].actor,'automatic');assert.match(r.reprocessed.text,/first source/);assert.equal(r.original.text,f.file.text);
 r.patches[0].decision='rejected';materializeSourceRevision(r);assert.equal(r.reprocessed.text,r.original.text);
});
test('Review all leaves sparse mechanical candidates pending without diffing the baseline',()=>{
 const f=fixture(),r=f.revision({...options,reviewPolicy:'review-all'});
 assert.equal(r.patches.length,1);assert.equal(r.patches[0].decision,'pending');assert.equal(r.reprocessed.text,r.original.text);assert.equal(r.patches[0].autoAcceptance,undefined);
});
test('uncertain word and number substitutions never acquire independent OCR proof',()=>{
 for(const [text,original,replacement] of [['The rnark remains as printed.','rn','m'],['There are 19 items.','19','20']]){
  const f=fixture(text,{original,replacement,category:'ocr'}),r=f.revision();assert.equal(r.patches[0].decision,'pending');assert.equal(r.patches[0].confidence,0);assert.equal(r.patches[0].autoAcceptance,undefined);
 }
});
test('exact offsets disambiguate duplicate text and preserve non-BMP coordinates',()=>{
 const f=fixture('😀 ﬁrst ﬁrst',{original:'ﬁrst',replacement:'first',category:'ocr'}),r=f.revision();
 assert.equal(r.original.text.slice(r.patches[0].range.startOffset,r.patches[0].range.endOffset),'ﬁrst');
 assert.match(r.reprocessed.text,/😀 first ﬁrst/);assert.equal(r.patches[0].range.startPage,1);
});
test('invalid or overlapping candidates and provider page-marker injection fail closed',()=>{
 const f=fixture();f.assembly.repairs[0].original='unrelated';assert.throws(()=>f.revision(),/invalid exact canonical evidence/);
 const g=fixture();g.assembly.repairs.push({...g.assembly.repairs[0]});assert.throws(()=>g.revision(),/overlap/);
 const h=fixture();h.assembly.repairs[0].replacement='<!-- Page 2 -->';assert.throws(()=>h.revision(),/physical page markers/);
});
test('large ingestion correction and backup restore exceed legacy 512K scheduler ceiling without generation checkpoints',()=>{
 const f=fixture('The ﬁrst source paragraph.\n\n'+'Ordinary synthetic text. '.repeat(24000)),r=f.revision();assert.ok(r.original.text.length>512000);
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file');
 assert.equal(restored.original.text,r.original.text);assert.equal(restored.reprocessed.text,r.reprocessed.text);assert.equal(restored.origin.kind,'ingestion');
 assert.deepEqual(restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[],[]),{chunks:[],passes:[]});
 assert.throws(()=>restoreReprocessingCheckpoints(restored,r.id,r.baseHash,[{}],[]));
});
test('legacy backup readers keep their historical size ceiling',()=>{
 const f=fixture('The ﬁrst source paragraph.\n\n'+'Ordinary synthetic text. '.repeat(24000)),r=f.revision();delete r.origin;
 assert.throws(()=>restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file'),/invalid source editorial revision/);
});
function addRich(f){
 f.document.semantic.children=structuredClone(f.assembly.semanticNodes);
 f.document.ingestion={documentId:options.documentId,contentHash:f.assembly.contentHash,assemblyVersion:1,relations:f.assembly.relations,blocks:f.ir.blocks.map(block=>({...block,immutableId:f.assembly.blockRanges.find(value=>value.temporaryId===block.id).id})),pages:f.ir.pages,provenance:{provider:'openai',requestedModel:'synthetic',returnedModel:'synthetic',schemaVersion:1,promptVersion:'pdf-transcription-1',originalHash:'1'.repeat(64),admittedHash:'2'.repeat(64),transmittedHash:'3'.repeat(64),responseHash:'4'.repeat(64),coverage:'checked',independentEvidence:'not-checked',userReviewed:false}};
 return f;
}
test('rich revision retains immutable transcription and explicitly maps changed reading blocks',()=>{
 const f=addRich(fixture()),r=f.revision(),originalId=f.document.semantic.children[0].id;
 assert.equal(r.reprocessed.document.ingestion.blocks[0].text,f.ir.blocks[0].text);
 assert.notEqual(r.reprocessed.document.semantic.children[0].id,originalId);
 assert.equal(r.reprocessed.document.ingestion.readingMapping.nodes[0].readingId,r.reprocessed.document.semantic.children[0].id);
 assert.match(r.reprocessed.document.semantic.children[0].text,/first/);
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file');
 assert.equal(restored.original.document.ingestion.blocks[0].immutableId,originalId);
 assert.match(restored.reprocessed.document.semantic.children[0].text,/first/);
});
test('rich archive refuses an unmatched block, invalid page, or invented exact geometry',()=>{
 for(const mutate of [r=>{r.original.document.ingestion.blocks[0].text='invented';},r=>{r.original.document.ingestion.pages[0].number=2;},r=>{r.original.document.ingestion.blocks[0].location={x:0,y:0,width:1,height:1,accuracy:'native'};}]){
  const f=addRich(fixture()),r=f.revision();mutate(r);
  // Recompute to test the additive rich validator independently of the base digest guard.
  r.baseHash=(sourceRevisionBaseHash(r.original));for(const patch of r.patches)patch.baseHash=r.baseHash;
  assert.throws(()=>restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file'),/invalid source editorial revision/);
 }
});
test('metadata reconciliation preserves manual values, registers AI evidence for review, and is repeat-safe',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {openDatabase}=await import('../src/server/database.ts');const {Store}=await import('../src/server/store.ts');
 const {SourceFiles}=await import('../src/server/modules/source-files.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');
 const {SourceMetadata}=await import('../src/server/modules/source-metadata.ts');const {Bibliography}=await import('../src/server/modules/bibliography.ts');
 const {reconcileSourceIngestion}=await import('../src/server/modules/source-ingestion-corrections.ts');
 const directory=mkdtempSync(join(tmpdir(),'noema-ingestion-metadata-')),db=openDatabase(join(directory,'synthetic.sqlite')),store=new Store(db),files=new SourceFiles(store);
 t.after(()=>{files.close();db.close();rmSync(directory,{recursive:true,force:true});});
 const f=fixture('Synthetic title\nPublisher: Archive Press\nAuthor: Jane Synthetic\n\nThe ﬁrst paragraph preserves source wording.');
 f.ir.metadata.title='Synthetic title';f.ir.metadata.bibliographic=[{field:'publisher',value:'Archive Press',page:1,blockId:'b1'}];f.ir.metadata.contributors=[{name:'Jane Synthetic',role:'author',page:1,blockId:'b1'}];
 const staged=files.add('default','synthetic.md',Buffer.from(f.assembly.text)),source=new Knowledge(store).create('default',{name:'Manually chosen source name',type:'source',attachmentIds:[staged.id]});
 store.run("UPDATE source_files SET status='ready',text=?,admitted=1,enrichment_status='completed' WHERE id=?",f.assembly.text,staged.id);
 const file=files.require('default',staged.id),metadata=new SourceMetadata(store);metadata.setPolicy('default',source.id,'fill_validated_empty');
 const publisher=metadata.snapshot('default',source.id).fields.find(field=>field.key==='bibliography:publisher');metadata.save('default',source.id,{fieldKey:publisher.key,fingerprint:publisher.fingerprint,value:'Manual Press'});
 const reconcile=()=>store.transaction(()=>reconcileSourceIngestion(store,file,f.ir,f.assembly,options));
 const first=reconcile(),second=reconcile();assert.equal(first.revision.id,second.revision.id);assert.equal(store.get('SELECT count(*) n FROM source_reprocessing WHERE file_id=?',file.id).n,1);
 assert.equal(new Bibliography(store).get('default',source.id).fields.publisher,'Manual Press');assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,'Manually chosen source name');
 const snapshot=metadata.snapshot('default',source.id),proposal=snapshot.fields.find(field=>field.key==='bibliography:publisher').proposals.find(value=>value.value==='Archive Press');
 assert.ok(proposal);assert.equal(proposal.compatible,false);assert.equal(snapshot.fields.find(field=>field.key==='bibliography:author').value,'Jane Synthetic');
 assert.ok(first.metadataPending>0);assert.equal(store.get('SELECT count(*) n FROM source_reprocessing WHERE file_id=?',file.id).n,1);
});
