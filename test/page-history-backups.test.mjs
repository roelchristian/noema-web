import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Images} from '../src/server/modules/images.ts';
import {PageHistory,historyHash} from '../src/server/modules/page-history.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {sourceTextHash} from '../src/server/modules/source-math-text.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
function fixture() {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-history-backup-')),db=openDatabase(path.join(directory,'noema.sqlite')),store=new Store(db);
 const vault=new Vaults(store).create({name:'Synthetic history'}),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),images=new Images(store),history=new PageHistory(store),backups=new VaultBackups(store);
 return {store,vault,knowledge,pages,images,history,backups,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function archive(bytes){return JSON.parse(gunzipSync(bytes).toString());}
function rewrite(bytes,fn){const data=archive(bytes);fn(data);return gzipSync(JSON.stringify(data));}

test('historical-only images survive cleanup and portable backup with checkpoint/restore evidence',async()=>{
 const s=fixture();try {
  const image=s.images.add(s.vault.id,png),entity=s.knowledge.create(s.vault.id,{name:'Synthetic reference',type:'concept'});
  let page=s.pages.create(s.vault.id,{title:'History with image'});
  page=s.pages.update(s.vault.id,page.id,{...page,featuredImageId:image.id,blocks:[{id:'picture',type:'image',checked:false,content:[],imageId:image.id},{id:'text',type:'paragraph',checked:false,content:[{entityId:entity.id,mentionText:'synthetic reference'}]}]});
  const checkpoint=s.history.checkpoint(s.vault.id,page.id,{revision:page.revision,name:'Image checkpoint'});
  page=s.pages.update(s.vault.id,page.id,{...page,featuredImageId:null,blocks:[{id:'later',type:'paragraph',checked:false,content:[{text:'Later state'}]}]});
  assert.equal(s.images.cleanup(s.vault.id,[image.id]),0);
  assert.deepEqual(s.images.get(s.vault.id,image.id).bytes,png);
  page=s.history.restore(s.vault.id,page.id,checkpoint.id,{revision:page.revision},s.pages);
  page=s.pages.update(s.vault.id,page.id,{...page,featuredImageId:null,blocks:[{id:'latest',type:'paragraph',checked:false,content:[{text:'Current without image'}]}]});
  const copied=s.history.copy(s.vault.id,page.id,checkpoint.id,{revision:page.revision},s.pages);
  // Copy is also stripped so the archived image is exclusively historical.
  s.pages.update(s.vault.id,copied.id,{...copied,featuredImageId:null,blocks:[{id:'copy',type:'paragraph',checked:false,content:[]}]});
  const exported=await s.backups.export(s.vault.id),data=archive(exported.bytes);
  assert.equal(data.images.length,1);assert.ok(data.tables.page_versions.length>=7);
  const restored=await s.backups.import(exported.bytes,'Imported history'),restoredPage=s.pages.list(restored.id).find(p=>s.history.list(restored.id,p.id).some(v=>v.name==='Image checkpoint'));
  const versions=s.history.list(restored.id,restoredPage.id),named=versions.find(v=>v.name==='Image checkpoint'),detail=s.history.get(restored.id,restoredPage.id,named.id);
  assert.notEqual(named.id,checkpoint.id);assert.equal(named.pinned,true);
  assert.notEqual(detail.snapshot.featuredImageId,image.id);assert.deepEqual(s.images.get(restored.id,detail.snapshot.featuredImageId).bytes,png);
  assert.notEqual(detail.snapshot.blocks[1].content[0].entityId,entity.id);
  assert.ok(versions.some(v=>v.kind==='restore'&&v.restoredFromVersionId===named.id));
  assert.equal(s.images.cleanup(restored.id,[detail.snapshot.featuredImageId]),0);
  assert.deepEqual(s.store.all('PRAGMA foreign_key_check'),[]);
 }finally{s.close();}
});

test('historical deleted targets stay detached across versions and legacy archives invent no history',async()=>{
 const s=fixture();try {
  const entity=s.knowledge.create(s.vault.id,{name:'Temporary target',type:'concept'});let page=s.pages.create(s.vault.id,{title:'Detached evidence'});
  page=s.pages.update(s.vault.id,page.id,{...page,blocks:[{id:'mention',type:'paragraph',checked:false,content:[{entityId:entity.id,mentionText:'original words'}]}]});
  s.history.checkpoint(s.vault.id,page.id,{revision:page.revision,name:'Before deletion'});
  s.pages.update(s.vault.id,page.id,{...page,blocks:[{id:'current',type:'paragraph',checked:false,content:[]}]});
  s.store.run('DELETE FROM entities WHERE id=?',entity.id);
  const exported=await s.backups.export(s.vault.id),restored=await s.backups.import(exported.bytes),newPage=s.pages.list(restored.id)[0];
  const snapshots=s.history.list(restored.id,newPage.id).map(v=>s.history.get(restored.id,newPage.id,v.id).snapshot).filter(p=>p.blocks[0].id==='mention');
  assert.equal(snapshots.length,2);assert.equal(snapshots[0].blocks[0].content[0].entityId,snapshots[1].blocks[0].content[0].entityId);
  assert.notEqual(snapshots[0].blocks[0].content[0].entityId,entity.id);assert.equal(s.knowledge.list(restored.id).length,0);
  const legacy=await s.backups.import(rewrite(exported.bytes,data=>delete data.tables.page_versions));
  assert.equal(s.history.list(legacy.id,s.pages.list(legacy.id)[0].id).length,0);
 }finally{s.close();}
});

test('invalid historical snapshot rolls back imported rows and newly written historical image assets',async()=>{
 const s=fixture();try {
  const image=s.images.add(s.vault.id,png);let page=s.pages.create(s.vault.id,{title:'Atomic archive'});
  page=s.pages.update(s.vault.id,page.id,{...page,blocks:[{id:'image',type:'image',checked:false,content:[],imageId:image.id}]});
  s.pages.update(s.vault.id,page.id,{...page,blocks:[{id:'empty',type:'paragraph',checked:false,content:[]}]});
  const exported=await s.backups.export(s.vault.id),before=s.store.get('SELECT count(*) AS count FROM vaults').count;
  const corrupt=rewrite(exported.bytes,data=>{const row=data.tables.page_versions.at(-1),snapshot=JSON.parse(row.snapshot_json);snapshot.blocks[0].type='invalid';row.snapshot_json=JSON.stringify(snapshot);row.content_hash=historyHash(snapshot);});
  await assert.rejects(()=>s.backups.import(corrupt),error=>error.status===400);
  assert.equal(s.store.get('SELECT count(*) AS count FROM vaults').count,before);assert.deepEqual(s.store.all('PRAGMA foreign_key_check'),[]);
 }finally{s.close();}
});


test('reading-note anchors and stable inline citations survive historical backup and copied-page restoration',async()=>{
 const s=fixture();try {
  const files=new SourceFiles(s.store),content='Synthetic evidence for reading history.',file=files.add(s.vault.id,'evidence.txt',Buffer.from(content));
  const source=s.knowledge.create(s.vault.id,{name:'Synthetic source',type:'source',attachmentIds:[file.id]});
  s.store.run("UPDATE source_files SET text=?,status='ready',admitted=1 WHERE id=?",content,file.id);
  let page=new SourceReading(s.store).createReadingNote(s.vault.id,file.id,{sourceId:source.id,fileId:file.id,sourceHash:sourceTextHash(content),startOffset:0,endOffset:content.length,excerpt:content,text:'A short reading note'});
  const reference=JSON.parse(s.store.get('SELECT reference_json FROM page_reading_notes WHERE page_id=?',page.id).reference_json);
  reference.generationId='synthetic-old-generation';reference.passageId='synthetic-old-passage';
  s.store.run('UPDATE page_reading_notes SET reference_json=? WHERE page_id=?',JSON.stringify(reference),page.id);
  page=s.pages.update(s.vault.id,page.id,{...page,blocks:[{id:'citation',type:'paragraph',checked:false,content:[{text:'Evidence',sourceReference:reference}]}]});
  const checkpoint=s.history.checkpoint(s.vault.id,page.id,{revision:page.revision,name:'Reading evidence'});
  const exported=await s.backups.export(s.vault.id),restored=await s.backups.import(exported.bytes),newPage=s.pages.list(restored.id)[0];
  const named=s.history.list(restored.id,newPage.id).find(v=>v.name==='Reading evidence'),snapshot=s.history.get(restored.id,newPage.id,named.id).snapshot;
  assert.notEqual(snapshot.readingNote.sourceId,source.id);assert.notEqual(snapshot.readingNote.fileId,file.id);
  assert.equal(snapshot.readingNote.reference.sourceId,snapshot.readingNote.sourceId);assert.equal(snapshot.readingNote.reference.fileId,snapshot.readingNote.fileId);
  const current=s.pages.get(restored.id,newPage.id);
  assert.equal(current.blocks[0].content[0].sourceReference.id,snapshot.blocks[0].content[0].sourceReference.id);
  const currentAnchor=JSON.parse(s.store.get('SELECT reference_json FROM page_reading_notes WHERE page_id=?',newPage.id).reference_json);
  assert.equal(currentAnchor.id,snapshot.readingNote.reference.id);
  for(const key of ['generationId','passageId']) {
    const mapped=snapshot.blocks[0].content[0].sourceReference[key];
    assert.notEqual(mapped,reference[key]);assert.match(mapped,/^[a-f0-9-]{36}$/);
    assert.equal(current.blocks[0].content[0].sourceReference[key],mapped);
    assert.equal(currentAnchor[key],mapped);assert.equal(snapshot.readingNote.reference[key],mapped);
  }
  assert.equal(snapshot.blocks[0].content[0].sourceReference.fileId,snapshot.readingNote.fileId);
  assert.equal(snapshot.blocks[0].content[0].sourceReference.sourceId,snapshot.readingNote.sourceId);
  const copied=s.history.copy(restored.id,newPage.id,named.id,{revision:s.pages.get(restored.id,newPage.id).revision},s.pages);
  assert.equal(copied.readingNote.fileId,snapshot.readingNote.fileId);assert.equal(copied.readingNote.excerpt,content);
  assert.notEqual(named.id,checkpoint.id);assert.deepEqual(s.store.all('PRAGMA foreign_key_check'),[]);
 }finally{s.close();}
});
