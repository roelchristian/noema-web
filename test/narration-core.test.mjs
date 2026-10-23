import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
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
