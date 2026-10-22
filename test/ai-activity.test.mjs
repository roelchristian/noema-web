import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { AIActivityLog } from '../src/server/modules/ai-activity.ts';
const selection={model:'test-model',reasoningEffort:'low'};

test('activity keeps over 1,000 recent records, paginates and recovers interrupted requests',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-activity-')),filename=path.join(dir,'test.sqlite');
  let db=openDatabase(filename);
  try {
    let log=new AIActivityLog(new Store(db));
    for(let i=0;i<1005;i++){const id=log.start('connection_test',selection);log.finish(id,'completed',200);}
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_activity').get().count,1005);
    const seen=new Set();let cursor=null;
    do {
      const page=log.list(cursor);assert.ok(page.items.length>0&&page.items.length<=50);
      for(const item of page.items){assert.ok(!seen.has(item.id));seen.add(item.id);}
      cursor=page.nextCursor===null?null:String(page.nextCursor);
    }while(cursor!==null);
    assert.equal(seen.size,1005);
    const pending=log.start('connection_test',selection);log.request(pending,42,null);
    db.close();db=openDatabase(filename);log=new AIActivityLog(new Store(db));
    const recovered=log.list(null).items[0];
    assert.equal(recovered.id,pending);assert.equal(recovered.status,'interrupted');assert.ok(recovered.finishedAt);
    assert.equal(recovered.promptBytes,42);assert.equal(recovered.model,'test-model');
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_activity').get().count,1006);
    for(const value of ['-1','1.5','NaN','9007199254740992','0'])assert.throws(()=>log.list(value),e=>e.status===400);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('activity references survive deletion without retaining page contents or titles',()=>{
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db)),id=log.start('page_summary',selection,'default','welcome');
    log.finish(id,'completed',200);
    assert.equal(log.list(null).items[0].available,true);
    db.prepare('DELETE FROM pages WHERE id=?').run('welcome');
    const item=log.list(null).items[0];
    assert.equal(item.objectId,'welcome');assert.equal(item.objectTitle,null);assert.equal(item.available,false);
  }finally{db.close();}
});

test('clearing activity removes all visible rows and keeps locked vault records',()=>{
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db));
    const visible=log.start('page_summary',selection,'default','welcome');
    const global=log.start('connection_test',selection);
    db.prepare('UPDATE vaults SET locked=1 WHERE id=?').run('default');
    assert.deepEqual(log.list(null).items.map(item=>item.id),[global]);
    log.clear();
    assert.equal(log.list(null).items.length,0);
    assert.equal(db.prepare('SELECT id FROM ai_activity').get().id,visible);
    db.prepare('UPDATE vaults SET locked=0 WHERE id=?').run('default');
    log.clear();
    log.finish(visible,'completed',200);
    assert.equal(log.list(null).items.length,0);
  }finally{db.close();}
});

test('compact provider capture retains diagnostics without source, vectors, SSE copies or repeated downloads',async()=>{
  const {redactedTrace}=await import('../src/server/modules/openai-response.ts');
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db));assert.equal(log.debugSettings().mode,'off');
    log.saveDebugSettings({enabled:true});const id=log.start('note_embedding',selection),trace=redactedTrace(log.request(id,100,3),'sk-secret');
    trace.request('/embeddings',{model:'test',input:['private content'],dimensions:1536});
    trace.response({model:'test',data:[{embedding:Array(1536).fill(0.123456),index:0}],usage:{prompt_tokens:10}});
    trace.event('validation',{valid:true});trace.event('response.output_text.delta',{delta:'private output'});
    trace.stream({eventCount:500,textBytes:3000});trace.usage({prompt_tokens:10});log.finish(id,'completed',200);
    const debug=log.debug(id,{includeEvents:false}),serialized=JSON.stringify(debug),response=JSON.parse(debug.response);
    assert.equal(debug.mode,'compact');assert.equal(debug.responseBody,'');assert.equal(response.vectorCount,1);assert.equal(response.stream.eventCount,500);assert.equal(JSON.parse(debug.request).inputBytes,15);
    assert.ok(!serialized.includes('private content'));assert.ok(!serialized.includes('0.123456'));assert.ok(!serialized.includes('private output'));
    assert.equal(debug.eventCount,1);assert.equal(log.debug(id,{after:debug.revision,includeEvents:false}).unchanged,true);
    assert.equal(log.debug(id,{includeEvents:true,limit:1}).events[0].type,'validation');
    assert.equal(log.list(null).items[0].inputTokens,10);
  }finally{db.close();}
});

test('debug sessions expire, quotas do not affect generation, pagination and age pruning protect active captures',()=>{
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db));log.saveDebugSettings({enabled:true,fullTraceMinutes:10});assert.equal(log.debugSettings().mode,'full');
    const full=log.start('page_summary',selection),trace=log.request(full,100,1);
    trace.request('/responses',{input:'x'.repeat(3*1024*1024)});trace.error('still useful');
    assert.equal(log.debug(full).truncated,true);assert.equal(log.debug(full).error,'still useful');
    for(let i=0;i<5;i++)trace.event('event',{index:i});
    const first=log.debug(full,{limit:2});assert.equal(first.events.length,2);assert.equal(first.hasMoreEvents,true);
    const second=log.debug(full,{limit:2,eventCursor:first.nextEventCursor});assert.ok(second.events[0].sequence>first.events[1].sequence);
    db.prepare("UPDATE metadata SET value=? WHERE key='ai_debug_full_until'").run(new Date(Date.now()-1000).toISOString());assert.equal(log.debugSettings().mode,'compact');
    log.finish(full,'completed',200);db.prepare("UPDATE ai_activity SET finished_at=datetime('now','-31 days') WHERE id=?").run(full);
    const active=log.start('page_summary',selection),legacy=log.start('page_summary',selection);log.finish(legacy,'completed',200);
    db.prepare("UPDATE ai_activity_debug SET mode='legacy',updated_at='2000-01-01' WHERE activity_id=?").run(legacy);
    db.prepare("UPDATE ai_activity SET finished_at=datetime('now','-31 days') WHERE id=?").run(legacy);
    db.prepare("UPDATE ai_activity_debug SET updated_at='2000-01-01' WHERE activity_id=?").run(active);
    log.start('connection_test',selection);assert.throws(()=>log.debug(full),e=>e.status===404);assert.equal(log.debug(active).status,'running');assert.throws(()=>log.debug(legacy),e=>e.status===404);
  }finally{db.close();}
});

test('30-day debug expiry leaves a year of activity and token usage independently of trace mode',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),log=new AIActivityLog(store);log.saveDebugSettings({enabled:true});
  const records=[];
  for(const [mode,days] of [['compact',29],['full',29],['legacy',29],['compact',31],['full',31],['legacy',31],['compact',360],['compact',367]]) {
   const id=log.start('page_summary',selection),trace=log.request(id,10,1);trace.usage({input_tokens:100,output_tokens:20});log.finish(id,'completed',200);
   db.prepare("UPDATE ai_activity SET started_at=datetime('now',?),finished_at=datetime('now',?) WHERE id=?").run(`-${days} days`,`-${days} days`,id);
   db.prepare("UPDATE ai_activity_debug SET mode=?,updated_at=datetime('now') WHERE activity_id=?").run(mode,id);
   records.push({id,mode,days});
  }
  const items=log.list(null).items;
  assert.equal(items.length,7);assert.equal(items.reduce((sum,item)=>sum+item.inputTokens,0),700);
  for(const {id,days} of records) {
   assert.equal(items.some(item=>item.id===id),days<365);
   assert.equal(!!db.prepare('SELECT 1 FROM ai_activity_debug WHERE activity_id=?').get(id),days<30);
  }
 }finally{db.close();}
});

test('debug cleanup backfills usage and preserves activity, locked vault records and running traces',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),log=new AIActivityLog(store);log.saveDebugSettings({enabled:true});
  const complete=log.start('page_summary',selection,'default','welcome'),trace=log.request(complete,10,1);
  trace.event('validation',{valid:true});log.finish(complete,'completed',200);
  db.prepare('UPDATE ai_activity_debug SET mode=?,response=? WHERE activity_id=?').run('legacy',JSON.stringify({usage:{input_tokens:123,output_tokens:45,input_tokens_details:{cached_tokens:12},output_tokens_details:{reasoning_tokens:9}}}),complete);
  const running=log.start('page_summary',selection,'default','welcome');log.request(running,20,2);
  db.prepare('UPDATE vaults SET locked=1 WHERE id=?').run('default');
  const maintenance=new AIActivityLog(store,{recoverRunning:false}),result=maintenance.cleanupDebug();
  assert.equal(result.deletedTraces,1);assert.equal(result.deletedEvents,1);
  assert.equal(db.prepare('SELECT count(*) count FROM ai_activity').get().count,2);
  const usage=db.prepare('SELECT input_tokens,output_tokens,cached_input_tokens,reasoning_tokens FROM ai_activity WHERE id=?').get(complete);
  assert.deepEqual({...usage},{input_tokens:123,output_tokens:45,cached_input_tokens:12,reasoning_tokens:9});
  assert.equal(db.prepare('SELECT status FROM ai_activity WHERE id=?').get(running).status,'running');
  assert.ok(db.prepare('SELECT 1 FROM ai_activity_debug WHERE activity_id=?').get(running));
  assert.equal(maintenance.cleanupDebug().deletedTraces,0);
 }finally{db.close();}
});
