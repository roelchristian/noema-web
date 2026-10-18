import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
const vector=(x=1,y=0)=>[x,y,...Array(1534).fill(0)];
const paragraph=text=>({id:'body',type:'paragraph',content:[{text}]});
function fixture(t){
 const directory=mkdtempSync(path.join(tmpdir(),'noema-source-suggestions-'));
 const db=openDatabase(path.join(directory,'test.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store),vault=vaults.create({name:'Suggestions'}).id;
 let calls=0;
 const worker=new Embeddings(store,pages,knowledge,vaults,{status:()=>({configured:false}),embed:()=>{calls++;throw Error('No provider calls allowed');}});
 const segments=new PageSegments(store),index=new PageSegmentIndex(store);
 let page=pages.create(vault,{title:'Algebra'});page=pages.update(vault,page.id,{...page,blocks:[paragraph('A field is an algebraic structure with multiplicative inverses.')]});segments.process(page.id);
 for(const segment of store.all('SELECT * FROM page_segments WHERE page_id=?',page.id))index.save(segment,vector(),10);
 function source(name,v=vector(),owner=vault){
  const file=new SourceFiles(store).add(owner,name+'.txt',Buffer.from('A source discussing algebraic structures and fields.'));
  const entity=knowledge.create(owner,{name,type:'source',attachmentIds:[file.id]});
  store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",'A source discussing algebraic structures and fields.',file.id);
  store.run('UPDATE entities SET inactive=0 WHERE id=?',entity.id);
  new SourcePassages(store).synchronize(owner);
  for(const passage of store.all('SELECT * FROM source_passages WHERE source_id=?',entity.id))store.run('INSERT INTO source_passage_embeddings (passage_id,model,dimensions,content_hash,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?)',passage.id,'text-embedding-3-small',1536,passage.content_hash,JSON.stringify(v),10,new Date().toISOString());
  return {id:entity.id,fileId:file.id};
 }
 t.after(()=>{worker.close();index.close();db.close();rmSync(directory,{recursive:true,force:true});});
 return {db,store,knowledge,pages,vaults,vault,worker,page,segments,index,source,calls:()=>calls};
}
test('saved vectors rank unique sources, exclude weak/attached/cross-vault matches, with no provider calls',t=>{
 const f=fixture(t),best=f.source('Best'),next=f.source('Next',vector(.8,.6)),weak=f.source('Weak',vector(0,1)),attached=f.source('Attached');
 const other=f.vaults.create({name:'Other'}).id;f.source('Other vault',vector(),other);
 f.pages.update(f.vault,f.page.id,{...f.page,sourceIds:[attached.id]});
 const results=f.worker.suggestedSources(f.vault,f.page.id);
 assert.deepEqual(results.map(r=>r.sourceId),[best.id,next.id]);assert.ok(results[0].excerpt);assert.equal(f.calls(),0);
 assert.equal(results.some(r=>r.sourceId===weak.id),false);
});
test('dismissals survive worker recreation and page edits, are page-specific, and reject foreign sources',t=>{
 const f=fixture(t),source=f.source('Related');
 assert.equal(f.worker.suggestedSources(f.vault,f.page.id).length,1);
 f.worker.dismissSource(f.vault,f.page.id,source.id);f.worker.dismissSource(f.vault,f.page.id,source.id);
 f.worker.close();const restarted=new Embeddings(f.store,f.pages,f.knowledge,f.vaults,{status:()=>({configured:false}),embed:()=>{throw Error('Unexpected API call');}});t.after(()=>restarted.close());
 assert.deepEqual(restarted.suggestedSources(f.vault,f.page.id),[]);
 const page=f.pages.create(f.vault,{title:'Another'});f.pages.update(f.vault,page.id,{...page,blocks:[paragraph('Another field note about algebraic structures and inverses.')]});f.segments.process(page.id);
 for(const segment of f.store.all('SELECT * FROM page_segments WHERE page_id=?',page.id))f.index.save(segment,vector(),10);
 assert.equal(restarted.suggestedSources(f.vault,page.id)[0].sourceId,source.id);
 const other=f.vaults.create({name:'Foreign'}).id,foreign=f.source('Foreign',vector(),other);
 assert.throws(()=>restarted.dismissSource(f.vault,page.id,foreign.id),/this vault/);
 f.vaults.lock(f.vault,{passphrase:'test-lock'});assert.throws(()=>restarted.suggestedSources(f.vault,page.id),/locked/);
});
test('missing, malformed and outdated embeddings do not become suggestions',t=>{
 const f=fixture(t),source=f.source('Related');
 f.store.run("UPDATE page_segment_embeddings SET vector='[1,2]'");assert.deepEqual(f.worker.suggestedSources(f.vault,f.page.id),[]);
 for(const segment of f.store.all('SELECT * FROM page_segments WHERE page_id=?',f.page.id))f.index.save(segment,vector(),10);
 f.store.run("UPDATE source_files SET text='A completely changed source with enough text for indexing.' WHERE id=?",source.fileId);
 assert.deepEqual(f.worker.suggestedSources(f.vault,f.page.id),[]);
 f.store.run('DELETE FROM page_segment_embeddings');assert.deepEqual(f.worker.suggestedSources(f.vault,f.page.id),[]);assert.equal(f.calls(),0);
});
function savedNote(f,title,v=vector(),owner=f.vault){
 let note=f.pages.create(owner,{title});
 note=f.pages.update(owner,note.id,{...note,blocks:[paragraph('A related note about algebraic structures, fields and inverses.')]});
 f.segments.process(note.id);
 for(const segment of f.store.all('SELECT * FROM page_segments WHERE page_id=?',note.id))f.index.save(segment,v,10);
 return note;
}
test('related notes rank saved vectors locally, limit to five, and exclude self, weak, deleted and foreign notes',t=>{
 const f=fixture(t),best=savedNote(f,'Best',vector(5,0)),next=savedNote(f,'Next',vector(8,6));
 for(let i=0;i<5;i++)savedNote(f,'More '+i,vector(.6,.8));
 savedNote(f,'Weak',vector(0,1));
 const deleted=savedNote(f,'Deleted');f.pages.delete(f.vault,deleted.id);
 savedNote(f,'Foreign',vector(),f.vaults.create({name:'Other'}).id);
 const results=f.worker.relatedNotes(f.vault,f.page.id);
 assert.equal(results.length,5);
 assert.deepEqual(results.slice(0,2).map(note=>note.pageId),[best.id,next.id]);
 assert.equal(new Set(results.map(note=>note.pageId)).size,5);
 assert.equal(results[0].title,'Best');assert.ok(results[0].excerpt);assert.equal(results[0].score,1);
 assert.equal(results.some(note=>[f.page.id,deleted.id].includes(note.pageId)),false);
 assert.equal(f.calls(),0);
});
test('related notes require current valid embeddings and respect vault access',t=>{
 const f=fixture(t),note=savedNote(f,'Related');
 assert.equal(f.worker.relatedNotes(f.vault,f.page.id).length,1);
 f.store.run("UPDATE page_segment_embeddings SET vector='[1,2]' WHERE segment_id IN (SELECT id FROM page_segments WHERE page_id=?)",note.id);
 assert.deepEqual(f.worker.relatedNotes(f.vault,f.page.id),[]);
 for(const segment of f.store.all('SELECT * FROM page_segments WHERE page_id=?',note.id))f.index.save(segment,vector(),10);
 f.pages.update(f.vault,note.id,{...note,blocks:[paragraph('Completely changed content now requires a new saved embedding.')]});
 assert.deepEqual(f.worker.relatedNotes(f.vault,f.page.id),[]);
 savedNote(f,'Another');
 f.store.run('DELETE FROM page_segment_embeddings WHERE segment_id IN (SELECT id FROM page_segments WHERE page_id=?)',f.page.id);
 assert.deepEqual(f.worker.relatedNotes(f.vault,f.page.id),[]);assert.equal(f.calls(),0);
 f.vaults.lock(f.vault,{passphrase:'test-lock'});
 assert.throws(()=>f.worker.relatedNotes(f.vault,f.page.id),/locked/);
});
