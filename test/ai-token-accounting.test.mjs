import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
const selection={model:'test-model',reasoningEffort:'none'};
test('cache token counts persist without debug traces and survive restart and migration',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-cache-usage-')),filename=path.join(dir,'test.sqlite');let db=openDatabase(filename);
 try {
  let log=new AIActivityLog(new Store(db));const id=log.start('page_title',selection);const observer=log.request(id,100,1);
  observer.usage({input_tokens:3056,output_tokens:24,input_tokens_details:{cached_tokens:0,cache_write_tokens:3053}});log.finish(id,'completed',200);
  let item=log.list(null).items[0];assert.equal(item.cachedInputTokens,0);assert.equal(item.cacheWriteTokens,3053);assert.equal(item.inputTokens,3056);assert.equal(item.outputTokens,24);
  assert.equal(item.debugRecorded,false);assert.equal(db.prepare('SELECT count(*) AS n FROM ai_activity_debug').get().n,0);
  db.close();db=openDatabase(filename);log=new AIActivityLog(new Store(db));item=log.list(null).items[0];
  assert.equal(item.cachedInputTokens,0);assert.equal(item.cacheWriteTokens,3053);
  // Legacy databases lack both columns. Reopening must add them without losing activity.
  db.exec('ALTER TABLE ai_activity DROP COLUMN cached_input_tokens; ALTER TABLE ai_activity DROP COLUMN cache_write_tokens;');db.close();db=openDatabase(filename);
  item=new AIActivityLog(new Store(db)).list(null).items[0];assert.equal(item.inputTokens,3056);assert.equal(item.cachedInputTokens,null);assert.equal(item.cacheWriteTokens,null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('usage supports both provider formats, partial events, valid zeros and missing or malformed details',()=>{
 const db=openDatabase(':memory:');try {
  const log=new AIActivityLog(new Store(db)),id=log.start('page_summary',selection),observer=log.request(id,100,1);
  observer.usage({prompt_tokens:2000,completion_tokens:12,prompt_tokens_details:{cached_tokens:1024,cache_write_tokens:0}});
  observer.usage({input_tokens_details:{cached_tokens:-1,cache_write_tokens:1.5}});observer.usage({input_tokens_details:[]});
  let item=log.list(null).items.find(item=>item.id===id);assert.equal(item.cachedInputTokens,1024);assert.equal(item.cacheWriteTokens,0);assert.equal(item.inputTokens,2000);
  const embedding=log.start('search_embedding',selection);log.request(embedding,20,null).usage({prompt_tokens:3,total_tokens:3});
  item=log.list(null).items.find(item=>item.id===embedding);assert.equal(item.outputTokens,0);assert.equal(item.cachedInputTokens,null);assert.equal(item.cacheWriteTokens,null);
  log.clear();observer.usage({input_tokens:2,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}});assert.equal(log.list(null).items.length,0);
 }finally{db.close();}
});
test('older debug snapshots backfill cache counts even when total counts already exist',()=>{
 const db=openDatabase(':memory:');try {
  let log=new AIActivityLog(new Store(db));log.saveDebugSettings({enabled:true});const id=log.start('page_title',selection),trace=log.request(id,100,1);
  const usage={input_tokens:3056,output_tokens:24,input_tokens_details:{cached_tokens:2048,cache_write_tokens:1000}};
  trace.usage(usage);trace.response({usage});log.finish(id,'completed',200);
  db.prepare('UPDATE ai_activity SET cached_input_tokens=NULL,cache_write_tokens=NULL WHERE id=?').run(id);
  log=new AIActivityLog(new Store(db));const row=log.list(null).items[0];assert.equal(row.cachedInputTokens,2048);assert.equal(row.cacheWriteTokens,1000);assert.equal(row.inputTokens,3056);
 }finally{db.close();}
});
