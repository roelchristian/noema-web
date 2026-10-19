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
import {Intelligence} from '../src/server/modules/intelligence.ts';

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
