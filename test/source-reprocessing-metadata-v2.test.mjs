// Real metadata owner and SQLite; all model requests are synthetic in-memory responses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceReprocessing} from '../src/server/modules/source-reprocessing.ts';
import {SourceMetadata} from '../src/server/modules/source-metadata.ts';
import {SourceMetadataExtraction} from '../src/server/modules/source-metadata-extraction.ts';

function fixture(t,provider=request=>JSON.stringify({blocks:request.blocks,diagnostics:[],unresolved:false}),customText){
 const db=openDatabase(':memory:'),store=new Store(db);t.after(()=>db.close());
 const text=customText??'Title: Synthetic Publication\nPublisher: Synthetic Press\nPublication year: 2026\n\n'+'Ordinary words remain exactly as printed.\n'.repeat(280);
 store.run("INSERT INTO entities(id,vault_id,name,type,updated_at) VALUES('metadata-source','default','Source display name','source','2026-01-01')");
 store.run("INSERT INTO source_files(id,vault_id,entity_id,name,generated_name,size,status,text,created_at,format,admitted,enrichment_status) VALUES('metadata-file','default','metadata-source','Synthetic.txt','Synthetic Publication',1,'ready',?,'2026-01-01','txt',1,'completed')",text);
 const file=store.get("SELECT * FROM source_files WHERE id='metadata-file'"),metadata=new SourceMetadata(store),extraction=new SourceMetadataExtraction(store,metadata),versions=[],calls=[],activityObjects=[];
 const process=extraction.process.bind(extraction);extraction.process=(vault,sourceId,revision,version)=>{
  versions.push(version);
  if(version==='editorial')assert.equal(JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE id=?',revision.id).payload).reprocessed.text,revision.reprocessed.text,'Derivative is persisted before metadata owner receives its evidence');
  return process(vault,sourceId,revision,version);
 };
 const intelligence={editorialSelection:()=>({model:'gpt-5-mini',reasoningEffort:'low'}),reeditSource:async(input,_instructions,signal)=>{const request=JSON.parse(input);calls.push(request);if(request.kind==='synthesis')return JSON.stringify({observations:[]});return provider(request,signal);}};
 const service=new SourceReprocessing(store,{require:()=>file},intelligence,()=>{}, {start:(_action,_selection,_vault,id)=>{activityObjects.push(id);return 1;},request:()=>({}),finish(){}},extraction);
 t.after(()=>service.close());
 const revision=service.start('default',file.id,{pipelineVersion:2,configuration:{depth:'balanced',reviewPolicy:'verified',evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}}});
 return {store,text,file,metadata,versions,calls,activityObjects,service,revision,get value(){return service.detail('default',file.id,revision.id);}};
}

test('V2 reconciles real owner metadata once per document across multiple balanced chunks',async t=>{
 const env=fixture(t);await env.service.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(result.report.chunksTotal,2);assert.equal(env.calls.length,5);assert.deepEqual(env.versions,['canonical']);assert.ok(env.activityObjects.every(id=>id==='metadata-source'));assert.equal(env.activityObjects.length,5);
 assert.equal(result.report.metadata.candidateCount,3);assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_extraction_cache').n,1);assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_candidates').n,3);
 assert.equal(result.original.text,env.text);assert.equal(result.reprocessed.text,env.text);assert.equal(env.store.get("SELECT name FROM entities WHERE id='metadata-source'").name,'Source display name');
});

test('V2 cancellation retains document metadata without per-chunk extraction or publishing unfinished text',{timeout:2000},async t=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const env=fixture(t,(_request,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Synthetic cancellation')),{once:true});entered();}));
 const work=env.service.tick();await started;env.service.cancel('default',env.file.id,env.revision.id);await work;
 assert.equal(env.value.status,'interrupted');assert.deepEqual(env.versions,['canonical']);assert.equal(env.calls.length,2);assert.equal(env.value.report.metadata.candidateCount,3);assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_extraction_cache').n,1);assert.equal(env.value.reprocessed.text,env.text);
});

test('V2 manual acceptance persists the derivative before real metadata reconciliation and reuses unchanged evidence',async t=>{
 const env=fixture(t,request=>JSON.stringify({blocks:request.blocks.map(block=>({...block,text:block.text.replace('Synthetic Press','Restored Press')})),diagnostics:[],unresolved:false}));
 await env.service.tick();const before=env.value;assert.equal(before.status,'completed');assert.deepEqual(env.versions,['canonical']);assert.ok(before.patches.length>=1);assert.ok(before.patches.every(patch=>patch.decision==='pending'));
 const reviewed=env.service.review('default',env.file.id,before.id,{updatedAt:before.updatedAt,decisions:before.patches.map(patch=>({patchId:patch.id,decision:'accepted'}))});
 assert.deepEqual(env.versions,['canonical','editorial']);assert.match(reviewed.reprocessed.text,/Publisher: Restored Press/);assert.equal(env.store.get("SELECT text FROM source_files WHERE id='metadata-file'").text,env.text);
 const publisher=env.metadata.snapshot('default','metadata-source').fields.find(field=>field.key==='bibliography:publisher');
 const proposal=publisher.proposals.find(value=>value.value==='Restored Press');assert.ok(proposal);assert.equal(proposal.evidence[0].version,'editorial');assert.equal(proposal.evidence[0].runId,before.id);assert.equal(publisher.value,null);
 assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_extraction_cache').n,2);
 const candidates=env.store.get('SELECT count(*) n FROM source_metadata_candidates').n;
 env.service.review('default',env.file.id,reviewed.id,{updatedAt:reviewed.updatedAt,decisions:before.patches.map(patch=>({patchId:patch.id,decision:'accepted'}))});
 assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_candidates').n,candidates);assert.equal(env.store.get('SELECT count(*) n FROM source_metadata_extraction_cache').n,2);assert.equal(env.calls.length,5);
});


test('balanced extracts reviewable metadata from unlabeled cover text even when reading text is unchanged',async t=>{
 const text='INTERNATIONAL EXAMPLE COURT\nTHE PRESIDENCY\nDecision constituting Trial Chamber III\nDate: 24 April 2026\nOriginal: English\n';
 const env=fixture(t,request=>JSON.stringify({blocks:request.blocks,diagnostics:[],unresolved:false,metadata:[
  {field:'title',value:'Decision constituting Trial Chamber III',blockId:request.blocks[0].id,quote:'Decision constituting Trial Chamber III',reason:'The document title printed on its cover.'},
  {field:'author',value:'International Example Court, Presidency',blockId:request.blocks[0].id,quote:'INTERNATIONAL EXAMPLE COURT\nTHE PRESIDENCY',reason:'Issuing institution and body, not an individual judge.'},
  {field:'date',value:'2026-04-24',blockId:request.blocks[0].id,quote:'Date: 24 April 2026',reason:'The document date, not a cited decision or filing stamp.'}
 ]}),text);
 await env.service.tick();const result=env.value;
 assert.equal(result.status,'completed');assert.equal(env.calls.length,3);assert.equal(result.reprocessed.text,text);
 const snapshot=env.metadata.snapshot('default','metadata-source');
 for(const key of ['title','author','date']){
  const field=snapshot.fields.find(field=>field.key==='bibliography:'+key);assert.equal(field.proposals.length,1);assert.equal(field.value,null);
  const evidence=field.proposals[0].evidence[0];assert.equal(evidence.validated,false);assert.equal(text.slice(evidence.start,evidence.end),evidence.excerpt);assert.equal(evidence.version,'canonical');
 }
 assert.equal(result.report.metadata.candidateCount,3);assert.equal(result.report.metadata.requiresReview,3);
 const extraction=new SourceMetadataExtraction(env.store,env.metadata);extraction.processModelCandidates('default','metadata-source',result);assert.equal(result.report.metadata.candidateCount,3);
});

test('metadata uses the final verified candidates and excludes invented or ambiguous canonical evidence',async t=>{
 const env=fixture(t,request=>JSON.stringify({blocks:request.blocks,diagnostics:[],unresolved:false,metadata:[{field:'language',value:'English',blockId:request.blocks[0].id,quote:request.kind==='verify'?'invented evidence':'Ordinary words remain exactly as printed.',reason:'Claimed language.'}]}));
 await env.service.tick();const result=env.value;assert.equal(result.status,'completed');
 assert.equal(env.metadata.snapshot('default','metadata-source').fields.find(field=>field.key==='bibliography:language').proposals.length,0);
 assert.ok(result.report.diagnostics.some(message=>message.includes('metadata candidate was excluded')));
});


test('metadata from completed verification survives a sibling excerpt failure',async t=>{
 const env=fixture(t,request=>JSON.stringify({blocks:request.chunkIndex===1?[]:request.blocks,diagnostics:[],unresolved:false,metadata:[{field:'language',value:'English',blockId:request.blocks[0].id,quote:'Title: Synthetic Publication',reason:'The cover title is in English.'}]}));
 await env.service.tick();const result=env.value;assert.equal(result.status,'failed');assert.equal(result.report.chunksCompleted,1);
 const field=env.metadata.snapshot('default','metadata-source').fields.find(field=>field.key==='bibliography:language');assert.equal(field.proposals.length,1);assert.equal(field.proposals[0].evidence[0].validated,false);
});
