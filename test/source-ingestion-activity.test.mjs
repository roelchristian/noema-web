import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {sourceIngestionWithActivity} from '../src/server/modules/source-ingestion-activity.ts';
import {DocumentProviderError} from '../src/server/modules/document-provider.ts';
const secret='PRIVATE_DOCUMENT_PROMPT_AND_PROVIDER_SECRET';
function setup(t){const root=mkdtempSync(path.join(tmpdir(),'noema-ingestion-activity-')),db=openDatabase(path.join(root,'db.sqlite')),store=new Store(db),log=new AIActivityLog(store),files=new SourceFiles(store);store.run("INSERT INTO entities(id,vault_id,type,name,updated_at) VALUES('activity-source','default','source','Synthetic','2026-10-26')");const file=files.add('default','synthetic.pdf',Buffer.from('%PDF-1.4\n%%EOF'),'activity-source',undefined,false,true);t.after(()=>{files.close();db.close();rmSync(root,{recursive:true,force:true});});return {store,log,file,scope:{vaultId:'default',fileId:file.id,phase:'extract'}};}
const request={model:'gpt-6.1-sol',pdf:Buffer.from(secret),pages:1,prompt:secret,schema:{},maxOutputTokens:1000};
const usage={inputTokens:10,outputTokens:20,thinkingTokens:3,cachedInputTokens:2,cacheWriteTokens:1};
function provider(extract,kind='openai'){return {provider:kind,extract};}
const completed=()=>({status:'completed',candidate:{text:secret},requestId:secret,requestedModel:'gpt-6.1-sol',returnedModel:'gpt-6.1-sol',usage,outcomeCertainty:'known',responseHash:secret});
test('all document phases record one scoped activity without content traces, even full debug',async t=>{
 const f=setup(t);f.log.saveDebugSettings({enabled:true,fullTraceMinutes:10});let calls=0;
 for(const phase of ['extract','repair','relate','recover']){const result=await sourceIngestionWithActivity(f.log,f.store,{...f.scope,phase},provider(async input=>{calls++;assert.equal(input.pdf,request.pdf);assert.equal(input.prompt,request.prompt);assert.equal(input.model,request.model);input.onSubmitted?.('synthetic-request');return completed();}),request);assert.equal(result.candidate.text,secret);}
 assert.equal(calls,4);const rows=f.log.list(null).items;assert.equal(rows.length,4);
 for(const row of rows){assert.equal(row.action,'source_ingestion');assert.equal(row.status,'completed');assert.equal(row.vaultId,'default');assert.equal(row.objectId,'activity-source');assert.equal(row.objectKind,'entity');assert.equal(row.available,true);assert.equal(row.inputTokens,10);assert.equal(row.outputTokens,20);assert.equal(row.reasoningTokens,3);assert.equal(row.cachedInputTokens,2);assert.equal(row.cacheWriteTokens,1);assert.ok(row.estimatedCost>0);const trace=f.log.debug(row.id);assert.equal(trace.request,null);assert.equal(trace.response,null);assert.equal(trace.responseBody,'');assert.ok(!JSON.stringify(trace).includes(secret));assert.match(JSON.stringify(trace.events),/phase/);}
});
test('Gemini thinking totals are normalized without fabricating missing catalog prices',async t=>{const f=setup(t);await sourceIngestionWithActivity(f.log,f.store,f.scope,provider(async()=>completed(),'gemini'),{...request,model:'gemini-3.8-flash'});const row=f.log.list(null).items[0];assert.equal(row.outputTokens,23);assert.equal(row.reasoningTokens,3);assert.equal(row.estimatedCost,null);assert.equal(row.pricingVersion,null);});
test('known incomplete results retain usage as failed without any provider replay',async t=>{const f=setup(t);let calls=0;await sourceIngestionWithActivity(f.log,f.store,f.scope,provider(async()=>{calls++;return {...completed(),status:'incomplete',candidate:undefined};}),request);const row=f.log.list(null).items[0];assert.equal(row.status,'failed');assert.equal(row.outputTokens,20);assert.equal(calls,1);});
test('unknown paid outcome is interrupted and raw error text never reaches full debug',async t=>{const f=setup(t);f.log.saveDebugSettings({enabled:true,fullTraceMinutes:10});let calls=0;await assert.rejects(()=>sourceIngestionWithActivity(f.log,f.store,f.scope,provider(async()=>{calls++;throw new DocumentProviderError('transport',502,secret,true);}),request),error=>error.message===secret);const row=f.log.list(null).items[0],trace=f.log.debug(row.id);assert.equal(row.status,'interrupted');assert.equal(row.httpStatus,null);assert.match(trace.error,/outcome unknown/);assert.ok(!JSON.stringify(trace).includes(secret));assert.equal(calls,1);});
test('known provider rejection and predispatch cancellation remain distinct',async t=>{const f=setup(t);for(const error of [new DocumentProviderError('cancelled',409,secret,false),new DocumentProviderError('rate_limit',429,secret,false)])await assert.rejects(()=>sourceIngestionWithActivity(f.log,f.store,f.scope,provider(async()=>{throw error;}),request));const rows=f.log.list(null).items;assert.equal(rows[0].status,'failed');assert.equal(rows[0].httpStatus,429);assert.equal(rows[1].status,'skipped');assert.equal(rows[1].promptBytes,null);});
test('activity persistence failure cannot discard successful paid document output or repeat calls',async t=>{const f=setup(t);let calls=0;const result=await sourceIngestionWithActivity({start(){throw Error('log unavailable');}},f.store,f.scope,provider(async()=>{calls++;return completed();}),request);assert.equal(result.status,'completed');assert.equal(calls,1);});

test('an unclassified failure after dispatch remains an unknown paid activity outcome',async t=>{const f=setup(t);let calls=0;await assert.rejects(()=>sourceIngestionWithActivity(f.log,f.store,f.scope,provider(async input=>{calls++;input.onSubmitted?.('synthetic-dispatched');throw Error(secret);}),request));assert.equal(f.log.list(null).items[0].status,'interrupted');assert.equal(calls,1);});
