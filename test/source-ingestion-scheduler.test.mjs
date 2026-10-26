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
test('clean Balanced result does not schedule optional repair and localized uncertain span does',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages,'The ﬁrst source reading.');candidate.blocks[0].uncertainty='Ligature needs inspection';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted('repair');const block=input.document.blocks[0],start=block.text.indexOf('ﬁrst');return {status:'completed',candidate:{repairs:[{blockId:block.id,start,end:start+4,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Equivalent ligature.'}]},usage:{inputTokens:3,outputTokens:4},responseHash:sha('repair')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(repairs,1);
 assert.match(f.files.require('default',f.file.id).text,/ﬁrst/);assert.equal(f.ingestion.view('default',f.file.id).pendingReview,0);
 const revision=JSON.parse(f.store.get('SELECT payload FROM source_reprocessing').payload);assert.equal(revision.patches[0].decision,'accepted');assert.match(revision.reprocessed.text,/first/);
 assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_attempts WHERE kind='repair'").n,1);
});
test('unknown targeted repair cannot replay extraction and explicit recovery retries repair only',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Synthetic localized issue';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted('repair');if(repairs===1)throw new DocumentProviderError('transport',502,'uncertain paid repair',true);return {status:'completed',candidate:{repairs:[]},usage:{inputTokens:1,outputTokens:2},responseHash:sha('repair')};};
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'unknown');assert.equal(f.calls(),1);assert.throws(()=>f.ingestion.resume('default',f.file.id),/duplicate-cost/);
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
  generation++;const body=JSON.parse(request.body),prompt=route==='openai'?body.input[0].content[1].text:body.input[1].text,plan=JSON.parse(prompt),candidate=ir(plan.ownedPhysicalPages,'Synthetic source text.');
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
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed');assert.equal(f.ingestion.view('default',f.file.id).canRetryOptional,true);
 const file=f.files.require('default',f.file.id),before=f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),sourceDocument=new SourceDocuments(f.store).get(file);
 f.ingestion.retry('default',file.id);assert.equal(f.files.require('default',file.id).status,'ready');await f.ingestion.tick();assert.equal(f.ingestion.view('default',file.id).state,'completed',f.ingestion.view('default',file.id).error);
 assert.equal(f.calls(),1);assert.equal(repairs,2);assert.equal(reconciliations,1);assert.equal(f.files.require('default',file.id).text,file.text);assert.deepEqual(f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),before);assert.deepEqual(new SourceDocuments(f.store).get(f.files.require('default',file.id)),sourceDocument);
 const rows=f.store.all('SELECT payload FROM source_reprocessing WHERE file_id=?',file.id);assert.equal(rows.length,1);const revision=JSON.parse(rows[0].payload);assert.equal(revision.origin.kind,'ingestion');assert.match(revision.origin.repairIdentity,/^[a-f0-9]{64}$/);assert.equal(revision.patches[0].decision,'accepted');assert.match(revision.reprocessed.text,/first/);assert.equal(f.ingestion.view('default',file.id).pendingReview,0);
 f.ingestion.retry('default',file.id);await f.ingestion.tick();assert.equal(repairs,2);assert.equal(f.store.all('SELECT id FROM source_reprocessing WHERE file_id=?',file.id).length,1);
});
test('optional retry enforces revision capacity before paid work while the published source remains readable',async t=>{
 let repairs=0;
 const f=setup(t,{extract:async input=>{input.onSubmitted();const candidate=ir(input.plan.ownedPages);candidate.blocks[0].uncertainty='Synthetic localized issue';return {status:'completed',candidate,usage:{inputTokens:1,outputTokens:2},responseHash:sha('first')};}});
 f.dependencies.repair=async input=>{repairs++;input.onSubmitted();throw new DocumentProviderError('rate_limit',429,'Known quota rejection.',false);};f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();assert.equal(repairs,1);
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
 f.ingestion.stage('default',f.file.id,f.options);await f.ingestion.tick();const canonical=f.files.require('default',f.file.id).text;f.ingestion.retry('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'failed');assert.equal(f.store.get("SELECT repair_state FROM source_ingestion_windows").repair_state,'candidate');assert.equal(f.files.require('default',f.file.id).status,'ready');
 f.dependencies.prepare=async()=>{throw new Error('Retained candidates must not need PDF evidence or provider work.');};
 f.store.run("DELETE FROM source_reprocessing WHERE id LIKE 'racing-slot-%'");f.ingestion.retry('default',f.file.id);await f.ingestion.tick();assert.equal(f.ingestion.view('default',f.file.id).state,'completed',f.ingestion.view('default',f.file.id).error);assert.equal(f.calls(),1);assert.equal(repairs,2);assert.equal(f.files.require('default',f.file.id).text,canonical);assert.equal(f.store.all('SELECT id FROM source_reprocessing WHERE file_id=?',f.file.id).length,1);
});
test('PDF route staging cannot take ownership from active local extraction',async t=>{
 const f=setup(t);f.store.run("UPDATE source_files SET status='processing' WHERE id=?",f.file.id);assert.throws(()=>f.ingestion.stage('default',f.file.id,f.options),/workflow owns/);assert.equal(f.store.all('SELECT id FROM source_ingestion_runs').length,0);
});
