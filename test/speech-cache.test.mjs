import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,readdirSync,mkdirSync,symlinkSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SpeechCache,speechCacheRetentionMs,speechCacheKey,validSpeechWav} from '../src/server/modules/speech-cache.ts';
function audio(){const bytes=Buffer.alloc(48);bytes.write('RIFF');bytes.writeUInt32LE(40,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(4,40);return bytes;}
test('speech cache keys scope text, model, voice, and cache version',()=>{
 const base=speechCacheKey('Private text');assert.match(base,/^[a-f0-9]{64}$/);assert.equal(base,speechCacheKey(' Private text '));assert.equal(base,speechCacheKey('Private [ref] text [L: 1–2]'));assert.equal(base,speechCacheKey('Private text[^note]\n\n[^note]: Private citation'));
 for(const key of [speechCacheKey('Changed text'),speechCacheKey('Private text',{model:'other'}),speechCacheKey('Private text',{voice:'coral'}),speechCacheKey('Private text',{version:'next'})])assert.notEqual(key,base);
});
test('speech cache persists restrictive WAV assets across restarts and rejects corruption',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-cache-')),filename=path.join(dir,'noema.sqlite');let db=openDatabase(filename);
 try {
  let cache=new SpeechCache(new Store(db));const key=speechCacheKey('Private text'),bytes=audio();assert.equal(validSpeechWav(bytes),true);
  cache.write('default',key,bytes,()=>{});const wav=path.join(dir,'assets/default/speech',key+'.wav');assert.deepEqual(readFileSync(wav),bytes);assert.equal(statSync(wav).mode&0o777,0o600);assert.equal(statSync(path.dirname(wav)).mode&0o777,0o700);
  assert.ok(!readdirSync(path.dirname(wav)).some(name=>name.includes('Private')));assert.deepEqual(cache.entries('default'),[{id:key+'.wav',bytes}]);
  db.close();db=openDatabase(filename);cache=new SpeechCache(new Store(db));assert.deepEqual(cache.read('default',key),bytes);assert.equal(cache.read('11111111-1111-4111-8111-111111111111',key),null);
  const corrupted=Buffer.from(bytes);corrupted[47]=1;writeFileSync(wav,corrupted);assert.equal(cache.read('default',key),null);assert.deepEqual(cache.entries('default'),[]);
  cache.restore('default',key+'.wav',bytes);assert.deepEqual(cache.read('default',key),bytes);cache.remove('default',key+'.wav');assert.equal(cache.read('default',key),null);
  assert.throws(()=>cache.restore('default','../../unsafe.wav',bytes));assert.throws(()=>cache.write('../escape',key,bytes,()=>{}));assert.throws(()=>cache.write('default',key,Buffer.from('invalid'),()=>{}));
  let validations=0;assert.throws(()=>cache.write('default',key,bytes,()=>{if(++validations===2)throw new Error('Locked');}));assert.equal(cache.read('default',key),null);assert.deepEqual(readdirSync(path.dirname(wav)),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});


test('speech cache refuses symlink directories and never reads or writes outside vault assets',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-symlink-')),db=openDatabase(path.join(dir,'test.sqlite')),cache=new SpeechCache(new Store(db)),key=speechCacheKey('selection');
 const outside=path.join(dir,'outside');mkdirSync(outside);
 try {
  mkdirSync(path.join(dir,'assets/default'),{recursive:true});symlinkSync(outside,path.join(dir,'assets/default/speech'),'dir');
  assert.equal(cache.read('default',key),null);assert.deepEqual(cache.entries('default'),[]);assert.throws(()=>cache.write('default',key,audio(),()=>{}));assert.deepEqual(readdirSync(outside),[]);
  rmSync(path.join(dir,'assets/default/speech'));rmSync(path.join(dir,'assets/default'),{recursive:true});symlinkSync(outside,path.join(dir,'assets/default'),'dir');
  assert.equal(cache.read('default',key),null);cache.cleanup();assert.throws(()=>cache.write('default',key,audio(),()=>{}));assert.deepEqual(readdirSync(outside),[]);
  rmSync(path.join(dir,'assets/default'));rmSync(path.join(dir,'assets'),{recursive:true});symlinkSync(outside,path.join(dir,'assets'),'dir');
  assert.equal(cache.read('default',key),null);cache.cleanup();assert.throws(()=>cache.write('default',key,audio(),()=>{}));assert.deepEqual(readdirSync(outside),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});


test('speech recordings expire seven days after creation without extending on reads, including after restart',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-speech-retention-')),db=openDatabase(path.join(dir,'test.sqlite'));
 let now=Date.now();const store=new Store(db),cache=new SpeechCache(store,()=>now),key=speechCacheKey('Expired'),freshKey=speechCacheKey('Fresh');
 const vault='11111111-1111-4111-8111-111111111111';
 try{
  cache.write('default',key,audio(),()=>{});cache.write(vault,key,audio(),()=>{});
  const filename=path.join(dir,'assets/default/speech',key+'.wav'),created=now-speechCacheRetentionMs;
  for(const id of ['default',vault]){const file=path.join(dir,'assets',id,'speech',key+'.wav');utimesSync(file,new Date(created),new Date(created));}
  // Expiry applies to direct reads and removes both files, including at the boundary.
  now+=1;assert.equal(cache.read('default',key),null);assert.equal(existsSync(filename),false);assert.equal(existsSync(filename+'.sha256'),false);
  cache.write(vault,freshKey,audio(),()=>{});
  const freshFile=path.join(dir,'assets',vault,'speech',freshKey+'.wav');utimesSync(freshFile,new Date(now),new Date(now));
  const orphan=path.join(dir,'assets',vault,'speech','a'.repeat(64)+'.wav.sha256');writeFileSync(orphan,'0'.repeat(64));utimesSync(orphan,new Date(created),new Date(created));
  const restarted=new SpeechCache(store,()=>now);restarted.cleanup();
  assert.deepEqual(restarted.entries(vault),[{id:freshKey+'.wav',bytes:audio()}]);assert.equal(existsSync(orphan),false);
  assert.equal(existsSync(path.join(dir,'assets',vault,'speech',key+'.wav')),false);
  restarted.read(vault,freshKey);now+=speechCacheRetentionMs+1;restarted.cleanup();assert.deepEqual(restarted.entries(vault),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('memory speech cache expires on reads and cleanup and can regenerate expired recordings',()=>{
 const db=openDatabase(':memory:');let now=Date.now();const cache=new SpeechCache(new Store(db),()=>now),key=speechCacheKey('Memory');
 try{
  cache.write('default',key,audio(),()=>{});now+=speechCacheRetentionMs-1;assert.deepEqual(cache.read('default',key),audio());
  now++;assert.equal(cache.read('default',key),null);cache.write('default',key,audio(),()=>{});assert.deepEqual(cache.read('default',key),audio());
  now+=speechCacheRetentionMs;cache.cleanup();assert.deepEqual(cache.entries('default'),[]);
 }finally{db.close();}
});
