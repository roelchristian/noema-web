import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
const vector=Array.from({length:1536},(_,i)=>i===0?1:0);
function setup() {
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store);
 let calls=0,finish;
 const ai={status:()=>({configured:true}),embed:async()=>{calls++;return finish?new Promise(resolve=>finish=resolve):{embedding:vector,tokens:10};}};
 ai.embedBatch=async(inputs,onRequest)=>{onRequest?.(inputs.reduce((n,input)=>n+Buffer.byteLength(input),0));const results=await Promise.all(inputs.map(input=>ai.embed(input)));return {embeddings:results.map(result=>result.embedding),tokens:results.reduce((n,result)=>n+result.tokens,0)};};
 const create=()=>new Embeddings(store,pages,knowledge,vaults,ai);
 let worker=create();
 let page=pages.create('default',{title:'Working note'});
 const update=(body)=>{page=pages.update('default',page.id,{...page,blocks:[{id:'paragraph',type:'paragraph',content:[{text:body}]}]});return page;};
 update('Substantive note body for semantic search indexing.');
 return {db,store,pages,vaults,create,get worker(){return worker;},set worker(v){worker=v;},get page(){return page;},update,get calls(){return calls;},pause(){finish=true;},release(){const resolve=finish;finish=null;resolve({embedding:vector,tokens:10});},close(){worker.close();db.close();}};
}
test('embeddings deduplicate exact content, exclude stale vectors, and reject in-flight edits',async()=>{
 const f=setup();try {
  f.worker.enqueueExisting('default',{mode:'missing'});await f.worker.tick();await f.worker.tick();
  assert.equal(f.calls,2); // Seed welcome note and the new note.
  assert.equal(f.worker.status('default').counts.indexed,2);
  assert.equal(f.worker.enqueueExisting('default',{mode:'eligible'}).queued,0);
  f.update('A changed substantive note with entirely different content.');f.worker.onSave('default',f.page.id);new PageSegments(f.store).synchronize('default',f.page.id);new PageSegmentIndex(f.store).enqueue('default',f.page.id,'save',0);
  assert.equal(f.worker.status('default').counts.missing,1);
  f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");
  f.pause();const pending=f.worker.tick();
  await Promise.resolve();
  f.update('Another substantive edit while a request is running.');f.worker.onSave('default',f.page.id);new PageSegments(f.store).synchronize('default',f.page.id);new PageSegmentIndex(f.store).enqueue('default',f.page.id,'save',0);
  f.release();await pending;
  assert.equal(f.worker.status('default').counts.missing,1);
  assert.equal(f.worker.status('default').counts.queued,1);
  assert.ok(f.worker.status('default').jobs.some(job=>job.status==='skipped'));
 }finally{f.close();}
});
test('interrupted attempts resume from a persisted queue and wait for vault unlock',async()=>{
 const f=setup();try {
  f.worker.enqueueExisting('default',{mode:'missing'});
  f.store.run("UPDATE embedding_jobs SET status='running',attempts=1");
  f.worker.close();f.vaults.lock('default',{passphrase:'secret'});f.worker=f.create();
  await f.worker.tick();assert.equal(f.calls,0);
  f.vaults.unlock('default',{passphrase:'secret'});
  assert.equal(f.worker.status('default').jobs.filter(j=>j.status==='interrupted').length,2);
  await f.worker.tick();await f.worker.tick();assert.equal(f.calls,2);
  assert.equal(f.worker.status('default').counts.indexed,2);
 }finally{f.close();}
});
test('eligibility excludes short bodies, segments oversized bodies and close prevents pending persistence',async()=>{
 const f=setup();try {
  f.update('short');assert.equal(f.worker.status('default').notes.find(n=>n.pageId===f.page.id).eligible,false);
  f.update('oversized body '.repeat(600));assert.equal(f.worker.status('default').notes.find(n=>n.pageId===f.page.id).eligible,true);
  f.update('Eligible content for a request that will close before completion.');
  f.worker.onSave('default',f.page.id);new PageSegments(f.store).synchronize('default',f.page.id);new PageSegmentIndex(f.store).enqueue('default',f.page.id,'save',0);f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");
  f.pause();const pending=f.worker.tick();await Promise.resolve();f.worker.close();f.release();await pending;
  assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings').n,0);
 }finally{f.close();}
});
test('retry backoff stops after three attempts and never logs provider text',async()=>{
 const f=setup();try {
  f.worker.close();
  f.pages.delete('default','welcome');
  let calls=0;
  const ai={status:()=>({configured:true}),embedBatch:async(_inputs,onRequest)=>{onRequest?.(100);calls++;throw new Error('secret provider payload');}};
  f.worker=new Embeddings(f.store,f.pages,new Knowledge(f.store),f.vaults,ai);
  f.worker.onSave('default',f.page.id);new PageSegments(f.store).synchronize('default',f.page.id);new PageSegmentIndex(f.store).enqueue('default',f.page.id,'save',0);
  for(let i=0;i<3;i++) {
   f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");
   await f.worker.tick();
  }
  const job=f.worker.status('default').jobs.find(j=>j.pageId===f.page.id);
  assert.equal(calls,3);assert.equal(job.status,'failed');assert.equal(job.attempts,3);
  assert.equal(JSON.stringify(job).includes('secret provider payload'),false);
  await f.worker.tick();assert.equal(calls,3);
 }finally{f.close();}
});

test('typed embedding auth and request failures dispatch once while capacity respects Retry-After',async()=>{
 const {GenerationProviderError}=await import('../src/server/modules/intelligence.ts');
 for(const status of [400,401,403,429,503]) {
  const f=setup();try {
   f.worker.close();f.pages.delete('default','welcome');let calls=0;
   const ai={status:()=>({configured:true}),embedBatch:async(_inputs,onRequest)=>{onRequest?.(100);calls++;throw new GenerationProviderError(status,'Safe failure',120_000);}};
   f.worker=new Embeddings(f.store,f.pages,new Knowledge(f.store),f.vaults,ai);
   f.worker.onSave('default',f.page.id);new PageSegments(f.store).synchronize('default',f.page.id);new PageSegmentIndex(f.store).enqueue('default',f.page.id,'save',0);
   f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");
   const before=Date.now();await f.worker.tick();await f.worker.tick();
   const job=f.worker.status('default').jobs.find(j=>j.pageId===f.page.id);
   assert.equal(calls,1);assert.equal(job.attempts,1);
   assert.equal(job.status,status===429||status===503?'queued':'failed');
   if(job.status==='queued')assert.ok(Date.parse(job.nextAttemptAt)>=before+120_000);
  }finally{f.close();}
 }
});

test('deterministic embedding blocks survive forced retry and restart, and release after credential change',async()=>{
 const {GenerationProviderError}=await import('../src/server/modules/intelligence.ts');
 const f=setup();try {
  f.worker.close();f.pages.delete('default','welcome');let calls=0,configuration='old key';
  const ai={status:()=>({configured:true}),retryConfigurationIdentity:()=>configuration,embedBatch:async(_input,onRequest)=>{onRequest?.(100);calls++;throw new GenerationProviderError(401,'Replace key');}};
  const create=()=>new Embeddings(f.store,f.pages,new Knowledge(f.store),f.vaults,ai);
  f.worker=create();new PageSegments(f.store).synchronize('default');new PageSegmentIndex(f.store).enqueue('default',f.page.id,'retry',0,true);await f.worker.tick();
  assert.equal(calls,1);const first=f.worker.status('default').jobs.find(j=>j.pageId===f.page.id);
  f.worker.close();f.worker=create();f.worker.retry('default',first.id);await f.worker.tick();assert.equal(calls,1);
  f.update('Changed substantive content with the same rejected credential should wait.');new PageSegments(f.store).synchronize('default');new PageSegmentIndex(f.store).enqueue('default',f.page.id,'retry',0,true);await f.worker.tick();assert.equal(calls,1);
  configuration='replacement key';await f.worker.tick();assert.equal(calls,2);
  assert.equal(f.store.get("SELECT category FROM embedding_retry_blocks WHERE kind='page'").category,'configuration');
 }finally{f.close();}
});

test('credential replacement during an embedding dispatch requeues for the fresh key without poisoning it',async()=>{
 const {HttpError}=await import('../src/server/validation.ts');
 const f=setup();try {
  f.worker.close();f.pages.delete('default','welcome');let calls=0,configuration='old key',reject;
  const ai={status:()=>({configured:true}),retryConfigurationIdentity:()=>configuration,embedBatch:async(_input,onRequest)=>{onRequest?.(100);calls++;if(calls===1)return new Promise((_resolve,fail)=>{reject=fail;});return {embeddings:[vector],tokens:10};}};
  f.worker=new Embeddings(f.store,f.pages,new Knowledge(f.store),f.vaults,ai);
  new PageSegments(f.store).synchronize('default');new PageSegmentIndex(f.store).enqueue('default',f.page.id,'retry',0,true);
  const pending=f.worker.tick();await Promise.resolve();configuration='fresh key';reject(new HttpError(409,'The credential changed or expired.'));await pending;
  assert.equal(f.store.get('SELECT count(*) n FROM embedding_retry_blocks').n,0);
  await f.worker.tick();assert.equal(calls,2);assert.equal(f.worker.status('default').jobs.find(j=>j.pageId===f.page.id).status,'completed');
 }finally{f.close();}
});
