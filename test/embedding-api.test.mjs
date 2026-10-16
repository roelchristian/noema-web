import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/http.ts';
import { Intelligence } from '../src/server/modules/intelligence.ts';

const blocks = text => [{id:'body',type:'paragraph',checked:false,content:[{text}]}];
const vector = [1,...Array(1535).fill(0)];
const embedded = () => Response.json({model:'text-embedding-3-small',data:[{index:0,embedding:vector}],usage:{prompt_tokens:12,total_tokens:12}});

async function fixture(run) {
  const dir=mkdtempSync(path.join(tmpdir(),'noema-embedding-api-')), file=path.join(dir,'notes.sqlite');
  const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
  let db,server,base,calls=[],handler=async()=>embedded(),tick=Date.now();
  async function start() {
    db=openDatabase(file);
    const ai=new Intelligence(secrets,async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body),options});
      return handler();
    },()=>tick+=61000);
    if(!secrets.value)ai.save({apiKey:'sk-test-embedding-api-secret-key'});
    server=createApp(new Store(db),path.resolve('dist/client'),ai);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port+'/api/';
  }
  async function stop(){if(!server)return;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();server=null;}
  async function call(route,method='GET',body,expected=200,vault='default',extra={}) {
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-Id':vault,...extra},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
  }
  async function until(predicate) {
    const end=Date.now()+7000;
    while(Date.now()<end){const status=await call('embeddings');if(predicate(status))return status;await new Promise(resolve=>setTimeout(resolve,25));}
    assert.fail('Embedding queue did not reach expected state: '+JSON.stringify(await call('embeddings')));
  }
  await start();
  try {await run({call,until,calls,get db(){return db;},get base(){return base;},setHandler(value){handler=value;},async restart(){await stop();await start();}});}
  finally {await stop();rmSync(dir,{recursive:true,force:true});}
}

test('embedding API persists indexes and history, rejects stale content, and follows note lifecycle',async()=>fixture(async f=>{
  const {call,until}=f;
  await call('embeddings/settings','PUT',{automatic:false,minCharacters:20});
  const other=await call('vaults','POST',{name:'Separate index'},201);
  let page=await call('pages','POST',{title:'Semantic fixture'},201);
  page=await call('pages/'+page.id,'PUT',{...page,blocks:blocks('Durable semantic knowledge about gardens and careful planting.')});
  let status=await call('embeddings');
  assert.equal(status.model,'text-embedding-3-small');assert.equal(status.dimensions,1536);
  assert.equal(status.notes.find(note=>note.pageId===page.id).state,'missing');
  await call('embeddings/enqueue','POST',{mode:'missing'});
  status=await until(value=>value.jobs.some(job=>job.pageId===page.id&&job.status==='completed'));
  assert.equal(status.notes.find(note=>note.pageId===page.id).state,'indexed');
  assert.ok(status.jobs.find(job=>job.pageId===page.id).attempts>=1);
  let results=await call('embeddings/search','POST',{query:'gardening',limit:10});
  assert.ok(results.results.some(result=>result.id===page.id));
  assert.equal(results.results.find(result=>result.id===page.id).snippet,'Durable semantic knowledge about gardens and careful planting.');
  const logged=(await call('intelligence/activity')).items;
  const indexing=logged.find(item=>item.action==='note_embedding'&&item.objectId===page.id);
  assert.equal(indexing.status,'completed');assert.equal(indexing.model,'text-embedding-3-small');assert.equal(indexing.revision,page.revision);assert.ok(indexing.promptBytes>0);
  const searching=logged.find(item=>item.action==='search_embedding');
  assert.equal(searching.status,'completed');assert.equal(searching.vaultId,'default');assert.equal(searching.objectId,null);assert.equal(searching.promptBytes,Buffer.byteLength('gardening'));
  const provider=f.calls[0];assert.equal(provider.url,'https://api.openai.com/v1/embeddings');
  assert.equal(provider.body.model,'text-embedding-3-small');assert.equal(provider.body.dimensions,1536);
  assert.equal(provider.options.redirect,'error');
  assert.ok(!JSON.stringify(status.jobs).includes('careful planting'),'Queue logs exclude note contents');
  await f.restart();
  status=await call('embeddings');
  assert.equal(status.settings.automatic,false);assert.equal(status.notes.find(note=>note.pageId===page.id).state,'indexed');
  assert.ok(status.jobs.some(job=>job.pageId===page.id&&job.status==='completed'));
  assert.ok((await call('intelligence/activity')).items.some(item=>item.id===indexing.id),'Embedding activity survives restart');
  results=await call('embeddings/search','POST',{query:'gardening'},200,other.id);assert.deepEqual(results.results,[]);
  page=await call('pages/'+page.id,'PUT',{...page,blocks:blocks('Revised knowledge about mountains and climbing safely.')});
  status=await call('embeddings');assert.equal(status.notes.find(note=>note.pageId===page.id).state,'stale');
  results=await call('embeddings/search','POST',{query:'gardening'});assert.ok(!results.results.some(result=>result.id===page.id));
  await call('embeddings/enqueue','POST',{mode:'eligible'});
  await until(value=>value.notes.find(note=>note.pageId===page.id)?.state==='indexed');
  await call('pages/'+page.id,'DELETE');
  results=await call('embeddings/search','POST',{query:'mountains'});assert.ok(!results.results.some(result=>result.id===page.id));
  await call('trash/'+page.id+'/restore','POST',{});
  await call('embeddings/settings','PUT',{automatic:true,minCharacters:20});
  page=await call('pages/'+page.id);page=await call('pages/'+page.id,'PUT',{...page,blocks:blocks('Another saved revision receives a fresh automatic embedding.')});
  await until(value=>value.notes.find(note=>note.pageId===page.id)?.state==='indexed');
  await call('vaults/default/lock','POST',{passphrase:'embedding-lock'});
  await call('embeddings','GET',undefined,423);await call('embeddings/search','POST',{query:'gardens'},423);
  await call('vaults/default/unlock','POST',{passphrase:'embedding-lock'});
  await call('pages/'+page.id,'DELETE');await call('trash/'+page.id,'DELETE');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM note_embeddings WHERE page_id=?').get(page.id).n,0);
}));

test('embedding API enforces client/origin protection, validates requests, and scopes job retries',async()=>fixture(async f=>{
  const {call}=f;
  await call('embeddings','GET',undefined,403,'default',{'X-Noema-Request':''});
  await call('embeddings/enqueue','POST',{mode:'eligible'},403,'default',{'Content-Type':'text/plain'});
  await call('embeddings/search','POST',{query:'private'},403,'default',{Origin:'https://attacker.example'});
  await call('embeddings/settings','PUT',{automatic:true,minCharacters:-1},400);
  await call('embeddings/enqueue','POST',{mode:'all'},400);
  await call('embeddings/search','POST',{query:''},400);
  await call('embeddings/search','POST',{query:'test',limit:10000},400);
  await call('embeddings/jobs/missing/retry','POST',{},404);
  await call('embeddings/settings','PUT',{automatic:false,minCharacters:20});
  const other=await call('vaults','POST',{name:'Other jobs'},201);
  let page=await call('pages','POST',{title:'Retry fixture'},201);
  await call('pages/'+page.id,'PUT',{...page,blocks:blocks('This eligible note exercises durable failed job history.')});
  f.setHandler(async()=>Response.json({error:{message:'sensitive upstream details'}},{status:400}));
  await call('embeddings/enqueue','POST',{mode:'missing'});
  // Exhaust earlier attempts without waiting through the 30/60-second retry backoff.
  f.db.prepare("UPDATE embedding_jobs SET attempts=2 WHERE status='queued'").run();
  const status=await f.until(value=>value.jobs.some(job=>job.pageId===page.id&&job.status==='failed'));
  const job=status.jobs.find(job=>job.pageId===page.id&&job.status==='failed');
  assert.ok(!JSON.stringify(job).includes('sensitive upstream details'));
  const failed=(await call('intelligence/activity')).items.find(item=>item.action==='note_embedding'&&item.objectId===page.id);
  assert.equal(failed.status,'failed');assert.equal(failed.httpStatus,502);
  await call('embeddings/jobs/'+job.id+'/retry','POST',{},404,other.id);
  f.setHandler(async()=>embedded());
  await call('embeddings/jobs/'+job.id+'/retry','POST',{});
  await f.until(value=>value.notes.find(note=>note.pageId===page.id)?.state==='indexed');
}));

test('search snippets are private plain text excerpts without embeddings or credentials',async()=>fixture(async f=>{
 const {call}=f;
 await call('embeddings/settings','PUT',{automatic:false,minCharacters:20});
 const other=await call('vaults','POST',{name:'Private snippets'},201);
 let page=await call('pages','POST',{title:'A matching title stays separate'},201);
 const entity=await call('entities','POST',{name:'Ursula Le Guin',type:'person'},201);
 page=await call('pages/'+page.id,'PUT',{...page,blocks:[
  ...blocks('Introductory context. '.repeat(30)),
  {id:'quote',type:'paragraph',content:[{text:'A meaningful passage about '},{entityId:entity.id},{text:' and semantic gardens.'}]},
  {id:'table',type:'table',content:[],rows:[[[{text:'Careful planting in table cells'}]]]},
 ]});
 let hidden=await call('pages','POST',{title:'Other vault'},201,other.id);
 hidden=await call('pages/'+hidden.id,'PUT',{...hidden,blocks:blocks('Private content outside the active vault.')},200,other.id);
 await call('intelligence','DELETE');
 const requests=f.calls.length;
 let result=await call('search/snippets','POST',{query:'Ursula',pageIds:[page.id,hidden.id,'missing']});
 assert.deepEqual(Object.keys(result.snippets),[page.id]);
 assert.ok(result.snippets[page.id].includes('Ursula Le Guin'));
 assert.ok(result.snippets[page.id].length<=240);
 result=await call('search/snippets','POST',{query:'planting',pageIds:[page.id]});
 assert.ok(result.snippets[page.id].includes('planting in table cells'));
 assert.equal(f.calls.length,requests,'Snippets never call OpenAI');
 await call('search/snippets','POST',{query:'x'.repeat(2001),pageIds:[]},400);
 await call('search/snippets','POST',{query:'x',pageIds:Array(101).fill(page.id)},400);
 await call('search/snippets','POST',{query:'x',pageIds:[42]},400);
 await call('search/snippets','POST',{query:'x',pageIds:[page.id]},403,'default',{'X-Noema-Request':''});
 await call('search/snippets','POST',{query:'x',pageIds:[page.id]},403,'default',{'Content-Type':'text/plain'});
 await call('search/snippets','POST',{query:'x',pageIds:[page.id]},403,'default',{Origin:'https://attacker.example'});
 await call('vaults/default/lock','POST',{passphrase:'snippet-lock'});
 await call('search/snippets','POST',{query:'Ursula',pageIds:[page.id]},423);
 await call('vaults/default/unlock','POST',{passphrase:'snippet-lock'});
 await call('pages/'+page.id,'DELETE');
 assert.deepEqual((await call('search/snippets','POST',{query:'Ursula',pageIds:[page.id]})).snippets,{});
}));
