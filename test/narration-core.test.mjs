import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server/http.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {defaultNarrationPreferences,parseNarrationPreferences,narrationCapabilities} from '../src/shared/narration.ts';
import {defaultIntelligencePreferences} from '../src/shared/intelligence.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {speechCacheKey,validSpeechWav} from '../src/server/modules/speech-cache.ts';
import {appendSpeechSilence} from '../src/server/modules/speech-silence.ts';
import {realtimeSpeech} from '../src/server/modules/realtime-speech.ts';
import {geminiSpeech} from '../src/server/modules/gemini-speech.ts';
const prefs=more=>({...structuredClone(defaultNarrationPreferences),...more});
const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);wav.writeInt16LE(1234,44);
const secrets={read:()=>null,write(){throw new Error('No credential operations allowed');},remove(){throw new Error('No credential operations allowed');}};

test('bounded narration preferences persist independently from credentials and sound-affecting changes identify distinct cache entries',()=>{
 let stored;const store={read:()=>stored,write:value=>{stored=structuredClone(value);}};
 const ai=new Intelligence(secrets,undefined,undefined,store);
 const narration=prefs({pace:0.8,pronunciations:[{word:'Noema',spoken:'noh eh mah',caseSensitive:false,language:'en'}]});
 ai.savePreferences({...defaultIntelligencePreferences,ttsEnabled:true,narration});
 assert.deepEqual(new Intelligence(secrets,undefined,undefined,store).narrationSelection(),narration);
 const base=speechCacheKey('Noema');
 for(const variant of [prefs({pace:1.1}),prefs({accent:'british'}),prefs({warmth:'warm'}),prefs({expressiveness:'expressive'}),prefs({preset:'study'}),prefs({locale:'de-DE'}),prefs({pauses:{heading:100,paragraph:0,listItem:0}}),narration,prefs({rules:{...narration.rules,numbers:'digits'}})])assert.notEqual(speechCacheKey('Noema',{narration:variant}),base);
 assert.notEqual(speechCacheKey('Noema',{pauseAfterMs:100}),base);assert.notEqual(speechCacheKey('Noema',{protectedText:true}),base);
 for(const bad of [null,prefs({pace:NaN}),prefs({pace:0.7}),prefs({pauses:{heading:3001,paragraph:0,listItem:0}}),prefs({pronunciations:Array(101).fill(narration.pronunciations[0])}),prefs({pronunciations:[{word:'a',spoken:'b\nheader',caseSensitive:false,language:''}]}),prefs({pronunciations:[narration.pronunciations[0],narration.pronunciations[0]]}),prefs({locale:'invented'})])assert.throws(()=>parseNarrationPreferences(bad),RangeError);
 assert.equal(narrationCapabilities('kokoro').steering,false);assert.equal(narrationCapabilities('kokoro').pace,'native');assert.equal(narrationCapabilities('gemini').pace,'prompt');
});

test('saved and draft narration transform only spoken content, use native local pace, append exact silence and abort on settings changes',async()=>{
 let received,release;const ai=new Intelligence(secrets,undefined,undefined,undefined,async(text,_signal,voice,pace)=>{received={text,voice,pace};return wav;});
 ai.savePreferences({...defaultIntelligencePreferences,ttsEnabled:true});
 const draft=prefs({pace:0.75,pronunciations:[{word:'Noema',spoken:'noh eh mah',caseSensitive:false,language:''}]});
 const audio=await ai.speech('Noema',undefined,undefined,{narration:draft,pauseAfterMs:250});
 assert.equal(received.text,'noh eh mah');assert.equal(received.pace,0.75);assert.deepEqual(ai.narrationSelection(),defaultNarrationPreferences);
 assert.equal(audio.length,wav.length+12000);assert.deepEqual(audio.subarray(44,48),wav.subarray(44));assert.ok(audio.subarray(48).every(value=>value===0));assert.ok(validSpeechWav(audio));
 await ai.speech('Noema',undefined,undefined,{narration:draft,protectedText:true});assert.equal(received.text,'Noema');
 assert.throws(()=>appendSpeechSilence(wav,3001));assert.throws(()=>appendSpeechSilence(Buffer.from('partial'),0));
 const busy=new Intelligence(secrets,undefined,undefined,undefined,()=>new Promise(resolve=>{release=resolve;}));busy.savePreferences({...defaultIntelligencePreferences,ttsEnabled:true});
 const pending=busy.speech('Noema');busy.savePreferences({...defaultIntelligencePreferences,narration:draft});release(wav);await assert.rejects(pending,error=>error.status===409);
 const expansive=prefs({pronunciations:[{word:'a',spoken:'b'.repeat(200),caseSensitive:false,language:''}]});await assert.rejects(ai.speech('a '.repeat(30),undefined,undefined,{narration:expansive}),error=>error.status===400);
});

test('cloud delivery stays outside transcript and OpenAI pace uses the documented output speed field',async()=>{
 const draft=prefs({pace:0.8,preset:'study',accent:'british',warmth:'warm',expressiveness:'expressive'});let sent;
 await geminiSpeech('Authored text','synthetic-key',new AbortController().signal,async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:wav.toString('base64')}]}]});},'Puck',undefined,draft);
 const content=sent.input[0].content[0];assert.equal(content.text,'Authored text');assert.match(content.annotations[0].style,/british/);assert.match(content.annotations[0].style,/slowly/);
 const messages=[];
 class Socket extends EventEmitter {send(value){const message=JSON.parse(value);messages.push(message);if(message.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.updated'}))));else queueMicrotask(()=>{this.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.delta',delta:wav.subarray(44).toString('base64')})));this.emit('message',Buffer.from(JSON.stringify({type:'response.done',response:{status:'completed'}})));});}terminate(){}}
 await realtimeSpeech('Authored text','synthetic-key',new AbortController().signal,()=>{const socket=new Socket();queueMicrotask(()=>socket.emit('open'));return socket;},undefined,'marin',draft);
 assert.equal(messages[0].session.audio.output.speed,0.8);assert.equal(messages[1].response.input[0].content[0].text,'Authored text');assert.match(messages[1].response.instructions,/untrusted/);assert.match(messages[1].response.instructions,/british/);
});


test('speech route validates draft controls, scopes cache to narration and protected text, and downloads the requested silence',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-narration-route-')),db=openDatabase(path.join(directory,'test.sqlite'));const received=[];
 const ai=new Intelligence(secrets,undefined,undefined,undefined,async text=>{received.push(text);return wav;});ai.savePreferences({...defaultIntelligencePreferences,ttsEnabled:true});
 const server=createApp(new Store(db),path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
 const speak=body=>fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/speech`,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json'},body:JSON.stringify({text:'Noema',...body})});
 try {
  const narration=prefs({pronunciations:[{word:'Noema',spoken:'noh eh mah',caseSensitive:false,language:''}]});
  let response=await speak({narration,pauseAfterMs:250});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'miss');assert.equal((await response.arrayBuffer()).byteLength,wav.length+12000);assert.deepEqual(received,['noh eh mah']);
  response=await speak({narration,pauseAfterMs:250});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(received.length,1);
  response=await speak({narration,pauseAfterMs:0});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,wav.length);assert.equal(received.length,2);
  response=await speak({narration,protectedText:true});assert.equal(response.status,200);assert.equal(received.at(-1),'Noema');assert.equal(received.length,3);
  response=await speak({});assert.equal(response.status,200);assert.equal(received.length,4);assert.deepEqual(ai.narrationSelection(),defaultNarrationPreferences);
  for(const controls of [{pauseAfterMs:3001},{pauseAfterMs:'100'},{protectedText:'yes'},{narration:{...narration,pace:2}}])assert.equal((await speak(controls)).status,400);
  assert.equal(received.length,4);
  // A subsequent section must not replay cached audio or bill for stale saved narration.
  response=await speak({expectedNarration:prefs({})});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(received.length,4);
  ai.savePreferences({...defaultIntelligencePreferences,narration});
  response=await speak({expectedNarration:prefs({})});assert.equal(response.status,409);assert.equal(received.length,4);
  response=await speak({text:'Uncached stale section',expectedNarration:prefs({})});assert.equal(response.status,409);assert.equal(received.length,4);
  response=await speak({expectedNarration:{...narration,pace:2}});assert.equal(response.status,400);assert.equal(received.length,4);
  // Parsing canonicalizes object order and strips unrelated fields before comparison.
  response=await speak({expectedNarration:{rules:narration.rules,...narration,unused:true}});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.equal(received.length,4);
  response=await speak({narration:prefs({})});assert.equal(response.status,200);assert.equal(response.headers.get('x-noema-speech-cache'),'hit');assert.deepEqual(ai.narrationSelection(),narration);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});}
});
