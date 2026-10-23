import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {maxSourceBytes,maxSourceTextBytes,pastedSourceFilename,validatePastedSourceText} from '../src/shared/source-input.ts';
import {getPropertyProvenance} from '../src/server/modules/property-provenance.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {createApp} from '../src/server/http.ts';
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-sources-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db);
 const files=new SourceFiles(store),knowledge=new Knowledge(store),vaults=new Vaults(store);
 return {dir,db,store,files,knowledge,vaults,close(){files.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
const fail=(fn,status)=>assert.throws(fn,e=>e.status===status);
test('sources require original files; local extraction, last-file invariant, vault isolation and backups',async()=>{
 const env=fixture();const {files,knowledge,vaults,store}=env;
 try {
  fail(()=>knowledge.create('default',{name:'Missing original',type:'source'}),400);
  const a=files.add('default','notes.md',Buffer.from('# Primary source\nText in the vault.'));
  assert.match(a.id,/^[a-f0-9-]{36}\.md$/);
  assert.equal(readFileSync(files.filename('default',a.id),'utf8'),'# Primary source\nText in the vault.');
  const other=vaults.create({name:'Other'});
  fail(()=>knowledge.create(other.id,{name:'Cross-vault',type:'source',attachmentIds:[a.id]}),400);
  const source=knowledge.create('default',{name:'Reference',type:'source',attachmentIds:[a.id]});
  assert.equal(source.attachments[0].entity_id,source.id);
  assert.equal(knowledge.list('default').find(entity=>entity.id===source.id).sourceSize,a.size);
  assert.equal(knowledge.find('default',source.id).sourceSize,a.size);
  fail(()=>knowledge.create('default',{name:'Reused',type:'source',attachmentIds:[a.id]}),400);
  fail(()=>files.remove('default',a.id),400);
  fail(()=>knowledge.update('default',source.id,{name:'Reference',type:'person'}),400);
  const person=knowledge.create('default',{name:'Person',type:'person'});
  assert.equal(knowledge.find('default',person.id).sourceSize,null);
  fail(()=>knowledge.update('default',person.id,{name:'Person',type:'source'}),400);
  fail(()=>files.add('default','file.txt',Buffer.from('value'),person.id),400);
  await files.tick();assert.equal(files.require('default',a.id).status,'ready');
  assert.match(files.require('default',a.id).text,/Primary source/);
  fail(()=>files.add('default','page.html',Buffer.from('<p>Disabled HTML</p>'),source.id),415);
  fail(()=>files.add('default','PAGE.HTML',Buffer.from('<p>Disabled HTML</p>'),source.id),415);
  fail(()=>files.add('default','second.txt',Buffer.from('Second original'),source.id),400);
  assert.equal(knowledge.detail('default',source.id).attachments.length,1);
  const b=files.add('default','reference.txt',Buffer.from('Reference text é 😀'));
  knowledge.create('default',{name:'Text reference',type:'source',attachmentIds:[b.id]});
  await files.tick();const extracted=files.require('default',b.id);
  assert.equal(extracted.text,'Reference text é 😀');
  const c=files.add('default','empty.txt',Buffer.from('   '));
  knowledge.create('default',{name:'Empty source',type:'source',attachmentIds:[c.id]});
  await files.tick();assert.equal(files.require('default',c.id).status,'failed');
  assert.ok(existsSync(files.filename('default',c.id)));files.retry('default',c.id);assert.equal(files.require('default',c.id).status,'queued');
  fail(()=>files.remove('default',c.id),400);
  const abandoned=files.add('default','abandoned.txt',Buffer.from('Temporary upload'));files.remove('default',abandoned.id);assert.equal(existsSync(files.filename('default',abandoned.id)),false);
  const backups=new VaultBackups(store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored');
  const restoredSource=knowledge.list(restored.id).find(e=>e.name==='Reference');
  const restoredFiles=knowledge.detail(restored.id,restoredSource.id).attachments;
  assert.equal(restoredFiles.length,1);assert.ok(restoredFiles.every(f=>f.status==='ready'));
  assert.notEqual(restoredFiles[0].id,a.id);const textSource=knowledge.list(restored.id).find(e=>e.name==='Text reference');assert.equal(knowledge.detail(restored.id,textSource.id).attachments[0].text,extracted.text);
  assert.deepEqual(readFileSync(files.filename(restored.id,restoredFiles.find(f=>f.name==='notes.md').id)),readFileSync(files.filename('default',a.id)));
  fail(()=>files.remove('default',a.id),400);assert.ok(existsSync(files.filename('default',a.id)));
  fail(()=>files.remove('default',b.id),400);
  fail(()=>files.require(other.id,b.id),404);
  fail(()=>files.add('default','bad.pdf',Buffer.from('fake')),415);
  fail(()=>files.add('default','bad.exe',Buffer.from('binary')),415);
  fail(()=>files.add('default','bad.txt',Buffer.from([0,255])),415);
  fail(()=>files.add('default','../path.txt',Buffer.from('unsafe')),400);
 }finally{env.close();}
});
test('source HTTP actions enforce client headers, safe downloads, locks and restart recovery',async t=>{
 const env=fixture();
 // Only the fixture's explicit tick advances extraction. The server's own
 // 500 ms worker must not admit a file while this test checks queued access.
 const tick=SourceFiles.prototype.tick;
 t.mock.method(SourceFiles.prototype,'tick',async function(...args){if(this===env.files)return tick.apply(this,args);});
 let server=createApp(env.store,path.resolve('dist/client'));
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const headers={'X-Noema-Request':'1','X-Vault-Id':'default'};
 try {
  let response=await fetch(base+'/api/source-files?name=reference.txt',{method:'POST',body:'Original'});assert.equal(response.status,403);
  response=await fetch(base+'/api/source-files?name=page.html',{method:'POST',headers,body:'<p>Disabled</p>'});assert.equal(response.status,415);
  response=await fetch(base+'/api/source-files?name=reference.txt',{method:'POST',headers,body:'Original'});assert.equal(response.status,201);const file=await response.json();
  const source=env.knowledge.create('default',{name:'Text original',type:'source',attachmentIds:[file.id]});
  assert.equal(env.files.require('default',file.id).status,'queued');assert.equal(env.files.require('default',file.id).admitted,0);
  response=await fetch(base+'/api/source-files/'+file.id+'/download',{headers});assert.equal(response.status,409,'unadmitted originals cannot be downloaded');
  await env.files.tick();assert.equal(env.files.require('default',file.id).admitted,1);
  response=await fetch(base+'/api/source-files/'+file.id+'/download',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(await response.text(),'Original');
  const other=env.vaults.create({name:'Other'});
  response=await fetch(base+'/api/source-files/'+file.id+'?vault='+other.id);assert.equal(response.status,404);
  env.store.run("UPDATE source_files SET status='queued' WHERE id=?",file.id);
  env.vaults.lock('default',{passphrase:'test-lock'});
  response=await fetch(base+'/api/source-files/'+file.id);assert.equal(response.status,423);
  await env.files.tick();assert.equal(env.files.require('default',file.id).status,'queued');
  env.vaults.unlock('default',{passphrase:'test-lock'});
  env.store.run("UPDATE source_files SET status='processing' WHERE id=?",file.id);env.files.recover();assert.equal(env.files.require('default',file.id).status,'queued');
  await env.files.tick();assert.equal(env.knowledge.detail('default',source.id).attachments[0].text,'Original');
 }finally{await new Promise(resolve=>server.close(resolve));env.close();}
});


test('pasted UTF-8 text follows the original-file lifecycle with exact evidence, paragraphs, provenance and vault-isolated backup',async t=>{
 assert.equal(maxSourceBytes,50*1024*1024);assert.equal(maxSourceTextBytes,16*1024*1024);
 assert.equal(pastedSourceFilename('   '),'Pasted text.txt');assert.equal(pastedSourceFilename('../A: title?.txt'),'A title.txt');
 assert.ok(pastedSourceFilename('😀'.repeat(200)).length<=200);assert.match(pastedSourceFilename('CON'),/^_CON\.txt$/);
 for(const invalid of ['', ' \n\t ', 'before\0after', '\ud800', '\udc00', 'a\ud800b', '😀\udc00'])assert.throws(()=>validatePastedSourceText(invalid));
 assert.doesNotThrow(()=>validatePastedSourceText('😀'.repeat(maxSourceTextBytes/4)));
 assert.throws(()=>validatePastedSourceText('😀'.repeat(maxSourceTextBytes/4+1)),RangeError);
 const text='First café e\u0301 😀 中文 paragraph.\r\nA soft-wrapped continuation.\r\n\r\nSecond paragraph: Ελληνικά, العربية.\r\n\r\nThird paragraph.',bytes=Buffer.from(text,'utf8');
 validatePastedSourceText(text);const name=pastedSourceFilename('Pasted multilingual source');
 let networkCalls=0;t.mock.method(globalThis,'fetch',async()=>{networkCalls++;throw new Error('Pasted sources must not invoke AI or network requests.');});
 const env=fixture(),{files,knowledge,vaults,store}=env;
 try {
  const staged=await files.admit('default',name,bytes,undefined,()=>vaults.requireOpen('default'));
  assert.equal(staged.entity_id,null);assert.equal(staged.admitted,0);assert.equal(staged.format,'txt');assert.equal(staged.import_method,'upload');
  assert.deepEqual(readFileSync(files.assetFilename('default',staged.id)),bytes);
  const other=vaults.create({name:'Other pasted vault'});fail(()=>knowledge.create(other.id,{name:'Wrong vault',type:'source',attachmentIds:[staged.id]}),400);
  const source=knowledge.create('default',{name:'Pasted multilingual source',type:'source',attachmentIds:[staged.id]});
  fail(()=>knowledge.create('default',{name:'Reused paste',type:'source',attachmentIds:[staged.id]}),400);
  fail(()=>files.add('default','extra.txt',Buffer.from('Another text'),source.id),400);
  await files.tick();const extracted=files.require('default',staged.id),evidence=files.exportEvidence('default',staged.id);
  assert.equal(extracted.status,'ready');assert.equal(extracted.admitted,1);assert.equal(extracted.original_filename,name);
  assert.match(extracted.text,/café e\u0301 😀 中文/);assert.match(extracted.text,/continuation\.\n\nSecond paragraph/);assert.match(extracted.text,/العربية\.\n\nThird paragraph/);
  assert.equal(evidence.rawExtraction.text,text);assert.equal(evidence.originalHash,createHash('sha256').update(bytes).digest('hex'));assert.equal(evidence.originalBytes,bytes.length);
  assert.deepEqual(Buffer.from(evidence.originalData,'base64'),bytes);assert.deepEqual(readFileSync(files.filename('default',staged.id)),bytes);
  const property=store.get("SELECT id,value FROM properties WHERE entity_id=? AND name='Import method'",source.id);
  assert.equal(property.value,'upload');const provenance=getPropertyProvenance(store,'default',property.id);assert.equal(provenance.origin,'imported');assert.equal(provenance.source_file_id,staged.id);
  assert.equal(knowledge.detail('default',source.id).attachments.length,1);fail(()=>files.require(other.id,staged.id),404);fail(()=>files.remove('default',staged.id),400);
  const backups=new VaultBackups(store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored paste');
  const restoredSource=knowledge.list(restored.id).find(entity=>entity.name===source.name),attachments=knowledge.detail(restored.id,restoredSource.id).attachments;
  assert.equal(attachments.length,1);assert.equal(attachments[0].text,extracted.text);assert.notEqual(attachments[0].id,staged.id);
  assert.deepEqual(readFileSync(files.filename(restored.id,attachments[0].id)),bytes);assert.deepEqual(Buffer.from(files.exportEvidence(restored.id,attachments[0].id).originalData,'base64'),bytes);
  assert.equal(networkCalls,0);
 }finally{env.close();}
});
