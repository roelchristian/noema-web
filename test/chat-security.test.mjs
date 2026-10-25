import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {createRuntime} from '../src/server/runtime.ts';
import {createTransportHandler} from '../src/server/transport.ts';
import {readNetworkConfig} from '../src/server/network.ts';
import {Chat} from '../src/server/modules/chat.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
const headers={'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-ID':'default'};
async function httpFixture(t,generate) {
 const corpus=chatCorpus(),selection=()=>({model:'test-model',reasoningEffort:'none'});
 const ai={selection,enrichmentSelection:selection,status:()=>({configured:false}),generate:generate??(async request=>{const input=JSON.parse(request.input);return JSON.stringify({claims:[{text:'The supplied material records a position on grace.',attribution:'supported',citationIds:[input.evidence[0].id]}]});}),purgeExpired(){}};
 const runtime=createRuntime(corpus.store,ai,readNetworkConfig());
 const server=http.createServer(createTransportHandler(runtime,path.resolve('dist/client'),new Set()));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{runtime.close();await new Promise(r=>server.close(r));corpus.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const request=(route,method='GET',body,extra={})=>fetch(base+'/api/chat/'+route,{method,headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{})});
 return {...corpus,runtime,request};
}

test('Chat routes enforce same-origin client headers, JSON and vault isolation',async t=>{
 const f=await httpFixture(t);
 assert.equal((await f.request('threads','GET',undefined,{'X-Noema-Request':''})).status,403);
 assert.equal((await f.request('threads','GET',undefined,{'X-Vault-ID':''})).status,400);
 assert.equal((await f.request('threads','POST',{scope:{kind:'vault'}},{Origin:'http://evil.invalid'})).status,403);
 assert.equal((await f.request('threads','POST',{scope:{kind:'vault'}},{'Content-Type':'text/plain'})).status,403);
 const created=await f.request('threads','POST',{scope:{kind:'page',id:f.myNote.id}});assert.equal(created.status,201);const thread=await created.json();
 assert.equal((await f.request('threads/'+thread.id,'GET',undefined,{'X-Vault-ID':f.other})).status,404);
 assert.equal((await f.request('threads/'+thread.id,'DELETE',undefined,{'X-Vault-ID':f.other})).status,404);
 assert.equal((await f.request('threads','POST',{scope:{kind:'page',id:f.hidden.id}})).status,404);
 assert.equal((await f.request('messages','POST',{question:'grace',scope:{kind:'page',id:f.myNote.id},requestId:randomUUID(),tools:[{kind:'sql'}]})).status,200);
 f.store.run("UPDATE vaults SET locked=1 WHERE id='default'");assert.equal((await f.request('threads')).status,423);
});

test('transport emits validated evidence separately before final claims and scopes exact source navigation',async t=>{
 const f=await httpFixture(t),before=f.store.all('SELECT id,text FROM source_files ORDER BY id');
 const response=await f.request('messages','POST',{question:'How is grace understood?',scope:{kind:'source',id:f.primary.id},requestId:randomUUID(),temporary:true});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.equal(response.headers.get('cache-control'),'no-store');
 const stream=(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 assert.deepEqual(stream.map(event=>event.type),['evidence','answer']);assert.ok(stream[0].evidence.length>0);
 assert.ok(stream[0].evidence.every(item=>item.objectId===f.primary.id));
 for(const item of stream[0].evidence.filter(item=>item.kind==='source')){assert.equal(item.reference.sourceId,f.primary.id);assert.equal(item.reference.fileId,f.primary.fileId);assert.ok(item.reference.generationId);assert.ok(item.reference.startLine>=1);assert.ok(item.reference.sourceHash);}
 assert.deepEqual(f.store.all('SELECT id,text FROM source_files ORDER BY id'),before);
 assert.equal(f.store.get('SELECT count(*) n FROM chat_threads').n,0);
});

test('malformed provider citations return a stream error without exposing invalid claims or saving an answer',async t=>{
 const f=await httpFixture(t,async()=>JSON.stringify({claims:[{text:'INVENTED_PROVIDER_TEXT',attribution:'supported',citationIds:['E999']}]}));
 const response=await f.request('messages','POST',{question:'grace',scope:{kind:'page',id:f.myNote.id},requestId:randomUUID()});assert.equal(response.status,200);
 const body=await response.text();assert.doesNotMatch(body,/INVENTED_PROVIDER_TEXT|E999/);assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.match(body,/"type":"error"/);assert.doesNotMatch(body,/"type":"claim"|"type":"answer"/);
 const history=f.store.all('SELECT payload FROM chat_messages');assert.ok(history.every(row=>!row.payload.includes('INVENTED_PROVIDER_TEXT')));
 assert.ok(history.every(row=>JSON.parse(row.payload).role==='user'||JSON.parse(row.payload).status==='failed'));
});

test('even full debug mode receives usage accounting only, never transcript, excerpt or provider output',async()=>{
 const f=chatCorpus();let called=0;
 try {
  const activity=new AIActivityLog(f.store);activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});assert.equal(activity.debugSettings().mode,'full');
  const ai={selection:()=>({model:'test-model',reasoningEffort:'none'}),async generate(request){called++;const observer=request.onRequest(200);assert.deepEqual(Object.keys(observer),['usage']);observer.usage?.({inputTokens:21,outputTokens:4});return JSON.stringify({claims:[{text:'PRIVATE_PROVIDER_ANSWER',attribution:'supported',citationIds:['E1']}]});}};
  const chat=new Chat(f.store,ai,f.retrieval,f.vaults,activity);
  const result=await chat.submit('default',{question:'PRIVATE_TRANSCRIPT grace',scope:{kind:'page',id:f.myNote.id},requestId:randomUUID(),temporary:true});
  assert.equal(called,1);const activityRow=f.store.get('SELECT * FROM ai_activity WHERE id=?',result.activityId);assert.equal(activityRow.prompt_bytes,200);
  const debug=JSON.stringify(f.store.all('SELECT * FROM ai_activity_debug'));assert.doesNotMatch(debug,/PRIVATE_TRANSCRIPT|PRIVATE_PROVIDER_ANSWER|Grace is not entirely/);
  const events=JSON.stringify(f.store.all('SELECT * FROM ai_activity_debug_events'));assert.doesNotMatch(events,/PRIVATE_TRANSCRIPT|PRIVATE_PROVIDER_ANSWER|Grace is not entirely/);chat.close();
 }finally{f.close();}
});

test('Chat uses the configured Meno persona, foreground admission and provider cancellation with mock transport only',async()=>{
 const {Intelligence,GenerationAdmissionError,GenerationCancellationError}=await import('../src/server/modules/intelligence.ts');
 const {completedResponse}=await import('./helpers/providers.ts');
 const fakeSecret={value:null,read(){return this.value;},write(value){this.value=structuredClone(value);},remove(){this.value=null;}};
 let release,calls=0,body;
 const ai=new Intelligence(fakeSecret,async(_url,options)=>{calls++;body=JSON.parse(options.body);return new Promise(resolve=>release=()=>resolve(completedResponse(JSON.stringify({claims:[{text:'Bounded claim',attribution:'supported',citationIds:['E1']}]}))));});
 ai.save({apiKey:'sk-synthetic-chat-test-never-a-real-key'});ai.savePreferences({...ai.selection(),personaId:'editor',personaExpression:'subtle'});
 const controller=new AbortController(),request={kind:'chat',input:'Bounded test evidence',instructions:'Neutral read-only Chat instructions.',signal:controller.signal};
 const running=ai.generate(request);
 assert.equal(calls,1);assert.equal(body.store,false);assert.deepEqual(body.tools,[]);assert.ok(body.instructions.startsWith(request.instructions));assert.match(body.instructions,/AI PERSONA: The Editor/);assert.equal(!!body.stream,false);assert.ok(body.max_output_tokens<=8192);
 await assert.rejects(()=>ai.generate({...request,signal:new AbortController().signal}),GenerationAdmissionError);assert.equal(calls,1);
 controller.abort();release();await assert.rejects(running,error=>error.status===409);
 const blocked=new AbortController();blocked.abort();await assert.rejects(()=>ai.generate({...request,signal:blocked.signal}),error=>error.status===409);assert.equal(calls,1);
});

test('private query embedding strips debug content, avoids shared cache and propagates abort signal',async()=>{
 const {Embeddings}=await import('../src/server/modules/embeddings.ts');
 const f=chatCorpus();let calls=0;
 try {
  const activity=new AIActivityLog(f.store);activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});
  const controller=new AbortController(),vector=Array.from({length:1536},(_,index)=>index===0?1:0);
  const ai={status:()=>({configured:true}),async embed(input,onRequest,background,signal){calls++;assert.equal(input,'PRIVATE_EMBEDDING_QUERY');assert.equal(signal,controller.signal);assert.equal(background,false);const observer=onRequest(25);assert.deepEqual(Object.keys(observer),['usage']);return {embedding:vector,tokens:5};}};
  const embeddings=new Embeddings(f.store,f.pages,f.knowledge,f.vaults,ai,activity);
  await embeddings.queryEmbedding('default','PRIVATE_EMBEDDING_QUERY',{private:true,signal:controller.signal});
  await embeddings.queryEmbedding('default','PRIVATE_EMBEDDING_QUERY',{private:true,signal:controller.signal});assert.equal(calls,2);
  controller.abort();await assert.rejects(embeddings.queryEmbedding('default','PRIVATE_EMBEDDING_QUERY',{private:true,signal:controller.signal}));assert.equal(calls,2);
  assert.doesNotMatch(JSON.stringify(f.store.all('SELECT * FROM ai_activity_debug')),/PRIVATE_EMBEDDING_QUERY/);embeddings.close();
 }finally{f.close();}
});

test('evidence revalidation detects live edits, disallows forged coordinates and never resolves across vaults',async t=>{
 const f=await httpFixture(t),retrieved=await f.runtime.chat.submit('default',{question:'grace',scope:{kind:'page',id:f.myNote.id},requestId:randomUUID(),temporary:true});
 const original=retrieved.message.evidence.find(item=>item.kind==='own_note');assert.ok(original);
 const current=await f.request('evidence','POST',{evidence:[original]});assert.equal(current.status,200);assert.equal((await current.json())[0].status,'current');
 const invalid=await f.request('evidence','POST',{evidence:[{...original,pageReference:{...original.pageReference,blockIds:'forged'}}]});assert.equal(invalid.status,400);
 const isolated=await f.request('evidence','POST',{evidence:[original]},{'X-Vault-ID':f.other});assert.equal(isolated.status,200);assert.equal((await isolated.json())[0].status,'deleted');
 f.pages.update('default',f.myNote.id,{...f.myNote,blocks:[{id:'edited',type:'paragraph',content:[{text:'Grace has been reconsidered.'}]}]});
 const stale=await f.request('evidence','POST',{evidence:[original]});assert.equal(stale.status,200);const snapshot=(await stale.json())[0];assert.equal(snapshot.status,'stale');assert.equal(snapshot.excerpt,original.excerpt);
});

test('Chat uses configured persona settings while ignoring explicit stray persona overrides',async()=>{
 const {generationPolicy}=await import('../src/server/modules/generation-request.ts');
 const {aiPersonas,personaExpressions}=await import('../src/shared/ai-personas.ts');
 const {Intelligence}=await import('../src/server/modules/intelligence.ts');
 const {completedResponse}=await import('./helpers/providers.ts');
 const selection={model:'gpt-5-mini',reasoningEffort:'low'},request={kind:'chat',input:'Bounded supplied evidence.',instructions:'Neutral Chat grounding instructions.',personaId:'socratic',personaVersion:2,personaExpression:'immersive'};
 for(const persona of aiPersonas)for(const personaExpression of personaExpressions){
  const policy=generationPolicy(request,{personaId:persona.id,personaExpression,standard:selection,title:selection,enrichment:selection});
  assert.equal(policy.persona.id,persona.id);assert.equal(policy.persona.expression,personaExpression);assert.equal(policy.prompt().input,request.input);assert.ok(policy.prompt().instructions.startsWith(request.instructions));assert.ok(policy.prompt().instructions.includes('AI PERSONA: '+persona.name));assert.deepEqual(policy.selection,selection);assert.equal(policy.admission.activeSlot,'exclusive');assert.equal(policy.stream,false);
 }
 const fakeSecret={value:null,read(){return this.value;},write(value){this.value=structuredClone(value);},remove(){this.value=null;}};
 let payload;
 const ai=new Intelligence(fakeSecret,async(_url,options)=>{payload=JSON.parse(options.body);return completedResponse(JSON.stringify({claims:[{text:'The source records a position.',attribution:'supported',citationIds:['E1']}]}));});
 ai.save({apiKey:'sk-synthetic-persona-chat-test-never-real'});ai.savePreferences({...selection,personaId:'editor',personaExpression:'subtle'});
 await ai.generate(request);assert.ok(payload.instructions.startsWith(request.instructions));assert.match(payload.instructions,/AI PERSONA: The Editor/);assert.match(payload.instructions,/EXPRESSION: subtle/);assert.doesNotMatch(payload.instructions,/Socratic|EXPRESSION: immersive/);assert.deepEqual(payload.tools,[]);assert.equal(payload.store,false);
});

test('Chat and Persona comparison previews share foreground admission rather than independent queues',async()=>{
 const {Intelligence,GenerationAdmissionError}=await import('../src/server/modules/intelligence.ts');
 const {completedResponse}=await import('./helpers/providers.ts');
 const fakeSecret={value:null,read(){return this.value;},write(value){this.value=structuredClone(value);},remove(){this.value=null;}};
 let release,calls=0;const ai=new Intelligence(fakeSecret,async()=>{calls++;return new Promise(resolve=>release=()=>resolve(completedResponse('Synthetic output')));});ai.save({apiKey:'sk-synthetic-shared-admission-never-real'});
 const preview={kind:'personaPreview',input:'Synthetic user-authored comparison.',personaId:'socratic',personaExpression:'expressive',modelSettings:{model:'gpt-5-mini',reasoningEffort:'low'},signal:new AbortController().signal},chat={kind:'chat',input:'Bounded evidence.',instructions:'Neutral Chat instructions.',signal:new AbortController().signal};
 const activePreview=ai.generate(preview);await assert.rejects(()=>ai.generate(chat),GenerationAdmissionError);assert.equal(calls,1);release();await activePreview;
 const activeChat=ai.generate(chat);await assert.rejects(()=>ai.generate(preview),GenerationAdmissionError);assert.equal(calls,2);release();await activeChat;
});

test('HTTP streams a checked claim while generation is still pending, then commits the final answer',async t=>{
 let finish,ready;const started=new Promise(resolve=>ready=resolve);
 const f=await httpFixture(t,async request=>{
  const claim={text:'The selected source records grace.',attribution:'supported',citationIds:['E1']},output=JSON.stringify({claims:[claim]});
  request.onDelta(output.slice(0,-2));ready();await new Promise(resolve=>finish=resolve);request.onDelta(']}');return output;
 });
 const response=await f.request('messages','POST',{question:'grace',scope:{kind:'source',id:f.primary.id},requestId:randomUUID()});
 await started;const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
 try {
  while(!text.includes('"type":"claim"')){const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value,{stream:true});}
  assert.match(text,/"type":"thread"/);assert.match(text,/"type":"evidence"/);assert.doesNotMatch(text,/"type":"answer"/);
  assert.equal(f.store.get("SELECT count(*) n FROM chat_messages WHERE json_extract(payload,'$.role')='assistant'").n,0);
  finish();for(;;){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});}
  assert.match(text,/"type":"answer"/);assert.equal(f.store.get("SELECT count(*) n FROM chat_messages WHERE json_extract(payload,'$.role')='assistant'").n,1);
 }finally{finish?.();reader.releaseLock();}
});

test('Chat requests provider streaming and receives text before the final provider envelope',async()=>{
 const {Intelligence}=await import('../src/server/modules/intelligence.ts');
 const secret={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 let stream,payload;const encoder=new TextEncoder(),deltas=[];
 const ai=new Intelligence(secret,async(_url,options)=>{payload=JSON.parse(options.body);return new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'Content-Type':'text/event-stream'}});});
 ai.save({apiKey:'sk-synthetic-chat-test-never-a-real-key'});
 const text=JSON.stringify({claims:[{text:'A bounded claim.',attribution:'unestablished',citationIds:[]}]});
 const pending=ai.generate({kind:'chat',input:'Synthetic evidence',instructions:'Neutral Chat',onDelta:delta=>deltas.push(delta)});
 const event=value=>stream.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));
 event({type:'response.output_text.delta',delta:text,item_id:'message-1',output_index:0,content_index:0});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(payload.stream,true);assert.equal(deltas.join(''),text);
 event({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}});stream.close();
 assert.equal(await pending,text);
});


test('folder context reaches the provider as a closed registry and moved evidence cannot produce a completed answer',async()=>{
 const f=chatCorpus();let chat,calls=0;
 try {
  f.store.run("INSERT INTO folders(id,vault_id,name) VALUES('selected','default','Selected')");
  f.store.run("INSERT INTO folders(id,vault_id,name) VALUES('outside','default','Outside')");
  f.store.run("INSERT INTO item_locations(vault_id,kind,item_id,folder_id) VALUES('default','page',?,'selected')",f.myNote.id);
  const ai={selection:()=>({model:'test-model',reasoningEffort:'none'}),async generate(request){
   calls++;const input=JSON.parse(request.input);
   assert.deepEqual(input.scope,{kind:'folder',id:'selected'});assert.ok(input.evidence.length>0);
   assert.ok(input.evidence.every(item=>item.objectId===f.myNote.id));
   assert.doesNotMatch(request.input,/VAULT_SECRET_93|ceremonial|cooperating with human freedom/);
   f.store.run("UPDATE item_locations SET folder_id='outside' WHERE vault_id='default' AND kind='page' AND item_id=?",f.myNote.id);
   return JSON.stringify({claims:[{text:'This answer used material that left the selected folder.',attribution:'supported',citationIds:[input.evidence[0].id]}]});
  }};
  chat=new Chat(f.store,ai,f.retrieval,f.vaults);
  await assert.rejects(chat.submit('default',{question:'What does Aquinas say about grace?',scope:{kind:'folder',id:'selected'},mentions:[{id:f.aquinas.id,name:'Aquinas'}],requestId:randomUUID()}),e=>e.status===409&&/evidence changed/.test(e.message));
  assert.equal(calls,1);
  const failed=chat.storage.get('default',chat.storage.list('default')[0].id);assert.equal(failed.messages.at(-1).status,'failed');
  assert.doesNotMatch(JSON.stringify(failed),/This answer used material/);
  const empty=await chat.submit('default',{question:'Augustine grace',scope:{kind:'folder',id:'selected'},requestId:randomUUID(),temporary:true});
  assert.equal(calls,1,'The now-empty folder cannot trigger a vault-wide provider request');assert.deepEqual(empty.message.evidence,[]);assert.match(empty.message.text,/could not establish/i);
 }finally{chat?.close();f.close();}
});


test('a completed folder request cannot replay material that moved outside its context',async()=>{
 const f=chatCorpus();let chat,calls=0;
 try {
  f.store.run("INSERT INTO folders(id,vault_id,name) VALUES('selected','default','Selected')");
  f.store.run("INSERT INTO folders(id,vault_id,name) VALUES('outside','default','Outside')");
  f.store.run("INSERT INTO item_locations(vault_id,kind,item_id,folder_id) VALUES('default','page',?,'selected')",f.myNote.id);
  const ai={selection:()=>({model:'test-model',reasoningEffort:'none'}),async generate(request){calls++;const input=JSON.parse(request.input);return JSON.stringify({claims:[{text:'The selected note records a position on grace.',attribution:'supported',citationIds:[input.evidence[0].id]}]});}};
  chat=new Chat(f.store,ai,f.retrieval,f.vaults);
  const body={question:'grace',scope:{kind:'folder',id:'selected'},requestId:randomUUID()},first=await chat.submit('default',body);
  assert.equal(calls,1);assert.ok(first.message.evidence.length>0);
  f.store.run("UPDATE item_locations SET folder_id='outside' WHERE vault_id='default' AND kind='page' AND item_id=?",f.myNote.id);
  await assert.rejects(chat.submit('default',body),e=>e.status===409&&/Saved evidence changed/.test(e.message));assert.equal(calls,1);
  const history=chat.storage.get('default',first.threadId);assert.equal(history.messages.at(-1).evidence[0].status,'current','Historical stored evidence is not rewritten');
 }finally{chat?.close();f.close();}
});
