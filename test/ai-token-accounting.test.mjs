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

test('published prices cover every wired model and estimate cache writes, long prompts, embeddings and Gemini speech',async()=>{
 const {intelligenceModels,geminiSpeechModel,openAISpeechModel}=await import('../src/shared/intelligence.ts');
 const {publishedModelPricing}=await import('../src/shared/ai-pricing.ts');
 for(const model of [...intelligenceModels.map(model=>model.id),geminiSpeechModel,openAISpeechModel,'text-embedding-3-small'])assert.ok(publishedModelPricing.models[model],model);
 const db=openDatabase(':memory:');try{
  const log=new AIActivityLog(new Store(db));
  const record=(model,usage,action='page_summary')=>{const id=log.start(action,{model,reasoningEffort:'none'});log.request(id,100,1).usage(usage);log.finish(id,'completed',200);return log.list(null).items.find(item=>item.id===id);};
  const row=record('gpt-6-luna',{input_tokens:1000,output_tokens:200,input_tokens_details:{cached_tokens:400,cache_write_tokens:100},output_tokens_details:{reasoning_tokens:150}});
  assert.equal(row.estimatedCost,(500*0.1+400*0.01+100*0.125+200*0.5)/1e6);
  assert.match(row.pricingVersion,/published-2026-10-25/);
  const long=record('gpt-6.1-sol',{input_tokens:272001,output_tokens:200,input_tokens_details:{cached_tokens:1000}});
  assert.equal(long.estimatedCost,((271001*2+1000*0.1)*2+200*10*1.5)/1e6);
  assert.equal(record('text-embedding-3-small',{prompt_tokens:1000},'search_embedding').estimatedCost,0.00002);
  assert.equal(record(geminiSpeechModel,{input_tokens:100,output_tokens:250},'text_to_speech').estimatedCost,0.00155);
  assert.equal(record('unknown-model',{input_tokens:100,output_tokens:250}).estimatedCost,null);
  assert.equal(record('gpt-6-luna',{input_tokens:100}).estimatedCost,null);
  assert.equal(record('gpt-6-luna',{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:101}}).estimatedCost,null);
 }finally{db.close();}
});

test('OpenAI speech estimates use reported text/audio and cached modality counts',()=>{
 const db=openDatabase(':memory:');try{
  const log=new AIActivityLog(new Store(db)),id=log.start('text_to_speech',{model:'gpt-realtime-2.1-mini',reasoningEffort:'none'}),observer=log.request(id,100,null);
  observer.usage({input_tokens:100,output_tokens:200});assert.equal(log.list(null).items[0].estimatedCost,null);
  observer.usage({input_tokens:100,output_tokens:200,input_tokens_details:{text_tokens:80,audio_tokens:20,cached_tokens:30,cached_tokens_details:{text_tokens:20,audio_tokens:10}},output_tokens_details:{text_tokens:50,audio_tokens:150}});
  log.finish(id,'completed',200);
  assert.equal(log.list(null).items[0].estimatedCost,(60*0.6+20*0.06+10*10+10*0.3+50*2.4+150*20)/1e6);
  assert.equal(new AIActivityLog(new Store(db)).list(null).items[0].estimatedCost,log.list(null).items[0].estimatedCost);
 }finally{db.close();}
});

test('legacy usage gets a versioned snapshot estimate on startup while existing estimates survive',()=>{
 const db=openDatabase(':memory:');try{
  let log=new AIActivityLog(new Store(db));const id=log.start('page_summary',{model:'gpt-5-mini',reasoningEffort:'low'});
  log.request(id,100,1).usage({input_tokens:1000,output_tokens:200});log.finish(id,'completed',200);
  db.prepare('UPDATE ai_activity SET estimated_cost=NULL,pricing_version=NULL WHERE id=?').run(id);
  log=new AIActivityLog(new Store(db));const row=log.list(null).items[0];assert.equal(row.estimatedCost,0.00065);
  db.prepare("UPDATE ai_activity SET estimated_cost=42,pricing_version='historic' WHERE id=?").run(id);
  log=new AIActivityLog(new Store(db));assert.equal(log.list(null).items[0].estimatedCost,42);assert.equal(log.list(null).items[0].pricingVersion,'historic');
  const future=log.start('text_to_speech',{model:'gemini-3.8-flash-lite-tts',reasoningEffort:'none'});
  db.prepare("UPDATE ai_activity SET started_at='2027-01-01T00:00:00Z' WHERE id=?").run(future);
  log.request(future,100,null).usage({input_tokens:100,output_tokens:250});assert.equal(log.list(null).items.find(row=>row.id===future).estimatedCost,0.0031);
 }finally{db.close();}
});
