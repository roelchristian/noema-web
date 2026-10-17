import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
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
  fail(()=>knowledge.create('default',{name:'Reused',type:'source',attachmentIds:[a.id]}),400);
  fail(()=>files.remove('default',a.id),400);
  fail(()=>knowledge.update('default',source.id,{name:'Reference',type:'person'}),400);
  const person=knowledge.create('default',{name:'Person',type:'person'});
  fail(()=>knowledge.update('default',person.id,{name:'Person',type:'source'}),400);
  fail(()=>files.add('default','file.txt',Buffer.from('value'),person.id),400);
  await files.tick();assert.equal(files.require('default',a.id).status,'ready');
  assert.match(files.require('default',a.id).text,/Primary source/);
  fail(()=>files.add('default','page.html',Buffer.from('<p>Disabled HTML</p>'),source.id),415);
  fail(()=>files.add('default','PAGE.HTML',Buffer.from('<p>Disabled HTML</p>'),source.id),415);
  const b=files.add('default','reference.txt',Buffer.from('Reference text é 😀'),source.id);
  await files.tick();const extracted=files.require('default',b.id);
  assert.equal(extracted.text,'Reference text é 😀');
  const c=files.add('default','empty.txt',Buffer.from('   '),source.id);
  await files.tick();assert.equal(files.require('default',c.id).status,'failed');
  assert.ok(existsSync(files.filename('default',c.id)));files.retry('default',c.id);assert.equal(files.require('default',c.id).status,'queued');
  files.remove('default',c.id);
  const backups=new VaultBackups(store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored');
  const restoredSource=knowledge.list(restored.id).find(e=>e.name==='Reference');
  const restoredFiles=knowledge.detail(restored.id,restoredSource.id).attachments;
  assert.equal(restoredFiles.length,2);assert.ok(restoredFiles.every(f=>f.status==='ready'));
  assert.notEqual(restoredFiles[0].id,a.id);assert.equal(restoredFiles.find(f=>f.name==='reference.txt').text,extracted.text);
  assert.deepEqual(readFileSync(files.filename(restored.id,restoredFiles.find(f=>f.name==='notes.md').id)),readFileSync(files.filename('default',a.id)));
  files.remove('default',a.id);assert.ok(!existsSync(files.filename('default',a.id)));
  fail(()=>files.remove('default',b.id),400);
  fail(()=>files.require(other.id,b.id),404);
  fail(()=>files.add('default','bad.pdf',Buffer.from('fake')),415);
  fail(()=>files.add('default','bad.exe',Buffer.from('binary')),415);
  fail(()=>files.add('default','bad.txt',Buffer.from([0,255])),415);
  fail(()=>files.add('default','../path.txt',Buffer.from('unsafe')),400);
 }finally{env.close();}
});
test('source HTTP actions enforce client headers, safe downloads, locks and restart recovery',async()=>{
 const env=fixture();let server=createApp(env.store,path.resolve('dist/client'));
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const headers={'X-Noema-Request':'1','X-Vault-Id':'default'};
 try {
  let response=await fetch(base+'/api/source-files?name=reference.txt',{method:'POST',body:'Original'});assert.equal(response.status,403);
  response=await fetch(base+'/api/source-files?name=page.html',{method:'POST',headers,body:'<p>Disabled</p>'});assert.equal(response.status,415);
  response=await fetch(base+'/api/source-files?name=reference.txt',{method:'POST',headers,body:'Original'});assert.equal(response.status,201);const file=await response.json();
  const source=env.knowledge.create('default',{name:'Text original',type:'source',attachmentIds:[file.id]});
  response=await fetch(base+'/api/source-files/'+file.id+'/download');assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(await response.text(),'Original');
  const other=env.vaults.create({name:'Other'});
  response=await fetch(base+'/api/source-files/'+file.id+'?vault='+other.id);assert.equal(response.status,404);
  env.vaults.lock('default',{passphrase:'test-lock'});
  response=await fetch(base+'/api/source-files/'+file.id);assert.equal(response.status,423);
  await env.files.tick();assert.equal(env.files.require('default',file.id).status,'queued');
  env.vaults.unlock('default',{passphrase:'test-lock'});
  env.store.run("UPDATE source_files SET status='processing' WHERE id=?",file.id);env.files.recover();assert.equal(env.files.require('default',file.id).status,'queued');
  await env.files.tick();assert.equal(env.knowledge.detail('default',source.id).attachments[0].text,'Original');
 }finally{await new Promise(resolve=>server.close(resolve));env.close();}
});
