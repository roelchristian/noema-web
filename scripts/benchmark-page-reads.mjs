// Deterministic local fixture; providers throw if invoked. No workers or live calls.
// node --import tsx scripts/benchmark-page-reads.mjs [--assert]
// NOEMA_BENCH_ROOT=/tmp/baseline node --import tsx scripts/benchmark-page-reads.mjs
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const root=path.resolve(process.env.NOEMA_BENCH_ROOT??new URL('..',import.meta.url).pathname);
const moduleAt=relative=>import(pathToFileURL(path.join(root,relative)).href);
const [{openDatabase},{Store},{createRuntime},{createTransportHandler},{Intelligence},{Domains},{createClassificationBaseline},{summaryBaseline},{embeddingModel,embeddingDimensions}]=await Promise.all([
 'src/server/database.ts','src/server/store.ts','src/server/runtime.ts','src/server/transport.ts','src/server/modules/intelligence.ts','src/server/modules/domains.ts','src/server/modules/page-semantic-drift.ts','src/server/modules/page-summary-freshness.ts','src/shared/embeddings.ts'].map(moduleAt));
const dir=mkdtempSync(path.join(tmpdir(),'noema-read-bench-')),db=openDatabase(path.join(dir,'fixture.sqlite'));
let providerCalls=0,tracking=false,metrics={};
const reset=()=>{metrics={reads:0,writeStatements:0,rowsChanged:0,providerCalls:0,classificationAssessments:0,vectorLoads:0,knowledgeLists:0,storeGets:0,storeAlls:0,storeRuns:0};};reset();
const store=new Store(db);
for(const name of ['get','all','run']) {
 const original=store[name].bind(store);
 store[name]=(sql,...args)=>{if(tracking)metrics[{get:'storeGets',all:'storeAlls',run:'storeRuns'}[name]]++;return original(sql,...args);};
}
const prepare=db.prepare.bind(db);
db.prepare=sql=>{
 const statement=prepare(sql);
 for(const name of ['get','all','run']) {
  const original=statement[name].bind(statement);
  statement[name]=(...args)=>{
   if(tracking){if(name==='run')metrics.writeStatements++;else metrics.reads++;if(/select[\s\S]*\b(?:\w+\.)?vector\b/i.test(sql))metrics.vectorLoads++;}
   return original(...args);
  };
 }
 return statement;
};
const assess=Domains.prototype.assess;
Domains.prototype.assess=function(...args){if(tracking)metrics.classificationAssessments++;return assess.apply(this,args);};
const secret={read:()=>null,write(){},remove(){}};
const ai=new Intelligence(secret,async()=>{providerCalls++;throw new Error('Unexpected provider call in read fixture');});
const runtime=createRuntime(store,ai,{lan:false,host:'127.0.0.1',port:0});
const list=runtime.knowledge.list.bind(runtime.knowledge);runtime.knowledge.list=(...args)=>{if(tracking)metrics.knowledgeLists++;return list(...args);};
const server=http.createServer(createTransportHandler(runtime,path.join(root,'dist/client'),new Set()));
try {
 let page=runtime.pages.create('default',{title:'Algebra field notes'});
 const vocabulary='algebra theorem proof polynomial equation group ring field vector geometry analysis number matrix topology';
 const words=Array.from({length:4235},(_,i)=>vocabulary.split(' ')[i%14]);
 const blocks=Array.from({length:9},(_,i)=>({id:'body-'+i,type:'paragraph',checked:false,content:[{text:words.slice(Math.floor(i*4235/9),Math.floor((i+1)*4235/9)).join(' ')}]}));
 store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(blocks),page.id);
 page=runtime.pages.get('default',page.id);
 const vector=JSON.stringify(Array.from({length:embeddingDimensions},(_,i)=>Math.sin(i+1)/100));
 for(let ordinal=0;ordinal<9;ordinal++) {
  const id='fixture-segment-'+ordinal,hash='fixture-hash-'+ordinal,text=blocks[ordinal].content[0].text;
  store.run('INSERT INTO page_segments (id,page_id,vault_id,revision,projection_hash,ordinal,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,page.id,'default',page.revision,'fixture-projection',ordinal,'',text,text,hash,JSON.stringify([blocks[ordinal].id]),0,text.length,471);
  store.run('INSERT INTO page_segment_embeddings VALUES (?,?,?,?,?,?,?)',id,embeddingModel,embeddingDimensions,hash,vector,471,'2026-01-01T00:00:00Z');
 }
 store.run('DELETE FROM page_index_dirty WHERE page_id=?',page.id);
 const domains=new Domains(store);domains.setInferred('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},createClassificationBaseline(page).contentHash,page);
 runtime.enrichments.save('default',page.id,'summary',{summary:'Algebra studies groups, rings, fields, and mathematical structure.',origin:'inferred',baseline:summaryBaseline(page),generatedContentHash:page.summaryContentHash},page.revision,ai.selection());
 // Warm only compatibility paths; each reported request starts from settled storage.
 runtime.enrichments.list('default',page.id);
 store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',page.id);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+'/api/pages/'+page.id;
 const request=async suffix=>{const response=await fetch(base+suffix,{headers:{'X-Noema-Request':'1','X-Vault-Id':'default'}});return {status:response.status,body:await response.text()};};
 const results={fixture:{words:4235,segments:9,dimensions:embeddingDimensions,internalStateBytes:Buffer.byteLength(store.get("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='enrichment_state'",page.id)?.data??''),mode:'mocked providers, workers disabled; SQLite statement counts include request authorization'}};
 for(const [label,suffix] of [['page',''],['metadata','/metadata'],['enrichments','/enrichments'],['status','/enrichment-status']]) {
  reset();const before=prepare('SELECT total_changes() AS n').get().n,calls=providerCalls;
  tracking=true;const response=await request(suffix);tracking=false;
  metrics.rowsChanged=prepare('SELECT total_changes() AS n').get().n-before;metrics.providerCalls=providerCalls-calls;
  results[label]={status:response.status,bytes:Buffer.byteLength(response.body),...metrics};
  if(process.argv.includes('--assert')) {
   assert.equal(response.status,200,label);for(const key of ['writeStatements','rowsChanged','providerCalls','classificationAssessments','vectorLoads'])assert.equal(metrics[key],0,label+': '+key);
   if(label==='enrichments')assert.doesNotMatch(response.body,/"(?:baseline|tokenCounts|vector|embedding|body)"/);
  }
 }
 reset();const before=prepare('SELECT total_changes() AS n').get().n;tracking=true;
 for(let i=0;i<10;i++)await request('/enrichments');tracking=false;
 metrics.rowsChanged=prepare('SELECT total_changes() AS n').get().n-before;results.tenEnrichmentReads={...metrics};
 if(process.argv.includes('--assert'))for(const key of ['writeStatements','rowsChanged','classificationAssessments','vectorLoads'])assert.equal(metrics[key],0,'ten reads: '+key);
 reset();const prepareBefore=prepare('SELECT total_changes() AS n').get().n;tracking=true;const snapshot=runtime.pageEnrichment.prepare('default',page.id,{fields:['summary'],explicit:true});tracking=false;
 metrics.rowsChanged=prepare('SELECT total_changes() AS n').get().n-prepareBefore;
 results.summaryOnlyPreparation={...metrics,requestedFields:snapshot?.requestedFields??[]};
 ai.generatePageEnrichment=async()=>{providerCalls++;return {summary:'A mocked fresh summary of algebra and mathematical structure.'};};
 reset();const generationBefore=prepare('SELECT total_changes() AS n').get().n,generationCalls=providerCalls;tracking=true;
 await runtime.pageEnrichment.run('default',runtime.pages.get('default',page.id),undefined,{fields:['summary'],explicit:true});tracking=false;
 metrics.rowsChanged=prepare('SELECT total_changes() AS n').get().n-generationBefore;metrics.providerCalls=providerCalls-generationCalls;
 results.summaryOnlyGeneration={...metrics};
 console.log(JSON.stringify(results,null,2));
}finally {
 tracking=false;runtime.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});
}
