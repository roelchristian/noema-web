import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {geminiSpeech,geminiSpeechEndpoint} from '../src/server/modules/gemini-speech.ts';
import {Intelligence,MacKeychain,intelligencePreferencesFor,keychainFor} from '../src/server/modules/intelligence.ts';
import {geminiApiKeyMaxLength,geminiSpeechModel,geminiSpeechStyle,geminiSpeechVoices,defaultIntelligencePreferences,speechModelFor} from '../src/shared/intelligence.ts';
import {speechCacheKey,validSpeechWav} from '../src/server/modules/speech-cache.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {readBackupArchive} from './helpers/backup-archive.mjs';
import {createApp} from '../src/server/http.ts';
import {api} from '../src/client/api.ts';
import {IntelligenceSettings} from '../src/client/settings/IntelligenceSettings.tsx';
import {combineSpeechAudio,speechChunks,useSpeech} from '../src/client/editor/speech.tsx';
import {setupDOM} from './helpers/dom.mjs';
// Synthetic credentials only. All provider traffic is an injected function.
const authKey='AQ.'+'synthetic_auth-key_'.repeat(20);
const key='AIza'+'x'.repeat(35),openaiKey='sk-synthetic-openai-speech-key';
class Secrets {value=null;reads=0;read(){this.reads++;return this.value;}write(value){this.value=structuredClone(value);}remove(){this.value=null;}}
const wav=Buffer.alloc(50);wav.write('RIFF');wav.writeUInt32LE(42,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(6,40);wav.writeInt16LE(1234,44);
const output=(overrides={})=>({status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:wav.toString('base64')}]}],usage:{total_input_tokens:13,total_output_tokens:29,total_cached_tokens:0,total_thought_tokens:0},...overrides});
const success=async()=>Response.json(output());
const reject=(work,status)=>assert.rejects(work,e=>e.status===status&&!e.message.includes(key));
function fixture(transport=success,preferences,clock=Date.now){
 const openai=new Secrets(),gemini=new Secrets();let localCalls=0;
 const ai=new Intelligence(openai,transport,clock,preferences,async()=>{localCalls++;return wav;},undefined,gemini);
 return {ai,openai,gemini,localCalls:()=>localCalls};
}
function enable(ai,more={}){return ai.savePreferences({...ai.selection(),ttsEnabled:true,ttsProvider:'gemini',ttsVoice:'Kore',...more});}

test('Gemini unary REST sends only clean transcript, structured style and an isolated header; returns existing WAV intact',async()=>{
 let usage,calls=0;
 const result=await geminiSpeech(' Selected prose.[ref][L: 1–2]',key,new AbortController().signal,async(url,options)=>{
  calls++;assert.equal(url,geminiSpeechEndpoint);assert.ok(!url.includes(key));assert.equal(options.headers['x-goog-api-key'],key);assert.equal(options.redirect,'error');
  assert.deepEqual(JSON.parse(options.body),{model:geminiSpeechModel,store:false,stream:false,input:[{type:'user_input',content:[{type:'text',text:'Selected prose.',annotations:[{type:'speech_metadata',style:geminiSpeechStyle}]}]}],response_format:{type:'audio',mime_type:'audio/wav',sample_rate:24000},generation_config:{speech_config:[{voice:'Kore'}]}});
  return Response.json(output());
 },'Kore',{usage:value=>{usage=value;}});
 assert.deepEqual(result,wav);assert.equal(result.length,50);assert.equal(validSpeechWav(result),true);assert.equal(calls,1);
 assert.deepEqual(usage,{input_tokens:13,output_tokens:29,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}});
});

test('Gemini rejects incomplete, missing, duplicate, malformed and noncanonical audio and bounds response reads',async()=>{
 const bad=output().steps[0].content[0];
 const samples=[output({status:'in_progress'}),output({status:'failed'}),output({steps:[]}),output({steps:[{type:'model_output',content:[bad,bad]}]}),output({steps:[{type:'model_output',content:[{...bad,mime_type:'audio/l16'}]}]}),output({steps:[{type:'model_output',content:[{...bad,data:'%%%%'}]}]}),output({steps:[{type:'model_output',content:[{...bad,data:Buffer.from('RIFF').toString('base64')}]}]})];
 for(const value of samples)await reject(()=>geminiSpeech('Hello',key,new AbortController().signal,async()=>Response.json(value),'Kore'),502);
 await reject(()=>geminiSpeech('Hello',key,new AbortController().signal,async()=>new Response('{broken'),'Kore'),502);
 let cancelled=false;
 await reject(()=>geminiSpeech('Hello',key,new AbortController().signal,async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}})),'Kore'),502);assert.equal(cancelled,true);
 for(const [status,expected] of [[401,409],[403,409],[429,429],[500,502]])await reject(()=>geminiSpeech('Hello',key,new AbortController().signal,async()=>new Response(key,{status}),'Kore'),expected);
 await reject(()=>geminiSpeech('Hello',key,new AbortController().signal,async()=>{throw new Error(key);},'Kore'),502);
});

test('Gemini WAV provenance and padded metadata chunks preserve all PCM samples; malformed chunks fail closed',async()=>{
 const chunk=(id,bytes)=>{const value=Buffer.alloc(8+bytes.length+(bytes.length%2));value.write(id);value.writeUInt32LE(bytes.length,4);bytes.copy(value,8);return value;};
 const recording=(...chunks)=>{const value=Buffer.concat([wav.subarray(0,12),...chunks]);value.writeUInt32LE(value.length-8,4);return value;};
 const format=wav.subarray(12,36),data=wav.subarray(36),provenance=chunk('C2PA',Buffer.from('synthetic provenance'));
 const speak=value=>geminiSpeech('Hello',key,new AbortController().signal,async()=>Response.json(output({steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:value.toString('base64')}]}]})),'Kore');
 for(const value of [recording(format,data,provenance),recording(chunk('JUNK',Buffer.from('odd')),format,data,provenance)]){
  const audio=await speak(value);assert.deepEqual(audio,wav);assert.equal(validSpeechWav(audio),true);
  const combined=Buffer.from(await (await combineSpeechAudio([new Blob([audio],{type:'audio/wav'}),new Blob([audio],{type:'audio/wav'})])).arrayBuffer());
  assert.deepEqual(combined.subarray(44),Buffer.concat([wav.subarray(44),wav.subarray(44)]));
 }
 const truncated=recording(format,data,provenance);truncated.writeUInt32LE(provenance.length, wav.length+4);
 const wrongFormat=Buffer.from(format);wrongFormat.writeUInt32LE(16000,12);
 for(const value of [truncated,recording(format,data,data),recording(format,format,data),recording(data,provenance),recording(format,provenance),recording(wrongFormat,data,provenance),recording(format,data,Buffer.from('tail'))])await reject(()=>speak(value),502);
});

test('Gemini input bounds and provider voices fail before transport; multilingual chunks and full WAV download preserve all audio',async()=>{
 let calls=0;const transport=async()=>{calls++;return success();};
 for(const [text,voice] of [['Hello','puck'],['a'.repeat(4097),'Kore'],['中'.repeat(2500),'Kore'],['','Kore']])await reject(()=>geminiSpeech(text,key,new AbortController().signal,transport,voice),400);
 const controller=new AbortController();controller.abort();await reject(()=>geminiSpeech('Hello',key,controller.signal,transport,'Kore'),409);assert.equal(calls,0);
 for(const voice of geminiSpeechVoices)assert.deepEqual(await geminiSpeech('Hello',key,new AbortController().signal,transport,voice),wav);
 const text=('中文 😀. '.repeat(2000)).trim(),chunks=speechChunks(text,1800);assert.equal(chunks.join(''),text);assert.ok(chunks.every(x=>x.length<=1800&&Buffer.byteLength(x)<7000));
 const joined=Buffer.from(await (await combineSpeechAudio([new Blob([wav],{type:'audio/wav'}),new Blob([wav],{type:'audio/wav'})])).arrayBuffer());
 assert.equal(joined.length,56);assert.equal(joined.readUInt32LE(40),12);assert.deepEqual(joined.subarray(44),Buffer.concat([wav.subarray(44),wav.subarray(44)]));
});

test('Gemini credentials are independent, write-only, persistent through the store, bounded and expire without changing OpenAI',()=>{
 let time=Date.now();const {ai,gemini,openai}=fixture(success,undefined,()=>time);
 ai.save({apiKey:openaiKey});const before=structuredClone(openai.value);
 assert.deepEqual(ai.geminiStatus(),{configured:false,expiresAt:null});
 for(const body of [{apiKey:'bad'},{apiKey:key,days:0},{apiKey:key,days:366},{apiKey:key,days:1.5},{apiKey:key,days:'30'}])assert.throws(()=>ai.saveGemini(body),e=>e.status===400);
 const status=ai.saveGemini({apiKey:key,days:1});assert.deepEqual(status,{configured:true,expiresAt:new Date(time+86400000).toISOString()});assert.deepEqual(openai.value,before);
 const restarted=new Intelligence(openai,success,()=>time,undefined,undefined,undefined,gemini);assert.deepEqual(restarted.geminiStatus(),status);
 assert.ok(!JSON.stringify([ai.status(),status]).includes(key));
 time+=86400001;assert.equal(ai.geminiStatus().configured,false);assert.equal(gemini.value,null);assert.deepEqual(openai.value,before);
 ai.saveGemini({apiKey:key});ai.removeGemini();assert.equal(gemini.value,null);assert.deepEqual(openai.value,before);
 assert.throws(()=>new Intelligence(new Secrets()).saveGemini({apiKey:key}),e=>e.status===503);
});

test('Gemini accepts opaque auth keys and pasted whitespace, rejects unsafe values, and sends the full saved key',async()=>{
 let sent;
 const {ai,gemini}=fixture(async(_url,options)=>{sent=options.headers['x-goog-api-key'];return success();});
 enable(ai);
 for(const value of [key,authKey,'future.'+'x'.repeat(geminiApiKeyMaxLength-7)]){
  assert.equal(ai.saveGemini({apiKey:` \n${value}\t `}).configured,true);
  assert.equal(gemini.value.key,value);
  await ai.speech('Hello');assert.equal(sent,value);
 }
 const before=structuredClone(gemini.value);
 for(const apiKey of [undefined,null,123,'','  ','bad','x'.repeat(geminiApiKeyMaxLength+1),authKey+' internal space',authKey+'\r\nheader',authKey+'\0',authKey+'\x7f',authKey+'中']){
  assert.throws(()=>ai.saveGemini({apiKey}),e=>e.status===400);
  assert.deepEqual(gemini.value,before);
 }
});

test('Gemini Keychain uses a separate service with secrets on stdin only and fails closed',t=>{
 t.mock.property(process,'platform','darwin');const records=new Map(),calls=[];
 const execute=(file,args,options)=>{
  calls.push({file,args});
  if(args[0]==='-i'){const parts=options.input.trim().split(' ');records.set(parts[parts.indexOf('-s')+1],parts.at(-1));return {status:0,stdout:'',stderr:''};}
  const service=args[args.indexOf('-s')+1],stored=records.get(service);
  if(args[0]==='delete-generic-password'){records.delete(service);return {status:stored?0:44,stdout:'',stderr:''};}
  return {status:stored?0:44,stdout:stored??'',stderr:''};
 };
 const account='00000000-0000-0000-0000-000000000000',openai=new MacKeychain(account,execute),gemini=new MacKeychain(account,execute,'gemini');
 const ai=new Intelligence(openai,success,Date.now,undefined,undefined,undefined,gemini);
 ai.save({apiKey:openaiKey});ai.saveGemini({apiKey:key});assert.equal(records.size,2);assert.equal(gemini.read().key,key);assert.equal(openai.read().key,openaiKey);
 assert.ok(!JSON.stringify(calls).includes(key));for(const secret of records.values())assert.ok(!JSON.stringify(calls).includes(secret));
 ai.removeGemini();assert.equal(records.has('app.noema.gemini'),false);assert.equal(records.has('app.noema.openai'),true);
 const denied=new MacKeychain(account,()=>({status:36,stdout:key,stderr:key}),'gemini');assert.throws(()=>denied.read(),e=>e.status===503&&!e.message.includes(key));
});

test('Gemini is explicit, never falls back, shares manual quotas, and restores saved provider voices',async()=>{
 let saved,calls=0;const preferenceStore={read:()=>saved,write:value=>{saved=structuredClone(value);}};
 const f=fixture(async()=>{calls++;return success();},preferenceStore);assert.equal(f.ai.speechProviderSelection(),'kokoro');await reject(()=>f.ai.speech('Hello'),409);
 enable(f.ai,{manualRequestsPerMinute:1});await reject(()=>f.ai.speech('Hello'),409);assert.equal(calls,0);assert.equal(f.localCalls(),0);
 f.ai.saveGemini({apiKey:key});enable(f.ai,{ttsVoice:'Charon'});assert.deepEqual(await f.ai.speech('Hello'),wav);await reject(()=>f.ai.speech('Quota'),429);assert.equal(calls,1);
 assert.equal(new Intelligence(new Secrets(),success,Date.now,preferenceStore).speechVoiceSelection(),'Charon');
 assert.throws(()=>enable(f.ai,{ttsVoice:'marin'}),e=>e.status===400);
 const failure=fixture(async()=>{throw new Error(key);});enable(failure.ai);failure.ai.saveGemini({apiKey:key});await reject(()=>failure.ai.speech('No fallback'),502);assert.equal(failure.localCalls(),0);
 for(const provider of ['kokoro','openai','gemini'])assert.notEqual(speechCacheKey('Text',{provider,model:'same',voice:'same'}),speechCacheKey('Text',{provider:provider==='gemini'?'openai':'gemini',model:'same',voice:'same'}));
});

test('Gemini in-flight work cancels on disconnect, provider/voice/enable changes, expiry and key replacement/removal',async()=>{
 for(const action of ['disconnect','provider','voice','disable','expiry','replace','remove']){
  let signal,begin;const started=new Promise(r=>{begin=r;});let time=Date.now();
  const f=fixture(async(_url,options)=>{signal=options.signal;begin();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error(key)),{once:true}));},undefined,()=>time);
  enable(f.ai);f.ai.saveGemini({apiKey:key,days:1});const controller=new AbortController(),pending=f.ai.speech('Pending',controller.signal);const outcome=reject(()=>pending,409);await started;
  if(action==='disconnect')controller.abort();if(action==='provider')f.ai.savePreferences({...f.ai.selection(),ttsProvider:'kokoro'});if(action==='voice')enable(f.ai,{ttsVoice:'Puck'});if(action==='disable')f.ai.savePreferences({...f.ai.selection(),ttsEnabled:false});if(action==='expiry'){time+=86400001;f.ai.purgeExpired();}if(action==='replace')f.ai.saveGemini({apiKey:key});if(action==='remove')f.ai.removeGemini();
  assert.equal(signal.aborted,true,action);await outcome;
 }
});

async function httpFixture(t,transport=success){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-gemini-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db),f=fixture(transport,intelligencePreferencesFor(store));
 const server=createApp(store,path.resolve('dist/client'),f.ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,method='POST',headers={})=>fetch(base+'/api/'+route,{method,headers:{'X-Noema-Request':'1',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {...f,db,store,dir,server,base,call};
}

test('Gemini HTTP credentials enforce CSRF and return only configured/expiry; cache scopes provider, model, voice, vault and survives backups without secrets or traces',async t=>{
 let calls=0;const f=await httpFixture(t,async()=>{calls++;return success();});
 const activity=new AIActivityLog(f.store);activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});
 for(const [method,body] of [['GET',undefined],['PUT',{apiKey:key}],['DELETE',undefined]])assert.equal((await fetch(f.base+'/api/intelligence/gemini',{method,body:body&&JSON.stringify(body)})).status,403);
 assert.equal((await f.call('intelligence/gemini',{apiKey:key},'PUT',{Origin:'https://evil.example'})).status,403);
 let response=await f.call('intelligence/gemini',{apiKey:key},'PUT');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(await response.json()).sort(),['configured','expiresAt']);assert.equal(calls,0);
 enable(f.ai);const speak=(voice='Kore',headers={})=>f.call('intelligence/speech',{text:'Private spoken prose.[ref]',provider:'gemini',voice},'POST',headers);
 response=await speak();assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');
 response=await speak();assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(calls,1);
 enable(f.ai,{ttsVoice:'Puck'});assert.equal((await speak()).status,409);assert.equal((await speak('Puck')).status,200);assert.equal(calls,2);
 enable(f.ai,{ttsVoice:'Kore'});assert.equal((await speak()).headers.get('x-noema-speech-cache'),'hit');assert.equal(calls,2);
 const other=await (await f.call('vaults',{name:'Synthetic other vault'})).json();assert.equal((await speak('Kore',{'X-Vault-Id':other.id})).status,200);assert.equal(calls,3);
 f.ai.savePreferences({...f.ai.selection(),ttsProvider:'kokoro'});response=await f.call('intelligence/speech',{text:'Private spoken prose.',provider:'kokoro',voice:'puck'});assert.equal(response.headers.get('x-noema-speech-cache'),'miss');assert.equal(f.localCalls(),1);assert.equal(calls,3);
 const entry=activity.list(null).items.find(x=>x.model===geminiSpeechModel);assert.equal(entry.inputTokens,13);assert.equal(entry.outputTokens,29);assert.equal(entry.estimatedCost,null);
 const debug=JSON.stringify(activity.debug(entry.id));for(const forbidden of [key,openaiKey,'Private spoken prose',wav.toString('base64')])assert.ok(!debug.includes(forbidden));assert.ok(debug.includes(geminiSpeechEndpoint));
 const backup=readBackupArchive((await new VaultBackups(f.store).export('default')).bytes);assert.equal(backup.speechAssets.length,3);
 for(const secret of [key,openaiKey]){assert.ok(!JSON.stringify(backup).includes(secret));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM metadata').all()).includes(secret));}
 assert.equal((await f.call('intelligence/gemini',undefined,'DELETE')).status,200);assert.deepEqual(await (await f.call('intelligence/gemini',undefined,'GET')).json(),{configured:false,expiresAt:null});assert.equal(calls,3);
});

test('locking a vault aborts pending Gemini transport and never saves or returns its audio',async t=>{
 let signal,begin;const started=new Promise(r=>{begin=r;});
 const f=await httpFixture(t,async(_url,options)=>{signal=options.signal;begin();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error(key)),{once:true}));});
 enable(f.ai);f.ai.saveGemini({apiKey:key});
 const pending=f.call('intelligence/speech',{text:'Never cache after lock',provider:'gemini',voice:'Kore'});await started;
 assert.equal((await f.call('vaults/default/lock',{passphrase:'synthetic-test-passphrase'})).status,200);assert.equal(signal.aborted,true);
 const response=await pending;assert.equal(response.status,409);assert.ok(!(await response.text()).includes(key));assert.equal((await f.call('intelligence/speech',{text:'Locked'})).status,423);
 const files=readdirSync(f.dir,{recursive:true});assert.ok(!files.some(x=>x.endsWith('.wav')));
});

test('Gemini raw provider errors stay out of HTTP responses and full diagnostic traces',async t=>{
 const f=await httpFixture(t,async()=>new Response(JSON.stringify({error:{message:key+' Private selected passage'}}),{status:500}));
 const activity=new AIActivityLog(f.store);activity.saveDebugSettings({enabled:true,fullTraceMinutes:5});enable(f.ai);f.ai.saveGemini({apiKey:key});
 const response=await f.call('intelligence/speech',{text:'Private selected passage',provider:'gemini',voice:'Kore'});assert.equal(response.status,502);assert.ok(!(await response.text()).includes(key));
 const entry=activity.list(null).items.find(x=>x.model===geminiSpeechModel);assert.equal(entry.status,'failed');const trace=JSON.stringify(activity.debug(entry.id));assert.ok(!trace.includes(key));assert.ok(!trace.includes('Private selected passage'));assert.equal(f.localCalls(),0);
});

test('Gemini settings require a saved explicit provider, expose only its voices, and keep credentials transient and write-only',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let saved={...defaultIntelligencePreferences,ttsEnabled:false,ttsProvider:'kokoro',ttsVoice:'puck',manualRequestsPerMinute:5},credential={configured:false,expiresAt:null},writes=[],events=0;
 t.mock.method(api,'intelligence',async()=>({...saved,configured:false,expiresAt:null}));t.mock.method(api,'speechModel',async()=>({ready:true,model:'kokoro-82m-v1.0',missingFiles:[]}));
 t.mock.method(api,'geminiCredential',async()=>credential);t.mock.method(api,'saveIntelligencePreferences',async value=>{saved=structuredClone(value);return saved;});
 t.mock.method(api,'saveGeminiCredential',async(value,days)=>{writes.push({value,days});credential={configured:true,expiresAt:'2026-11-23T00:00:00Z'};return credential;});
 t.mock.method(api,'removeGeminiCredential',async()=>{credential={configured:false,expiresAt:null};return credential;});
 window.addEventListener('noema:tts-preferences',()=>events++);
 await act(async()=>root.render(createElement(IntelligenceSettings)));
 assert.equal(document.querySelector('#ai-tts-provider').value,'kokoro');assert.equal(document.querySelector('#ai-tts-enabled').getAttribute('aria-checked'),'false');
 await act(async()=>{const select=document.querySelector('#ai-tts-provider');select.value='gemini';select.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(saved.ttsProvider,'kokoro');assert.equal(document.querySelector('.local-speech-model'),null);assert.equal(document.querySelector('#ai-tts-voice').value,'Puck');
 assert.deepEqual([...document.querySelector('#ai-tts-voice').options].map(x=>x.value),[...geminiSpeechVoices]);assert.ok(document.querySelector('#ai-tts-description').textContent.includes('Google'));assert.ok(document.body.textContent.includes(geminiSpeechModel));
 await act(async()=>document.querySelector('.ai-preferences-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(saved.ttsProvider,'gemini');assert.equal(saved.ttsVoice,'Puck');assert.equal(writes.length,0);
 const input=document.querySelector('#gemini-key');assert.equal(input.type,'password');assert.equal(input.autocomplete,'new-password');assert.equal(input.maxLength,geminiApiKeyMaxLength);assert.ok(input.maxLength>authKey.length);
 // React's input plugin initializes before JSDOM in this suite; invoke its registered change handler.
 await act(async()=>{input.value=`  ${authKey}  `;input[Object.keys(input).find(name=>name.startsWith('__reactProps'))].onChange({target:input});});
 await act(async()=>input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(writes,[{value:authKey,days:30}]);assert.equal(input.value,'');assert.ok(document.body.textContent.includes('Gemini key saved'));assert.ok(!document.body.innerHTML.includes(authKey));assert.equal(localStorageSafe(env.dom.window),false);
 assert.equal(events,2);await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Remove Gemini key').click());assert.equal(events,3);assert.equal(credential.configured,false);
});
function localStorageSafe(window){try{return JSON.stringify(window.localStorage).includes(key);}catch{return false;}}

test('Gemini editor generations pin their provider and voice, download every section and cancel on settings changes',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let hook,provider='gemini',voice='Kore',pending=[],created=[];
 t.mock.method(api,'intelligence',async()=>({ttsEnabled:true,ttsProvider:provider,ttsVoice:voice}));
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'/api/intelligence/speech');const body=JSON.parse(options.body);assert.equal(body.provider,'gemini');assert.equal(body.voice,'Kore');assert.ok(body.text.length<=1800);return new Promise(resolve=>pending.push({resolve,signal:options.signal}));});
 t.mock.method(URL,'createObjectURL',blob=>{created.push(blob);return 'blob:gemini-speech';});t.mock.method(URL,'revokeObjectURL',()=>{});t.mock.method(env.dom.window.HTMLMediaElement.prototype,'play',async()=>{});
 function Harness(){hook=useSpeech('default','synthetic-page');return hook.player;}
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>hook.speak('a'.repeat(3600)));assert.equal(pending.length,1);assert.equal(created.length,0);
 await act(async()=>pending[0].resolve(new Response(wav,{headers:{'Content-Type':'audio/wav'}})));assert.equal(pending.length,2);assert.equal(created.length,0);
 await act(async()=>pending[1].resolve(new Response(wav,{headers:{'Content-Type':'audio/wav'}})));assert.equal(created.length,1);assert.equal(created[0].size,56);assert.ok(document.querySelector('a[download="noema-speech.wav"]'));
 await act(async()=>hook.speak('b'.repeat(3600)));assert.equal(pending.length,3);
 provider='kokoro';voice='puck';await act(async()=>window.dispatchEvent(new Event('noema:tts-preferences')));assert.equal(pending[2].signal.aborted,true);
 await act(async()=>pending[2].resolve(new Response(wav,{headers:{'Content-Type':'audio/wav'}})));assert.equal(pending.length,3);assert.equal(created.length,1);assert.equal(document.querySelector('.editor-speech'),null);
});
