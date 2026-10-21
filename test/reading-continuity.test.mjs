import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createReadingAnchor,resolveReadingAnchor,canonicalReadingOffset,rawReadingOffset} from '../src/shared/reading-continuity.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceLifecycleService} from '../src/server/modules/source-lifecycle.ts';
import {processedSourceDocument} from '../src/server/modules/source-document.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {sourceTextHash} from '../src/server/modules/source-math-text.ts';
import {createApp} from '../src/server/http.ts';

test('revision reconciliation uses quote and context, never stale offsets or IDs',()=>{
 const passage='A unique synthetic theorem about numbered triangles. '.repeat(5);
 const raw='Opening context.\r\n\r\n'+passage+'\r\nClosing context.';
 const anchor=createReadingAnchor('file','v1',raw,raw.indexOf(passage));
 assert.equal(rawReadingOffset(raw,canonicalReadingOffset(raw,20)),20);
 assert.equal(resolveReadingAnchor(anchor,raw,'v1').offset,anchor.offset);
 const revised='Inserted preface.\n'+raw;
 assert.equal(resolveReadingAnchor({...anchor,nodeId:'reused-id'},revised,'v2').offset,anchor.offset+18);
 assert.equal(resolveReadingAnchor(anchor,'Unrelated replacement text.','v2').status,'unresolved');
 // The entire original context is repeated, so even the context cannot decide.
 assert.equal(resolveReadingAnchor(anchor,raw+'\n'+raw,'v2').status,'ambiguous');
 const context='a'.repeat(70)+'Unique context distinguishes the same quoted synthetic passage. '.repeat(4)+'b'.repeat(70);
 const a=createReadingAnchor('file','v1',context,70);
 assert.equal(resolveReadingAnchor(a,context+'\n'+a.quote,'v2').offset,70);
 const short=createReadingAnchor('file','v1','Tiny',0);
 assert.equal(resolveReadingAnchor(short,'Tiny and different','v2').status,'unresolved');
 const eof=createReadingAnchor('file','v1',raw,raw.length,undefined,true);
 assert.ok(eof.quote);assert.equal(eof.atEnd,true);
});

test('HTTP resume/bookmark CRUD survives database and server restart; revisions, backups and deletion remain safe',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-continuity-')),filename=path.join(directory,'db.sqlite');
 let db=openDatabase(filename),store=new Store(db),files=new SourceFiles(store),server;
 let content='# Synthetic source\n\n'+Array.from({length:8},(_,i)=>`## Section ${i+1}\n\nSynthetic passage ${i+1} proves a distinct statement using local fictional examples and numbered triangles.\n\n`).join('');
 const file=files.add('default','continuity.md',Buffer.from(content)),source=new Knowledge(store).create('default',{name:'Synthetic source',type:'source',attachmentIds:[file.id]});
 await files.tick();content=files.require('default',file.id).text;
 async function start(){server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
 let base=await start();
 const route='/api/source-files/'+file.id+'/reading-locations',headers={'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':'default'};
 const send=async(method,suffix='',body,customHeaders=headers)=>fetch(base+route+suffix,{method,headers:customHeaders,body:body===undefined?undefined:JSON.stringify(body)});
 const revision=sourceTextHash(content),offset=content.indexOf('Synthetic passage 5'),id=randomUUID();
 try{
  assert.equal((await send('PUT','/resume',{revision,offset})).status,200);
  assert.equal((await send('PUT','/'+id,{revision,offset,label:'Proof to revisit'})).status,200);
  assert.equal((await send('PUT','/'+randomUUID(),{revision:'stale',offset})).status,409);
  assert.equal((await send('PUT','/'+randomUUID(),{revision,offset:-1})).status,400);
  assert.equal((await send('PUT','/'+randomUUID(),{revision,offset,label:'x'.repeat(81)})).status,400);
  const other=new Vaults(store).create({name:'Other fixture vault'});
  assert.equal((await send('GET','',undefined,{...headers,'X-Vault-Id':other.id})).status,404);
  new Vaults(store).lock('default',{passphrase:'fixture-only'});assert.equal((await send('GET')).status,423);new Vaults(store).unlock('default',{passphrase:'fixture-only'});
  await new Promise(resolve=>server.close(resolve));files.close();db.close();
  db=openDatabase(filename);store=new Store(db);files=new SourceFiles(store);base=await start();
  let saved=await (await send('GET')).json();assert.equal(saved.resume.anchor.offset,offset);assert.equal(saved.bookmarks[0].label,'Proof to revisit');assert.equal(saved.bookmarks[0].resolution.status,'resolved');
  assert.equal((await send('PATCH','/'+id,{label:'Renamed proof'})).status,200);
  saved=await (await send('GET')).json();assert.equal(saved.bookmarks[0].label,'Renamed proof');
  const backups=new VaultBackups(store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored fixture');
  const restoredFile=new Knowledge(store).detail(restored.id,new Knowledge(store).list(restored.id).find(e=>e.name==='Synthetic source').id).attachments[0];
  const restoredReading=new SourceReading(store).continuity(restored.id,restoredFile.id);
  assert.equal(restoredReading.bookmarks[0].label,'Renamed proof');assert.equal(restoredReading.bookmarks[0].anchor.fileId,restoredFile.id);assert.equal(restoredReading.resume.resolution.status,'resolved');
  store.run('UPDATE source_files SET text=? WHERE id=?','New preface.\n'+content,file.id);
  saved=await (await send('GET')).json();assert.equal(saved.bookmarks[0].resolution.offset,offset+13);
  store.run('UPDATE source_files SET text=? WHERE id=?',content+'\n'+content,file.id);
  saved=await (await send('GET')).json();assert.equal(saved.bookmarks[0].resolution.status,'ambiguous');
  store.run('UPDATE source_files SET text=? WHERE id=?','Entirely different text.',file.id);
  saved=await (await send('GET')).json();assert.equal(saved.resume.resolution.status,'unresolved');assert.equal(saved.bookmarks[0].anchor.revision,revision);
  assert.equal((await send('DELETE','/'+id)).status,200);assert.deepEqual((await (await send('GET')).json()).bookmarks,[]);
  const lifecycle=new SourceLifecycleService(store);lifecycle.archive('default',source.id);lifecycle.delete('default',source.id,source.name);
  assert.equal((await send('GET')).status,404);
  assert.equal(store.get('SELECT count(*) AS n FROM source_reading_locations WHERE file_id=?',file.id).n,0);
 }finally{await new Promise(resolve=>server.close(resolve));files.close();db.close();rmSync(directory,{recursive:true,force:true});}
});

test('only recorded physical pages enter anchors; CRLF coordinates and section restructuring are independent of IDs',()=>{
 const raw='Chapter one\r\nFirst passage.\r\n\r\nChapter two\r\nSecond passage with enough evidence for a stable anchor.\r\n\r\nChapter three\r\nLast passage.';
 const file={id:'synthetic.pdf',name:'Synthetic PDF',text:raw,format:'pdf',pages:3,page_start_lines:'[1,4,7]',structural_nodes:'[]',enrichment_status:'completed'};
 const document=processedSourceDocument(file),offset=raw.indexOf('Second passage'),anchor=createReadingAnchor(file.id,'v1',raw,offset,document);
 assert.equal(anchor.physicalPage,2);assert.ok(anchor.nodeId);assert.equal(anchor.offset,canonicalReadingOffset(raw,offset));
 const changed=raw.replace('Chapter one','An expanded introductory section');
 assert.equal(resolveReadingAnchor(anchor,changed,'v2').offset,canonicalReadingOffset(changed,changed.indexOf('Second passage')));
 const unpaged=processedSourceDocument({...file,format:'txt',pages:0,page_start_lines:'[]'});
 assert.equal(createReadingAnchor(file.id,'v1',raw,offset,unpaged).physicalPage,undefined);
});
