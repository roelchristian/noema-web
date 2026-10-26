import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {openDatabase} from '../dist/server/database.js';
import {Store} from '../dist/server/store.js';
import {Intelligence} from '../dist/server/modules/intelligence.js';
import {createRuntime} from '../dist/server/runtime.js';
import {createTransportHandler} from '../dist/server/transport.js';
import {readNetworkConfig} from '../dist/server/network.js';
import {SourceDocuments} from '../dist/server/modules/source-documents.js';
import {sourceIngestionEnabled} from '../dist/server/modules/source-ingestion-settings.js';
import {sourceDocumentEntries} from '../dist/shared/source-document.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
function enrichmentReply(request,provider){
 const prompt=provider==='openai'?request.input[0].content.find(part=>part.type==='input_text').text:request.input.find(part=>part.type==='text').text;
 const scope=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)),first=scope.blocks[0],title=first&&first.text.length<=200?first.text:null;
 return {metadata:{title,language:null,synopsis:'Synthetic PDF synopsis from the dedicated structure and metadata enrichment pass.',candidates:title?[{field:'title',value:title,blockId:first.id,quote:first.text,reason:'Synthetic title evidence from the supplied canonical block.'}]:[]},blocks:scope.blocks.filter(block=>block.kind==='paragraph').map((block,index)=>({id:block.id,kind:index===0?'heading':'paragraph',headingLevel:index===0?1:null,table:null,quote:block.text,uncertainty:null})),relations:[]};
}
function transcriptionReply(document){
 const first=document.blocks[0],title=first&&first.text.length<=200?first.text:null;
 document.metadata={...document.metadata,title,synopsis:'Synthetic PDF synopsis produced together with transcription, structure and metadata.',candidates:title?[{field:'title',value:title,blockId:first.id,page:first.page,quote:first.text,reason:'Synthetic title evidence retained with this initial PDF response.'}]:[]};
 if(first?.kind==='paragraph'){first.kind='heading';first.headingLevel=1;}return document;
}
function requestKind(request){const properties=(request.text?.format.schema??request.response_format.schema).properties;return properties.pages?'extraction':properties.metadata?'enrichment':properties.repairs?'repair':'relations';}

function ir(){return {schemaVersion:1,metadata:{title:null,language:'en',synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'ix',role:'owned',state:'content',unresolved:[]},{number:2,printedLabel:null,role:'owned',state:'blank',unresolved:[]}],blocks:[{id:'provider-id',page:1,order:0,kind:'paragraph',text:'Faithful synthetic source.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[],repairs:[]};}
for(const provider of ['openai','gemini'])test(`${provider} actual Linux HTTP import uses portable PDF operations, real adapter envelope, provider evidence and durable restore`,{skip:process.platform!=='linux'?'Portable Linux integration gate':false},async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'noema-ingestion-runtime-')),db=openDatabase(path.join(root,'db.sqlite')),store=new Store(db),originalFlag=process.env.NOEMA_PDF_PROVIDER_INGESTION;
 process.env.NOEMA_PDF_PROVIDER_INGESTION='1';
 let runtime,server;let candidateFactory=ir;const generation=[],uploads=[],deleted=[];
 const model=provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash';
 const secrets={read:()=>({key:'synthetic-key-not-a-credential',expiresAt:'2099-01-01T00:00:00.000Z',generation:'synthetic'}),write(){throw new Error('Test must not configure credentials');},remove(){throw new Error('Test must not remove credentials');}};
 const transport=async(url,options)=>{
  if(options.method==='DELETE'){deleted.push(url);return Response.json({});}
  if(url==='https://api.openai.com/v1/files'){assert.equal(provider,'openai');assert.equal(options.body.get('purpose'),'user_data');const bytes=Buffer.from(await options.body.get('file').arrayBuffer());assert.match(bytes.toString('latin1',0,8),/^%PDF-/);uploads.push(bytes);return Response.json({id:'file-synthetic'});}
  if(url==='https://generativelanguage.googleapis.com/upload/v1/files?uploadType=multipart'){assert.equal(provider,'gemini');const bytes=Buffer.from(options.body);assert.ok(bytes.includes(Buffer.from('%PDF-')));uploads.push(bytes);return Response.json({file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1/files/synthetic',state:'ACTIVE',expirationTime:'2099-01-01T00:00:00Z'}});}
  const request=JSON.parse(options.body);generation.push({url,request,kind:requestKind(request)});assert.equal(request.model,model);assert.equal(request.store,false);
  if(provider==='openai'){assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.text.format.strict,true);assert.equal(request.input[0].content[0].type,'input_file');return Response.json({id:'resp-synthetic',model,status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(requestKind(request)==='enrichment'?enrichmentReply(request,provider):requestKind(request)==='extraction'?transcriptionReply(candidateFactory(request)):candidateFactory(request))}]}],usage:{input_tokens:100,output_tokens:200,output_tokens_details:{reasoning_tokens:20},input_tokens_details:{cached_tokens:0}}});}
  assert.equal(url,'https://generativelanguage.googleapis.com/v1/interactions');assert.equal(request.input[0].type,'document');assert.equal(request.response_format.mime_type,'application/json');return Response.json({id:'interaction-synthetic',model,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(requestKind(request)==='enrichment'?enrichmentReply(request,provider):requestKind(request)==='extraction'?transcriptionReply(candidateFactory(request)):candidateFactory(request))}]}],usage:{total_input_tokens:100,total_output_tokens:200,total_thought_tokens:20,total_cached_tokens:0}});
 };
 try{
  const intelligence=new Intelligence(secrets,transport,()=>Date.now(),undefined,undefined,undefined,secrets);
  runtime=createRuntime(store,intelligence,readNetworkConfig());server=http.createServer(createTransportHandler(runtime,path.resolve('dist/client'),new Set()));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const pdf=await PDFDocument.create();pdf.setTitle('Synthetic PDF context');pdf.addPage([200,300]).drawText('Faithful synthetic source.',{x:10,y:250,size:9});pdf.addPage([200,300]);const bytes=Buffer.from(await pdf.save({useObjectStreams:false}));
  const options={route:provider,model,depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:8,maxOutputTokens:24000,maxCostUsd:null}};
  const query=new URLSearchParams({name:'synthetic.pdf',containsMath:'false',ingestion:JSON.stringify(options),stagingKey:'synthetic-runtime-upload-'+provider});
  const upload=await fetch(base+'/api/source-files?'+query,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/pdf'},body:bytes});assert.equal(upload.status,201,await upload.clone().text());const file=await upload.json();
  const repeated=await fetch(base+'/api/source-files?'+query,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/pdf'},body:bytes});assert.equal(repeated.status,201);assert.equal((await repeated.json()).id,file.id);
  runtime.knowledge.create('default',{name:'Manual source name',type:'source',attachmentIds:[file.id]});
  await runtime.sourceIngestion.tick();const progress=runtime.sourceIngestion.view('default',file.id);assert.equal(progress.state,'completed',progress.error);assert.equal(progress.completedPages,2);assert.equal(progress.pendingReview,0);
  assert.equal(generation.length,1);assert.equal(uploads.length,1);assert.equal(deleted.length,1);assert.deepEqual(generation.map(call=>call.kind),['extraction']);await runtime.sourceFiles.tick();await runtime.sourceEnrichments.tick();assert.equal(generation.length,1,'legacy extraction/enrichment never repeats the document request');
  const evidenceResponse=await fetch(base+`/api/source-files/${file.id}/evidence?page=1`);assert.equal(evidenceResponse.status,200);const evidence=await evidenceResponse.json();assert.equal(evidence.originalAvailable,true);assert.ok(!(evidence.findings??[]).some(finding=>/legacy import|Re-upload/i.test(finding)));assert.equal(evidence.ingestion.provider,provider);assert.equal(evidence.ingestion.model,model);assert.equal(evidence.ingestion.text,'Faithful synthetic source.');assert.equal(evidence.ingestion.independentEvidence,'not-checked');assert.equal(evidence.rawExtraction,undefined);assert.equal(evidence.providerTranscription,undefined);
  const blank=await (await fetch(base+`/api/source-files/${file.id}/evidence?page=2`)).json();assert.equal(blank.ingestion.text,'');assert.equal(blank.ingestion.page,2);
  const image=await fetch(base+`/api/source-files/${file.id}/page-image/1`);assert.equal(image.status,200,await image.clone().text());assert.equal(Buffer.from(await image.arrayBuffer()).toString('hex',0,8),'89504e470d0a1a0a');
  const row=store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),provenance=JSON.parse(row.provenance_json);assert.equal(provenance.originalHash,sha(bytes));assert.equal(provenance.admittedHash,sha(bytes));const wire=uploads[0],transmitted=provider==='openai'?wire:wire.subarray(wire.indexOf(Buffer.from('%PDF-')),wire.lastIndexOf(Buffer.from('\r\n--noema-document-boundary--')));
  const transmittedWindow=store.get("SELECT transmitted_hash FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' ORDER BY ordinal LIMIT 1",row.id);
  assert.equal(transmittedWindow.transmitted_hash,sha(transmitted));const firstAttempt=store.get("SELECT a.transmitted_hash FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? AND a.kind='extraction' ORDER BY a.rowid LIMIT 1",row.id);assert.equal(firstAttempt.transmitted_hash,sha(transmitted));assert.equal(provenance.transmittedHash,sha(JSON.stringify(store.all('SELECT a.transmitted_hash FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? ORDER BY a.rowid',row.id).map(attempt=>attempt.transmitted_hash))));assert.equal(provenance.responseHash.length,64);assert.equal(provenance.returnedModel,model);assert.equal(store.get('SELECT count(*) n FROM source_reprocessing').n,0);
  const documents=new SourceDocuments(store),before=documents.get(runtime.sourceFiles.require('default',file.id));store.run('DELETE FROM source_documents WHERE file_id=?',file.id);assert.deepEqual(documents.get(runtime.sourceFiles.require('default',file.id)),before);
  const backup=await runtime.backups.export('default'),restored=await runtime.backups.import(backup.bytes,'Restored runtime source');const restoredFile=store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),after=documents.get(restoredFile);assert.equal(restoredFile.ingestion_origin,provider);assert.deepEqual(after.semantic.children,before.semantic.children);assert.deepEqual(after.ingestion.provenance,before.ingestion.provenance);assert.equal(generation.length,1);
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',restoredFile.entity_id).name,'Manual source name');
  // A separate source with an explicitly unreadable physical page exercises the
  // creation-to-recovery API without changing the clean extraction-plus-enrichment fixture.
  const gapIR=ir();gapIR.pages[1].state='unreadable';gapIR.pages[1].unresolved=[{description:'Synthetic wholly unreadable second page',blockId:null}];candidateFactory=()=>gapIR;
  const gapOptions={...options,depth:'light'},gapQuery=new URLSearchParams({name:'gap.pdf',containsMath:'false',ingestion:JSON.stringify(gapOptions),stagingKey:'synthetic-runtime-gap-'+provider});
  const gapUpload=await fetch(base+'/api/source-files?'+gapQuery,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/pdf'},body:bytes});assert.equal(gapUpload.status,201);const gap=await gapUpload.json();runtime.knowledge.create('default',{name:'Gap source',type:'source',attachmentIds:[gap.id]});await runtime.sourceIngestion.tick();assert.equal(runtime.sourceIngestion.view('default',gap.id).state,'completed');assert.equal(generation.length,2);
  const baseline=runtime.sourceFiles.require('default',gap.id).text;
  const gapEvidence=await(await fetch(base+`/api/source-files/${gap.id}/evidence?page=2`)).json();assert.equal(gapEvidence.ingestion.pageState,'unreadable');assert.equal(gapEvidence.ingestion.canRecoverPage,true);assert.equal(gapEvidence.ingestion.text,'');
  const readableEvidence=await(await fetch(base+`/api/source-files/${gap.id}/evidence?page=1`)).json();assert.equal(readableEvidence.ingestion.canRecoverPage,false);
  const invalidRecovery=await fetch(base+`/api/source-files/${gap.id}/ingestion/recover-page`,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/json'},body:JSON.stringify({page:1})});assert.ok([400,409].includes(invalidRecovery.status),`Readable-page recovery must be rejected as an admission error, got ${invalidRecovery.status}`);assert.equal(generation.length,2);
  const recovered=ir();recovered.pages=[{number:2,printedLabel:'1',role:'owned',state:'content',unresolved:[]}];recovered.blocks=[{...recovered.blocks[0],id:'recovered-block',page:2,text:'Recovered page text.'}];candidateFactory=()=>recovered;
  const recoverURL=base+`/api/source-files/${gap.id}/ingestion/recover-page`,recoverRequest={method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/json'},body:JSON.stringify({page:2})};
  const queued=await fetch(recoverURL,recoverRequest);assert.equal(queued.status,202,await queued.clone().text());const repeatedRecovery=await fetch(recoverURL,recoverRequest);assert.equal(repeatedRecovery.status,202);await runtime.sourceIngestion.tick();assert.equal(runtime.sourceIngestion.view('default',gap.id).state,'completed',runtime.sourceIngestion.view('default',gap.id).error);assert.equal(generation.length,3);assert.equal(runtime.sourceFiles.require('default',gap.id).text,baseline);
  assert.equal(store.get("SELECT count(*) n FROM source_ingestion_windows WHERE run_id=(SELECT id FROM source_ingestion_runs WHERE file_id=?) AND kind='page-recovery'",gap.id).n,1);
  const revisionID=store.get('SELECT id FROM source_reprocessing WHERE file_id=?',gap.id).id,detailURL=base+`/api/source-files/${gap.id}/reprocessing/${revisionID}`,revision=await(await fetch(detailURL)).json();assert.equal(revision.patches.length,1);assert.equal(revision.patches[0].decision,'pending');assert.equal(revision.patches[0].autoAcceptance,undefined);assert.equal(revision.origin.pageRecovery.page,2);
  const accept=await fetch(detailURL+'/review',{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/json'},body:JSON.stringify({updatedAt:revision.updatedAt,decisions:[{patchId:revision.patches[0].id,decision:'accepted'}]})});assert.equal(accept.status,200,await accept.clone().text());const accepted=await accept.json();assert.match(accepted.reprocessed.text,/Recovered page text/);assert.ok(accepted.reprocessed.document.ingestion.readingMapping.recoveredNodes.every(node=>node.originalId===null));assert.equal(runtime.sourceFiles.require('default',gap.id).text,baseline);
  const gapArchive=await runtime.backups.export('default'),gapRestore=await runtime.backups.import(gapArchive.bytes,'Restored manual page recovery'),restoredGap=store.get("SELECT f.* FROM source_files f JOIN entities e ON e.id=f.entity_id WHERE f.vault_id=? AND e.name='Gap source'",gapRestore.id),restoredRevision=JSON.parse(store.get('SELECT payload FROM source_reprocessing WHERE file_id=?',restoredGap.id).payload);assert.equal(restoredGap.text,baseline);assert.equal(restoredRevision.patches[0].decision,'accepted');assert.equal(restoredRevision.origin.pageRecovery.page,2);assert.equal(generation.length,3);
  const relationPDF=await PDFDocument.create();relationPDF.addPage([200,300]).drawText('Relation article.',{x:10,y:250,size:9});relationPDF.addPage([200,300]);relationPDF.addPage([200,300]).drawText('First table portion.',{x:10,y:250,size:9});relationPDF.addPage([200,300]).drawText('Second table portion.',{x:10,y:250,size:9});const relationBytes=Buffer.from(await relationPDF.save({useObjectStreams:false}));
  candidateFactory=request=>{const schema=request.text?.format.schema??request.response_format.schema;if(!schema.properties.pages){assert.deepEqual(Object.keys(schema.properties),['relations']);return {relations:[{kind:'table-continuation',from:'w0:t3',to:'w1:t4',uncertain:false,reason:'Same one-column table continues across the physical boundary.'}]};}const prompt=provider==='openai'?request.input[0].content.find(part=>part.type==='input_text').text:request.input.find(part=>part.type==='text').text,scope=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)),result=ir();result.pages=scope.ownedPhysicalPages.map(number=>({number,printedLabel:String(number),role:'owned',state:number===2?'blank':'content',unresolved:[]}));result.blocks=scope.ownedPhysicalPages.filter(page=>page!==2).map(page=>({id:page>=3?'t'+page:'article',page,order:0,kind:page>=3?'table':'paragraph',text:page===1?'Relation article.':page===3?'First table portion.':'Second table portion.',headingLevel:null,continues:null,table:page>=3?{rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:page===3?'First table portion.':'Second table portion.'}]}:null,uncertainty:null,location:null}));return result;};
  const relationQuery=new URLSearchParams({name:'relations.pdf',containsMath:'false',ingestion:JSON.stringify(options),stagingKey:'synthetic-runtime-relations-'+provider}),relationUpload=await fetch(base+'/api/source-files?'+relationQuery,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/pdf'},body:relationBytes});assert.equal(relationUpload.status,201);const relationFile=await relationUpload.json();runtime.knowledge.create('default',{name:'Boundary tables',type:'source',attachmentIds:[relationFile.id]});await runtime.sourceIngestion.tick();assert.equal(runtime.sourceIngestion.view('default',relationFile.id).state,'completed',runtime.sourceIngestion.view('default',relationFile.id).error);assert.equal(generation.length,5,'two joint processing windows, without an automatic relation request');
  const linked=new SourceDocuments(store).get(runtime.sourceFiles.require('default',relationFile.id)),continuation=linked.ingestion.relations.find(value=>value.kind==='table-continuation');assert.equal(continuation,undefined,'A relation not returned by the joint processing response must not be invented');assert.ok(sourceDocumentEntries(linked).some(({node})=>node.text==='First table portion.'));assert.ok(sourceDocumentEntries(linked).some(({node})=>node.text==='Second table portion.'));assert.equal(linked.ingestion.provenance.independentEvidence,'not-checked');
  const relationArchive=await runtime.backups.export('default'),relationRestore=await runtime.backups.import(relationArchive.bytes,'Restored boundary tables'),restoredRelation=store.get("SELECT f.* FROM source_files f JOIN entities e ON e.id=f.entity_id WHERE f.vault_id=? AND e.name='Boundary tables'",relationRestore.id),restoredLinked=new SourceDocuments(store).get(restoredRelation);assert.deepEqual(restoredLinked.ingestion.relations,linked.ingestion.relations);assert.equal(generation.length,5);


 }finally{if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();db.close();rmSync(root,{recursive:true,force:true});if(originalFlag===undefined)delete process.env.NOEMA_PDF_PROVIDER_INGESTION;else process.env.NOEMA_PDF_PROVIDER_INGESTION=originalFlag;}
});

test('PDF provider setting persists, supersedes the startup flag and gates admission through the live HTTP contract',async t=>{
 const root=mkdtempSync(path.join(tmpdir(),'noema-ingestion-settings-')),database=path.join(root,'db.sqlite');
 let db=openDatabase(database),store=new Store(db),runtime,server;
 assert.equal(sourceIngestionEnabled(store,{}),false,'provider processing is off without saved configuration or the legacy flag');
 const previous=process.env.NOEMA_PDF_PROVIDER_INGESTION;process.env.NOEMA_PDF_PROVIDER_INGESTION='1';
 const secrets={read:()=>null,write(){throw new Error('No credentials should be changed');},remove(){throw new Error('No credentials should be changed');}};
 const intelligence=new Intelligence(secrets,async()=>{throw new Error('Settings must not contact a provider');});
 try {
  runtime=createRuntime(store,intelligence,readNetworkConfig());
  server=http.createServer(createTransportHandler(runtime,path.resolve('dist/client'),new Set()));server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,headers={'x-noema-request':'1','content-type':'application/json'},settings=base+'/api/source-ingestion/settings';
  assert.deepEqual(await(await fetch(settings,{headers})).json(),{enabled:true});
  assert.equal((await fetch(settings)).status,403);
  assert.equal((await fetch(settings,{method:'PUT',headers:{'x-noema-request':'1'},body:'false'})).status,415);
  for(const body of [{enabled:'true'},{enabled:true,unexpected:1},{}])assert.equal((await fetch(settings,{method:'PUT',headers,body:JSON.stringify(body)})).status,400);
  const save=enabled=>fetch(settings,{method:'PUT',headers,body:JSON.stringify({enabled})});
  assert.deepEqual(await(await save(false)).json(),{enabled:false});
  assert.equal((await(await fetch(base+'/api/source-ingestion/capabilities')).json()).enabled,false);
  const options={route:'openai',model:'gpt-6.1-sol',depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:8,maxOutputTokens:24000,maxCostUsd:null}};
  await assert.rejects(runtime.sourceFiles.admit('default','synthetic.pdf',Buffer.from('unused'),undefined,()=>{},undefined,false,options),/not enabled/);
  const upload=await fetch(base+'/api/source-files?'+new URLSearchParams({name:'synthetic.pdf',ingestion:JSON.stringify(options)}),{method:'POST',headers:{...headers,'content-type':'application/pdf'},body:Buffer.from('unused')});
  assert.equal(upload.status,409);assert.match(await upload.text(),/not enabled/);
  assert.deepEqual(await(await save(true)).json(),{enabled:true});
  assert.equal((await(await fetch(base+'/api/source-ingestion/capabilities')).json()).enabled,true);
  await save(false);
  await new Promise(resolve=>server.close(resolve));server=undefined;runtime.close();runtime=undefined;db.close();
  db=openDatabase(database);store=new Store(db);
  assert.equal(sourceIngestionEnabled(store),false,'saved off survives restart even with the startup flag on');
  assert.equal(store.get('SELECT count(*) n FROM source_ingestion_runs').n,0);
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();db.close();rmSync(root,{recursive:true,force:true});
  if(previous===undefined)delete process.env.NOEMA_PDF_PROVIDER_INGESTION;else process.env.NOEMA_PDF_PROVIDER_INGESTION=previous;
 }
});

for(const provider of ['openai','gemini'])test(`${provider} HTTP PDF creation enriches in one call and explicit recovery uses a separate enrichment task`,async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-pdf-enrichment-http-')),db=openDatabase(path.join(directory,'db.sqlite')),store=new Store(db),previousFlag=process.env.NOEMA_PDF_PROVIDER_INGESTION;process.env.NOEMA_PDF_PROVIDER_INGESTION='1';
 let runtime,server;const requests=[];
 const model=provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash',secret={read:()=>({key:'synthetic-enrichment-key',expiresAt:'2099-01-01T00:00:00.000Z',generation:'synthetic'}),write(){throw Error('No credential changes');},remove(){throw Error('No credential changes');}};
 const transport=async(url,options)=>{
  if(options.method==='DELETE')return Response.json({});
  if(url==='https://api.openai.com/v1/files')return Response.json({id:'file-enrichment'});
  if(url==='https://generativelanguage.googleapis.com/upload/v1/files?uploadType=multipart')return Response.json({file:{name:'files/enrichment',uri:'https://generativelanguage.googleapis.com/v1/files/enrichment',state:'ACTIVE',expirationTime:'2099-01-01T00:00:00Z'}});
  assert.ok(['https://api.openai.com/v1/responses','https://generativelanguage.googleapis.com/v1/interactions'].includes(url));
  const request=JSON.parse(options.body),kind=requestKind(request);requests.push(kind);assert.equal(request.model,model);assert.equal(request.store,false);
  const output=kind==='enrichment'?enrichmentReply(request,provider):transcriptionReply(ir());
  if(kind==='enrichment')assert.match(request.instructions??request.system_instruction,/Enrich structure, metadata and synopsis/);
  return provider==='openai'?Response.json({id:'response-'+requests.length,model,status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}],usage:{input_tokens:100,output_tokens:200}}):Response.json({id:'interaction-'+requests.length,model,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(output)}]}],usage:{total_input_tokens:100,total_output_tokens:200}});
 };
 try{
  runtime=createRuntime(store,new Intelligence(secret,transport,Date.now,undefined,undefined,undefined,secret),readNetworkConfig());server=http.createServer(createTransportHandler(runtime,path.resolve('dist/client'),new Set()));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const pdf=await PDFDocument.create();pdf.addPage([200,300]).drawText('Faithful synthetic source.',{x:10,y:250,size:9});pdf.addPage([200,300]);
  const config={route:provider,model,depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:8,maxOutputTokens:24000,maxCostUsd:null}};
  const uploaded=await fetch(base+'/api/source-files?'+new URLSearchParams({name:'enriched.pdf',ingestion:JSON.stringify(config)}),{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/pdf'},body:Buffer.from(await pdf.save({useObjectStreams:false}))});assert.equal(uploaded.status,201,await uploaded.clone().text());const file=await uploaded.json();
  const created=await fetch(base+'/api/entities',{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/json'},body:JSON.stringify({name:'Manual source title',type:'source',attachmentIds:[file.id]})});assert.equal(created.status,201,await created.clone().text());const source=await created.json();
  await runtime.sourceIngestion.tick();const progress=await(await fetch(base+`/api/source-files/${file.id}/ingestion`)).json();assert.equal(progress.state,'completed',progress.error);assert.deepEqual(requests,['extraction']);assert.equal(progress.enrichedWindows,1);
  const stored=runtime.sourceFiles.require('default',file.id),document=new SourceDocuments(store).get(stored);assert.match(stored.summary,/together with transcription, structure and metadata/);assert.equal(stored.generated_name,'Faithful synthetic source.');assert.equal(document.semantic.children[0].kind,'section');assert.equal(document.semantic.children[0].title,'Faithful synthetic source.');
  const proposals=store.all("SELECT p.value,c.evidence_json FROM property_proposals p JOIN source_metadata_candidates c ON c.proposal_id=p.id WHERE p.entity_id=? AND c.field_key='bibliography:title'",source.id);assert.equal(proposals.length,1);assert.equal(proposals[0].value,'Faithful synthetic source.');assert.ok(JSON.parse(proposals[0].evidence_json).some(evidence=>evidence.excerpt==='Faithful synthetic source.'));
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,'Manual source title');assert.ok(progress.windows.every(window=>window.kind!=='enrichment'));
  const exported=await fetch(base+`/api/source-files/${file.id}/enriched-json`);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/application\/json/);assert.match(exported.headers.get('content-disposition'),/enriched.json/);assert.equal(exported.headers.get('cache-control'),'no-store');
  const json=await exported.json();assert.equal(json.schemaVersion,1);assert.match(json.metadata.synopsis,/together with transcription/);assert.equal(json.blocks[0].text,'Faithful synthetic source.');assert.equal(json.text,undefined);assert.equal(json.semantic,undefined);assert.equal(json.document,undefined);assert.deepEqual(Object.keys(json).sort(),['blocks','metadata','pages','relations','repairs','schemaVersion']);assert.deepEqual(requests,['extraction'],'Export uses the retained result without generation');
  const explicit=await fetch(base+`/api/source-files/${file.id}/ingestion/enrich`,{method:'POST',headers:{'x-noema-request':'1','Content-Type':'application/json'},body:'{}'});assert.equal(explicit.status,202,await explicit.clone().text());await runtime.sourceIngestion.tick();assert.deepEqual(requests,['extraction','enrichment']);assert.match(runtime.sourceFiles.require('default',file.id).summary,/dedicated structure and metadata enrichment pass/);
  await fetch(base+`/api/source-files/${file.id}/ingestion`);assert.equal(requests.length,2,'Status inspection cannot rerun enrichment');
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}runtime?.close();db.close();rmSync(directory,{recursive:true,force:true});if(previousFlag===undefined)delete process.env.NOEMA_PDF_PROVIDER_INGESTION;else process.env.NOEMA_PDF_PROVIDER_INGESTION=previousFlag;}
});
