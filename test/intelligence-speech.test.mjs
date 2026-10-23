import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {speechCacheKey} from '../src/server/modules/speech-cache.ts';
import {speechEndpoint,speechModel,speechMaxAudioBytes} from '../src/server/modules/realtime-speech.ts';
import {mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Intelligence,intelligencePreferencesFor} from '../src/server/modules/intelligence.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {createApp} from '../src/server/http.ts';
const key='sk-test-speech-private-key-never-disclose';
class Secrets {value=null;read(){return this.value;}write(value){this.value=value;}remove(){this.value=null;}}
const pcm=Buffer.from([0,0,128,127,0,128]);
const usage={input_tokens:14,output_tokens:25,input_token_details:{cached_tokens:0}};
class Socket extends EventEmitter {
  sent=[];terminated=false;
  constructor(script){super();this.script=script;queueMicrotask(()=>this.emit('open'));}
  send(value){const event=JSON.parse(value);this.sent.push(event);if(event.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.updated'}))));if(event.type==='response.create')queueMicrotask(()=>this.script(this));}
  event(event){this.emit('message',Buffer.from(JSON.stringify(event)));}
  terminate(){this.terminated=true;}
}
const complete=socket=>{socket.event({type:'response.output_audio.delta',delta:pcm.toString('base64')});socket.event({type:'response.done',response:{status:'completed',usage}});};
const fails=(work,status)=>assert.rejects(work,error=>error.status===status&&!error.message.includes(key));
function enabled(script=complete,preferences,factory){const ai=new Intelligence(new Secrets(),fetch,Date.now,preferences,factory??((_url,_options)=>new Socket(script)));ai.save({apiKey:key});ai.savePreferences({...ai.selection(),ttsEnabled:true});return ai;}

test('speech is opt-in, validates input before spending requests, and keeps settings across restarts',async()=>{
  let saved,calls=0;
  const preferenceStore={read:()=>saved,write:value=>{saved=structuredClone(value);}};
  const ai=new Intelligence(new Secrets(),fetch,Date.now,preferenceStore,()=>{calls++;return new Socket(complete);});
  assert.equal(ai.status().ttsEnabled,false);
  await fails(()=>ai.speech('Hello'),409);
  ai.savePreferences({...ai.selection(),ttsEnabled:true});
  await fails(()=>ai.speech('Hello'),409);
  ai.save({apiKey:key});
  for(const input of ['', '  ',null,{},'a'.repeat(4097)])await fails(()=>ai.speech(input),400);
  assert.equal(calls,0);
  for(const value of [null,'true',1])assert.throws(()=>ai.savePreferences({...ai.selection(),ttsEnabled:value}),error=>error.status===400);
  ai.savePreferences({...ai.selection(),manualRequestsPerMinute:1});
  assert.equal(ai.status().ttsEnabled,true);
  assert.equal(new Intelligence(new Secrets(),fetch,Date.now,preferenceStore).status().ttsEnabled,true);
  await ai.speech('Hello');await fails(()=>ai.speech('Quota'),429);assert.equal(calls,1);
});

test('speech uses the requested Realtime model and returns valid bounded PCM WAV audio',async()=>{
  let request,socket;
  const ai=enabled(complete,undefined,(url,options)=>{request={url,...options};return socket=new Socket(complete);});
  const wav=await ai.speech(' Hello ');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);assert.deepEqual(wav.subarray(44),pcm);
  assert.equal(request.url,speechEndpoint);assert.equal(request.followRedirects,false);assert.equal(request.headers.Authorization,'Bearer '+key);assert.equal(socket.terminated,true);
  const session=socket.sent[0].session;assert.equal(session.type,'realtime');assert.deepEqual(session.output_modalities,['audio']);assert.deepEqual(session.audio.output,{format:{type:'audio/pcm',rate:24000},voice:'marin'});
  const response=socket.sent[1].response;assert.equal(response.conversation,'none');assert.equal(response.input[0].content[0].text,'Hello');assert.match(response.instructions,/verbatim/);assert.match(response.instructions,/untrusted/);
  for(const script of [socket=>socket.emit('error',new Error(key)),socket=>socket.emit('close'),socket=>socket.event({type:'response.done',response:{status:'completed'}}),socket=>socket.event({type:'response.output_audio.delta',delta:'!!bad'}),socket=>{socket.event({type:'response.output_audio.delta',delta:pcm.toString('base64')});socket.event({type:'response.done',response:{status:'incomplete',usage}});}])await fails(()=>enabled(script).speech('Hello'),502);
  for(const code of ['rate_limit_exceeded','invalid_api_key'])await fails(()=>enabled(socket=>socket.event({type:'error',error:{code,message:key}})).speech('Hello'),code==='rate_limit_exceeded'?429:502);
  const chunk=Buffer.alloc(512*1024).toString('base64');await assert.rejects(()=>enabled(socket=>{for(let i=0;i<=speechMaxAudioBytes/(512*1024);i++)socket.event({type:'response.output_audio.delta',delta:chunk});}).speech('Hello'),error=>error.status===502&&/too much speech audio/.test(error.message));
});

test('speech discards in-flight audio on disable, removal, replacement and disconnect',async()=>{
  for(const action of ['disable','remove','replace','disconnect']) {
    let socket;const ai=enabled(()=>{},undefined,()=>socket=new Socket(()=>{}));
    const controller=new AbortController(),pending=ai.speech('Hello',controller.signal);
    await fails(()=>ai.speech('Concurrent'),429);
    if(action==='disable')ai.savePreferences({...ai.selection(),ttsEnabled:false});
    if(action==='remove')ai.remove();
    if(action==='replace')ai.save({apiKey:key+'-replacement'});
    if(action==='disconnect')controller.abort();
    assert.equal(socket.terminated,true);await fails(()=>pending,409);
  }
});

test('speech route protects private audio with CSRF, vault locks and no-store headers',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-')),db=openDatabase(path.join(dir,'test.sqlite'));
  let calls=0,providerFailure=false;const ai=enabled(socket=>{calls++;if(providerFailure)socket.event({type:'error',error:{code:'server_error',message:key}});else complete(socket);},intelligencePreferencesFor(new Store(db)));
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const call=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    for(const headers of [{'X-Noema-Request':''},{Origin:'https://evil.example'},{'Content-Type':'text/plain'}])assert.equal((await call('intelligence/speech',{text:'Private'},headers)).status,403);
    assert.equal(calls,0);
    const activity=new AIActivityLog(new Store(db));activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});activity.savePricing({version:'test',currency:'USD',models:{[speechModel]:{inputPerMillion:1,outputPerMillion:2}}});
    const source=await (await call('pages',{title:'Speech source'})).json();
    let response=await call('intelligence/speech',{text:'Private',pageId:source.id});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()).subarray(44),pcm);
    let item=activity.list(null).items.find(item=>item.action==='text_to_speech');assert.equal(item.status,'completed');assert.equal(item.model,speechModel);assert.equal(item.httpStatus,200);assert.equal(item.promptBytes,7);assert.equal(item.inputTokens,14);assert.equal(item.outputTokens,25);assert.equal(item.estimatedCost,null);assert.ok(item.durationMs>=0);assert.equal(item.vaultId,'default');assert.equal(item.objectId,source.id);assert.equal(item.objectTitle,'Speech source');
    const trace=activity.debug(item.id);assert.equal(trace.endpoint,speechEndpoint);assert.ok(!JSON.stringify(trace).includes('Private'));assert.ok(!JSON.stringify(trace).includes(key));assert.equal(JSON.parse(trace.response).audioBytes,50);
    writeFileSync(path.join(dir,'assets/default/speech',speechCacheKey('Private')+'.wav'),Buffer.from('corrupt'));
    response=await call('intelligence/speech',{text:'Private',pageId:source.id});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');assert.equal(calls,2);
    providerFailure=true;response=await call('intelligence/speech',{text:'Private failure'});assert.equal(response.status,502);
    item=activity.list(null).items.find(item=>item.action==='text_to_speech');assert.equal(item.status,'failed');assert.equal(item.httpStatus,502);assert.equal(item.promptBytes,15);assert.ok(item.durationMs>=0);assert.equal(existsSync(path.join(dir,'assets/default/speech',speechCacheKey('Private failure')+'.wav')),false);providerFailure=false;
    await call('vaults/default/lock',{passphrase:'test-lock'});
    response=await call('intelligence/speech',{text:'Private'});assert.equal(response.status,423);assert.equal(calls,3);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM metadata').all()).includes('Private'));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});


test('cached speech bypasses provider credentials and manual quota but respects toggle and vault scope',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-hit-')),db=openDatabase(path.join(dir,'test.sqlite'));let calls=0;
 const ai=enabled(socket=>{calls++;complete(socket);},intelligencePreferencesFor(new Store(db)));ai.savePreferences({...ai.selection(),ttsEnabled:true,manualRequestsPerMinute:1});
 const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try {
  let response=await call('intelligence/speech',{text:'Reusable'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');const original=Buffer.from(await response.arrayBuffer());
  const count=()=>new Store(db).get("SELECT COUNT(*) AS n FROM ai_activity WHERE action='text_to_speech'").n;
  assert.equal(count(),1);ai.remove();
  response=await call('intelligence/speech',{text:'Reusable'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.match(response.headers.get('content-disposition'),/noema-speech-[a-f0-9]{12}\.wav/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(calls,1);assert.equal(count(),1);
  response=await call('intelligence/speech',{text:'Changed'});assert.equal(response.status,409);assert.equal(calls,1);
  ai.savePreferences({...ai.selection(),ttsEnabled:false});assert.equal((await call('intelligence/speech',{text:'Reusable'})).status,409);
  ai.savePreferences({...ai.selection(),ttsEnabled:true});const other=await (await call('vaults',{name:'Other'})).json();assert.equal((await call('intelligence/speech',{text:'Reusable'},{'X-Vault-Id':other.id})).status,409);
  await call('vaults/default/lock',{passphrase:'test-lock'});assert.equal((await call('intelligence/speech',{text:'Reusable'})).status,423);assert.equal(calls,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});
