import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {PageSegments,pageSegmentReference} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
const paragraph=(id,text)=>({id,type:'paragraph',content:[{text}]});
const section=(id,title,body='Evidence supporting this section. '.repeat(12))=>[{id:`h-${id}`,type:'heading1',content:[{text:title}]},paragraph(`p-${id}`,body)];
function fixture(t,blocks=[...section('a','First'),...section('b','Second'),...section('c','Third')]) {
 const db=openDatabase(':memory:'),store=new Store(db),pages=new Pages(store,new Knowledge(store)),vault=new Vaults(store).create({name:'Incremental'}).id;
 store.run('INSERT INTO embedding_settings(vault_id,automatic,min_characters,page_policy) VALUES(?,0,20,?)',vault,JSON.stringify({smallTokens:100,mediumTokens:50000,targetTokens:800,overlapTokens:80,hysteresisTokens:0,debounceMs:5000}));
 const segments=new PageSegments(store),index=new PageSegmentIndex(store);
 let page=pages.create(vault,{title:'Stable evidence'});
 function update(blocks){page=pages.update(vault,page.id,{...page,blocks});segments.synchronize(vault,page.id);assert.equal(store.get('SELECT error FROM page_index_dirty WHERE page_id=?',page.id),undefined);return rows();}
 function rows(){return store.all('SELECT rowid AS physical_rowid,* FROM page_segments WHERE page_id=? ORDER BY ordinal',page.id);}
 update(blocks);assert.equal(rows().length,blocks.length/2);
 for(const row of rows())index.save(row,Array(1536).fill(0.01),12);
 db.exec(`CREATE TABLE segment_mutations(kind TEXT,id TEXT);
 CREATE TRIGGER count_segment_insert AFTER INSERT ON page_segments BEGIN INSERT INTO segment_mutations VALUES('insert',NEW.id); END;
 CREATE TRIGGER count_segment_delete AFTER DELETE ON page_segments BEGIN INSERT INTO segment_mutations VALUES('delete',OLD.id); END;
 CREATE TRIGGER count_segment_update AFTER UPDATE ON page_segments BEGIN INSERT INTO segment_mutations VALUES('update',NEW.id); END;
 CREATE TRIGGER count_segment_text AFTER UPDATE OF text,heading ON page_segments WHEN OLD.text IS NOT NEW.text OR OLD.heading IS NOT NEW.heading BEGIN INSERT INTO segment_mutations VALUES('text',NEW.id); END;
 CREATE TRIGGER count_vector_insert AFTER INSERT ON page_segment_embeddings BEGIN INSERT INTO segment_mutations VALUES('vector-insert',NEW.segment_id); END;
 CREATE TRIGGER count_vector_delete AFTER DELETE ON page_segment_embeddings BEGIN INSERT INTO segment_mutations VALUES('vector-delete',OLD.segment_id); END;
 CREATE TRIGGER count_vector_update AFTER UPDATE ON page_segment_embeddings BEGIN INSERT INTO segment_mutations VALUES('vector-update',NEW.segment_id); END;`);
 t.after(()=>db.close());
 return {db,store,pages,vault,segments,index,rows,update,get page(){return page;},clear(){store.run('DELETE FROM segment_mutations');},counts(){return Object.fromEntries(store.all('SELECT kind,count(*) AS n FROM segment_mutations GROUP BY kind').map(row=>[row.kind,row.n]));}};
}
test('editing one of three sections writes one replacement and preserves two physical rows and vector attachments',t=>{
 const f=fixture(t),before=f.rows();
 const next=f.update([...section('a','First','New evidence changes the first section. '.repeat(12)),...section('b','Second'),...section('c','Third')]);
 assert.deepEqual(f.counts(),{'delete':1,'insert':1,'update':2,'vector-delete':1});
 for(let i=1;i<3;i++) {
  assert.equal(next[i].id,before[i].id);assert.equal(next[i].physical_rowid,before[i].physical_rowid);
  assert.ok(f.store.get('SELECT 1 FROM page_segment_embeddings WHERE segment_id=?',next[i].id));
  const ref=pageSegmentReference(next[i]);assert.equal(ref.revision,f.page.revision);assert.equal(ref.excerpt,next[i].text);assert.ok(ref.blockIds.includes(`p-${i===1?'b':'c'}`));
  assert.equal(f.store.get('SELECT text FROM page_segments_fts WHERE rowid=?',next[i].physical_rowid).text,next[i].text);
 }
 f.clear();f.update([...section('a','First'),...section('b','Second'),...section('c','Third')]);
 assert.deepEqual(f.counts(),{'delete':1,'insert':1,'update':2,'vector-insert':1});
 assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings b JOIN page_segments s ON s.id=b.segment_id WHERE s.page_id=?',f.page.id).n,3,'Undo reattaches the cached first vector only');
});
test('section moves and unchanged saves retain row identity, attachments and searchable text',t=>{
 const f=fixture(t),before=f.rows();
 const moved=f.update([...section('b','Second'),...section('a','First'),...section('c','Third')]);
 assert.deepEqual(moved.map(row=>row.id),[before[1].id,before[0].id,before[2].id]);
 assert.deepEqual(Object.keys(f.counts()),['update']);
 assert.deepEqual(moved.map(row=>row.ordinal),[0,1,2]);
 assert.equal(f.store.get("SELECT count(*) AS n FROM page_segments_fts WHERE page_segments_fts MATCH 'supporting'").n,3);
 f.clear();f.update(f.page.blocks);assert.deepEqual(f.counts(),{update:3});
 f.clear();f.segments.synchronize(f.vault,f.page.id);assert.deepEqual(f.counts(),{});
});
test('splitting and merging sections replace only changed content and undo reuses historical vectors',t=>{
 const f=fixture(t),original=f.rows();
 f.update([...section('a','First'),...section('b','Second','The first split portion. '.repeat(8)),...section('split','Split','The second split portion. '.repeat(8)),...section('c','Third')]);
 assert.deepEqual(f.counts(),{'delete':1,'insert':2,'update':3,'vector-delete':1});
 assert.equal(f.rows()[0].id,original[0].id);assert.equal(f.rows()[3].id,original[2].id);
 f.clear();f.update([...section('a','First'),...section('b','Second'),...section('c','Third')]);
 assert.deepEqual(f.counts(),{'delete':2,'insert':1,'update':3,'vector-insert':1});
 assert.deepEqual(f.rows().map(row=>row.id),original.map(row=>row.id));
});
test('identical duplicate sections keep the surviving block anchor identity on deletion and insertion',t=>{
 const same='Identical duplicate body used to test stable anchors. '.repeat(12);
 const f=fixture(t,[...section('a','Duplicate',same),...section('b','Duplicate',same),...section('c','Third')]),before=f.rows();
 assert.equal(before[0].content_hash,before[1].content_hash);
 const remaining=f.update([...section('b','Duplicate',same),...section('c','Third')]);
 assert.equal(remaining[0].id,before[1].id);assert.equal(remaining[0].physical_rowid,before[1].physical_rowid);
 assert.deepEqual(f.counts(),{'delete':1,'update':4,'vector-delete':1});
 f.clear();const restored=f.update([...section('a','Duplicate',same),...section('b','Duplicate',same),...section('c','Third')]);
 assert.equal(restored[1].id,before[1].id);assert.equal(restored[0].id,before[0].id);
 assert.equal(f.counts()['vector-insert'],1);assert.equal(f.counts()['vector-delete'],undefined);
});
test('page deletion removes current segments, FTS and all retained vector variants',t=>{
 const f=fixture(t);f.pages.delete(f.vault,f.page.id);f.segments.synchronize(f.vault,f.page.id);
 assert.equal(f.rows().length,0);assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_cache WHERE page_id=?',f.page.id).n,0);
 assert.equal(f.store.get('SELECT count(*) AS n FROM page_segment_embeddings').n,0);
 assert.equal(f.store.get("SELECT count(*) AS n FROM page_segments_fts WHERE page_segments_fts MATCH 'supporting'").n,0);
 assert.equal(f.counts().delete,3);assert.equal(f.counts()['vector-delete'],3);
});
test('FTS ignores same-value text assignments and reference-only updates',t=>{
 const f=fixture(t),row=f.rows()[0];
 // Isolate FTS mutation counts from unrelated version and query invalidation triggers.
 for(const trigger of f.store.all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='page_segments' AND name<>'page_segments_fts_update'"))f.db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"','""')}"`);
 const total=()=>f.store.get('SELECT total_changes() AS n').n;
 let before=total();f.store.run('UPDATE page_segments SET text=text,heading=heading WHERE id=?',row.id);assert.equal(total()-before,1);
 before=total();f.store.run('UPDATE page_segments SET revision=revision+1 WHERE id=?',row.id);assert.equal(total()-before,1);
});
test('same provider hash refreshes nested headings beyond the bounded context',t=>{
 const prefix='Longheading '.repeat(100),child=section('b','Child');child[0].type='heading2';
 const f=fixture(t,[...section('a',prefix+'Oldend'),...child]),before=f.rows()[1];
 f.clear();const next=f.update([...section('a',prefix+'Newend'),...child])[1];
 assert.equal(next.content_hash,before.content_hash);assert.equal(next.id,before.id);
 assert.notEqual(next.heading,before.heading);assert.ok(next.heading.endsWith('Newend > Child'));
 assert.equal(f.counts().text,1);assert.equal(f.counts()['vector-delete'],1);assert.equal(f.counts()['vector-insert'],undefined);
 assert.ok(f.store.get('SELECT 1 FROM page_segment_embeddings WHERE segment_id=?',next.id));
 assert.equal(f.store.get('SELECT heading FROM page_segments_fts WHERE rowid=?',next.physical_rowid).heading,next.heading);
});
