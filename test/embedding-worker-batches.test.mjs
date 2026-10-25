import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {Intelligence,GenerationProviderError,EmbeddingAdmissionError} from '../src/server/modules/intelligence.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';

const vector=Array.from({length:1536},(_,i)=>i%2?-0.022552490234375:0.051544189453125);
async function fixture(t,count) {
 const dir=mkdtempSync(path.join(tmpdir(),'noema-worker-batches-')),filename=path.join(dir,'index.sqlite');
 const requests=[],successfulInputs=[];
 let db,store,pages,vaults,worker,handler;
 const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 const ai=new Intelligence(secrets,async(_url,options)=>{
  const inputs=JSON.parse(options.body).input;requests.push(inputs);
  const failure=handler?.(inputs,requests.length);if(failure)return failure;
  successfulInputs.push(...inputs);
  // Reverse provider order to exercise the index-to-job mapping too.
  return Response.json({model:'text-embedding-3-small',data:inputs.map((input,index)=>({index,embedding:[input.length,...vector.slice(1)]})).reverse(),usage:{total_tokens:inputs.length*7+1}});
 });
 ai.save({apiKey:'sk-worker-batch-test-123456789'});
 function open(){db=openDatabase(filename);store=new Store(db);const knowledge=new Knowledge(store);pages=new Pages(store,knowledge);vaults=new Vaults(store);worker=new Embeddings(store,pages,knowledge,vaults,ai);}
 open();
 t.after(()=>{worker.close();db.close();rmSync(dir,{recursive:true,force:true});});
 worker.saveSettings('default',{automatic:false});
 const vault=vaults.create({name:'Batch regression'}).id;
 worker.saveSettings(vault,{automatic:false,pagePolicy:{smallTokens:100,mediumTokens:50000,hysteresisTokens:0}});
 let page=pages.create(vault,{title:'Many sections'});
 const blocks=Array.from({length:count},(_,i)=>[
  {id:`h${i}`,type:'heading1',content:[{text:`Section ${i}`} ]},
  {id:`p${i}`,type:'paragraph',content:[{text:`Unique section ${i}: `+'algebraic structures and multiplicative inverses. '.repeat(10)}]},
 ]).flat();
 page=pages.update(vault,page.id,{...page,blocks});new PageSegments(store).synchronize(vault,page.id);
 assert.equal(store.get('SELECT count(*) AS n FROM page_segments WHERE page_id=?',page.id).n,count);
 assert.equal(new PageSegmentIndex(store).enqueue(vault,page.id,'backfill',0),count);
 // An audit trigger detects duplicate writes even when an UPSERT masks them.
 db.exec(`CREATE TABLE embedding_writes(segment_id TEXT); CREATE TRIGGER audit_embedding_insert AFTER INSERT ON page_segment_embeddings BEGIN INSERT INTO embedding_writes VALUES(NEW.segment_id); END; CREATE TRIGGER audit_embedding_update AFTER UPDATE ON page_segment_embeddings BEGIN INSERT INTO embedding_writes VALUES(NEW.segment_id); END;`);
 return {vault,page,requests,successfulInputs,get store(){return store;},get worker(){return worker;},setHandler(value){handler=value;},restart(){worker.close();db.close();open();},indexed(){return store.get('SELECT count(*) AS n FROM page_segment_embeddings b JOIN page_segments s ON s.id=b.segment_id WHERE s.page_id=?',page.id).n;},async drain(){for(let i=0;i<40;i++){if(!store.get("SELECT 1 FROM embedding_jobs WHERE page_id=? AND status='queued'",page.id))return;await worker.tick();}assert.fail('Queue did not drain');},assertComplete(){
  assert.equal(this.indexed(),count);
  assert.equal(store.get('SELECT count(*) AS n FROM embedding_writes').n,count);
  assert.equal(new Set(successfulInputs).size,count);assert.equal(successfulInputs.length,count);
  assert.equal(store.get("SELECT count(*) AS n FROM embedding_jobs WHERE page_id=? AND status='completed'",page.id).n,count);
  const note=worker.status(vault).notes.find(note=>note.pageId===page.id);
  assert.equal(note.state,'indexed');assert.equal(note.indexingStatus,'ready');assert.equal(note.pendingPassages,0);assert.equal(note.failedPassages,0);
  for(const row of store.all('SELECT s.input,b.vector FROM page_segments s JOIN page_segment_embeddings b ON b.segment_id=s.id WHERE s.page_id=?',page.id))assert.equal(JSON.parse(row.vector)[0],row.input.length);
 }};
}

for(const count of [9,16,17,32])test(`${count} Page segments persist exactly once across batches and a database restart`,async t=>{
 const f=await fixture(t,count);
 const ids=f.store.all('SELECT id FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id);
 await f.worker.tick();assert.equal(f.indexed(),Math.min(count,16));
 assert.equal(f.requests[0].length,Math.min(count,16));
 if(count>16)assert.equal(f.worker.status(f.vault).notes.find(note=>note.pageId===f.page.id).state,'partial');
 f.restart();await f.drain();f.assertComplete();
 assert.deepEqual(f.requests.map(inputs=>inputs.length),count<=16?[count]:[16,count-16]);
 assert.deepEqual(f.store.all('SELECT id FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id),ids);
 await f.worker.tick();assert.equal(f.successfulInputs.length,count);
});

test('a transient failure backs off, keeps the batch size and resumes after restart',async t=>{
 const f=await fixture(t,17);f.setHandler((_inputs,attempt)=>attempt===1?new Response(null,{status:503}):undefined);
 await f.worker.tick();assert.equal(f.indexed(),0);
 const failed=f.store.all("SELECT * FROM embedding_jobs WHERE page_id=? AND attempts=1",f.page.id);
 assert.equal(failed.length,16);assert.ok(failed.every(job=>job.status==='queued'&&Date.parse(job.next_attempt_at)>Date.now()));
 await f.worker.tick();assert.deepEqual(f.requests.map(inputs=>inputs.length),[16,1]);
 f.restart();f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");
 await f.drain();f.assertComplete();assert.deepEqual(f.requests.map(inputs=>inputs.length),[16,1,16]);
 assert.equal(f.store.get('SELECT sum(tokens) AS n FROM embedding_jobs WHERE page_id=?',f.page.id).n,17*7+2);
});

test('confirmed oversized responses split durably and retain successful sub-batches',async t=>{
 const f=await fixture(t,16);
 f.setHandler(inputs=>inputs.length>4?Response.json({padding:'x'.repeat(900000)}):undefined);
 const ids=f.store.all('SELECT id FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id);
 await f.worker.tick();assert.equal(f.indexed(),0);
 assert.ok(f.store.all('SELECT batch_max_inputs FROM embedding_jobs WHERE page_id=?',f.page.id).every(job=>job.batch_max_inputs===8));
 f.restart();await f.worker.tick();await f.worker.tick();await f.worker.tick();assert.equal(f.indexed(),4);
 f.restart();await f.drain();f.assertComplete();
 assert.deepEqual(f.requests.map(inputs=>inputs.length),[16,8,8,4,4,4,4]);
 assert.deepEqual(f.store.all('SELECT id FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id),ids);
});

test('an oversized singleton terminates under the normal retry policy',async t=>{
 const f=await fixture(t,1);f.setHandler(()=>Response.json({padding:'x'.repeat(900000)}));
 for(let i=0;i<3;i++){f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");await f.worker.tick();}
 assert.equal(f.requests.length,3);assert.equal(f.indexed(),0);
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',f.page.id).status,'failed');
});

test('source passage jobs also retain smaller batches and partial progress after restart',async t=>{
 const {SourceFiles}=await import('../src/server/modules/source-files.ts');
 const {SourcePassages}=await import('../src/server/modules/source-passages.ts');
 const f=await fixture(t,1);
 f.store.run('DELETE FROM embedding_jobs WHERE page_id=?',f.page.id);
 const text=Array.from({length:16},(_,i)=>`# Chapter ${i}\n\n`+'A source discussing algebraic structures and fields. '.repeat(10)).join('\n\n');
 const file=new SourceFiles(f.store).add(f.vault,'chapters.md',Buffer.from(text));
 const source=new Knowledge(f.store).create(f.vault,{name:'Chapters',type:'source',attachmentIds:[file.id]});
 f.store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",text,file.id);
 f.store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);
 new SourcePassages(f.store).synchronize(f.vault);
 const count=f.store.get('SELECT count(*) AS n FROM source_passages WHERE source_id=?',source.id).n;
 assert.equal(count,16);
 // Use the same real Intelligence transport as the page worker via queued source work.
 f.worker.onSourceSave(f.vault,source.id);
 // Explicit backfill works when automatic indexing is disabled.
 f.worker.enqueueExisting(f.vault,{mode:'missing'});
 f.store.run('DELETE FROM embedding_jobs WHERE page_id=?',f.page.id);
 f.setHandler(inputs=>inputs.length>4?Response.json({padding:'x'.repeat(900000)}):undefined);
 await f.worker.tick();
 assert.ok(f.store.all('SELECT batch_max_inputs FROM source_passage_embedding_jobs WHERE source_id=?',source.id).every(job=>job.batch_max_inputs===8));
 f.restart();
 for(let i=0;i<12;i++)await f.worker.tick();
 assert.deepEqual(f.requests.map(inputs=>inputs.length),[16,8,8,4,4,4,4]);
 assert.equal(f.store.get('SELECT count(*) AS n FROM source_passage_embeddings b JOIN source_passages p ON p.id=b.passage_id WHERE p.source_id=?',source.id).n,count);
 assert.equal(f.store.get("SELECT count(*) AS n FROM source_passage_embedding_jobs WHERE source_id=? AND status='completed'",source.id).n,count);
 assert.equal(new Set(f.successfulInputs).size,count);assert.equal(f.successfulInputs.length,count);
 assert.equal(f.worker.status(f.vault).notes.find(note=>note.sourceId===source.id).state,'indexed');
});

test('existing queues gain default batch limits on database migration',async t=>{
 const f=await fixture(t,17);
 const jobs=f.store.all('SELECT id,status,attempts FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id);
 for(const table of ['embedding_jobs','source_passage_embedding_jobs'])f.store.db.exec(`ALTER TABLE ${table} DROP COLUMN batch_max_inputs`);
 f.restart();
 assert.deepEqual(f.store.all('SELECT id,status,attempts FROM embedding_jobs WHERE page_id=? ORDER BY id',f.page.id),jobs);
 assert.ok(f.store.all('SELECT batch_max_inputs FROM embedding_jobs WHERE page_id=?',f.page.id).every(job=>job.batch_max_inputs===16));
 assert.ok(f.store.all('PRAGMA table_info(source_passage_embedding_jobs)').some(column=>column.name==='batch_max_inputs'));
 await f.drain();f.assertComplete();
});

test('automatic source discovery uses bounded passage history lookups as failed jobs accumulate',async t=>{
 const {SourceFiles}=await import('../src/server/modules/source-files.ts');
 const {SourcePassages}=await import('../src/server/modules/source-passages.ts');
 const f=await fixture(t,1);
 const text=Array.from({length:2},(_,i)=>`# Source section ${i}\n\n`+'A source discussing algebraic structures and fields. '.repeat(10)).join('\n\n');
 const file=new SourceFiles(f.store).add(f.vault,'history.md',Buffer.from(text));
 const source=new Knowledge(f.store).create(f.vault,{name:'History lookup',type:'source',attachmentIds:[file.id]});
 f.store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",text,file.id);
 f.store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);
 new SourcePassages(f.store).synchronize(f.vault);
 const passages=f.store.all('SELECT * FROM source_passages WHERE source_id=? ORDER BY ordinal',source.id);
 assert.equal(passages.length,2);
 const insert=f.store.db.prepare(`INSERT INTO source_passage_embedding_jobs(id,vault_id,passage_id,file_id,generation_id,source_id,content_hash,model,dimensions,status,reason,created_at,next_attempt_at,error) VALUES(?,?,?,?,?,?,?,'text-embedding-3-small',1536,'failed','save',?,?,?)`);
 f.store.transaction(()=>{
  for(let i=0;i<1200;i++)insert.run(`unrelated-${i}`,f.vault,`old-passage-${i}`,file.id,'old-generation',source.id,`old-hash-${i}`,'2026-01-01','2026-01-01','Terminal provider rejection');
  const p=passages[0];insert.run('current-failed',f.vault,p.id,file.id,p.generation_id,source.id,p.content_hash,'2026-01-02','2026-01-02','Terminal provider rejection');
 });
 // Exercise additive migration of an existing populated database, not just a fresh schema.
 f.store.db.exec('DROP INDEX source_passage_jobs_history');f.restart();
 f.worker.saveSettings(f.vault,{automatic:true});
 const all=f.store.all.bind(f.store);let details;
 f.store.all=(sql,...params)=>{
  if(sql.startsWith('SELECT p.id,p.file_id,p.generation_id,p.source_id,p.content_hash '))details=all('EXPLAIN QUERY PLAN '+sql,...params).map(row=>row.detail);
  return all(sql,...params);
 };
 f.worker.onSourceSave(f.vault,source.id);
 assert.ok(details,'Capture the actual automatic discovery query');
 assert.ok(details.some(detail=>/SEARCH latest USING (?:COVERING )?INDEX source_passage_jobs_history/.test(detail)),details.join('\n'));
 assert.ok(details.some(detail=>/SEARCH j USING (?:COVERING )?INDEX source_passage_jobs_history/.test(detail)),details.join('\n'));
 assert.ok(!details.some(detail=>/SCAN (?:j|latest)\b/.test(detail)),details.join('\n'));
 assert.equal(f.store.get("SELECT count(*) AS n FROM source_passage_embedding_jobs WHERE passage_id=? AND status='queued'",passages[0].id).n,0,'A terminal failure must remain suppressed');
 assert.equal(f.store.get("SELECT count(*) AS n FROM source_passage_embedding_jobs WHERE passage_id=? AND status='queued'",passages[1].id).n,1,'An unrelated missing passage must still queue');
});

function pageBatchFixture(t) {
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store);
 const requests=[];let handler,admissionError;
 const ai={status:()=>({configured:true}),embedBatch:async(inputs,onRequest)=>{
  if(admissionError)throw admissionError;
  requests.push(inputs);onRequest?.(inputs.reduce((sum,input)=>sum+Buffer.byteLength(input),0));
  if(handler)await handler(inputs);
  return {embeddings:inputs.map(input=>[input.length,...vector.slice(1)]),tokens:inputs.length*7};
 }};
 const activity=new AIActivityLog(store),worker=new Embeddings(store,pages,knowledge,vaults,ai,activity),segments=new PageSegments(store),index=new PageSegmentIndex(store);
 worker.saveSettings('default',{automatic:false});segments.synchronize('default');
 const vault=vaults.create({name:'Cross-page batches'}).id;worker.saveSettings(vault,{automatic:false});
 t.after(()=>{worker.close();db.close();});
 function add(i,target=vault,text='An algebraic structure with multiplicative inverses. '+'.'.repeat(i)) {
  let page=pages.create(target,{title:`Batch page ${i}`});
  page=pages.update(target,page.id,{...page,blocks:[{id:`body-${i}`,type:'paragraph',content:[{text}]}]});
  segments.synchronize(target,page.id);index.enqueue(target,page.id,'backfill',0);return page;
 }
 return {db,store,pages,vaults,vault,worker,index,activity,requests,add,setHandler(value){handler=value;},setAdmissionError(value){admissionError=value;}};
}

test('100 single-segment Pages use seven cross-Page requests with individual identities and unchanged token volume',async t=>{
 const f=pageBatchFixture(t);for(let i=0;i<100;i++)f.add(i);
 for(let i=0;i<7;i++)await f.worker.tick();
 assert.deepEqual(f.requests.map(inputs=>inputs.length),[16,16,16,16,16,16,4]);
 assert.equal(f.store.get("SELECT count(*) AS n FROM embedding_jobs WHERE vault_id=? AND status='completed'",f.vault).n,100);
 assert.equal(f.store.get('SELECT sum(tokens) AS n FROM embedding_jobs WHERE vault_id=?',f.vault).n,700);
 for(const row of f.store.all('SELECT s.input,b.vector FROM page_segments s JOIN page_segment_embeddings b ON b.segment_id=s.id WHERE s.vault_id=?',f.vault))assert.equal(JSON.parse(row.vector)[0],row.input.length);
});

test('completed batch reconciles its own unchanged Pages ahead of more than 16 unrelated dirty Pages',async t=>{
 const f=pageBatchFixture(t),page=f.add(1);let release;
 f.setHandler(()=>new Promise(resolve=>{release=resolve;}));const pending=f.worker.tick();assert.ok(release);
 for(let i=0;i<20;i++){
  let unrelated=f.pages.create(f.vault,{title:`Unrelated ${i}`});
  unrelated=f.pages.update(f.vault,unrelated.id,{...unrelated,blocks:[{id:'body',type:'paragraph',content:[{text:'Unrelated dirty algebraic content.'}]}]});
  f.store.run("UPDATE page_index_dirty SET next_attempt_at='2000-01-01' WHERE page_id=?",unrelated.id);
 }
 f.pages.update(f.vault,page.id,{...page});f.worker.onSave(f.vault,page.id);
 // Dirty rows default to an empty due time; force the completed Page behind
 // the unrelated backlog so the baseline vault-wide LIMIT 16 misses it.
 f.store.run("UPDATE page_index_dirty SET next_attempt_at='2001-01-01' WHERE page_id=?",page.id);
 release();await pending;
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',page.id).status,'completed');
 assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings b JOIN page_segments s ON s.id=b.segment_id WHERE s.page_id=?',page.id).n,1);
 assert.equal(f.requests.length,1);
 assert.equal(f.store.get('SELECT count(*) AS n FROM page_index_dirty WHERE vault_id=?',f.vault).n,20,'Only completed batch Pages need reconciliation');
});

test('cross-Page completion preserves unaffected members when one Page changes or is cancelled',async t=>{
 for(const action of ['edit','cancel','delete','archive'])await t.test(action,async t=>{
  const f=pageBatchFixture(t),first=f.add(1),second=f.add(2);let release;
  f.setHandler(()=>new Promise(resolve=>{release=resolve;}));const pending=f.worker.tick();assert.ok(release);
  await f.worker.tick();assert.equal(f.requests.length,1,'Concurrent tick must not launch duplicate work');
  assert.equal(f.activity.list(null).items[0].objectId,null,'Cross-Page request must not be attributed to its first Page');
  if(action==='edit')f.pages.update(f.vault,first.id,{...first,title:'Changed title'});
  if(action==='cancel')f.worker.invalidate(f.vault,first.id);
  if(action==='delete')f.pages.delete(f.vault,first.id);
  if(action==='archive')f.store.run("UPDATE pages SET archived_at='2026-01-01' WHERE id=?",first.id);
  release();await pending;
  assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',second.id).status,'completed');
  assert.notEqual(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',first.id).status,'completed');
  assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings b JOIN page_segments s ON s.id=b.segment_id WHERE s.page_id=?',second.id).n,1);
 });
});

test('cross-Page packing keeps vaults isolated, rejects incompatible jobs, and enforces the aggregate byte cap',async t=>{
 const f=pageBatchFixture(t),other=f.vaults.create({name:'Other batch vault'}).id;
 f.worker.saveSettings(other,{automatic:false});
 for(let i=0;i<20;i++)f.add(i,f.vault,'field. '.repeat(1000));
 f.add(99,other);const incompatible=f.add(100,f.vault);
 f.store.run("UPDATE embedding_jobs SET model='incompatible-model' WHERE page_id=?",incompatible.id);
 for(let i=0;i<10;i++)await f.worker.tick();
 for(const inputs of f.requests){
  assert.ok(inputs.length<=16);assert.ok(inputs.reduce((sum,input)=>sum+Buffer.byteLength(input),0)<=64000);
  assert.ok(inputs.every(input=>input.startsWith('Batch page 99\n'))||inputs.every(input=>!input.startsWith('Batch page 99\n')),'No request mixes vaults');
 }
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',incompatible.id).status,'skipped');
 assert.equal(f.store.get("SELECT count(*) AS n FROM embedding_jobs WHERE status='completed'").n,21);
});

test('smaller durable per-job batch limits also constrain cross-Page packing',async t=>{
 const f=pageBatchFixture(t);for(let i=0;i<17;i++)f.add(i);
 f.store.run('UPDATE embedding_jobs SET batch_max_inputs=4 WHERE vault_id=?',f.vault);
 for(let i=0;i<5;i++)await f.worker.tick();
 assert.deepEqual(f.requests.map(inputs=>inputs.length),[4,4,4,4,1]);
 assert.equal(f.store.get("SELECT count(*) AS n FROM embedding_jobs WHERE vault_id=? AND status='completed'",f.vault).n,17);
 assert.ok(f.store.all('SELECT batch_max_inputs FROM embedding_jobs WHERE vault_id=?',f.vault).every(job=>job.batch_max_inputs===4));
});


test('cross-Page typed permanent failures stop each member after one dispatch and survive forced discovery',async t=>{
 for(const status of [400,401,403])await t.test(String(status),async t=>{
  const f=pageBatchFixture(t),pages=[f.add(1),f.add(2)];
  f.setHandler(()=>{throw new GenerationProviderError(status,'Safe terminal failure');});
  await f.worker.tick();
  for(const page of pages){
   const job=f.store.get('SELECT * FROM embedding_jobs WHERE page_id=?',page.id);
   assert.equal(job.status,'failed');assert.equal(job.attempts,1);
   f.index.enqueue(f.vault,page.id,'retry',0,true);
  }
  await f.worker.tick();assert.equal(f.requests.length,1);
  assert.equal(f.store.get('SELECT count(*) AS n FROM embedding_retry_blocks WHERE vault_id=?',f.vault).n,2);
 });
});

test('cross-Page transient failures honor Retry-After per member while preserving cancelled jobs',async t=>{
 const f=pageBatchFixture(t),first=f.add(1),second=f.add(2);let fail;
 f.setHandler(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 const before=Date.now(),pending=f.worker.tick();assert.ok(fail);
 f.worker.invalidate(f.vault,first.id);fail(new GenerationProviderError(429,'Safe capacity failure',120_000));await pending;
 const cancelled=f.store.get('SELECT * FROM embedding_jobs WHERE page_id=?',first.id),retry=f.store.get('SELECT * FROM embedding_jobs WHERE page_id=?',second.id);
 assert.equal(cancelled.status,'skipped');assert.equal(cancelled.attempts,1);
 assert.equal(retry.status,'queued');assert.equal(retry.attempts,1);assert.ok(Date.parse(retry.next_attempt_at)>=before+120_000);
 await f.worker.tick();assert.equal(f.requests.length,1);
 f.setHandler(undefined);f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE id=?",retry.id);await f.worker.tick();
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE id=?',retry.id).status,'completed');
 assert.equal(f.store.get('SELECT attempts FROM embedding_jobs WHERE id=?',retry.id).attempts,2);
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE id=?',cancelled.id).status,'skipped');
});

test('cancelled cross-Page members do not acquire terminal retry blocks from surviving request failures',async t=>{
 const f=pageBatchFixture(t),first=f.add(1),second=f.add(2);let fail;
 const cancelledSegment=f.store.get('SELECT segment_id FROM embedding_jobs WHERE page_id=?',first.id).segment_id;
 f.setHandler(()=>new Promise((_resolve,reject)=>{fail=reject;}));const pending=f.worker.tick();assert.ok(fail);
 f.worker.invalidate(f.vault,first.id);fail(new GenerationProviderError(400,'Safe invalid input'));await pending;
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',first.id).status,'skipped');
 assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',second.id).status,'failed');
 assert.equal(f.store.get('SELECT count(*) AS n FROM embedding_retry_blocks WHERE item_id=?',cancelledSegment).n,0);
 assert.equal(f.store.get('SELECT count(*) AS n FROM embedding_retry_blocks WHERE vault_id=?',f.vault).n,1);
});

test('cross-Page local admission requeues all members without counting a provider attempt',async t=>{
 const f=pageBatchFixture(t),pages=[f.add(1),f.add(2)];
 f.setAdmissionError(new EmbeddingAdmissionError('Local capacity unavailable',15_000));const before=Date.now();await f.worker.tick();
 assert.equal(f.requests.length,0);
 for(const page of pages){const job=f.store.get('SELECT * FROM embedding_jobs WHERE page_id=?',page.id);assert.equal(job.status,'queued');assert.equal(job.attempts,0);assert.ok(Date.parse(job.next_attempt_at)>=before+15_000);}
 assert.equal(f.store.get('SELECT count(*) AS n FROM embedding_retry_blocks').n,0);
 f.setAdmissionError(undefined);f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");await f.worker.tick();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].length,2);
 for(const page of pages){const job=f.store.get('SELECT * FROM embedding_jobs WHERE page_id=?',page.id);assert.equal(job.status,'completed');assert.equal(job.attempts,1);}
});

test('cancelled source passage batches retain skipped status without terminal retry blocks after provider rejection',async t=>{
 const {SourceFiles}=await import('../src/server/modules/source-files.ts');
 const {SourcePassages}=await import('../src/server/modules/source-passages.ts');
 for(const status of [400,401,403])await t.test(String(status),async t=>{
  const f=pageBatchFixture(t),text='# Algebra\n\nA source about algebraic fields and multiplicative inverses.';
  const file=new SourceFiles(f.store).add(f.vault,'cancelled-source.md',Buffer.from(text));
  const source=new Knowledge(f.store).create(f.vault,{name:'Cancelled source',type:'source',attachmentIds:[file.id]});
  f.store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",text,file.id);
  f.store.run('UPDATE entities SET inactive=0 WHERE id=?',source.id);new SourcePassages(f.store).synchronize(f.vault);
  f.worker.enqueueExisting(f.vault,{mode:'missing'});let fail;
  f.setHandler(()=>new Promise((_resolve,reject)=>{fail=reject;}));const pending=f.worker.tick();assert.ok(fail);
  assert.ok(f.store.get("SELECT 1 FROM source_passage_embedding_jobs WHERE source_id=? AND status='running'",source.id));
  f.worker.invalidateSource(f.vault,source.id);fail(new GenerationProviderError(status,'Safe terminal rejection'));await pending;
  assert.ok(f.store.all('SELECT status,attempts FROM source_passage_embedding_jobs WHERE source_id=?',source.id).every(job=>job.status==='skipped'&&job.attempts===1));
  assert.equal(f.store.get("SELECT count(*) AS n FROM embedding_retry_blocks WHERE kind='source' AND vault_id=?",f.vault).n,0);
  assert.equal(f.store.get('SELECT count(*) AS n FROM source_passage_embeddings').n,0);
 });
});
