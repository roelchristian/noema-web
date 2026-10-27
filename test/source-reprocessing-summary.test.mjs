import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupSourceReprocessingSummarySchema} from '../src/server/source-reprocessing-summary-schema.ts';
import {SourceReprocessing} from '../src/server/modules/source-reprocessing.ts';
import {Store} from '../src/server/store.ts';

const table=`CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT)`;
const snapshot='Synthetic academic document. '.repeat(10000);
const revision=id=>({id,fileId:'f',createdAt:id,updatedAt:id,status:'completed',baseHash:'base',instructions:'Preserve evidence',furniture:[{text:snapshot,hidden:false}],patches:[{decision:'pending'},{decision:'accepted'},{decision:'rejected'}],original:{text:snapshot},reprocessed:{text:snapshot},nodeLinks:[{originalNodeId:'a',reprocessedNodeIds:['b']}],report:{chunksCompleted:2,chunksTotal:2,diagnostics:['Scholarly observation'],validationDiagnostics:['Detail only'],excerpts:[{index:0,attemptHistory:[{error:'detail'}]}]}});
const insert=(db,r,vault='v')=>db.prepare('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)').run(r.id,r.fileId,vault,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));

test('revision summary migration preserves full legacy payload and maintains counts on insert, review and resume',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(table);const r=revision('legacy');insert(db,r);const original=JSON.stringify(r);
  setupSourceReprocessingSummarySchema(db);setupSourceReprocessingSummarySchema(db);
  let row=db.prepare('SELECT payload,summary_json FROM source_reprocessing WHERE id=?').get(r.id),summary=JSON.parse(row.summary_json);
  assert.equal(row.payload,original);assert.equal(summary.patchCount,3);assert.equal(summary.pendingCount,1);assert.equal(summary.original,undefined);assert.equal(summary.reprocessed,undefined);assert.equal(summary.patches,undefined);assert.equal(summary.nodeLinks,undefined);assert.equal(summary.furniture,undefined);assert.deepEqual(summary.report.diagnostics,[]);assert.equal(summary.report.excerpts,undefined);assert.equal(summary.report.validationDiagnostics,undefined);assert.ok(row.summary_json.length<1000);
  r.status='queued';r.updatedAt='updated';r.patches[0].decision='accepted';
  db.prepare('UPDATE source_reprocessing SET status=?,updated_at=?,payload=? WHERE id=?').run(r.status,r.updatedAt,JSON.stringify(r),r.id);
  summary=JSON.parse(db.prepare('SELECT summary_json FROM source_reprocessing WHERE id=?').get(r.id).summary_json);
  assert.equal(summary.status,'queued');assert.equal(summary.pendingCount,0);assert.equal(summary.patchCount,3);assert.equal(summary.updatedAt,'updated');
  const restored=revision('restored');restored.patches=[];insert(db,restored);
  summary=JSON.parse(db.prepare('SELECT summary_json FROM source_reprocessing WHERE id=?').get(restored.id).summary_json);assert.equal(summary.patchCount,0);assert.equal(summary.pendingCount,0);
 }finally{db.close();}
});

test('revision list loads at most 100 persisted summaries scoped to file and vault without fetching snapshots',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(table);setupSourceReprocessingSummarySchema(db);
  for(let i=0;i<105;i++)insert(db,revision(String(i).padStart(3,'0')));
  insert(db,revision('foreign-vault'),'other');
  const foreign=revision('foreign-file');foreign.fileId='other';insert(db,foreign);
  const queries=[],store=new Store(db),all=store.all.bind(store);store.all=(sql,...args)=>{queries.push(sql);return all(sql,...args);};
  const service=new SourceReprocessing(store,{require:()=>({})},{},()=>{},{});service.currentHash=()=> 'base';queries.length=0;
  const list=service.list('v','f');assert.equal(list.length,100);assert.equal(list[0].id,'104');assert.equal(list.at(-1).id,'005');assert.ok(list.every(item=>item.stale===false&&item.patchCount===3&&item.pendingCount===1));
  assert.ok(queries.every(sql=>!/SELECT\s+\*|\bpayload\b/i.test(sql)));assert.ok(queries.some(sql=>/summary_json/.test(sql)));assert.ok(JSON.stringify(list).length<100000);
 }finally{db.close();}
});

test('reading representation retains presentation/mappings while omitting comparison evidence and diagnostics',async()=>{
 const {sourceReadingPresentation}=await import('../src/shared/source-reprocessing.ts');
 const value=revision('reading');value.original.document={heavyEvidence:snapshot};value.patches=[{id:'accepted',nodeIds:['n'],decision:'accepted',original:snapshot,replacement:snapshot,reason:snapshot},{id:'pending',nodeIds:['n'],decision:'pending'}];
 const reading=sourceReadingPresentation(value);
 assert.equal(reading.original.text,value.original.text);assert.equal(reading.reprocessed,value.reprocessed);assert.equal(reading.nodeLinks,value.nodeLinks);
 assert.deepEqual(reading.patches,[{id:'accepted',nodeIds:['n'],decision:'accepted'}]);assert.deepEqual(reading.report,{chunksCompleted:2,chunksTotal:2});
 assert.equal(reading.original.document,undefined);assert.equal(reading.instructions,undefined);assert.equal(reading.report.diagnostics,undefined);
 assert.ok(JSON.stringify(reading).length<JSON.stringify(value).length/2);
});

test('compact attachment projection whitelists bounded public scalars and fingerprints omitted document content',async()=>{
 const {sourceFileStatus}=await import('../src/server/modules/source-file-status.ts');
 const file={id:'file',vault_id:'vault',entity_id:'source',name:'name'.repeat(100),original_filename:'upload.pdf',generated_name:null,language:null,format:'pdf',size:100,status:'ready',admitted:1,progress:100,pages:1,ocr_pages:0,error:'e'.repeat(10000),enrichment_status:'completed',enrichment_error:null,enrichment_attempts:0,enrichment_next_attempt_at:'',created_at:'now',contains_math:0,pdf_flattened:0,import_method:'upload',source_url:null,ingestion_origin:'local',active_ingestion_run:null,text:'secret document'.repeat(10000),structural_nodes:'large structure'.repeat(1000),page_start_lines:'[1]',summary:'full summary',staging_key:'private-key',staging_config_json:'private-provider-config',future_internal_field:{private:true}};
 const status=sourceFileStatus(file);
 assert.equal(status.text,'');assert.equal(status.summary,null);assert.equal(status.name.length,200);assert.equal(status.error.length,2000);
 for(const key of ['structural_nodes','page_start_lines','staging_key','staging_config_json','future_internal_field'])assert.equal(Object.hasOwn(status,key),false,key);
 assert.ok(JSON.stringify(status).length<4000);assert.match(status.contentVersion,/^[a-f0-9]{64}$/);
 assert.notEqual(sourceFileStatus({...file,text:file.text+'changed'}).contentVersion,status.contentVersion);
 assert.equal(sourceFileStatus({...file,progress:75}).contentVersion,status.contentVersion,'progress alone does not change reading identity');
});

test('compact attachment inventory reads only explicit columns and retains vault/source isolation',async()=>{
 const {sourceFileStatuses}=await import('../src/server/modules/source-file-status.ts');const reads=[];
 const store={get:(sql,...args)=>{assert.deepEqual(args,['source','vault']);assert.match(sql,/vault_id=\?/);return {id:'source'};},all:(sql,...args)=>{reads.push(sql);assert.deepEqual(args,['vault','source']);return [];}};
 assert.deepEqual(sourceFileStatuses(store,'vault','source'),[]);assert.equal(reads.length,1);assert.doesNotMatch(reads[0],/SELECT\s+\*|staging|summary/i);
 assert.throws(()=>sourceFileStatuses({...store,get:()=>undefined},'vault','source'),/Source not found/);assert.equal(reads.length,1,'foreign/missing sources never query attachment inventory');
});

test('compact attachment polling retains scalar math progress without changing readable identity',async()=>{
 const {sourceFileStatus}=await import('../src/server/modules/source-file-status.ts');
 const {sourceProgress}=await import('../src/server/modules/source-progress.ts');
 const file={id:'compact-math-progress',vault_id:'vault',entity_id:'source',name:'math.pdf',original_filename:'math.pdf',generated_name:null,language:null,format:'pdf',size:100,status:'ready',admitted:1,progress:100,pages:1,ocr_pages:0,error:null,enrichment_status:'running',enrichment_error:null,enrichment_attempts:1,enrichment_next_attempt_at:'',created_at:'now',contains_math:1,pdf_flattened:0,import_method:'upload',source_url:null,text:'private canonical math',structural_nodes:'[]',page_start_lines:'[1]'};
 const before=sourceFileStatus(file);
 try{
  sourceProgress.set(file.id,{phase:'math',completed:1,total:3,startedAt:100,updatedAt:200,estimatedRemainingSeconds:20,privateProviderPayload:{text:'secret'}});
  const during=sourceFileStatus(file);
  assert.deepEqual(during.processing_detail,{phase:'math',completed:1,total:3,startedAt:100,updatedAt:200,estimatedRemainingSeconds:20});
  assert.equal(during.contentVersion,before.contentVersion);
  assert.doesNotMatch(JSON.stringify(during),/private canonical math|privateProviderPayload|secret/);
  sourceProgress.set(file.id,{phase:'math',completed:2,total:3,startedAt:100,updatedAt:300,estimatedRemainingSeconds:Infinity});
  assert.equal(sourceFileStatus(file).processing_detail.completed,2);
  assert.equal(Object.hasOwn(sourceFileStatus(file).processing_detail,'estimatedRemainingSeconds'),false);
 }finally{sourceProgress.delete(file.id);}
 assert.equal(sourceFileStatus(file).processing_detail,undefined);
});
