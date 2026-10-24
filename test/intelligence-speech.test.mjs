import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {speechCacheKey} from '../src/server/modules/speech-cache.ts';
import {speechModel,speechModelFor,speechVoicesFor,defaultSpeechVoiceFor,isSpeechVoice} from '../src/shared/intelligence.ts';
import {speechEndpoint as openaiSpeechEndpoint} from '../src/server/modules/realtime-speech.ts';
import {mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Intelligence,intelligencePreferencesFor,speechEndpoint} from '../src/server/modules/intelligence.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {createApp} from '../src/server/http.ts';
const key='sk-test-speech-private-key-never-disclose';
class Secrets {value=null;read(){return this.value;}write(value){this.value=value;}remove(){this.value=null;}}
const pcm=Buffer.from([0,0,128,127,0,128]);
const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
const complete=async()=>Buffer.from(wav);
const fails=(work,status)=>assert.rejects(work,error=>error.status===status&&!error.message.includes(key));
function enabled(synthesize=complete,preferences){const ai=new Intelligence(new Secrets(),fetch,Date.now,preferences,synthesize);ai.savePreferences({...ai.selection(),ttsEnabled:true});return ai;}

test('local speech is opt-in, validates before synthesis, and persists supported voices',async()=>{
  let saved,calls=0;
  const preferenceStore={read:()=>saved,write:value=>{saved=structuredClone(value);}};
  const ai=new Intelligence(new Secrets(),fetch,Date.now,preferenceStore,async()=>{calls++;return complete();});
  assert.equal(ai.status().ttsEnabled,false);assert.equal(ai.status().ttsVoice,'puck');
  await fails(()=>ai.speech('Hello'),409);
  ai.savePreferences({...ai.selection(),ttsEnabled:true});
  for(const input of ['', '  ',null,{},'a'.repeat(4097)])await fails(()=>ai.speech(input),400);
  assert.equal(calls,0);
  for(const value of [null,'true',1])assert.throws(()=>ai.savePreferences({...ai.selection(),ttsEnabled:value}),error=>error.status===400);
  const beforeInvalid=structuredClone(saved);
  for(const ttsVoice of ['marin','cedar','nova','unknown','Puck','',null,1,{}])assert.throws(()=>ai.savePreferences({...ai.selection(),ttsVoice}),error=>error.status===400);
  assert.deepEqual(saved,beforeInvalid);
  for(const voice of ['puck','echo','lewis','daniel']) {
    ai.savePreferences({...ai.selection(),ttsVoice:voice});assert.equal(ai.speechVoiceSelection(),voice);
    assert.equal(new Intelligence(new Secrets(),fetch,Date.now,preferenceStore).status().ttsVoice,voice);
  }
  ai.savePreferences({...ai.selection(),manualRequestsPerMinute:1});
  assert.equal(new Intelligence(new Secrets(),fetch,Date.now,preferenceStore).status().ttsEnabled,true);
  await ai.speech('Hello');await ai.speech('No API key or manual quota needed');assert.equal(calls,2);assert.equal(ai.status().configured,false);
  saved.ttsVoice='marin';assert.equal(new Intelligence(new Secrets(),fetch,Date.now,preferenceStore).speechVoiceSelection(),'puck');
});

test('local speech receives trimmed prose, cancellation signal, and selected voice',async()=>{
  let request;
  const ai=enabled(async(text,signal,voice)=>{request={text,signal,voice};return complete();});
  ai.savePreferences({...ai.selection(),ttsVoice:'lewis'});
  assert.deepEqual(await ai.speech(' Hello '),wav);
  assert.equal(request.text,'Hello');assert.equal(request.voice,'lewis');assert.ok(request.signal instanceof AbortSignal);
  await fails(()=>enabled(async()=>{throw new Error(key);}).speech('Hello'),502);
});

test('local speech cancels on disable, voice change, and disconnect',async()=>{
  for(const action of ['disable','disconnect','voice']) {
    let signal;
    const ai=enabled(async(_text,requestSignal)=>{signal=requestSignal;return new Promise((_resolve,reject)=>requestSignal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));});
    const controller=new AbortController(),pending=ai.speech('Hello',controller.signal);
    await fails(()=>ai.speech('Concurrent'),429);
    if(action==='disable')ai.savePreferences({...ai.selection(),ttsEnabled:false});
    if(action==='disconnect')controller.abort();
    if(action==='voice')ai.savePreferences({...ai.selection(),ttsVoice:'daniel'});
    assert.equal(signal.aborted,true);await fails(()=>pending,409);
  }
});

test('API key replacement and removal do not cancel local speech',async()=>{
  for(const action of ['replace','remove']) {
    let signal,finish;
    const ai=enabled(async(_text,requestSignal)=>{signal=requestSignal;return new Promise(resolve=>{finish=resolve;});});
    ai.save({apiKey:key});const pending=ai.speech('Hello');
    if(action==='replace')ai.save({apiKey:key+'-replacement'});else ai.remove();
    assert.equal(signal.aborted,false);finish(wav);assert.deepEqual(await pending,wav);
  }
});

test('local model status requires the Noema client and download rejects cross-origin requests',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-model-')),db=openDatabase(path.join(dir,'test.sqlite'));
  const server=createApp(new Store(db),path.resolve('dist/client'),enabled());server.listen(0,'127.0.0.1');await once(server,'listening');
  const route='http://127.0.0.1:'+server.address().port+'/api/intelligence/speech/model';
  try {
    assert.equal((await fetch(route)).status,403);
    assert.equal((await fetch(route,{headers:{'X-Noema-Request':'1',Origin:'https://evil.example'}})).status,403);
    const response=await fetch(route,{headers:{'X-Noema-Request':'1'}});assert.equal(response.status,200);
    const status=await response.json();assert.equal(status.model,speechModel);assert.equal(typeof status.ready,'boolean');assert.ok(Array.isArray(status.missingFiles));assert.ok(status.missingFiles.every(file=>typeof file==='string'));assert.equal(typeof status.downloadCommand,'string');assert.ok(status.downloadCommand.length>0);
    for(const headers of [{},{'X-Noema-Request':'1','Content-Type':'text/plain'},{'X-Noema-Request':'1','Content-Type':'application/json',Origin:'https://evil.example'}]) {
      assert.equal((await fetch(route,{method:'POST',headers,body:'{}'})).status,403);
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('speech route protects private audio with CSRF, vault locks and no-store headers',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-')),db=openDatabase(path.join(dir,'test.sqlite'));
  let calls=0,providerFailure=false;const ai=enabled(async()=>{calls++;if(providerFailure)throw new Error(key);return complete();},intelligencePreferencesFor(new Store(db)));
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const call=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    for(const headers of [{'X-Noema-Request':''},{Origin:'https://evil.example'},{'Content-Type':'text/plain'}])assert.equal((await call('intelligence/speech',{text:'Private'},headers)).status,403);
    assert.equal(calls,0);
    const activity=new AIActivityLog(new Store(db));activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});activity.savePricing({version:'test',currency:'USD',models:{[speechModel]:{inputPerMillion:1,outputPerMillion:2}}});
    const source=await (await call('pages',{title:'Speech source'})).json();
    let response=await call('intelligence/speech',{text:'Private',pageId:source.id});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()).subarray(44),pcm);
    let item=activity.list(null).items.find(item=>item.action==='text_to_speech');assert.equal(item.status,'completed');assert.equal(item.model,speechModel);assert.equal(item.httpStatus,200);assert.equal(item.promptBytes,7);assert.equal(item.inputTokens,null);assert.equal(item.outputTokens,null);assert.equal(item.estimatedCost,null);assert.ok(item.durationMs>=0);assert.equal(item.vaultId,'default');assert.equal(item.objectId,source.id);assert.equal(item.objectTitle,'Speech source');
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


test('local speech and its cache work without credentials or manual quota and respect vault scope',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-hit-')),db=openDatabase(path.join(dir,'test.sqlite'));let calls=0;
 const ai=enabled(async()=>{calls++;return complete();},intelligencePreferencesFor(new Store(db)));ai.savePreferences({...ai.selection(),ttsEnabled:true,manualRequestsPerMinute:1});
 const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try {
  let response=await call('intelligence/speech',{text:'Reusable'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');const original=Buffer.from(await response.arrayBuffer());
  const count=()=>new Store(db).get("SELECT COUNT(*) AS n FROM ai_activity WHERE action='text_to_speech'").n;
  assert.equal(count(),1);ai.remove();
  response=await call('intelligence/speech',{text:'Reusable'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.match(response.headers.get('content-disposition'),/noema-speech-[a-f0-9]{12}\.wav/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(calls,1);assert.equal(count(),1);
  response=await call('intelligence/speech',{text:'Changed'});assert.equal(response.status,200);assert.equal(calls,2);
  ai.savePreferences({...ai.selection(),ttsEnabled:false});assert.equal((await call('intelligence/speech',{text:'Reusable'})).status,409);
  ai.savePreferences({...ai.selection(),ttsEnabled:true});const other=await (await call('vaults',{name:'Other'})).json();assert.equal((await call('intelligence/speech',{text:'Reusable'},{'X-Vault-Id':other.id})).status,200);assert.equal(calls,3);
  await call('vaults/default/lock',{passphrase:'test-lock'});assert.equal((await call('intelligence/speech',{text:'Reusable'})).status,423);assert.equal(calls,3);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('speech sends only clean selected prose and reuses audio when citation metadata changes',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-prose-')),db=openDatabase(path.join(dir,'test.sqlite'));let calls=0,sent=[];
 const ai=enabled(async(text,_signal,voice)=>{calls++;sent.push({text,voice});return complete();},intelligencePreferencesFor(new Store(db)));
 const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body)=>fetch(base+'/api/'+route,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  const page=await (await call('pages',{title:'Private page metadata'})).json();
  const metadata={pageId:page.id,blockId:'private-block',vaultId:'private-vault',semanticMetadata:{type:'lemma'},group:{id:'private-group'},sourceReference:{entityId:'private-source'},citations:[{id:'private-citation',sourceId:'private-source'}]};
  let response=await call('intelligence/speech',{text:'Selected prose.[ref][??][L: 1–2]',...metadata});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');
  assert.deepEqual(sent,[{text:'Selected prose.',voice:'puck'}]);
  const serialized=JSON.stringify(sent);for(const forbidden of [page.id,'private-block','private-vault','private-group','private-source','private-citation','sourceReference','semanticMetadata','citations','[ref]','[??]','[L:'])assert.ok(!serialized.includes(forbidden),forbidden);
  response=await call('intelligence/speech',{text:'Selected prose.[L: 99–100][ref]',...metadata,blockId:'changed-block',citations:[{id:'changed-citation'}]});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(calls,1);
  response=await call('intelligence/speech',{text:'[ref][??][L: 1–2]',...metadata});assert.equal(response.status,400);assert.equal(calls,1);
  const direct=enabled(async(text)=>{sent=[text];return complete();});await direct.speech('Direct prose.[ref][??][L: 1–2]');assert.equal(sent[0],'Direct prose.');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});


test('saved speech voice controls local output and isolates cached audio per voice',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-voice-')),db=openDatabase(path.join(dir,'test.sqlite'));const voices=[];
 const ai=enabled(async(_text,_signal,voice)=>{voices.push(voice);return complete();},intelligencePreferencesFor(new Store(db)));
 const activity=new AIActivityLog(new Store(db));activity.saveDebugSettings({enabled:true});
 const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,method='POST')=>fetch(base+'/api/'+route,{method,headers:{'X-Noema-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
 const speak=voice=>call('intelligence/speech',{text:'Same selection.',voice});
 try {
  let response=await speak('puck');assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');const puckFilename=response.headers.get('content-disposition');
  response=await speak('puck');assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.deepEqual(voices,['puck']);
  response=await call('intelligence/preferences',{...ai.selection(),ttsVoice:'daniel'},'PUT');assert.equal(response.status,200);assert.equal((await response.json()).ttsVoice,'daniel');
  response=await speak('puck');assert.equal(response.status,409);assert.deepEqual(voices,['puck']);
  response=await speak('nova');assert.equal(response.status,400);assert.deepEqual(voices,['puck']);
  response=await speak('daniel');assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');assert.notEqual(response.headers.get('content-disposition'),puckFilename);assert.deepEqual(voices,['puck','daniel']);
  const latest=activity.list(null).items.find(item=>item.action==='text_to_speech');assert.equal(JSON.parse(activity.debug(latest.id).request).voice,'daniel');
  response=await speak('daniel');assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.deepEqual(voices,['puck','daniel']);
  response=await call('intelligence/preferences',{...ai.selection(),ttsVoice:'puck'},'PUT');assert.equal(response.status,200);
  response=await speak('puck');assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(response.headers.get('content-disposition'),puckFilename);assert.deepEqual(voices,['puck','daniel']);
  response=await call('intelligence/preferences',{...ai.selection(),ttsVoice:'invalid'},'PUT');assert.equal(response.status,400);assert.equal(ai.speechVoiceSelection(),'puck');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

// Exercise the restored OpenAI transport without network access or real credentials.
function speechSocketFactory({hold=false,error}={}) {
  const requests=[],sockets=[];
  const factory=(url,options)=>{
    const socket=new EventEmitter();socket.terminated=false;
    socket.terminate=()=>{socket.terminated=true;};
    socket.send=value=>{
      const event=JSON.parse(value);requests.push({url,options,event});
      if(event.type==='session.update')queueMicrotask(()=>socket.emit('message',Buffer.from(JSON.stringify({type:'session.updated'}))));
      if(event.type==='response.create'&&!hold)queueMicrotask(()=>{
        if(error){socket.emit('message',Buffer.from(JSON.stringify({type:'error',error:{code:error}})));return;}
        socket.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.delta',delta:pcm.toString('base64')})));
        socket.emit('message',Buffer.from(JSON.stringify({type:'response.done',response:{status:'completed',usage:{input_tokens:12,output_tokens:5}}})));
      });
    };
    sockets.push(socket);queueMicrotask(()=>socket.emit('open'));return socket;
  };
  return {factory,requests,sockets};
}

test('speech provider defaults and saved configurations migrate to Kokoro while OpenAI is explicit',()=>{
  let saved={model:'gpt-5-mini',reasoningEffort:'low',ttsEnabled:true,ttsVoice:'marin'};
  const preferences={read:()=>saved,write:value=>{saved=structuredClone(value);}};
  const ai=new Intelligence(new Secrets(),fetch,Date.now,preferences);
  assert.equal(ai.status().ttsProvider,'kokoro');assert.equal(ai.speechVoiceSelection(),'puck');
  assert.deepEqual(speechVoicesFor('kokoro'),['puck','echo','lewis','daniel']);
  assert.equal(defaultSpeechVoiceFor('openai'),'marin');assert.equal(isSpeechVoice('puck','openai'),false);assert.equal(isSpeechVoice('marin','kokoro'),false);
  for(const ttsProvider of ['invalid','OpenAI','',null,1])assert.throws(()=>ai.savePreferences({...ai.selection(),ttsProvider}),error=>error.status===400);
  ai.savePreferences({...ai.selection(),ttsProvider:'openai'});
  assert.equal(ai.status().ttsProvider,'openai');assert.equal(ai.speechVoiceSelection(),'marin');
  for(const ttsVoice of ['puck','lewis','daniel'])assert.throws(()=>ai.savePreferences({...ai.selection(),ttsVoice}),error=>error.status===400);
  for(const ttsVoice of speechVoicesFor('openai')) {
    ai.savePreferences({...ai.selection(),ttsVoice});
    const restored=new Intelligence(new Secrets(),fetch,Date.now,preferences);
    assert.equal(restored.status().ttsProvider,'openai');assert.equal(restored.speechVoiceSelection(),ttsVoice);
  }
  ai.savePreferences({...ai.selection(),ttsProvider:'kokoro'});assert.equal(ai.speechVoiceSelection(),'puck');
  assert.equal(new Intelligence(new Secrets(),fetch,Date.now,preferences).status().ttsProvider,'kokoro');
});

test('OpenAI speech requires credentials, sends the selected voice, reports usage and obeys quota and expiry',async()=>{
  let time=Date.now(),localCalls=0,usage;
  const socket=speechSocketFactory();
  const ai=new Intelligence(new Secrets(),fetch,()=>time,undefined,async()=>{localCalls++;return complete();},socket.factory);
  ai.savePreferences({...ai.selection(),ttsEnabled:true,ttsProvider:'openai',ttsVoice:'cedar',manualRequestsPerMinute:1});
  await fails(()=>ai.speech('Hello'),409);assert.equal(socket.requests.length,0);assert.equal(localCalls,0);
  ai.save({apiKey:key,days:1});
  assert.deepEqual(await ai.speech(' Hello ',undefined,()=>({usage:value=>{usage=value;}})),wav);
  assert.equal(socket.requests[0].url,openaiSpeechEndpoint);assert.equal(socket.requests[0].options.headers.Authorization,'Bearer '+key);
  assert.equal(socket.requests[0].event.session.audio.output.voice,'cedar');assert.equal(usage.input_tokens,12);assert.equal(usage.output_tokens,5);
  await fails(()=>ai.speech('Rate limited'),429);assert.equal(socket.sockets.length,1);
  time+=86400000;await fails(()=>ai.speech('Expired'),409);assert.equal(socket.sockets.length,1);assert.equal(localCalls,0);
});

test('OpenAI failures do not fall back to local speech',async()=>{
  let localCalls=0;
  const socket=speechSocketFactory({error:'insufficient_quota'});
  const ai=new Intelligence(new Secrets(),fetch,Date.now,undefined,async()=>{localCalls++;return complete();},socket.factory);
  ai.savePreferences({...ai.selection(),ttsEnabled:true,ttsProvider:'openai'});ai.save({apiKey:key});
  await fails(()=>ai.speech('Hello'),429);assert.equal(localCalls,0);
});

test('speech provider changes cancel local synthesis and OpenAI key changes cancel remote synthesis',async()=>{
  let signal;
  const local=enabled(async(_text,requestSignal)=>{signal=requestSignal;return new Promise((_resolve,reject)=>requestSignal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));});
  const localPending=local.speech('Hello');local.savePreferences({...local.selection(),ttsProvider:'openai'});
  assert.equal(signal.aborted,true);await fails(()=>localPending,409);
  for(const action of ['replace','remove','provider','voice','disable','disconnect']) {
    const socket=speechSocketFactory({hold:true}),ai=new Intelligence(new Secrets(),fetch,Date.now,undefined,complete,socket.factory);
    ai.savePreferences({...ai.selection(),ttsEnabled:true,ttsProvider:'openai'});ai.save({apiKey:key});
    const controller=new AbortController(),pending=ai.speech('Hello',controller.signal);
    await new Promise(resolve=>setImmediate(resolve));
    if(action==='replace')ai.save({apiKey:key+'-replacement'});
    if(action==='remove')ai.remove();
    if(action==='provider')ai.savePreferences({...ai.selection(),ttsProvider:'kokoro'});
    if(action==='voice')ai.savePreferences({...ai.selection(),ttsVoice:'cedar'});
    if(action==='disable')ai.savePreferences({...ai.selection(),ttsEnabled:false});
    if(action==='disconnect')controller.abort();
    await fails(()=>pending,409);assert.equal(socket.sockets[0].terminated,true,action);
  }
});

test('speech route pins the selected provider and isolates echo audio and activity by provider and model',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-provider-')),db=openDatabase(path.join(dir,'test.sqlite'));let localCalls=0;
  const socket=speechSocketFactory(),ai=new Intelligence(new Secrets(),fetch,Date.now,intelligencePreferencesFor(new Store(db)),async()=>{localCalls++;return complete();},socket.factory);
  ai.savePreferences({...ai.selection(),ttsEnabled:true,ttsVoice:'echo'});ai.save({apiKey:key});
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const call=body=>fetch('http://127.0.0.1:'+server.address().port+'/api/intelligence/speech',{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json'},body:JSON.stringify({text:'Shared prose',voice:'echo',...body})});
  try {
    assert.equal((await call({provider:'openai'})).status,409);assert.equal((await call({provider:'invalid'})).status,400);assert.equal(localCalls,0);
    let response=await call({provider:'kokoro'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');const localFilename=response.headers.get('content-disposition');await response.arrayBuffer();
    ai.savePreferences({...ai.selection(),ttsProvider:'openai',ttsVoice:'echo'});
    assert.equal((await call({provider:'kokoro'})).status,409);
    response=await call({provider:'openai'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');assert.notEqual(response.headers.get('content-disposition'),localFilename);await response.arrayBuffer();
    response=await call({provider:'openai'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');await response.arrayBuffer();
    assert.equal(socket.sockets.length,1);assert.equal(localCalls,1);
    const activity=new AIActivityLog(new Store(db)),items=activity.list(null).items.filter(item=>item.action==='text_to_speech'&&item.status==='completed');
    assert.deepEqual(new Set(items.map(item=>item.model)),new Set([speechModelFor('kokoro'),speechModelFor('openai')]));
    const remote=items.find(item=>item.model===speechModelFor('openai'));assert.equal(remote.inputTokens,12);assert.equal(remote.outputTokens,5);
    ai.savePreferences({...ai.selection(),ttsProvider:'kokoro',ttsVoice:'echo'});
    response=await call({provider:'kokoro'});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(response.headers.get('content-disposition'),localFilename);assert.equal(localCalls,1);await response.arrayBuffer();
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('category saves preserve interleaved AI and Voice updates in unified storage',()=>{
  let saved;const store={read:()=>saved,write:value=>{saved=structuredClone(value);}};
  const ai=new Intelligence(new Secrets(),fetch,Date.now,store);
  const aiDraft={model:'gpt-6-luna',reasoningEffort:'none',manualRequestsPerMinute:12};
  const voiceDraft={ttsEnabled:true,ttsProvider:'kokoro',ttsVoice:'daniel'};
  ai.saveCategoryPreferences('voice',voiceDraft);ai.saveCategoryPreferences('ai',aiDraft);
  assert.equal(saved.ttsVoice,'daniel');assert.equal(saved.model,'gpt-6-luna');
  ai.saveCategoryPreferences('voice',{...voiceDraft,ttsVoice:'echo'});
  assert.equal(saved.model,'gpt-6-luna');assert.equal(saved.manualRequestsPerMinute,12);
  const restored=new Intelligence(new Secrets(),fetch,Date.now,store).status();
  assert.equal(restored.ttsVoice,'echo');assert.equal(restored.model,'gpt-6-luna');
  for(const [category,body] of [['ai',{...aiDraft,ttsVoice:'puck'}],['voice',{...voiceDraft,model:'gpt-5-mini'}]])assert.throws(()=>ai.saveCategoryPreferences(category,body),error=>error.status===400);
  assert.equal(ai.status().ttsVoice,'echo');assert.equal(ai.status().model,'gpt-6-luna');
});

test('draft speech previews stay isolated from disabled saved defaults and enforce limits',async()=>{
  const calls=[];let writes=0;
  const ai=new Intelligence(new Secrets(),fetch,()=>1000,{read:()=>null,write:()=>{writes++;}},async(text,signal,voice,pace)=>{calls.push({text,voice,pace});return wav;});
  const before=ai.status();
  const draft={text:'An audition.',provider:'kokoro',voice:'daniel',narration:{...ai.narrationSelection(),pace:1.25}};
  assert.deepEqual(await ai.previewSpeech(draft),wav);
  assert.deepEqual(calls,[{text:'An audition.',voice:'daniel',pace:1.25}]);assert.deepEqual(ai.status(),before);assert.equal(writes,0);
  for(const bad of [{...draft,voice:'Puck'},{...draft,provider:'unknown'},{...draft,text:'a'.repeat(501)},{...draft,narration:{pace:99}},{...draft,pageId:'private-page'}])await fails(()=>ai.previewSpeech(bad),400);
  await fails(()=>ai.previewSpeech({...draft,provider:'openai',voice:'marin'}),409);
  for(let i=0;i<3;i++)await ai.previewSpeech(draft);
  await fails(()=>ai.previewSpeech(draft),429);
  assert.deepEqual(ai.status(),before);assert.equal(writes,0);
});

test('preview cancellation rejects stale audio while unrelated preference saves leave drafts isolated',async()=>{
  let signal,finish;
  const ai=new Intelligence(new Secrets(),fetch,Date.now,undefined,async(_text,current)=>{signal=current;return new Promise(resolve=>{finish=resolve;});});
  const draft={text:'Preview',provider:'kokoro',voice:'daniel',narration:ai.narrationSelection()};
  const controller=new AbortController(),pending=ai.previewSpeech(draft,controller.signal);
  ai.saveCategoryPreferences('ai',{model:'gpt-6-luna',reasoningEffort:'none'});
  ai.saveCategoryPreferences('voice',{ttsEnabled:true,ttsProvider:'kokoro',ttsVoice:'echo'});
  assert.equal(signal.aborted,false);controller.abort();assert.equal(signal.aborted,true);finish(wav);await fails(()=>pending,409);
  assert.equal(ai.speechVoiceSelection(),'echo');
  const repeated=ai.previewSpeech({...draft,text:'Repeat'});finish(wav);assert.deepEqual(await repeated,wav);
});

test('preview transport uses explicit drafts, no cache, and vault and CSRF boundaries',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-draft-preview-')),db=openDatabase(path.join(dir,'test.sqlite'));
  let calls=0,providerFailure=false;const sockets=speechSocketFactory(),ai=new Intelligence(new Secrets(),fetch,Date.now,intelligencePreferencesFor(new Store(db)),async()=>{calls++;if(providerFailure)throw new Error(key);return wav;},sockets.factory);
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const draft={text:'Synthetic audition',provider:'kokoro',voice:'daniel',narration:ai.narrationSelection()};
  const call=(route,body,method='POST',headers={})=>fetch(base+'/api/'+route,{method,headers:{'X-Noema-Request':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    for(const headers of [{'X-Noema-Request':''},{Origin:'https://evil.example'},{'Content-Type':'text/plain'}])assert.equal((await call('intelligence/speech/preview',draft,'POST',headers)).status,403);
    const original=ai.status(),activity=new AIActivityLog(new Store(db));activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});
    for(let i=0;i<2;i++){const response=await call('intelligence/speech/preview',draft);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('x-noema-speech-cache'),null);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav);}
    assert.equal(calls,2);assert.deepEqual(ai.status(),original);
    assert.equal(new Store(db).get("SELECT COUNT(*) AS n FROM ai_activity WHERE action='text_to_speech'").n,2);
    ai.save({apiKey:key});
    const cloudResponse=await call('intelligence/speech/preview',{...draft,provider:'openai',voice:'cedar'});assert.equal(cloudResponse.status,200);await cloudResponse.arrayBuffer();
    const cloud=activity.list(null).items.find(item=>item.model===speechModelFor('openai'));
    assert.equal(cloud.status,'completed');assert.equal(cloud.vaultId,'default');assert.equal(cloud.objectId,null);assert.equal(cloud.inputTokens,12);assert.equal(cloud.outputTokens,5);assert.equal(cloud.promptBytes,Buffer.byteLength(draft.text));
    const trace=JSON.stringify(activity.debug(cloud.id));assert.ok(!trace.includes(draft.text));assert.ok(!trace.includes(key));assert.ok(trace.includes('cedar'));assert.equal(ai.speechProviderSelection(),'kokoro');assert.equal(ai.speechEnabled(),false);
    providerFailure=true;const failure=await call('intelligence/speech/preview',draft);assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes(key));providerFailure=false;
    const failed=activity.list(null).items.find(item=>item.status==='failed');assert.equal(failed.httpStatus,502);assert.ok(!JSON.stringify(activity.debug(failed.id)).includes(draft.text));assert.ok(!JSON.stringify(activity.debug(failed.id)).includes(key));

    let response=await call('intelligence/preferences/voice',{ttsEnabled:true,ttsProvider:'kokoro',ttsVoice:'echo'},'PUT');assert.equal(response.status,200);
    response=await call('intelligence/preferences/ai',{model:'gpt-6-luna',reasoningEffort:'none'},'PUT');assert.equal(response.status,200);assert.equal((await response.json()).ttsVoice,'echo');
    response=await call('intelligence/preferences/voice',{model:'gpt-5-mini'},'PUT');assert.equal(response.status,400);
    await call('vaults/default/lock',{passphrase:'synthetic-lock'});
    assert.equal((await call('intelligence/speech/preview',draft)).status,423);assert.equal(calls,3);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gemini connection validation checks metadata without speech and redacts transport failures',async()=>{
  const gemini=new Secrets();let request;
  const ai=new Intelligence(new Secrets(),async(url,options)=>{request={url,options};return new Response('{}');},Date.now,undefined,complete,undefined,gemini);
  await fails(()=>ai.validateGemini(),409);
  ai.saveGemini({apiKey:key});const before=ai.status();assert.deepEqual(await ai.validateGemini(),{ok:true});
  assert.equal(request.options.method,'GET');assert.equal(request.options.headers['x-goog-api-key'],key);assert.ok(!request.url.includes(key));assert.match(request.url,/\/models\//);assert.deepEqual(ai.status(),before);
  const bad=new Intelligence(new Secrets(),async()=>{throw new Error(key);},Date.now,undefined,complete,undefined,gemini);
  await fails(()=>bad.validateGemini(),502);
});

test('cloud draft auditions use selected voices and stop when their credential changes while saved provider stays local',async()=>{
  const completed=speechSocketFactory(),ai=new Intelligence(new Secrets(),fetch,Date.now,undefined,complete,completed.factory);
  ai.save({apiKey:key});const before=ai.status();
  const draft={text:'Cloud draft',provider:'openai',voice:'cedar',narration:ai.narrationSelection()};
  assert.deepEqual(await ai.previewSpeech(draft),wav);assert.equal(completed.requests[0].event.session.audio.output.voice,'cedar');assert.deepEqual(ai.status(),before);
  for(const action of ['replace','remove']){
    const held=speechSocketFactory({hold:true}),current=new Intelligence(new Secrets(),fetch,Date.now,undefined,complete,held.factory);
    current.save({apiKey:key});const pending=current.previewSpeech({...draft,narration:current.narrationSelection()});
    await new Promise(resolve=>setImmediate(resolve));
    if(action==='replace')current.save({apiKey:key+'-replacement'});else current.remove();
    await fails(()=>pending,409);assert.equal(held.sockets[0].terminated,true);assert.equal(current.speechProviderSelection(),'kokoro');assert.equal(current.speechEnabled(),false);
  }
});
