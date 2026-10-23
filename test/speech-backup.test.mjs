import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,existsSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {SpeechCache,speechCacheKey} from '../src/server/modules/speech-cache.ts';
import {readBackupArchive,rewriteBackupArchive} from './helpers/backup-archive.mjs';

const selection='A saved passage for speech.',key=speechCacheKey(selection),id=key+'.wav';
function wav() {
 const bytes=Buffer.alloc(48);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
 bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);
 bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(4,40);
 bytes.writeInt16LE(123,44);bytes.writeInt16LE(-123,46);return bytes;
}
function fixture() {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-speech-backup-'));
 const db=openDatabase(path.join(directory,'noema.sqlite')),store=new Store(db),vaults=new Vaults(store);
 const vault=vaults.create({name:'Speech archive'}),cache=new SpeechCache(store),backups=new VaultBackups(store);
 return {directory,db,store,vaults,vault,cache,backups,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function audioFiles(directory) {
 const root=path.join(directory,'assets');
 return existsSync(root)?readdirSync(root,{recursive:true}).filter(file=>/\.(wav|sha256)$/.test(file)).sort():[];
}

test('saved speech audio survives backup import with its content cache identity',async()=>{
 const state=fixture();try {
  state.cache.restore(state.vault.id,id,wav());
  const exported=await state.backups.export(state.vault.id),archive=readBackupArchive(exported.bytes);
  assert.deepEqual(archive.speechAssets,[{id,data:wav().toString('base64')}]);
  const restored=await state.backups.import(exported.bytes,'Speech restored');
  assert.notEqual(restored.id,state.vault.id);
  assert.deepEqual(state.cache.entries(restored.id),[{id,bytes:wav()}]);
  assert.deepEqual(state.cache.read(restored.id,speechCacheKey(selection)),wav());
  assert.equal(state.cache.read(restored.id,speechCacheKey(selection+' Changed.')),null);
  assert.deepEqual(readBackupArchive((await state.backups.export(restored.id)).bytes).speechAssets,archive.speechAssets);
  const legacy=await state.backups.import(rewriteBackupArchive(exported.bytes,archive=>{delete archive.speechAssets;}));
  assert.deepEqual(state.cache.entries(legacy.id),[]);
 } finally {state.close();}
});

test('malformed speech assets reject the import and remove newly written audio and checksums',async()=>{
 const state=fixture();try {
  state.cache.restore(state.vault.id,id,wav());
  const {bytes}=await state.backups.export(state.vault.id),before=audioFiles(state.directory),count=state.vaults.list().length;
  const cases=[
   archive=>archive.speechAssets.push({id:'../escape.wav',data:wav().toString('base64')}),
   archive=>archive.speechAssets.push({id:'b'.repeat(64)+'.wav',data:Buffer.from('not WAV').toString('base64')}),
   archive=>archive.speechAssets.push({id:'b'.repeat(64)+'.wav',data:'%%%'}),
   archive=>archive.speechAssets.push(archive.speechAssets[0]),
   archive=>archive.tables.pages.push({id:'invalid'}),
  ];
  for(const change of cases) {
   await assert.rejects(state.backups.import(rewriteBackupArchive(bytes,change)),error=>error.status===400);
   assert.equal(state.vaults.list().length,count);assert.deepEqual(audioFiles(state.directory),before);
  }
 } finally {state.close();}
});

test('speech backup ignores arbitrary files, corrupt cache entries and symlinks',async()=>{
 const state=fixture();try {
  state.cache.restore(state.vault.id,id,wav());
  const directory=path.join(state.directory,'assets',state.vault.id,'speech');
  writeFileSync(path.join(directory,'private.txt'),'Never include arbitrary metadata');
  writeFileSync(path.join(directory,'b'.repeat(64)+'.wav'),wav());
  const linked='c'.repeat(64)+'.wav';symlinkSync(path.join(directory,id),path.join(directory,linked));
  const archive=readBackupArchive((await state.backups.export(state.vault.id)).bytes);
  assert.deepEqual(archive.speechAssets,[{id,data:wav().toString('base64')}]);
  assert.doesNotMatch(JSON.stringify(archive),/Never include arbitrary metadata/);
 } finally {state.close();}
});
