import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/server/store.ts';
import {setupPageEnrichmentSchedulerSchema} from '../src/server/page-enrichment-schema.ts';
import {PageEnrichmentScheduler} from '../src/server/modules/page-enrichment-scheduler.ts';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE vaults(id TEXT PRIMARY KEY,locked INTEGER DEFAULT 0);
    CREATE TABLE pages(id TEXT PRIMARY KEY,vault_id TEXT REFERENCES vaults(id),deleted_at TEXT,archived_at TEXT);
    CREATE TABLE page_edit_locks(page_id TEXT PRIMARY KEY);
    INSERT INTO vaults(id) VALUES ('v');INSERT INTO pages(id,vault_id) VALUES ('p','v');`);
  setupPageEnrichmentSchedulerSchema(db);
  return {db,store:new Store(db)};
}
const snapshot=job=>({contentHash:'hash',schemaVersion:'1',modelProfile:'cheap',requestedFields:job.fields,revision:1});

test('durable queue coalesces fields and resumes with the latest eligible snapshot',async()=>{
  const {db,store}=fixture();let now=100,calls=[];
  const callbacks={prepare:(_v,_p,job)=>snapshot(job),execute:async(_v,_p,value)=>{calls.push(value.requestedFields);}};
  const original=new PageEnrichmentScheduler(store,callbacks,{clock:()=>now});
  original.enqueue('v','p',{fields:['title'],delayMs:10});
  original.enqueue('v','p',{fields:['summary'],delayMs:20});
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,1);
  original.dispose();now=120;
  const restarted=new PageEnrichmentScheduler(store,callbacks,{clock:()=>now});
  await restarted.drain();assert.deepEqual(calls,[['title','summary']]);
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,0);
  restarted.dispose();db.close();
});

test('classification cooldown preserves pending domains while other fields run',async()=>{
  const {db,store}=fixture();let now=100,calls=[];
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async(_v,_p,value)=>{calls.push(value.requestedFields);return {classified:value.requestedFields.includes('domains')};}},{clock:()=>now,classificationCooldownMs:1000});
  scheduler.markClassified('p');scheduler.enqueue('v','p',{fields:['domains','summary'],delayMs:0});
  await scheduler.drain();assert.deepEqual(calls,[['summary']]);
  assert.deepEqual(JSON.parse(store.get('SELECT fields FROM page_enrichment_jobs').fields),['domains']);
  now=1100;await scheduler.drain();assert.deepEqual(calls,[['summary'],['domains']]);
  scheduler.dispose();db.close();
});

test('saves during in-flight work survive completion and overlapping drain calls deduplicate',async()=>{
  const {db,store}=fixture();let finish,calls=0;
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async()=>{calls++;await new Promise(resolve=>{finish=resolve;});}},{clock:()=>100});
  scheduler.enqueue('v','p',{fields:['title'],delayMs:0});const pending=scheduler.drain();
  await scheduler.drain();assert.equal(calls,1);
  scheduler.enqueue('v','p',{fields:['summary'],delayMs:0});finish();await pending;
  assert.equal(store.get('SELECT generation FROM page_enrichment_jobs').generation,2);
  scheduler.dispose();db.close();
});

test('presentation revisions and additional queued fields preserve a compatible active request',async()=>{
  const {db,store}=fixture();let revision=1,finish,signal;const calls=[];
  const scheduler=new PageEnrichmentScheduler(store,{
    prepare:(_v,_p,job)=>({...snapshot(job),revision,dependencyIdentity:'same field dependencies'}),
    execute:async(_v,_p,value,requestSignal)=>{calls.push(value.requestedFields);signal=requestSignal;await new Promise(resolve=>{finish=resolve;});}
  },{clock:()=>100});
  scheduler.enqueue('v','p',{fields:['title'],delayMs:0});const pending=scheduler.drain();
  revision++;scheduler.enqueue('v','p',{fields:['summary'],delayMs:0});
  assert.equal(signal.aborted,false);
  assert.deepEqual(calls,[['title']]);
  finish();await pending;
  assert.equal(store.get('SELECT generation FROM page_enrichment_jobs').generation,2);
  scheduler.dispose();db.close();
});

test('dependency changes immediately abort obsolete work and retain the newest queued snapshot',async()=>{
  const {db,store}=fixture();let dependencyIdentity='original',signal,finish;const calls=[];
  const scheduler=new PageEnrichmentScheduler(store,{
    prepare:(_v,_p,job)=>({...snapshot(job),dependencyIdentity}),
    execute:async(_v,_p,value,requestSignal)=>{
      calls.push(value.dependencyIdentity);signal=requestSignal;
      if(calls.length===1)await new Promise(resolve=>{finish=resolve;});
    }
  },{clock:()=>100});
  scheduler.enqueue('v','p',{fields:['summary'],delayMs:0});const pending=scheduler.drain();
  dependencyIdentity='edited';scheduler.enqueue('v','p',{fields:['summary'],delayMs:0});
  assert.equal(signal.aborted,true);
  dependencyIdentity='newest';scheduler.enqueue('v','p',{fields:['summary'],delayMs:0});
  // A provider that settles after abort must not consume the newer generation.
  finish();await pending;
  assert.equal(store.get('SELECT generation FROM page_enrichment_jobs').generation,3);
  await scheduler.drain();assert.deepEqual(calls,['original','newest']);
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,0);
  scheduler.dispose();db.close();
});

test('losing field eligibility aborts the active request without recording late classification',async()=>{
  const {db,store}=fixture();let eligible=true,signal,finish;
  const scheduler=new PageEnrichmentScheduler(store,{
    prepare:(_v,_p,job)=>eligible?snapshot(job):null,
    execute:async(_v,_p,_value,requestSignal)=>{signal=requestSignal;await new Promise(resolve=>{finish=resolve;});return {classified:true};}
  },{clock:()=>100});
  scheduler.enqueue('v','p',{fields:['domains'],delayMs:0});const pending=scheduler.drain();
  eligible=false;scheduler.enqueue('v','p',{fields:['domains'],delayMs:0});
  assert.equal(signal.aborted,true);finish();await pending;
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_cooldowns').n,0);
  await scheduler.drain();assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,0);
  scheduler.dispose();db.close();
});

test('locked vaults pause dispatch and permanent errors are never retried',async()=>{
  const {db,store}=fixture();let calls=0;
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async()=>{calls++;throw Object.assign(new Error('Missing credentials'),{status:400});}},{clock:()=>100});
  scheduler.enqueue('v','p',{delayMs:0});store.run('UPDATE vaults SET locked=1');await scheduler.drain();assert.equal(calls,0);
  store.run('UPDATE vaults SET locked=0');await scheduler.drain();await scheduler.drain();assert.equal(calls,1);
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,0);
  scheduler.dispose();db.close();
});

test('transient failures use bounded durable backoff and explicit work bypasses cooldown',async()=>{
  const {db,store}=fixture();let now=100,calls=0;
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async()=>{calls++;throw Object.assign(new Error('Busy'),{status:503});}},{clock:()=>now,retryDelaysMs:[10,20]});
  scheduler.markClassified('p');scheduler.enqueue('v','p',{fields:['domains'],explicit:true});await scheduler.drain();assert.equal(calls,1);
  now=109;await scheduler.drain();assert.equal(calls,1);
  now=110;await scheduler.drain();now=130;await scheduler.drain();assert.equal(calls,3);
  assert.equal(store.get('SELECT count(*) AS n FROM page_enrichment_jobs').n,0);
  scheduler.dispose();db.close();
});

test('completed classification timestamps restore cooldown without an earlier queue job',async()=>{
  const {db,store}=fixture();let calls=0;
  db.exec('CREATE TABLE page_ai_enrichments(page_id TEXT,kind TEXT,data TEXT)');
  store.run('INSERT INTO page_ai_enrichments VALUES (?,?,?)','p','domain_classification',JSON.stringify({lastClassifiedAt:new Date(100).toISOString()}));
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async()=>{calls++;}},{clock:()=>500,classificationCooldownMs:1000});
  scheduler.enqueue('v','p',{fields:['domains'],delayMs:0});await scheduler.drain();assert.equal(calls,0);
  assert.equal(store.get('SELECT due_at FROM page_enrichment_jobs').due_at,1100);
  scheduler.dispose();db.close();
});

test('a vault restored in the running server retains classification work through cooldown',async()=>{
  const {db,store}=fixture();let calls=0;
  db.exec('CREATE TABLE page_ai_enrichments(page_id TEXT,kind TEXT,data TEXT)');
  const scheduler=new PageEnrichmentScheduler(store,{prepare:(_v,_p,job)=>snapshot(job),execute:async()=>{calls++;}},{clock:()=>500,classificationCooldownMs:1000});
  // Classification metadata arrives after the worker was constructed, as on a live restore.
  store.run('INSERT INTO page_ai_enrichments VALUES (?,?,?)','p','enrichment_state',JSON.stringify({classification:{lastClassifiedAt:new Date(100).toISOString()}}));
  scheduler.enqueue('v','p',{fields:['domains'],delayMs:0});await scheduler.drain();assert.equal(calls,0);
  assert.equal(store.get('SELECT due_at FROM page_enrichment_jobs').due_at,1100);
  scheduler.dispose();db.close();
});

test('enrichment settings migrate from global metadata and cascade with vault deletion',()=>{
  const {db,store}=fixture();
  db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);INSERT INTO vaults(id) VALUES ('empty');");
  store.run('INSERT INTO metadata VALUES (?,?)','page_enrichment:v:automatic_summaries','true');
  store.run('INSERT INTO metadata VALUES (?,?)','page_enrichment:deleted-vault:automatic_summaries','true');
  store.run('INSERT INTO metadata VALUES (?,?)','unrelated','keep');
  setupPageEnrichmentSchedulerSchema(db);
  assert.equal(store.get('SELECT automatic_summaries FROM page_enrichment_settings WHERE vault_id=?','v').automatic_summaries,1);
  assert.deepEqual(store.all('SELECT key FROM metadata').map(row=>row.key),['unrelated']);
  store.run('INSERT INTO page_enrichment_settings(vault_id,automatic_summaries) VALUES (?,1)','empty');
  store.run('DELETE FROM vaults WHERE id=?','empty');
  assert.equal(store.get('SELECT 1 FROM page_enrichment_settings WHERE vault_id=?','empty'),undefined);
  db.close();
});
