import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourceIngestion} from '../src/server/modules/source-ingestion.ts';
import {SourceDocuments} from '../src/server/modules/source-documents.ts';
import {applySourceIngestionEnrichment} from '../src/server/modules/source-ingestion-enrichment.ts';
import {DocumentProviderError} from '../src/server/modules/document-provider.ts';
const options=route=>({route,model:route==='openai'?'gpt-6.1-sol':'gemini-3.8-flash',depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:20,maxOutputTokens:32000,maxCostUsd:null}});
const sha=value=>createHash('sha256').update(value).digest('hex');
function ir(pages,text='Faithful synthetic 😀 source text.'){return {schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:pages.map(number=>({number,printedLabel:String(number+3),role:'owned',state:'content',unresolved:[]})),blocks:pages.map(page=>({id:`b${page}`,page,order:0,kind:'paragraph',text:`${text} Page ${page}.`,headingLevel:null,continues:null,table:null,uncertainty:null,location:null})),relations:[],repairs:[]};}
function setup(t,{route='openai',pages=2,extract}={}){
 const root=mkdtempSync(path.join(tmpdir(),'noema-ingestion-test-')),db=openDatabase(path.join(root,'test.sqlite')),store=new Store(db),files=new SourceFiles(store);
 store.run("INSERT INTO entities(id,vault_id,type,name,updated_at) VALUES('source','default','source','Synthetic','2026-10-26')");
 const file=files.add('default','synthetic.pdf',Buffer.from('%PDF-1.4\n%%EOF'),'source',undefined,false,true);
 let calls=0;
 const dependencies={prepare:async()=>{store.run('UPDATE source_files SET admitted=1 WHERE id=?',file.id);return {bytes:Buffer.from('admitted-synthetic'),originalHash:sha('original'),admittedHash:sha('admitted-synthetic'),pageCount:pages};},split:async(bytes,pageMap)=>({bytes,pageMap}),extract:async input=>{calls++;if(extract)return extract(input,calls);input.onSubmitted('synthetic-request');return {status:'completed',candidate:ir(input.plan.ownedPages),requestId:'synthetic-request',usage:{inputTokens:10,outputTokens:20,thinkingTokens:0,cachedInputTokens:0},responseHash:sha('response'),returnedModel:options(route).model};}};
 const ingestion=new SourceIngestion(store,dependencies);files.bindIngestion(ingestion);
 t.after(()=>{ingestion.close();files.close();db.close();rmSync(root,{recursive:true,force:true});});
 return {store,files,file,ingestion,dependencies,calls:()=>calls,options:options(route)};
}
// These fixtures represent retained optional failures/checkpoints created by
// older workflows. Retrying them is explicit and must never replay extraction.
function retryLegacyOptionalFailure(f){f.store.run("UPDATE source_ingestion_windows SET repair_state='failed',error='Retained optional repair failure' WHERE kind='extraction' AND run_id=?",f.ingestion.view('default',f.file.id).id);f.ingestion.retry('default',f.file.id);}
function resumeLegacyRelationCheckpoint(f,pages=[5,6]){const run=f.ingestion.view('default',f.file.id);f.store.run("INSERT INTO source_ingestion_windows(id,run_id,ordinal,kind,plan_json,repair_state) VALUES('legacy-relation',?,999,'relations',?,'skipped')",run.id,JSON.stringify({index:999,ownedPages:pages,contextPages:[],estimatedOutputTokens:8000}));f.store.run("UPDATE source_ingestion_runs SET state='paused' WHERE id=?",run.id);f.ingestion.resume('default',f.file.id);}
for(const route of ['openai','gemini'])test(`${route} complete direct import publishes once and rebuilds identical citation anchors without generation`,async t=>{
 const f=setup(t,{route});f.ingestion.stage('default',f.file.id,f.options);f.ingestion.stage('default',f.file.id,f.options);
 await f.files.tick();assert.equal(f.files.require('default',f.file.id).status,'queued');
 await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);
 const file=f.files.require('default',f.file.id);assert.equal(file.enrichment_status,'completed');assert.equal(file.pages,2);assert.match(file.text,/<!-- Page 2 -->/);
 const documents=new SourceDocuments(f.store),before=documents.get(file);assert.equal(before.ingestion.pages[0].printedLabel,'4');assert.equal(before.semantic.children.length,2);
 f.store.run('DELETE FROM source_documents WHERE file_id=?',file.id);assert.deepEqual(documents.get(file),before);
 await f.ingestion.tick();assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT count(*) n FROM source_reprocessing').n,0);
 assert.equal(f.store.get('SELECT status FROM source_author_jobs WHERE file_id=?',file.id).status,'completed');
 assert.throws(()=>f.ingestion.stage('default',file.id,{...f.options,depth:'deep'}),/frozen|immutable/);
});
test('submitted unknown outcome is durable, cannot replay on resume or restart, and explicit recovery preserves usage',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted('may-have-been-paid');throw new DocumentProviderError('transport',502,'uncertain',true);}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).unknownOutcome,true);
 assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);f.ingestion.recover();await f.ingestion.tick();assert.equal(f.calls(),1);
 f.store.run("UPDATE source_ingestion_runs SET state='paused'");assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);
 f.ingestion.resume('default',f.file.id,true);assert.equal(f.ingestion.view('default',f.file.id).state,'pending');
});
test('known rejected request is retryable and is not labelled unknown paid work',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted();throw new DocumentProviderError('rate_limit',429,'quota',false);}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.ingestion.view('default',f.file.id).unknownOutcome,false);
 f.ingestion.resume('default',f.file.id);assert.equal(f.ingestion.view('default',f.file.id).state,'pending');
});
test('incomplete JSON is retained as charged invalid attempt and never appended to source',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted('truncated');return {status:'incomplete',usage:{inputTokens:100,outputTokens:200},responseHash:sha('incomplete')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.files.require('default',f.file.id).text,'');
 assert.equal(f.store.get('SELECT usage_json FROM source_ingestion_attempts').usage_json,'{"inputTokens":100,"outputTokens":200}');assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_documents').n,0);
});
test('stop retains completed window and resume sends only unfinished owned pages',async t=>{
 let fixture;const requested=[];
 const f=setup(t,{pages:10,extract:async input=>{requested.push(input.plan.ownedPages);input.onSubmitted('window');if(requested.length===1)fixture.ingestion.stop('default',fixture.file.id);return {status:'completed',candidate:ir(input.plan.ownedPages),usage:{inputTokens:1,outputTokens:2},responseHash:sha('window')};}});fixture=f;
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'paused');assert.ok(f.ingestion.view('default',f.file.id).completedPages>0);
 f.ingestion.resume('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.deepEqual(requested.flat(),Array.from({length:10},(_,i)=>i+1));
});
test('budget stops safely before paid submission',async t=>{
 const f=setup(t);f.options.budget.maxCostUsd=0.000001;f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.calls(),0);assert.match(f.ingestion.view('default',f.file.id).error,/cost budget/);
});
test('missing physical page rejects publication and retains diagnostic without altering canonical text',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted();return {status:'completed',candidate:ir([1]),usage:{inputTokens:1,outputTokens:1},responseHash:sha('bad')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.files.require('default',f.file.id).text,'');assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_documents').n,0);
});
test('truncated window splits within budget and publishes only complete smaller results',async t=>{
 const f=setup(t,{extract:async(input,n)=>{input.onSubmitted();return n===1?{status:'incomplete',usage:{inputTokens:10,outputTokens:20},responseHash:sha('truncated')}:{status:'completed',candidate:ir(input.plan.ownedPages),usage:{inputTokens:1,outputTokens:2},responseHash:sha('complete')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),3);
 assert.equal(f.ingestion.view('default',f.file.id).completedPages,2);assert.equal(f.ingestion.view('default',f.file.id).totalWindows,2);
 assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_windows WHERE state='superseded'").n,1);
 assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_attempts').n,3);
});
test('fresh uncertain transcription retains inline sparse proposals without scheduling a repair pass',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages,'The ﬁrst source reading.');const block=candidate.blocks[0],start=block.text.indexOf('ﬁrst');block.uncertainty='Ligature needs inspection';candidate.repairs=[{blockId:block.id,start,end:start+4,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Equivalent ligature.'}];return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async()=>{repairs++;throw new Error('Fresh input cannot request a second pass');};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(repairs,0);
 assert.match(f.files.require('default',f.file.id).text,/ﬁrst/);assert.equal(f.ingestion.view('default',f.file.id).pendingReview,0);
 const revision=JSON.parse(f.store.get('SELECT payload FROM source_reprocessing').payload);assert.equal(revision.patches[0].decision,'accepted');assert.match(revision.reprocessed.text,/first/);
 assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_attempts WHERE kind='repair'").n,0);assert.equal(f.store.get("SELECT repair_state FROM source_ingestion_windows WHERE kind='extraction'").repair_state,'skipped');
});
test('unknown targeted repair cannot replay extraction and explicit recovery retries repair only',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Synthetic localized issue';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted('repair');if(repairs===1)throw new DocumentProviderError('transport',502,'uncertain paid repair',true);return {status:'completed',candidate:{repairs:[]},usage:{inputTokens:1,outputTokens:2},responseHash:sha('repair')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(repairs,0);retryLegacyOptionalFailure(f);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'unknown');assert.equal(f.calls(),1);assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);
 f.ingestion.recover();f.ingestion.resume('default',f.file.id,true);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(repairs,2);
});
test('two scheduler instances exclusively claim one paid source run',async t=>{
 let unblock;const blocked=new Promise(resolve=>{unblock=resolve;});
 const f=setup(t);let prepareCount=0;const original=f.dependencies.prepare;f.dependencies.prepare=async(...args)=>{prepareCount++;await blocked;return original(...args);};
 const other=new SourceIngestion(f.store,f.dependencies);t.after(()=>other.close());f.ingestion.stage('default',f.file.id,f.options);
 const first=f.ingestion.tick();await other.tick();unblock();await first;assert.equal(prepareCount,1);assert.equal(f.calls(),1);
});
for(const route of ['openai','gemini'])test(`${route} Linux PDF import uses portable admission, real adapter envelope and mocked transport with exact provenance`,{skip:process.platform!=='linux'},async t=>{
 const {PDFDocument}=await import('pdf-lib');const {writeFileSync}=await import('node:fs');
 const {PdfPlatform}=await import('../dist/server/modules/pdf-platform.js');
 const {OpenAIDocumentProvider}=await import('../src/server/modules/document-provider-openai.ts');const {GeminiDocumentProvider}=await import('../src/server/modules/document-provider-gemini.ts');
 const {SOURCE_INGESTION_JSON_SCHEMA}=await import('../src/server/modules/source-ingestion-validation.ts');
 const f=setup(t,{route}),pdf=await PDFDocument.create();for(let page=1;page<=2;page++)pdf.addPage([200,300]).drawText(`Synthetic source text. Page ${page}.`,{x:10,y:180,size:10});
 const bytes=Buffer.from(await pdf.save({useObjectStreams:false}));writeFileSync(f.files.assetFilename('default',f.file.id),bytes);f.store.run('UPDATE source_files SET size=? WHERE id=?',bytes.length,f.file.id);
 const platform=new PdfPlatform();let generation=0,upload=0,cleanup=0;
 const transport=async(url,request)=>{
  if(request.method==='DELETE'){cleanup++;return Response.json({});}
  if(url.includes('/files')){upload++;return Response.json(route==='openai'?{id:'file-synthetic'}:{file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1/files/synthetic',state:'ACTIVE'}});}
  generation++;const body=JSON.parse(request.body),prompt=body.input[0].content[1].text,plan=JSON.parse(prompt),candidate=ir(plan.ownedPhysicalPages,'Synthetic source text.');
  return Response.json(route==='openai'?{id:'resp-synthetic',status:'completed',model:f.options.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}],usage:{input_tokens:20,output_tokens:30}}:{id:'interaction-synthetic',status:'completed',model:f.options.model,steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(candidate)}]}],usage:{total_input_tokens:20,total_output_tokens:30}});
 };
 const adapter=route==='openai'?new OpenAIDocumentProvider(()=>'synthetic-key',transport):new GeminiDocumentProvider(()=>'synthetic-key',transport);
 f.dependencies.prepare=(file,signal)=>f.files.prepareProviderPDF(file.vault_id,file.id,platform,signal);
 f.dependencies.split=(bytes,pages)=>platform.split(bytes,pages);
 f.dependencies.extract=input=>adapter.extract({model:input.options.model,pdf:input.pdf,pages:input.pageMap.length,prompt:JSON.stringify({ownedPhysicalPages:input.plan.ownedPages,pageMap:input.pageMap}),schema:SOURCE_INGESTION_JSON_SCHEMA,maxOutputTokens:input.options.budget.maxOutputTokens,signal:input.signal,onSubmitted:input.onSubmitted});
 f.dependencies.reconcile=(file,document,assembly,options)=>f.files.publishProviderEvidence(file.vault_id,file.id,assembly.text,{provider:options.route,model:options.model,document});
 f.ingestion.stage('default',f.file.id,f.options);await f.files.tick();await f.ingestion.tick();
 assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(generation,1);assert.equal(upload,1);assert.equal(cleanup,1);
 const file=f.files.require('default',f.file.id),row=f.store.get('SELECT provenance_json FROM source_ingestion_documents WHERE file_id=?',file.id),provenance=JSON.parse(row.provenance_json);
 assert.equal(provenance.originalHash,sha(bytes));assert.equal(provenance.admittedHash,sha(bytes));assert.equal(provenance.returnedModel,f.options.model);assert.equal(provenance.independentEvidence,'not-checked');assert.match(provenance.transmittedHash,/^[a-f0-9]{64}$/);
 const evidence=f.files.evidence('default',file.id);assert.equal(evidence.canonicalHash,sha(file.text));assert.equal(evidence.extractorHash,undefined);assert.equal(evidence.origin,'provider');
 const {SourcePageImages}=await import('../dist/server/modules/source-page-images.js');const images=new SourcePageImages(f.files);t.after(()=>images.close());assert.equal((await images.get('default',file.id,1)).toString('hex',0,8),'89504e470d0a1a0a');
 f.store.run('DELETE FROM source_documents WHERE file_id=?',file.id);assert.equal(new SourceDocuments(f.store).get(file).semantic.children.length,2);assert.equal(generation,1);
});
test('staged unattached PDF options may change before paid work and local selection releases the old run',async t=>{
 const f=setup(t);f.store.run('UPDATE source_files SET entity_id=NULL WHERE id=?',f.file.id);f.ingestion.stage('default',f.file.id,f.options);const first=f.ingestion.view('default',f.file.id).id;
 f.ingestion.stage('default',f.file.id,{...f.options,depth:'deep'});assert.notEqual(f.ingestion.view('default',f.file.id).id,first);
 f.ingestion.stage('default',f.file.id,{...f.options,route:'local',model:null,transmissionConsent:false});assert.equal(f.ingestion.view('default',f.file.id),null);assert.equal(f.files.require('default',f.file.id).ingestion_origin,'local');
});
test('repeated local PDF upload with immutable staging identity reuses bytes and math choice',async t=>{
 const f=setup(t),local={...f.options,route:'local',model:null,transmissionConsent:false},key='synthetic-local-upload-key';
 const bytes=Buffer.from('%PDF-1.4\n%%EOF');const first=await f.files.admit('default','local.pdf',bytes,undefined,()=>{},undefined,false,local,key),second=await f.files.admit('default','local.pdf',bytes,undefined,()=>{},undefined,false,local,key);
 assert.equal(first.id,second.id);await assert.rejects(()=>f.files.admit('default','local.pdf',bytes,undefined,()=>{},undefined,true,local,key),/Staged upload/);
});
test('failed optional repair retries after publication without extraction, metadata reconciliation or canonical mutation',async t=>{
 let repairs=0,reconciliations=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages,'The ﬁrst source reading.');candidate.blocks[0].uncertainty='Ligature needs inspection';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.reconcile=()=>{reconciliations++;};
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted('repair');if(repairs===1)throw new DocumentProviderError('rate_limit',429,'Known optional quota rejection.',false);const block=input.document.blocks[0],start=block.text.indexOf('ﬁrst');return {status:'completed',candidate:{repairs:[{blockId:block.id,start,end:start+4,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Equivalent ligature.'}]},usage:{inputTokens:3,outputTokens:4},responseHash:sha('derivative-repair')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(repairs,0);retryLegacyOptionalFailure(f);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed');assert.equal(f.ingestion.view('default',f.file.id).canRetryOptional,true);
 const file=f.files.require('default',f.file.id),before=f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),sourceDocument=new SourceDocuments(f.store).get(file);
 f.ingestion.retry('default',file.id);assert.equal(f.files.require('default',file.id).status,'ready');await f.ingestion.tick();assert.equal(f.ingestion.view('default',file.id).state,'completed',f.ingestion.view('default',file.id).error);
 assert.equal(f.calls(),1);assert.equal(repairs,2);assert.equal(reconciliations,1);assert.equal(f.files.require('default',file.id).text,file.text);assert.deepEqual(f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),before);assert.deepEqual(new SourceDocuments(f.store).get(f.files.require('default',file.id)),sourceDocument);
 const rows=f.store.all('SELECT payload FROM source_reprocessing WHERE file_id=?',file.id);assert.equal(rows.length,1);const revision=JSON.parse(rows[0].payload);assert.equal(revision.origin.kind,'ingestion');assert.match(revision.origin.repairIdentity,/^[a-f0-9]{64}$/);assert.equal(revision.patches[0].decision,'accepted');assert.match(revision.reprocessed.text,/first/);assert.equal(f.ingestion.view('default',file.id).pendingReview,0);
 f.ingestion.retry('default',file.id);await f.ingestion.tick();assert.equal(repairs,2);assert.equal(f.store.all('SELECT id FROM source_reprocessing WHERE file_id=?',file.id).length,1);
});
test('optional retry enforces revision capacity before paid work while the published source remains readable',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Synthetic localized issue';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted();throw new DocumentProviderError('rate_limit',429,'Known quota rejection.',false);};f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(repairs,0);retryLegacyOptionalFailure(f);await f.ingestion.tick();assert.equal(repairs,1);
 for(let i=0;i<4;i++)f.store.run("INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,'default','completed','2026-10-26','2026-10-26',?)",`slot-${i}`,f.file.id,JSON.stringify({patches:[],report:{},status:'completed'}));
 assert.throws(()=>f.ingestion.retry('default',f.file.id),/limit|capacity/i);assert.equal(repairs,1);assert.equal(f.files.require('default',f.file.id).status,'ready');assert.equal(f.ingestion.view('default',f.file.id).state,'completed');
});
test('application page ceiling rejects unsupported backup size before any paid work',async t=>{
 const f=setup(t,{pages:1001});f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.calls(),0);assert.match(f.ingestion.view('default',f.file.id).error,/1,000 physical pages/);
});
test('postpublication paid repair survives a capacity race and later creates derivative without another provider call',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages,'The ﬁrst source reading.');candidate.blocks[0].uncertainty='Synthetic ligature issue';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted();if(repairs===1)throw new DocumentProviderError('rate_limit',429,'Known quota rejection.',false);
  for(let i=0;i<4;i++)f.store.run("INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,'default','completed','2026-10-26','2026-10-26',?)",`racing-slot-${i}`,f.file.id,JSON.stringify({patches:[],report:{},status:'completed'}));
  const block=input.document.blocks[0],start=block.text.indexOf('ﬁrst');return {status:'completed',candidate:{repairs:[{blockId:block.id,start,end:start+4,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Equivalent ligature.'}]},usage:{inputTokens:3,outputTokens:4},responseHash:sha('retained-derivative')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(repairs,0);retryLegacyOptionalFailure(f);await f.ingestion.tick();const canonical=f.files.require('default',f.file.id).text;f.ingestion.retry('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.store.get("SELECT repair_state FROM source_ingestion_windows").repair_state,'candidate');assert.equal(f.files.require('default',f.file.id).status,'ready');
 f.dependencies.prepare=async()=>{throw new Error('Retained candidates must not need PDF evidence or provider work.');};
 f.store.run("DELETE FROM source_reprocessing WHERE id LIKE 'racing-slot-%'");f.ingestion.retry('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(repairs,2);assert.equal(f.files.require('default',f.file.id).text,canonical);assert.equal(f.store.all('SELECT id FROM source_reprocessing WHERE file_id=?',f.file.id).length,1);
});
test('PDF route staging cannot take ownership from active local extraction',async t=>{
 const f=setup(t);f.store.run("UPDATE source_files SET status='processing' WHERE id=?",f.file.id);assert.throws(()=>f.ingestion.stage('default',f.file.id,f.options),/workflow owns/);assert.equal(f.store.all('SELECT id FROM source_ingestion_runs').length,0);
});
test('explicit resumed legacy cross-window checkpoint uses one bounded relation request and durable structural assembly',async t=>{
 let relationCalls=0;
 const f=setup(t,{pages:10,extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);for(const block of candidate.blocks)if(block.page===5)block.text='A paragraph that continues';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('window')};}});
 f.dependencies.relate=async input=>{relationCalls++;assert.deepEqual(input.plan.ownedPages,[5,6]);assert.deepEqual(input.pageMap,[5,6]);assert.equal(input.options.route,'openai');input.onSubmitted('relations');return {status:'completed',candidate:{relations:[{kind:'continuation',from:'w0:b5',to:'w1:b6',uncertain:false,reason:'The sentence continues on the adjacent physical page.'}]},usage:{inputTokens:3,outputTokens:4},responseHash:sha('relations')};};
 f.ingestion.stage('default',f.file.id,f.options);resumeLegacyRelationCheckpoint(f);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),2);assert.equal(relationCalls,1);
 const row=f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',f.file.id),document=JSON.parse(row.document_json);assert.equal(document.relations.length,1);assert.equal(document.relations[0].from,'w0:b5');assert.equal(document.relations[0].to,'w1:b6');assert.equal(f.ingestion.view('default',f.file.id).completedPages,10);assert.equal(f.ingestion.view('default',f.file.id).totalWindows,2);
 const rich=new SourceDocuments(f.store).get(f.files.require('default',f.file.id));assert.equal(rich.ingestion.relations.length,1);assert.equal(rich.ingestion.provenance.independentEvidence,'not-checked');
 await f.ingestion.tick();assert.equal(relationCalls,1);
});
test('unknown boundary relation response pauses paid work and resumes only that relation unit',async t=>{
 let relations=0;
 const f=setup(t,{pages:10,extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);for(const block of candidate.blocks)if(block.page===5)block.text='A paragraph that continues';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('window')};}});
 f.dependencies.relate=async input=>{relations++;input.onSubmitted();if(relations===1)throw new DocumentProviderError('transport',502,'Unknown relation outcome',true);return {status:'completed',candidate:{relations:[]},usage:{inputTokens:1,outputTokens:2},responseHash:sha('relations')};};
 f.ingestion.stage('default',f.file.id,f.options);resumeLegacyRelationCheckpoint(f);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'unknown');assert.equal(f.calls(),2);assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);f.ingestion.resume('default',f.file.id,true);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),2);assert.equal(relations,2);
 const document=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents').document_json);assert.ok(document.pages.find(p=>p.number===6).unresolved.length>0);
});
function missingPageExtraction(input){const candidate=ir(input.plan.ownedPages);const missing=candidate.pages.find(p=>p.number===2);if(missing){missing.state='unreadable';missing.unresolved=[{description:'The physical page could not be read.',blockId:null}];candidate.blocks=candidate.blocks.filter(b=>b.page!==2);}return candidate;}
test('explicit unreadable-page recovery transmits only selected page and creates a manual derivative without baseline mutation',async t=>{
 const requested=[];
 const f=setup(t,{extract:async(input,n)=>{requested.push(input.plan.ownedPages);input.onSubmitted();return {status:'completed',candidate:n===1?missingPageExtraction(input):ir(input.plan.ownedPages,'Recovered page transcription.'),usage:{inputTokens:1,outputTokens:2},responseHash:sha(`page-${n}`)};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();const baseline=f.files.require('default',f.file.id),original=f.store.get('SELECT * FROM source_ingestion_documents');assert.equal(f.ingestion.view('default',f.file.id).state,'completed');
 f.ingestion.recoverPage('default',f.file.id,2);f.ingestion.recoverPage('default',f.file.id,2);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.deepEqual(requested,[[1,2],[2]]);assert.equal(f.calls(),2);assert.equal(f.files.require('default',f.file.id).status,'ready');assert.equal(f.files.require('default',f.file.id).text,baseline.text);assert.deepEqual(f.store.get('SELECT * FROM source_ingestion_documents'),original);
 const revision=JSON.parse(f.store.get('SELECT payload FROM source_reprocessing').payload);assert.equal(revision.origin.pageRecovery.page,2);assert.equal(revision.patches.length,1);assert.equal(revision.patches[0].decision,'pending');assert.equal(revision.patches[0].autoAcceptance,undefined);assert.equal(revision.reprocessed.text,baseline.text);assert.match(revision.patches[0].replacement,/Recovered page transcription/);assert.equal(f.ingestion.view('default',f.file.id).pendingReview,1);assert.equal(f.ingestion.view('default',f.file.id).completedPages,2);assert.equal(f.ingestion.view('default',f.file.id).totalWindows,1);
 f.ingestion.recoverPage('default',f.file.id,2);await f.ingestion.tick();assert.equal(f.calls(),2);
});
test('unknown page recovery remains readable and explicit recovery never repeats initial extraction',async t=>{
 const requested=[];
 const f=setup(t,{extract:async(input,n)=>{requested.push(input.plan.ownedPages);input.onSubmitted();if(n===2)throw new DocumentProviderError('transport',502,'Unknown paid selected page request',true);return {status:'completed',candidate:n===1?missingPageExtraction(input):ir(input.plan.ownedPages,'Recovered source.'),usage:{inputTokens:1,outputTokens:2},responseHash:sha(`page-${n}`)};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();f.ingestion.recoverPage('default',f.file.id,2);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).unknownOutcome,true);assert.equal(f.files.require('default',f.file.id).status,'ready');assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);
 f.ingestion.recover();f.ingestion.resume('default',f.file.id,true);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.deepEqual(requested,[[1,2],[2],[2]]);assert.equal(f.store.all('SELECT id FROM source_reprocessing').length,1);
});
test('page recovery refuses readable pages and exhausted revision capacity before provider calls',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted();return {status:'completed',candidate:missingPageExtraction(input),usage:{inputTokens:1,outputTokens:2},responseHash:sha('initial')};}});f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.throws(()=>f.ingestion.recoverPage('default',f.file.id,1),/unreadable|image-only|empty/i);
 for(let i=0;i<4;i++)f.store.run("INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,'default','completed','2026-10-26','2026-10-26',?)",`recovery-slot-${i}`,f.file.id,JSON.stringify({patches:[],report:{},status:'completed'}));assert.throws(()=>f.ingestion.recoverPage('default',f.file.id,2),/limit|capacity/i);assert.equal(f.calls(),1);
});
test('explicit unknown-outcome replay retains a conservative charge bound within the frozen budget',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted();throw new DocumentProviderError('transport',502,'Unknown charged response',true);}});f.options.budget.maxCostUsd=1;
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.calls(),1);assert.equal(f.ingestion.view('default',f.file.id).state,'unknown');
 f.ingestion.resume('default',f.file.id,true);await f.ingestion.tick();assert.equal(f.calls(),1);assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.match(f.ingestion.view('default',f.file.id).error,/cost budget/);assert.equal(f.store.get("SELECT usage_json FROM source_ingestion_attempts WHERE state='unknown'").usage_json,null);
});
test('explicit resumed legacy relation after truncation preserves durable window namespaces while reconciling physically adjacent boundaries',async t=>{
 let relationCalls=0;
 const f=setup(t,{pages:10,extract:async(input,n)=>{input.onSubmitted();if(n===1)return {status:'incomplete',usage:{inputTokens:1,outputTokens:2},responseHash:sha('truncated')};const candidate=ir(input.plan.ownedPages);for(const block of candidate.blocks)if(block.page===5)block.text='The paragraph continues';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('window')};}});
 f.dependencies.relate=async input=>{relationCalls++;input.onSubmitted();assert.deepEqual(input.pageMap,[5,6]);const from=input.document.blocks.find(b=>b.page===5).id,to=input.document.blocks.find(b=>b.page===6).id;return {status:'completed',candidate:{relations:[{kind:'continuation',from,to,uncertain:false,reason:'Adjacent physical-page continuation.'}]},usage:{inputTokens:1,outputTokens:2},responseHash:sha('relation')};};
 f.ingestion.stage('default',f.file.id,f.options);resumeLegacyRelationCheckpoint(f);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),4);assert.equal(relationCalls,1);const document=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents').document_json);assert.deepEqual(document.relations[0],{kind:'continuation',from:'w2:b5',to:'w0:b6',uncertain:false});assert.equal(f.ingestion.view('default',f.file.id).completedPages,10);
});
test('each paid attempt preserves its exact transmitted PDF hash across repeated window requests',async t=>{
 const transmitted=[];
 const f=setup(t,{extract:async(input,n)=>{transmitted.push(sha(input.pdf));input.onSubmitted();if(n===1)throw new DocumentProviderError('rate_limit',429,'Known failed request.',false);return {status:'completed',candidate:ir(input.plan.ownedPages),usage:{inputTokens:1,outputTokens:2},responseHash:sha('successful-second-attempt')};}});
 let splits=0;f.dependencies.split=async(_bytes,pageMap)=>({bytes:Buffer.from(`synthetic-PDF-window-with-creation-metadata-${++splits}`),pageMap});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');f.ingestion.resume('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);
 const attempts=f.store.all('SELECT transmitted_hash FROM source_ingestion_attempts ORDER BY rowid');assert.equal(attempts.length,2);assert.notEqual(attempts[0].transmitted_hash,attempts[1].transmitted_hash);assert.deepEqual(attempts.map(a=>a.transmitted_hash),transmitted);assert.equal(f.store.get('SELECT transmitted_hash FROM source_ingestion_windows').transmitted_hash,transmitted[1]);
 const provenance=JSON.parse(f.store.get('SELECT provenance_json FROM source_ingestion_documents').provenance_json);assert.equal(provenance.transmittedHash,sha(JSON.stringify(transmitted)));const baseline=f.files.require('default',f.file.id).text;await f.ingestion.tick();assert.equal(f.files.require('default',f.file.id).text,baseline);assert.equal(f.calls(),2);
});

test('a failed or queued legacy retry cannot replace existing canonical text through initial ingestion',t=>{const f=setup(t);for(const status of ['failed','queued']){f.store.run('UPDATE source_files SET status=?,text=? WHERE id=?',status,'Existing canonical source with citation anchors.',f.file.id);assert.throws(()=>f.ingestion.stage('default',f.file.id,f.options),/immutable/);assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_runs').n,0);assert.equal(f.files.require('default',f.file.id).text,'Existing canonical source with citation anchors.');}assert.equal(f.calls(),0);});
test('legacy flattened bytes without retained original cannot become provider original evidence',async t=>{const f=setup(t);f.store.run('UPDATE source_files SET pdf_flattened=1 WHERE id=?',f.file.id);let calls=0;await assert.rejects(()=>f.files.prepareProviderPDF('default',f.file.id,{admit:async()=>{calls++;throw Error('Unexpected admission');},count:async()=>{calls++;return 1;}}),error=>error.status===409&&/Re-upload the original/.test(error.message));assert.equal(calls,0);assert.equal(f.files.evidence('default',f.file.id).originalAvailable,false);});

test('processing view exposes durable window checkpoints without dispatching work',async t=>{
 const f=setup(t);f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();
 const before=f.calls(),view=f.ingestion.view('default',f.file.id);
 assert.equal(view.depth,'balanced');assert.equal(view.reviewPolicy,'verified');assert.equal(view.windows.length,1);
 assert.deepEqual(view.windows[0].pages,[1,2]);assert.equal(view.windows[0].state,'completed');assert.equal(view.windows[0].attempts,1);assert.equal(view.windows[0].error,null);
 assert.equal(f.calls(),before);
});

test('malformed optional table layout preserves five-page transcription in one provider request',async t=>{
 const f=setup(t,{pages:5,extract:async input=>{input.onSubmitted('table-layout');const candidate=ir(input.plan.ownedPages);candidate.blocks[1].kind='table';candidate.blocks[1].table={rows:1,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Notified prosecutor'},{row:0,column:2,rowSpan:1,columnSpan:1,text:'Notified defence'}]};return {status:'completed',candidate,usage:{inputTokens:100,outputTokens:200},responseHash:sha('layout-response')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();
 const view=f.ingestion.view('default',f.file.id);assert.equal(view.state,'completed',view.error);assert.equal(f.calls(),1);assert.equal(view.completedPages,5);
 const file=f.files.require('default',f.file.id);assert.equal(file.status,'ready');assert.match(file.text,/Notified prosecutor/);assert.match(file.text,/Notified defence/);assert.match(file.text,/Faithful synthetic 😀 source text. Page 5/);
 const authoritative=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id).document_json);assert.equal(authoritative.blocks[1].table,null);assert.ok(authoritative.blocks[1].uncertainty);
 const ledger=JSON.parse(f.store.get('SELECT capabilities_json FROM source_ingestion_documents WHERE file_id=?',file.id).capabilities_json);assert.equal(ledger.structure.state,'requires-review');
 await f.ingestion.tick();assert.equal(f.calls(),1,'Published source never repeats extraction');
});

test('completed raw response survives failed validation and resumes locally with no new paid request',async t=>{
 const f=setup(t,{extract:async input=>{input.onSubmitted('retained');const candidate=ir(input.plan.ownedPages);candidate.pages[0].state='blank';return {status:'completed',candidate,usage:{inputTokens:40,outputTokens:80},responseHash:sha('retained-response')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.calls(),1);
 const paid=f.store.get('SELECT id,candidate_json,usage_json FROM source_ingestion_attempts');assert.ok(paid.candidate_json);assert.equal(JSON.parse(paid.candidate_json).pages[0].state,'blank');
 f.dependencies.split=async()=>{throw new Error('Retained candidate must not be split or uploaded again');};
 f.ingestion.resume('default',f.file.id);await f.ingestion.tick();assert.equal(f.calls(),1);assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.match(f.ingestion.view('default',f.file.id).error,/Blank page contains text/);assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_attempts').n,1);assert.equal(f.store.get('SELECT usage_json FROM source_ingestion_attempts').usage_json,paid.usage_json);
 // Simulate a later parser correction against the retained response, without a
 // network call; actual recovery must still pass every strict publication gate.
 const candidate=JSON.parse(paid.candidate_json);candidate.pages[0].state='content';f.store.run('UPDATE source_ingestion_attempts SET candidate_json=? WHERE id=?',JSON.stringify(candidate),paid.id);
 f.ingestion.resume('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_attempts').n,1);
});

test('unsupported optional correction category cannot block readable source publication',async t=>{
 const f=setup(t,{pages:5,extract:async input=>{input.onSubmitted('unsupported-category');const candidate=ir(input.plan.ownedPages,'HEREBY CONSITUTES Trial Chamber III.');candidate.repairs=[{blockId:candidate.blocks[0].id,start:7,end:17,original:'CONSITUTES',replacement:'CONSTITUTES',category:'possible source typo',reason:'Possible omitted letter; retain original.'}];return {status:'completed',candidate,usage:{inputTokens:100,outputTokens:200},responseHash:sha('unsupported-category')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);
 const file=f.files.require('default',f.file.id);assert.match(file.text,/CONSITUTES/);assert.doesNotMatch(file.text,/CONSTITUTES/);assert.equal(f.store.get('SELECT count(*) n FROM source_reprocessing').n,0);
 const doc=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id).document_json);assert.equal(doc.repairs.length,0);assert.ok(doc.blocks[0].uncertainty);
});

function enrichmentCandidate(document){return {metadata:{title:document.blocks[0].text,language:'en',synopsis:'A concise AI synopsis of the supplied source pages.',candidates:[{field:'title',value:document.blocks[0].text,blockId:document.blocks[0].id,quote:document.blocks[0].text,reason:'Explicit title in supplied source evidence.'},{field:'language',value:'en',blockId:document.blocks[0].id,quote:document.blocks[0].text,reason:'The supplied source passage is in English.'}]},blocks:document.blocks.map((block,index)=>({id:block.id,kind:index===0?'heading':block.kind,headingLevel:index===0?1:block.headingLevel,table:null,quote:block.text,uncertainty:null})),relations:[]};}
test('PDF ingestion produces transcription, structure and metadata from one input request',async t=>{
 const f=setup(t,{pages:5,extract:async input=>{input.onSubmitted('joint-processing');const document=ir(input.plan.ownedPages);return {status:'completed',candidate:applySourceIngestionEnrichment(enrichmentCandidate(document),document,{ownedPages:input.plan.ownedPages}),usage:{inputTokens:100,outputTokens:200},responseHash:sha('joint-processing')};}});let enrichments=0;
 f.dependencies.enrich=async input=>{enrichments++;input.onSubmitted('enrichment');return {status:'completed',candidate:enrichmentCandidate(input.document),usage:{inputTokens:100,outputTokens:200},responseHash:sha('enrichment')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();const view=f.ingestion.view('default',f.file.id);assert.equal(view.state,'completed',view.error);assert.equal(f.calls(),1);assert.equal(enrichments,0,'Fresh processing must not resend the PDF for a second enrichment pass');assert.equal(view.enrichedWindows,1);
 const file=f.files.require('default',f.file.id);assert.match(file.summary,/concise AI synopsis/);assert.equal(file.generated_name,'Faithful synthetic 😀 source text. Page 1.');assert.equal(file.language,'en');assert.match(file.text,/Faithful synthetic/);
 const doc=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id).document_json);assert.equal(doc.blocks[0].kind,'heading');assert.equal(doc.blocks[0].headingLevel,1);
 await f.ingestion.tick();assert.equal(enrichments,0);assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_attempts").n,1);
});
test('already published PDF enriches retained text without a second transcription or canonical identity change',async t=>{
 const f=setup(t);f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();const file=f.files.require('default',f.file.id),original=f.store.get('SELECT document_json,assembly_json FROM source_ingestion_documents WHERE file_id=?',file.id);
 let enrichments=0;f.dependencies.enrich=async input=>{enrichments++;input.onSubmitted('later-enrichment');return {status:'completed',candidate:enrichmentCandidate(input.document),usage:{inputTokens:10,outputTokens:20},responseHash:sha('later-enrichment')};};
 f.ingestion.enrich('default',file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',file.id).state,'completed',f.ingestion.view('default',file.id).error);assert.equal(f.calls(),1);assert.equal(enrichments,1);
 assert.equal(f.files.require('default',file.id).text,file.text);assert.match(f.files.require('default',file.id).summary,/AI synopsis/);assert.deepEqual(f.store.get('SELECT document_json,assembly_json FROM source_ingestion_documents WHERE file_id=?',file.id),original);
 const {resolveSourceIngestionAssembly}=await import('../src/server/modules/source-ingestion-document.ts');const projected=resolveSourceIngestionAssembly(f.store,f.files.require('default',file.id));assert.equal(projected.document.blocks[0].kind,'heading');assert.deepEqual(projected.blockRanges.map(b=>[b.id,b.range,b.text]),JSON.parse(original.assembly_json).blockRanges.map(b=>[b.id,b.range,b.text]));
});

for(const depth of ['light','balanced','deep'])test(`fresh ${depth} PDF ingestion retains joint outputs with no automatic repair, relations or enrichment pass`,async t=>{
 const f=setup(t,{pages:10,extract:async input=>{input.onSubmitted('joint-single-pass');const candidate=ir(input.plan.ownedPages);candidate.metadata={...candidate.metadata,title:'Joint source output',language:'en',synopsis:'An AI synopsis returned with the faithful transcription.'};candidate.blocks[0].kind='heading';candidate.blocks[0].headingLevel=8;candidate.blocks[0].uncertainty='Uncertain heading classification requires review.';candidate.blocks.at(-1).text='A paragraph continues across a physical boundary';return {status:'completed',candidate,usage:{inputTokens:100,outputTokens:200},responseHash:sha('joint-'+input.plan.index)};}});f.options.depth=depth;
 let repairs=0,relations=0,enrichments=0;f.dependencies.repair=async()=>{repairs++;throw new Error('No automatic repair pass allowed');};f.dependencies.relate=async()=>{relations++;throw new Error('No automatic relation pass allowed');};f.dependencies.enrich=async()=>{enrichments++;throw new Error('No automatic enrichment pass allowed');};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();const view=f.ingestion.view('default',f.file.id);assert.equal(view.state,'completed',view.error);assert.equal(view.completedPages,10);assert.equal(f.calls(),view.totalWindows);assert.equal(repairs,0);assert.equal(relations,0);assert.equal(enrichments,0);
 const attempts=f.store.all('SELECT kind FROM source_ingestion_attempts');assert.equal(attempts.length,view.totalWindows);assert.ok(attempts.every(attempt=>attempt.kind==='extraction'));const windows=f.store.all("SELECT repair_state FROM source_ingestion_windows WHERE kind='extraction'");assert.ok(windows.every(window=>window.repair_state==='skipped'));
 const file=f.files.require('default',f.file.id);assert.equal(file.generated_name,'Joint source output');assert.equal(file.language,'en');assert.match(file.summary,/returned with the faithful transcription/);assert.match(file.text,/physical boundary/);const doc=JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents').document_json);assert.equal(doc.pages.length,10);assert.ok(doc.blocks.some(block=>block.uncertainty?.includes('heading')));assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_windows WHERE kind IN ('relations','enrichment')").n,0);
});

test('layout-only provider warnings mark structure for review without resending transcription',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].layoutWarnings=['Approximate diagram layout requires review.'];return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('layout')};}});
 f.dependencies.repair=async()=>{repairs++;throw new Error('Layout-only warnings cannot trigger a transcription request');};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();
 assert.equal(f.ingestion.view('default',f.file.id).state,'completed');assert.equal(f.calls(),1);assert.equal(repairs,0);
 const record=f.store.get('SELECT capabilities_json,document_json FROM source_ingestion_documents WHERE file_id=?',f.file.id),ledger=JSON.parse(record.capabilities_json),document=JSON.parse(record.document_json);
 assert.equal(ledger.structure.state,'requires-review');assert.equal(ledger.transcription.state,'completed');assert.equal(document.blocks[0].uncertainty,null);assert.deepEqual(document.blocks[0].layoutWarnings,['Approximate diagram layout requires review.']);
});

test('explicit published repair prepares visual bytes before recording exact attempt hash and evidence',async t=>{
 let prepared=0,repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Unclear bar';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 const evidence={version:1,algorithm:'pdfjs-context-crop-v1',pageMap:[1,2],ownedPages:[1,2],crops:[{physicalPage:1,blockId:'b1',rect:{x:.1,y:.2,width:.3,height:.1},accuracy:'approximate'}],fallback:'none'};
 const bytes=Buffer.from('full page context alongside magnified region');
 f.dependencies.prepareRepairEvidence=async input=>{prepared++;assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_attempts WHERE kind='repair'").n,0);assert.deepEqual(input.pageMap,[1,2]);return {bytes,pageMap:input.pageMap,evidence};};
 f.dependencies.repair=async input=>{repairs++;assert.deepEqual(input.pdf,bytes);assert.deepEqual(input.visualEvidence,evidence);const attempt=f.store.get("SELECT transmitted_hash,evidence_json,prompt_version FROM source_ingestion_attempts WHERE kind='repair'");assert.equal(attempt.transmitted_hash,sha(bytes));assert.equal(attempt.prompt_version,'pdf-repair-2');assert.deepEqual(JSON.parse(attempt.evidence_json),evidence);input.onSubmitted();return {status:'completed',candidate:{repairs:[]},usage:{inputTokens:1,outputTokens:2},responseHash:sha('visual-repair')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(prepared,0);assert.equal(repairs,0);const baseline=f.files.require('default',f.file.id).text;
 retryLegacyOptionalFailure(f);await f.ingestion.tick();assert.equal(prepared,1);assert.equal(repairs,1);assert.equal(f.calls(),1);assert.equal(f.files.require('default',f.file.id).text,baseline);
});
test('visual derivative size is budgeted before a repair attempt or provider dispatch',async t=>{
 let prepared=0,repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Unclear sign';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});f.options.budget.maxCostUsd=1;
 f.dependencies.prepareRepairEvidence=async input=>{prepared++;return {bytes:Buffer.alloc(2_000_000),pageMap:input.pageMap,evidence:{version:1,algorithm:'pdfjs-context-crop-v1',pageMap:input.pageMap,ownedPages:input.plan.ownedPages,crops:[],fallback:'no-valid-geometry'}};};
 f.dependencies.repair=async()=>{repairs++;throw Error('Budget should prevent submission');};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();retryLegacyOptionalFailure(f);await f.ingestion.tick();
 assert.equal(prepared,1);assert.equal(repairs,0);assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_attempts WHERE kind='repair'").n,0);assert.equal(f.files.require('default',f.file.id).status,'ready');
});

test('local math review findings mark math for review without a second paid request or canonical rewrite',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();return {status:'completed',candidate:ir(input.plan.ownedPages,'The source has $[unreadable sign]4$.'),usage:{inputTokens:1,outputTokens:2},responseHash:sha('math')};}});
 f.options.containsMath=true;f.dependencies.repair=async()=>{repairs++;throw new Error('Local math review does not authorize a second request');};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();
 assert.equal(f.ingestion.view('default',f.file.id).state,'completed');assert.equal(f.calls(),1);assert.equal(repairs,0);
 const ledger=JSON.parse(f.store.get('SELECT capabilities_json FROM source_ingestion_documents WHERE file_id=?',f.file.id).capabilities_json);assert.equal(ledger.math.state,'requires-review');assert.match(f.files.require('default',f.file.id).text,/unreadable sign/);
});

for(const scenario of ['omitted-invalid-diagram','uncertain-valid-diagram'])test(`explicit enrichment preserves structure review state for ${scenario}`,async t=>{
 const f=setup(t,{pages:1,extract:async input=>{input.onSubmitted('initial-figure');const candidate=ir(input.plan.ownedPages,'L K');candidate.blocks[0].kind='figure';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('initial-figure')};}});
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();
 const baseline=f.files.require('default',f.file.id).text,original=f.store.get('SELECT document_json,assembly_json FROM source_ingestion_documents WHERE file_id=?',f.file.id);
 assert.equal(JSON.parse(f.store.get('SELECT capabilities_json FROM source_ingestion_documents WHERE file_id=?',f.file.id).capabilities_json).structure.state,'completed');
 f.dependencies.enrich=async input=>{input.onSubmitted('enrichment-figure');const block=input.document.blocks[0],diagram=scenario==='omitted-invalid-diagram'?{nodes:[],edges:[],uncertainty:null}:{nodes:[{id:'L',label:'L',quote:'L'},{id:'K',label:'K',quote:'K'}],edges:[],uncertainty:'The connecting line is unreadable.'};return {status:'completed',candidate:{metadata:{title:null,language:null,synopsis:'A source figure.',candidates:[]},blocks:[{id:block.id,kind:'figure',headingLevel:null,table:null,diagram,quote:'L K',uncertainty:null}],relations:[]},usage:{inputTokens:1,outputTokens:2},responseHash:sha(scenario)};};
 f.ingestion.enrich('default',f.file.id);await f.ingestion.tick();const progress=f.ingestion.view('default',f.file.id);assert.equal(progress.state,'completed',progress.error);
 assert.equal(f.files.require('default',f.file.id).text,baseline);assert.deepEqual(f.store.get('SELECT document_json,assembly_json FROM source_ingestion_documents WHERE file_id=?',f.file.id),original);
 const {resolveSourceIngestionAssembly}=await import('../src/server/modules/source-ingestion-document.ts'),block=resolveSourceIngestionAssembly(f.store,f.files.require('default',f.file.id)).document.blocks[0];
 assert.equal(block.uncertainty,null);if(scenario==='omitted-invalid-diagram')assert.ok(block.layoutWarnings.length);else assert.equal(block.diagram.uncertainty,'The connecting line is unreadable.');
 assert.equal(JSON.parse(f.store.get('SELECT capabilities_json FROM source_ingestion_documents WHERE file_id=?',f.file.id).capabilities_json).structure.state,'requires-review');assert.equal(f.calls(),1);
});
