import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
const vector=()=>({embedding:Array(1536).fill(0.01),tokens:12});
const paragraph=(text,id='body')=>({id,type:'paragraph',checked:false,content:[{text}]});
function fixture(t,embed=async()=>vector(),blocks=[paragraph('A field has multiplicative inverses and forms an algebraic structure.')]) {
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store),vault=vaults.create({name:'Efficiency'}).id;
 let calls=0,configured=true;
 const ai={status:()=>({configured}),embed:async(...args)=>{calls++;return embed(...args);},embedBatch:async(inputs,onRequest)=>{onRequest?.(inputs.reduce((n,input)=>n+Buffer.byteLength(input),0));calls++;const results=await Promise.all(inputs.map(input=>embed(input)));return {embeddings:results.map(result=>result.embedding),tokens:results.reduce((n,result)=>n+result.tokens,0)};}};
 const log=new AIActivityLog(store),worker=new Embeddings(store,pages,knowledge,vaults,ai,log),segments=new PageSegments(store),index=new PageSegmentIndex(store);
 worker.saveSettings('default',{automatic:false});
 let page=pages.create(vault,{title:'Algebra'});page=pages.update(vault,page.id,{...page,blocks});segments.synchronize(vault,page.id);
 t.after(()=>{worker.close();db.close();});
 return {db,store,pages,vaults,vault,worker,segments,index,page,log,calls:()=>calls,setConfigured:value=>{configured=value;}};
}
function ready(f){const segment=f.store.get('SELECT * FROM page_segments WHERE page_id=? ORDER BY ordinal',f.page.id);f.index.save(segment,vector().embedding,12);return segment;}
test('in-flight embedding survives manual subjects and an unchanged save without another provider call',async t=>{
 let finish;const f=fixture(t,()=>new Promise(resolve=>{finish=()=>resolve(vector());}));
 f.index.enqueue(f.vault,f.page.id,'save',0);const pending=f.worker.tick();assert.ok(finish);
 new Domains(f.store).setManual(f.vault,f.page.id,{primaryDomainId:'mathematics.algebra.abstract',secondaryDomainIds:[]},f.page.revision);
 f.worker.onSave(f.vault,f.page.id);finish();await pending;
 assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',f.page.id).status,'completed');
 let current=f.pages.get(f.vault,f.page.id);f.pages.update(f.vault,current.id,{...current});f.worker.onSave(f.vault,current.id);f.segments.synchronize(f.vault,current.id);
 assert.equal(f.index.enqueue(f.vault,current.id,'test',0),0);
 assert.equal(f.store.get('SELECT revision FROM page_segments WHERE page_id=?',current.id).revision,f.pages.get(f.vault,current.id).revision);
});
test('editing another section preserves an unchanged in-flight segment',async t=>{
 let finish;const heading=(text,id)=>({...paragraph(text,id),type:'heading1'});
 const f=fixture(t,()=>new Promise(resolve=>{finish=()=>resolve(vector());}),[heading('First section','h1'),paragraph('unchanged algebra '.repeat(250),'first'),heading('Second section','h2'),paragraph('editable structure '.repeat(250),'second')]);
 for(const segment of f.store.all('SELECT * FROM page_segments WHERE page_id=? AND ordinal>0',f.page.id))f.index.save(segment,vector().embedding,12);
 f.index.enqueue(f.vault,f.page.id,'save',0);const pending=f.worker.tick();assert.ok(finish);
 const active=f.store.get("SELECT segment_id FROM embedding_jobs WHERE page_id=? AND status='running'",f.page.id);
 f.pages.update(f.vault,f.page.id,{...f.page,blocks:f.page.blocks.map(block=>block.id==='second'?paragraph('New content in the second section. '.repeat(90),'second'):block)});
 f.worker.onSave(f.vault,f.page.id);finish();await pending;
 assert.ok(f.store.get('SELECT 1 FROM page_segment_embeddings WHERE segment_id=?',active.segment_id),JSON.stringify({active,segments:f.store.all('SELECT id,ordinal,heading FROM page_segments WHERE page_id=?',f.page.id),jobs:f.store.all('SELECT segment_id,status,error FROM embedding_jobs WHERE page_id=?',f.page.id)}));
 assert.equal(f.calls(),1);
});
test('changed text, deletion, disabling indexing, and vault locking still block stale embedding insertion',async t=>{
 for(const change of ['text','delete','disable','lock'])await t.test(change,async t=>{
  let finish;const f=fixture(t,()=>new Promise(resolve=>{finish=()=>resolve(vector());}));
  f.index.enqueue(f.vault,f.page.id,'save',0);const pending=f.worker.tick();assert.ok(finish);
  if(change==='text'){f.pages.update(f.vault,f.page.id,{...f.page,blocks:[paragraph('A completely different paragraph about psychology and fieldwork.')]});f.worker.onSave(f.vault,f.page.id);}
  if(change==='delete')f.pages.delete(f.vault,f.page.id);
  if(change==='disable')f.worker.saveSettings(f.vault,{automatic:false});
  if(change==='lock')f.vaults.lock(f.vault,{passphrase:'test-passphrase'});
  finish();await pending;
  assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings WHERE segment_id IN (SELECT id FROM page_segments WHERE page_id=?)',f.page.id).n,0);
  assert.notEqual(f.store.get('SELECT status FROM embedding_jobs WHERE page_id=?',f.page.id).status,'completed');
 });
});
test('concurrent and repeated queries share one vector across search and retrieval, with current results',async t=>{
 let finish;const f=fixture(t,()=>new Promise(resolve=>{finish=()=>resolve(vector());}));ready(f);
 const first=f.worker.search(f.vault,{query:'inverses'}),second=f.worker.search(f.vault,{query:' inverses ',limit:1});
 assert.equal(f.calls(),1);finish();await Promise.all([first,second]);
 const added=f.pages.create(f.vault,{title:'Another note'});f.pages.update(f.vault,added.id,{...added,blocks:[paragraph('Multiplicative inverses provide useful evidence in this new note.')]});f.segments.synchronize(f.vault,added.id);
 f.index.save(f.store.get('SELECT * FROM page_segments WHERE page_id=?',added.id),vector().embedding,12);
 const results=await f.worker.search(f.vault,{query:'inverses'});assert.ok(results.results.some(result=>result.id===added.id));
 await f.worker.retrievePassages(f.vault,{query:'inverses'});
 assert.equal(f.calls(),1);assert.equal(f.log.list(null).items.filter(row=>row.action==='search_embedding').length,1);
});
test('query cache is vault-scoped, expires, is bounded, and clears explicitly',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T12:00:00Z')});
 const f=fixture(t);ready(f);
 await f.worker.search(f.vault,{query:'inverses'});await f.worker.search(f.vault,{query:'inverses'});assert.equal(f.calls(),1);
 const other=f.vaults.create({name:'Other'}).id,p=f.pages.create(other,{title:'Other algebra'});f.pages.update(other,p.id,{...p,blocks:[paragraph('Multiplicative inverses are discussed in a different vault.')]});f.segments.synchronize(other,p.id);
 f.index.save(f.store.get('SELECT * FROM page_segments WHERE page_id=?',p.id),vector().embedding,12);
 await f.worker.search(other,{query:'inverses'});assert.equal(f.calls(),2);
 f.worker.clearQueryCache(f.vault);await f.worker.search(f.vault,{query:'inverses'});assert.equal(f.calls(),3);
 await f.worker.search(other,{query:'inverses'});assert.equal(f.calls(),3);
 t.mock.timers.tick(5*60_000);await f.worker.search(f.vault,{query:'inverses'});assert.equal(f.calls(),4);
 for(let i=0;i<128;i++)await f.worker.search(f.vault,{query:'query '+i});
 const before=f.calls();await f.worker.search(f.vault,{query:'inverses'});assert.equal(f.calls(),before+1);
 f.setConfigured(false);await assert.rejects(f.worker.search(f.vault,{query:'inverses'}),{status:409});
 f.setConfigured(true);f.vaults.lock(f.vault,{passphrase:'test-passphrase'});await assert.rejects(f.worker.search(f.vault,{query:'inverses'}),{status:423});
});
test('failed and malformed query embeddings are evicted and can retry',async t=>{
 for(const malformed of [false,true])await t.test(String(malformed),async t=>{
  let attempts=0;const f=fixture(t,async()=>{if(++attempts===1){if(malformed)return {embedding:[NaN],tokens:0};throw Object.assign(new Error('Busy'),{status:429});}return vector();});ready(f);
  await assert.rejects(f.worker.search(f.vault,{query:'inverses'}));
  await f.worker.search(f.vault,{query:'inverses'});await f.worker.search(f.vault,{query:'inverses'});assert.equal(f.calls(),2);
 });
});

test('database restart upgrades the old blanket cancellation trigger without losing queued work',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=mkdtempSync(path.join(tmpdir(),'noema-embedding-migration-')),filename=path.join(dir,'test.sqlite');let db=openDatabase(filename);
 try {
  let store=new Store(db);const segments=new PageSegments(store);segments.synchronize('default','welcome');new PageSegmentIndex(store).enqueue('default','welcome','save',0);
  const job=store.get("SELECT id FROM embedding_jobs WHERE page_id='welcome' AND status='queued'");assert.ok(job);
  db.exec("DROP TRIGGER page_index_update; CREATE TRIGGER page_index_update AFTER UPDATE OF revision ON pages BEGIN UPDATE embedding_jobs SET status='skipped' WHERE page_id=NEW.id AND status IN ('queued','running'); END;");
  db.close();db=openDatabase(filename);store=new Store(db);store.run("UPDATE pages SET revision=revision+1 WHERE id='welcome'");
  assert.equal(store.get('SELECT status FROM embedding_jobs WHERE id=?',job.id).status,'queued');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
