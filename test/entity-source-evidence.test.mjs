import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {sourceTextHash} from '../src/server/modules/source-math-text.ts';
import {entitySourceEvidence} from '../src/server/modules/entity-source-evidence.ts';
const block=(content,id=randomUUID())=>({id,type:'paragraph',checked:false,content});
function fixture(t,name='Ada',aliases=['Countess']) {
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store),vault=vaults.create({name:'Evidence'}).id;
 const entity=knowledge.create(vault,{name,type:'person',aliases});
 t.after(()=>db.close());
 const source=(text,owner=vault)=>{
  const file=new SourceFiles(store).add(owner,'Evidence.txt',Buffer.from(text));
  const entity=knowledge.create(owner,{name:'Evidence source',type:'source',attachmentIds:[file.id]});
  store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",text,file.id);
  store.run('UPDATE entities SET inactive=0 WHERE id=?',entity.id);new SourcePassages(store).synchronize(owner);
  const ref={id:randomUUID(),sourceId:entity.id,fileId:file.id,sourceHash:sourceTextHash(text),excerpt:text,startOffset:0,endOffset:text.length,startLine:1,endLine:text.split('\n').length};
  return {file,entity,ref};
 };
 const page=(blocks)=>{let page=pages.create(vault,{title:'Evidence page'});return pages.update(vault,page.id,{...page,blocks});};
 const evidence=(opts)=>entitySourceEvidence(store,vault,entity.id,opts),passages=(opts)=>evidence(opts).groups.flatMap(group=>group.passages);
 return {store,knowledge,pages,vaults,vault,entity,source,page,evidence,passages};
}
test('source canonical and alias phrases use Unicode boundaries and safe literal FTS',t=>{
 const f=fixture(t,'Émilie',['Ada','x" OR "anything','C++']);
 f.source('Émilie, Ada and Ada discuss C++ together.');f.source('Adaline is unrelated.');
 assert.equal(f.passages().length,1);assert.equal(f.passages()[0].reason,'source-mention');
 const unicode=fixture(t,'科学',['量子力学']);unicode.source('科学。量子力学。');assert.equal(unicode.passages().length,1);
 const hostile=fixture(t,'" NOT *',['a(b)[c]']);hostile.source('Plain unrelated content.');assert.deepEqual(hostile.passages(),[]);
});
test('citations require the same block or table cell and merge page provenance',t=>{
 const f=fixture(t),source=f.source('Historical evidence unrelated to entity names.');
 const mention={entityId:f.entity.id},citation={text:'[1]',sourceReference:source.ref};
 const first=f.page([block([mention,citation])]);const second=f.page([block([mention,{...citation,sourceReference:{...source.ref,id:randomUUID()}}])]);
 f.page([block([mention]),block([citation])]);
 f.page([{...block([]),type:'table',rows:[[[mention],[citation]]]}]);
 const results=f.passages();assert.equal(results.length,1);assert.deepEqual(new Set(results[0].pageIds),new Set([first.id,second.id]));assert.equal(results[0].stale,false);
 // An explicit association alone does not make all of the page's citations relevant.
 const unrelated=f.page([block([citation])]);f.knowledge.associatePage(f.vault,f.entity.id,unrelated.id,{});
 assert.deepEqual(new Set(f.passages()[0].pageIds),new Set([first.id,second.id]));
});
test('associated reading anchors and matching highlights preserve their precise reasons',t=>{
 const f=fixture(t),source=f.source('Ada studied this excerpt.');
 const page=f.page([block([{text:'Reading note without a tag'}])]);f.knowledge.associatePage(f.vault,f.entity.id,page.id,{});
 f.store.run('INSERT INTO page_reading_notes (page_id,vault_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',page.id,f.vault,source.entity.id,source.file.id,source.ref.sourceHash,0,source.ref.endOffset,source.ref.excerpt,JSON.stringify(source.ref),'2026-10-22');
 f.store.run('INSERT INTO highlights (id,vault_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,color,reference_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),f.vault,source.entity.id,source.file.id,source.ref.sourceHash,0,source.ref.endOffset,source.ref.excerpt,'yellow',JSON.stringify(source.ref),'2026-10-22');
 const result=f.passages();assert.equal(result.length,1);assert.deepEqual(result[0].reasons,['reading-note','highlight','source-mention']);assert.deepEqual(result[0].pageIds,[page.id]);
 f.store.run('UPDATE pages SET deleted_at=? WHERE id=?','2026-10-22',page.id);assert.deepEqual(f.passages()[0].pageIds,[]);
});
test('historical citations are marked stale while unready direct search and foreign sources are excluded',t=>{
 const f=fixture(t),source=f.source('Ada appears here.');f.page([block([{entityId:f.entity.id},{text:'[1]',sourceReference:source.ref}])]);
 f.store.run("UPDATE source_files SET status='processing',text='Replacement text' WHERE id=?",source.file.id);
 const result=f.passages();assert.equal(result.length,1);assert.equal(result[0].stale,true);assert.equal(result[0].reference.stale,true);assert.deepEqual(result[0].reasons,['citation']);assert.equal(result[0].reference.excerpt,'Ada appears here.');
 const other=f.vaults.create({name:'Other'}).id;const foreign=f.source('Ada elsewhere.',other);const forged=f.page([block([{entityId:f.entity.id}])]);f.store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify([block([{entityId:f.entity.id},{text:'[2]',sourceReference:foreign.ref}])]),forged.id);assert.equal(f.passages().length,1);
 f.store.run('UPDATE source_files SET admitted=0 WHERE id=?',source.file.id);assert.deepEqual(f.passages(),[]);
 f.vaults.lock(f.vault,{passphrase:'lock'});assert.throws(()=>f.evidence(),/locked/);
});
test('stable pagination returns each bounded passage exactly once',t=>{
 const f=fixture(t);for(let i=0;i<5;i++)f.source(`Ada appears in source ${i}.`);
 const first=f.evidence({limit:2});assert.equal(first.hasMore,true);assert.equal(first.nextOffset,2);
 const second=f.evidence({offset:first.nextOffset,limit:2}),third=f.evidence({offset:second.nextOffset,limit:2});
 assert.equal(third.hasMore,false);assert.equal(third.nextOffset,undefined);assert.equal(third.truncated,false);
 const ids=[first,second,third].flatMap(result=>result.groups.flatMap(group=>group.passages.map(p=>p.id)));assert.equal(new Set(ids).size,5);
});
test('inactive saved evidence survives as stale and invalid coordinates never appear precise',t=>{
 const f=fixture(t),source=f.source('Historical excerpt.');
 const page=f.page([block([{entityId:f.entity.id},{text:'[1]',sourceReference:source.ref}])]);
 f.store.run('UPDATE entities SET inactive=1 WHERE id=?',source.entity.id);
 assert.equal(f.passages().length,1);assert.equal(f.passages()[0].stale,true);
 f.store.run('UPDATE entities SET inactive=0 WHERE id=?',source.entity.id);
 const invalid={...source.ref,startOffset:10000,endOffset:10019};
 f.store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify([block([{entityId:f.entity.id},{text:'[1]',sourceReference:invalid}])]),page.id);
 assert.equal(f.passages()[0].stale,true);
 const wrongExcerpt={...source.ref,excerpt:'An invented historical excerpt.'};
 f.store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify([block([{entityId:f.entity.id},{text:'[1]',sourceReference:wrongExcerpt}])]),page.id);
 assert.equal(f.passages()[0].stale,true);
});
test('large saved excerpts become bounded current subranges and bounded stale previews',t=>{
 const f=fixture(t),source=f.source('A historical excerpt with many details. '.repeat(600));
 f.page([block([{entityId:f.entity.id},{text:'[1]',sourceReference:source.ref}])]);
 let passage=f.passages().find(p=>p.reason==='citation');
 assert.equal(passage.excerptTruncated,true);assert.equal(passage.stale,false);assert.ok(passage.reference.excerpt.length<=6500);
 assert.equal(passage.reference.endOffset,passage.reference.startOffset+passage.reference.excerpt.length);
 assert.equal(source.ref.excerpt.slice(passage.reference.startOffset,passage.reference.endOffset),passage.reference.excerpt);
 f.store.run("UPDATE source_files SET text='Replacement historical text' WHERE id=?",source.file.id);
 passage=f.passages().find(p=>p.reason==='citation');assert.equal(passage.stale,true);assert.equal(passage.reference.endOffset,source.ref.endOffset);assert.ok(passage.reference.excerpt.length<=6500);
});
test('both raw and cleaned math source revisions remain valid evidence',t=>{
 const f=fixture(t),source=f.source('Ada wrote x squared.');const cleaned='Ada wrote $x^2$.';
 f.page([block([{entityId:f.entity.id},{text:'[1]',sourceReference:source.ref}])]);
 f.store.run('INSERT INTO source_math_documents (file_id,raw_hash,cleaned_text,uncertainty_json,updated_at,algorithm_version) VALUES (?,?,?,?,?,2)',source.file.id,source.ref.sourceHash,cleaned,'[]','2026-10-22');f.store.run('INSERT OR IGNORE INTO source_passage_dirty(file_id,vault_id) VALUES(?,?)',source.file.id,f.vault);
 const results=f.passages();assert.equal(results.length,2);assert.ok(results.every(p=>!p.stale));assert.ok(results.some(p=>p.reference.sourceHash===sourceTextHash(cleaned)));
});

test('Overview evidence is a bounded read-only window and does not synchronize the source index',t=>{
 const f=fixture(t);const source=f.source('Ada is a synthetic name.');
 f.page([block([{entityId:f.entity.id},{text:'[1]',sourceReference:source.ref}])]);
 const before=f.store.get('SELECT total_changes() AS n').n;
 const result=f.evidence({preview:true});assert.equal(result.groups.length,1);assert.deepEqual(result.groups[0].passages[0].reasons,['citation','source-mention']);
 assert.equal(f.store.get('SELECT total_changes() AS n').n,before);
 for(let i=0;i<8;i++)f.source('Ada in another synthetic source '+i);
 assert.ok(f.evidence({preview:true}).groups.flatMap(group=>group.passages).length<=6);
});
