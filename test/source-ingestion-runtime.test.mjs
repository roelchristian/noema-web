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
const sha=value=>createHash('sha256').update(value).digest('hex');
function ir(){return {schemaVersion:1,metadata:{title:null,language:'en',synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'ix',role:'owned',state:'content',unresolved:[]},{number:2,printedLabel:null,role:'owned',state:'blank',unresolved:[]}],blocks:[{id:'provider-id',page:1,order:0,kind:'paragraph',text:'Faithful synthetic source.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[],repairs:[]};}
for(const provider of ['openai','gemini'])test(`${provider} actual Linux HTTP import uses portable PDF operations, real adapter envelope, provider evidence and durable restore`,{skip:process.platform!=='linux'?'Portable Linux integration gate':false},async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'noema-ingestion-runtime-')),db=openDatabase(path.join(root,'db.sqlite')),store=new Store(db),originalFlag=process.env.NOEMA_PDF_PROVIDER_INGESTION;
 process.env.NOEMA_PDF_PROVIDER_INGESTION='1';
 let runtime,server;const generation=[],uploads=[],deleted=[];
 const model=provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash';
 const secrets={read:()=>({key:'synthetic-key-not-a-credential',expiresAt:'2099-01-01T00:00:00.000Z',generation:'synthetic'}),write(){throw new Error('Test must not configure credentials');},remove(){throw new Error('Test must not remove credentials');}};
 const transport=async(url,options)=>{
  if(options.method==='DELETE'){deleted.push(url);return Response.json({});}
  if(url==='https://api.openai.com/v1/files'){assert.equal(provider,'openai');assert.equal(options.body.get('purpose'),'user_data');const bytes=Buffer.from(await options.body.get('file').arrayBuffer());assert.match(bytes.toString('latin1',0,8),/^%PDF-/);uploads.push(bytes);return Response.json({id:'file-synthetic'});}
  if(url==='https://generativelanguage.googleapis.com/upload/v1/files?uploadType=multipart'){assert.equal(provider,'gemini');const bytes=Buffer.from(options.body);assert.ok(bytes.includes(Buffer.from('%PDF-')));uploads.push(bytes);return Response.json({file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1/files/synthetic',state:'ACTIVE',expirationTime:'2099-01-01T00:00:00Z'}});}
  const request=JSON.parse(options.body);generation.push({url,request});assert.equal(request.model,model);assert.equal(request.store,false);
  if(provider==='openai'){assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.text.format.strict,true);assert.equal(request.input[0].content[0].type,'input_file');return Response.json({id:'resp-synthetic',model,status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ir())}]}],usage:{input_tokens:100,output_tokens:200,output_tokens_details:{reasoning_tokens:20},input_tokens_details:{cached_tokens:0}}});}
  assert.equal(url,'https://generativelanguage.googleapis.com/v1/interactions');assert.equal(request.input[0].type,'document');assert.equal(request.response_format.mime_type,'application/json');return Response.json({id:'interaction-synthetic',model,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(ir())}]}],usage:{total_input_tokens:100,total_output_tokens:200,total_thought_tokens:20,total_cached_tokens:0}});
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
  assert.equal(generation.length,1);assert.equal(uploads.length,1);assert.equal(deleted.length,1);await runtime.sourceFiles.tick();await runtime.sourceEnrichments.tick();assert.equal(generation.length,1,'legacy extraction/enrichment never repeats the document request');
  const evidenceResponse=await fetch(base+`/api/source-files/${file.id}/evidence?page=1`);assert.equal(evidenceResponse.status,200);const evidence=await evidenceResponse.json();assert.equal(evidence.ingestion.provider,provider);assert.equal(evidence.ingestion.model,model);assert.equal(evidence.ingestion.text,'Faithful synthetic source.');assert.equal(evidence.ingestion.independentEvidence,'not-checked');assert.equal(evidence.rawExtraction,undefined);assert.equal(evidence.providerTranscription,undefined);
  const blank=await (await fetch(base+`/api/source-files/${file.id}/evidence?page=2`)).json();assert.equal(blank.ingestion.text,'');assert.equal(blank.ingestion.page,2);
  const image=await fetch(base+`/api/source-files/${file.id}/page-image/1`);assert.equal(image.status,200,await image.clone().text());assert.equal(Buffer.from(await image.arrayBuffer()).toString('hex',0,8),'89504e470d0a1a0a');
  const row=store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',file.id),provenance=JSON.parse(row.provenance_json);assert.equal(provenance.originalHash,sha(bytes));assert.equal(provenance.admittedHash,sha(bytes));assert.equal(provenance.transmittedHash.length,64);assert.equal(provenance.responseHash.length,64);assert.equal(provenance.returnedModel,model);assert.equal(store.get('SELECT count(*) n FROM source_reprocessing').n,0);
  const documents=new SourceDocuments(store),before=documents.get(runtime.sourceFiles.require('default',file.id));store.run('DELETE FROM source_documents WHERE file_id=?',file.id);assert.deepEqual(documents.get(runtime.sourceFiles.require('default',file.id)),before);
  const backup=await runtime.backups.export('default'),restored=await runtime.backups.import(backup.bytes,'Restored runtime source');const restoredFile=store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),after=documents.get(restoredFile);assert.equal(restoredFile.ingestion_origin,provider);assert.deepEqual(after.semantic.children,before.semantic.children);assert.deepEqual(after.ingestion.provenance,before.ingestion.provenance);assert.equal(generation.length,1);
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',restoredFile.entity_id).name,'Manual source name');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));runtime?.close();db.close();rmSync(root,{recursive:true,force:true});if(originalFlag===undefined)delete process.env.NOEMA_PDF_PROVIDER_INGESTION;else process.env.NOEMA_PDF_PROVIDER_INGESTION=originalFlag;}
});
