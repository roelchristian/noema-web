import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
const embedded=()=>Response.json({model:'text-embedding-3-small',data:[{index:0,embedding:[1,...Array(1535).fill(0)]}],usage:{total_tokens:8}});
function fixture(){
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store),activity=new AIActivityLog(store);
 const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 let handler=async()=>embedded();
 const ai=new Intelligence(secrets,async()=>handler());ai.save({apiKey:'sk-test-embedding-activity-credential'});
 const worker=new Embeddings(store,pages,knowledge,vaults,ai,activity);
 worker.saveSettings('default',{automatic:false});
 let page=pages.create('default',{title:'Index fixture'});
 function update(text='Private note text about careful gardening and planting.'){page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text}]}]});return page;}
 function queue(){worker.onSave('default',page.id);new PageSegments(store).synchronize('default',page.id);new PageSegmentIndex(store).enqueue('default',page.id,'backfill',0);store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");}
 update();
 return {db,store,worker,pages,vaults,activity,update,queue,get page(){return page;},handler(value){handler=value;},close(){worker.close();db.close();}};
}

test('note and search embeddings record running/completed attempts with metadata and no content',async()=>{
 const f=fixture();let release;
 try{
  f.handler(()=>new Promise(resolve=>{release=resolve;}));f.queue();
  const pending=f.worker.tick();
  let item=f.activity.list(null).items[0];
  assert.equal(item.action,'note_embedding');assert.equal(item.status,'running');assert.equal(item.objectId,f.page.id);
  assert.equal(item.vaultId,'default');assert.equal(item.revision,null);assert.equal(item.model,'text-embedding-3-small');
  assert.equal(item.promptBytes,Buffer.byteLength(f.page.title+'\n\n'+f.page.blocks[0].content[0].text));
  release(embedded());await pending;
  item=f.activity.list(null).items[0];assert.equal(item.status,'completed');assert.equal(item.httpStatus,200);assert.ok(item.finishedAt);assert.ok(item.durationMs>=0);
  f.handler(async()=>embedded());
  await f.worker.search('default',{query:'private search phrase'});
  item=f.activity.list(null).items[0];
  assert.equal(item.action,'search_embedding');assert.equal(item.status,'completed');assert.equal(item.vaultName,'Personal vault');
  assert.equal(item.objectId,null);assert.equal(item.revision,null);assert.equal(item.promptBytes,Buffer.byteLength('private search phrase'));
  const raw=JSON.stringify(f.store.all('SELECT * FROM ai_activity'));
  for(const secret of ['Private note text','private search phrase','sk-test-embedding-activity-credential','Index fixture'])assert.ok(!raw.includes(secret));
  f.vaults.lock('default',{passphrase:'lock-fixture'});assert.equal(f.activity.list(null).items.length,0);
  f.activity.clear();f.vaults.unlock('default',{passphrase:'lock-fixture'});assert.equal(f.activity.list(null).items.length,2);
  f.handler(async()=>Response.json({error:{message:'private upstream error'}},{status:429}));
  await assert.rejects(f.worker.search('default',{query:'failed search'}),e=>e.status===429);
  item=f.activity.list(null).items[0];assert.equal(item.status,'failed');assert.equal(item.httpStatus,429);
  assert.ok(!JSON.stringify(f.activity.list(null)).includes('private upstream error'));
  f.activity.clear();assert.equal(f.activity.list(null).items.length,0);
 }finally{f.close();}
});

test('embedding retries, discarded results, interruption and clear retain accurate activity outcomes',async()=>{
 const f=fixture();let release;
 try{
  f.handler(async()=>Response.json({error:{message:'do not log'}},{status:503}));f.queue();await f.worker.tick();
  const failed=f.activity.list(null).items[0];assert.equal(failed.status,'failed');assert.equal(failed.httpStatus,502);
  f.handler(async()=>embedded());f.store.run("UPDATE embedding_jobs SET next_attempt_at='2000-01-01' WHERE status='queued'");await f.worker.tick();
  let items=f.activity.list(null).items;assert.equal(items.length,2);assert.equal(items[0].status,'completed');assert.equal(items[1].id,failed.id);
  f.update('Revised note text that should have a new embedding.');f.queue();
  f.handler(()=>new Promise(resolve=>{release=resolve;}));const changed=f.worker.tick();await Promise.resolve();
  f.update('Another revision while the request is running.');f.worker.onSave('default',f.page.id);
  assert.ok(release);release(embedded());await changed;assert.equal(f.activity.list(null).items[0].status,'skipped');
  f.queue();const interrupted=f.worker.tick();await Promise.resolve();const runningId=f.activity.list(null).items[0].id;
  f.worker.close();let item=f.activity.list(null).items[0];assert.equal(item.id,runningId);assert.equal(item.status,'interrupted');assert.equal(item.httpStatus,null);
  release(embedded());await interrupted;assert.equal(f.activity.list(null).items[0].status,'interrupted');
 }finally{f.close();}
});

test('clearing running embedding activity does not recreate its record on completion',async()=>{
 const f=fixture();let release;
 try{
  f.handler(()=>new Promise(resolve=>{release=resolve;}));f.queue();const pending=f.worker.tick();
  f.activity.clear();release(embedded());await pending;
  assert.deepEqual(f.activity.list(null).items,[]);
  const empty=f.vaults.create({name:'Unindexed vault'});
  await f.worker.search(empty.id,{query:'not sent'});assert.deepEqual(f.activity.list(null).items,[],'A search without an indexed note makes no embedding request');
 }finally{f.close();}
});
