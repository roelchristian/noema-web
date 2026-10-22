import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once,EventEmitter} from 'node:events';
import {sourcePageRoutes} from '../src/server/routes/source-pages.ts';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {createApp} from '../src/server/http.ts';
import {createRuntime} from '../src/server/runtime.ts';
import {readNetworkConfig} from '../src/server/network.ts';

async function fixture(t,generate) {
 const dir=mkdtempSync(path.join(tmpdir(),'noema-runtime-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),files=new SourceFiles(store);
 const file=files.add('default','synthetic.md',Buffer.from('A group has an identity.\nEvery element has an inverse.'));
 const source=new Knowledge(store).create('default',{name:'Synthetic groups',type:'source',attachmentIds:[file.id]});await files.tick();files.close();
 const selection=()=>({model:'test-model',reasoningEffort:'none'}),ai={selection,enrichmentSelection:selection,personaSelection:()=>({id:"oxford_don",version:1,origin:"builtin"}),generate,purgeExpired(){}};
 let server;
 t.after(async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,ai,source,file,start:async()=>{server=createApp(store,path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}};
}
const output=JSON.stringify({type:'title',title:'Synthetic group axioms',language:'en'})+'\n'+JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'Groups have identities.',citations:[]})+'\n';
const headers={'Content-Type':'application/json','X-Noema-Request':'1'};
const events=async response=>(await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));

test('runtime recovers activity before listening and repeated recovery emits one outcome',async t=>{
 const f=await fixture(t,async()=>{throw Error('Unexpected AI');});
 f.store.run("INSERT INTO ai_activity(id,action,status,started_at,vault_id,object_kind,object_id,model,reasoning_effort,prompt_bytes) VALUES ('pending','create_page_from_source','running',?,'default','entity',?,'test-model','none',10)",new Date().toISOString(),f.source.id);
 const runtime=createRuntime(f.store,f.ai,readNetworkConfig());
 assert.equal(f.store.get("SELECT status FROM ai_activity WHERE id='pending'").status,'interrupted');
 const count=f.store.get('SELECT COUNT(*) AS n FROM ai_notifications').n;assert.ok(count>0);runtime.close();
 const recovered=createRuntime(f.store,f.ai,readNetworkConfig());assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ai_notifications').n,count);recovered.close();
});

test('source-page transport stages before its terminal event, replays and accepts idempotently',async t=>{
 let calls=0,mathCalls=0;
 const f=await fixture(t,async request=>{if(request.kind==='sourceMath'){mathCalls++;assert.equal(request.background,true);request.onRequest(50);return JSON.stringify({edits:[],uncertain:[]});}calls++;assert.equal(request.kind,'sourcePage');assert.ok(request.signal instanceof AbortSignal);request.onRequest(100);request.onPreviewDelta('{"type":"invented"}\n');request.onPreviewReset();request.onDelta(output);return output;});
 f.store.run('UPDATE source_files SET contains_math=1 WHERE id=?',f.file.id);
 const base=await f.start(),route=base+'/api/entities/'+f.source.id+'/create-page',body={requestId:randomUUID()};
 const post=(url=route,data=body,extra={})=>fetch(url,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 const rejected=await post(route,body,{Origin:'http://evil.invalid'});assert.equal(rejected.status,403);assert.match(rejected.headers.get('content-type'),/application\/json/);assert.equal(calls,0);
 const response=await post();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/x-ndjson; charset=utf-8');assert.equal(response.headers.get('x-accel-buffering'),'no');assert.equal(response.headers.get('cache-control'),'no-store');
 const stream=await events(response);assert.equal(stream.at(-1).type,'review');assert.ok(stream.some(event=>event.type==='preview_reset'));
 const row=f.store.get('SELECT status,notification_id,activity_id FROM source_page_drafts WHERE request_id=?',body.requestId);assert.equal(row.status,'pending');assert.ok(row.notification_id);assert.equal(f.store.get('SELECT status FROM ai_activity WHERE id=?',row.activity_id).status,'completed');
 assert.equal((await events(await post())).at(-1).type,'review');assert.equal(calls,1);
 const accepted=await (await post(route+'/accept',body)).json(),again=await (await post(route+'/accept',body)).json();assert.equal(accepted.id,again.id);
 assert.equal((await events(await post())).at(-1).type,'completed');assert.equal(calls,1);assert.equal(mathCalls,1);
});

test('source-page failures after headers and access changes never stage drafts',async t=>{
 for(const mode of ['failure','locked'])await t.test(mode,async t=>{
  const f=await fixture(t,async request=>{request.onRequest(100);if(mode==='failure')throw Error('Private provider detail');f.store.run("UPDATE vaults SET locked=1 WHERE id='default'");return output;});
  const base=await f.start(),response=await fetch(base+'/api/entities/'+f.source.id+'/create-page',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID()})});
  assert.equal(response.status,200);const stream=await events(response);assert.equal(stream.at(-1).type,'error');assert.doesNotMatch(stream.at(-1).message,/Private provider detail/);
  assert.equal(f.store.get('SELECT COUNT(*) AS n FROM source_page_drafts').n,0);assert.equal(f.store.get("SELECT status FROM ai_activity WHERE action='create_page_from_source'").status,'failed');
 });
});

test('disconnect aborts source-page work and persists interruption without a draft',async t=>{
 let ready,aborted;const started=new Promise(resolve=>ready=resolve),stopped=new Promise(resolve=>aborted=resolve);
 const f=await fixture(t,request=>{request.onRequest(100);ready();return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>{aborted();reject(Error('cancelled'));},{once:true}));});
 const base=await f.start(),controller=new AbortController();
 const response=await fetch(base+'/api/entities/'+f.source.id+'/create-page',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID()}),signal:controller.signal});
 await started;controller.abort();await stopped;
 // Drain the response close handler before observing durable completion.
 await assert.rejects(response.text());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.store.get("SELECT status FROM ai_activity WHERE action='create_page_from_source'").status,'interrupted');assert.equal(f.store.get('SELECT COUNT(*) AS n FROM source_page_drafts').n,0);
});

test('a lost terminal callback preserves completed activity and its recoverable draft',async t=>{
 const f=await fixture(t,async request=>{request.onRequest(100);request.onDelta(output);return output;});
 const runtime=createRuntime(f.store,f.ai,readNetworkConfig());
 try {
 const prepared=runtime.sourcePageGeneration.prepare('default',f.source.id,{requestId:randomUUID()});
 await assert.rejects(runtime.sourcePageGeneration.run({vault:'default',id:f.source.id,prepared,signal:new AbortController().signal,onGenerating(){},onEvent(event){if(event.type==='review')throw Error('lost terminal write');}}),/lost terminal write/);
 assert.equal(f.store.get("SELECT status FROM ai_activity WHERE action='create_page_from_source'").status,'completed');
 assert.equal(runtime.sourcePageGeneration.prepare('default',f.source.id,{requestId:prepared.requestId}).review.id,prepared.requestId);
 }finally{runtime.close();}
});

test('source-page adapter starts heartbeats for new work and removes timers and close listeners',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const res=new EventEmitter(),writes=[];Object.assign(res,{destroyed:false,writableEnded:false,writeHead(){},flushHeaders(){},write(value){writes.push(value);},end(){this.writableEnded=true;}});
 let finish;
 const services={vaults:{requireOpen(){}},sourcePageGeneration:{prepare(){return {};},async run({onEvent,onGenerating}){onEvent({type:'status',phase:'thinking'});onGenerating();await new Promise(resolve=>finish=resolve);}}};
 const running=sourcePageRoutes(services,{vault:'default',id:'synthetic',parts:['api','entities','synthetic','create-page'],method:'POST',body:{},res,send(){assert.fail('JSON response after stream headers');}});
 t.mock.timers.tick(10000);assert.equal(writes.at(-1),'\n');finish();await running;
 const count=writes.length;t.mock.timers.tick(20000);assert.equal(writes.length,count);assert.equal(res.listenerCount('close'),0);assert.equal(res.writableEnded,true);
});
