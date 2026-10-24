import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {gzipSync,gunzipSync} from 'node:zlib';
import {extractTemporal,temporalDate,temporalBounds,temporalDisplay,temporalOverlaps} from '../src/shared/temporal.ts';
import {validateTemporalReference} from '../src/client/search/temporal-navigation.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultDeletion} from '../src/server/modules/vault-deletion.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {createApp} from '../src/server/http.ts';

const block=(id,text,type='paragraph')=>({id,type,checked:false,content:[{text}]});
function fixture(t,filename=':memory:') {
 const db=openDatabase(filename),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Temporal test'}),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),index=new TemporalIndex(store);
 t.after(()=>db.close());
 const create=(blocks=[block('first','23 October 2026')])=>{const page=pages.create(vault.id,{title:'Temporal note'});return pages.update(vault.id,page.id,{...page,blocks});};
 return {db,store,vaults,vault,knowledge,pages,index,create};
}
const values=text=>extractTemporal(text).map(item=>item.date?.value??null);
const query=(index,vault,all=true)=>index.query(vault,'2026-10-01','2026-10-31',all);

test('English dates retain day/month/year precision and Gregorian or Julian identity',()=>{
 const expressions=extractTemporal('23 October 2026; October 2026; in 1848; March 12, 1861; 25 October 1917 (Old Style)');
 assert.deepEqual(expressions.map(item=>[item.date.value,item.date.precision,item.date.calendar]),[
  ['2026-10-23','day','gregorian'],['2026-10','month','gregorian'],['1848','year','gregorian'],['1861-03-12','day','gregorian'],['1917-10-25','day','julian'],
 ]);
 assert.deepEqual(values('23rd October 2026; October 23rd, 2026'),['2026-10-23','2026-10-23']);
 assert.equal(extractTemporal('in 1848 (Old Style)')[0].date.calendar,'julian');
 assert.equal(extractTemporal('1848 (Julian)')[0].text,'1848 (Julian)');
 assert.deepEqual(values('23 October 202600; October 2026abc'),[]);
 assert.equal(temporalDate('2026-10').id,'gregorian:month:2026-10');
 assert.equal(temporalDate('1900-02-29'),null);
 assert.equal(temporalDate('1900-02-29','julian').precision,'day');
 assert.equal(temporalDate('2000-02-29').precision,'day');
 for(const value of ['0000','2026-00','2026-13','2026-02-30','2026-01-00','2026-1-2'])assert.equal(temporalDate(value),null,value);
 assert.equal(temporalOverlaps(temporalDate('2026'),'2026-10-01','2026-10-31'),true);
 assert.equal(temporalOverlaps(temporalDate('2026-10'),'2026-11-01','2026-11-30'),false);
});

test('ambiguous, invalid, approximate, relative and unsupported chronology never leaks inner dates',()=>{
 for(const text of ['03/04/2026','2026-10-23','next Thursday','early eighteenth century','circa 23 October 2026','October 2026?','31 February 2026','23th October 2026','123 October 2026','about 23rd October 2026','October 23rd, 2026?','23 October 2026 (Hebrew)','in 1848 (Hijri)','25 October 1917 (O.S.)']) {
  const expressions=extractTemporal(text);assert.equal(expressions.length,1,text);assert.equal(expressions[0].date,null,text);assert.ok(expressions[0].reason,text);
 }
 assert.deepEqual(values('See item 1848 and page 2026'),[]);
 assert.deepEqual(values('1848'),['1848']);
 assert.deepEqual(values('in 1848 and in 2026'),['1848','2026']);
});

test('saved pages enqueue cheap dirty IDs; extraction deduplicates identity but retains occurrences and precise navigation',t=>{
 const {index,store,vault,create,pages}=fixture(t);
 const page=create([block('first','😀 23 October 2026 and 23 October 2026'),block('second','October 2026; in 2026'),block('code','23 October 2026','code')]);
 assert.equal(store.get('SELECT count(*) n FROM temporal_mentions').n,0);
 assert.equal(store.get('SELECT count(*) n FROM temporal_dirty WHERE page_id=?',page.id).n,1);
 const result=query(index,vault.id);assert.equal(result.items.length,3);assert.equal(result.indexing.pending,0);
 assert.equal(query(index,vault.id,false).items.length,0,'incidental mentions do not become calendar commitments');
 assert.equal(store.get('SELECT count(*) n FROM temporal_relations').n,0);
 const evidence=index.pageEvidence(vault.id,page.id);assert.equal(evidence.length,4);
 const day=evidence.filter(item=>item.dateId==='gregorian:day:2026-10-23');assert.equal(day.length,2);assert.notEqual(day[0].id,day[1].id);
 assert.equal(day[0].evidence.reference.startOffset,3);
 for(const item of evidence)assert.equal(validateTemporalReference(item.evidence.reference,page,[]),true);
 assert.deepEqual(index.pageEvidence(vault.id,page.id).map(item=>item.id),evidence.map(item=>item.id));
 assert.equal(store.get('SELECT count(*) n FROM temporal_mentions').n,4);
 const changed=pages.update(vault.id,page.id,{...page,blocks:[block('inserted','Introduction'),...page.blocks]});
 assert.equal(index.resolve(vault.id,day[1].id).status,'stale');
 assert.equal(validateTemporalReference(day[1].evidence.reference,changed,[]),false);
 const snapshot=index.prepare(vault.id,page.id);assert.equal(snapshot.blocks.find(item=>item.id==='first').expressions,null,'unchanged blocks skip parsing');
 assert.equal(index.commit(snapshot),true);
 const refreshed=index.resolve(vault.id,day[1].id);assert.equal(refreshed.status,'current');assert.equal(refreshed.reference.startOffset,day[1].evidence.reference.startOffset+'Introduction\n'.length);
 assert.equal(validateTemporalReference(refreshed.reference,changed,[]),true);
 assert.equal(validateTemporalReference({...refreshed.reference,blockId:'other'},changed,[]),false);
});

test('changed and removed blocks retain stale evidence without a repeated-text fallback; curation and manual relations survive',t=>{
 const {index,store,vault,create,pages,knowledge}=fixture(t);
 let page=create([block('a','23 October 2026'),block('b','23 October 2026')]);
 const mention=index.pageEvidence(vault.id,page.id).find(item=>item.evidence.reference.blockId==='a');
 index.curate(vault.id,'2026-10-23',{label:'Research',pinned:true,importance:'notable',personalPriority:'important',annotation:'Keep this date'});
 const event=knowledge.create(vault.id,{name:'Research event',type:'event'});
 index.relate(vault.id,mention.dateId,{entityId:event.id,kind:'occurs_on',mentionId:mention.id});
 page=pages.update(vault.id,page.id,{...page,blocks:[block('b','23 October 2026'),block('c','24 October 2026')]});
 query(index,vault.id);
 assert.equal(index.resolve(vault.id,mention.id).status,'stale');
 const curated=query(index,vault.id,false).items[0];assert.equal(curated.curation.annotation,'Keep this date');assert.equal(curated.relations[0].evidence.status,'stale');assert.equal(curated.mentions.length,1);
 assert.equal(store.get('SELECT count(*) n FROM temporal_relations').n,1);
 pages.delete(vault.id,page.id);
 assert.equal(index.resolve(vault.id,mention.id).status,'unavailable');
 assert.equal(query(index,vault.id).items[0].mentions.length,0);
 page=pages.restore(vault.id,page.id);query(index,vault.id);
 assert.equal(query(index,vault.id).items.find(item=>item.date.value==='2026-10-24').mentions.length,1);
 pages.delete(vault.id,page.id);pages.permanentlyDelete(vault.id,page.id);
 const result=query(index,vault.id,false);assert.equal(result.items.length,1);assert.equal(result.items[0].relations[0].mentionId,null);
 assert.equal(store.get('SELECT count(*) n FROM temporal_mentions WHERE page_id=?',page.id).n,0);
});

test('old snapshots cannot overwrite a newer revision, deletion, or renamed entity projection',t=>{
 const {index,store,vault,create,pages,knowledge}=fixture(t);
 let page=create();const old=index.prepare(vault.id,page.id);
 page=pages.update(vault.id,page.id,{...page,blocks:[block('first','24 October 2026')]});
 index.refresh(vault.id);assert.equal(index.commit(old),false);assert.equal(query(index,vault.id).items[0].date.value,'2026-10-24');
 const beforeDeletion=index.prepare(vault.id,page.id);pages.delete(vault.id,page.id);assert.equal(index.commit(beforeDeletion),false);
 page=pages.restore(vault.id,page.id);
 const entity=knowledge.create(vault.id,{name:'23 October 2026',type:'event'});
 page=pages.update(vault.id,page.id,{...page,blocks:[{id:'linked',type:'paragraph',checked:false,content:[{entityId:entity.id}]}]});
 const beforeRename=index.prepare(vault.id,page.id);index.commit(beforeRename);
 store.run('UPDATE entities SET name=? WHERE id=?','24 October 2026',entity.id);
 assert.equal(index.commit(beforeRename),false);
 assert.equal(query(index,vault.id).items[0].date.value,'2026-10-24');
});

test('unresolved evidence retains its anchored text and never populates exact date queries',t=>{
 const {index,vault,create}=fixture(t);const page=create([block('a','On 03/04/2026; in October 2026?')]);
 const evidence=index.pageEvidence(vault.id,page.id);assert.equal(evidence.length,2);
 for(const mention of evidence){assert.equal(mention.dateId,null);assert.equal(mention.evidence.status,'unresolved');assert.equal(mention.text,mention.evidence.reference.excerpt);}
 assert.deepEqual(query(index,vault.id).items,[]);
});

test('vault access, archive and deletion boundaries exclude inaccessible records and preserve independent curation',t=>{
 const {index,store,vault,vaults,knowledge,create}=fixture(t);const page=create();const mention=index.pageEvidence(vault.id,page.id)[0];
 const foreign=vaults.create({name:'Other vault'});
 assert.equal(index.resolve(foreign.id,mention.id).status,'unavailable');assert.equal(index.prepare(foreign.id,page.id),null);assert.deepEqual(query(index,foreign.id).items,[]);
 assert.throws(()=>index.pageEvidence(foreign.id,page.id),error=>error.status===404);
 const entity=knowledge.create(vault.id,{name:'Event',type:'event'});
 assert.throws(()=>index.relate(foreign.id,mention.dateId,{entityId:entity.id,kind:'deadline'}),error=>error.status===404);
 index.relate(vault.id,mention.dateId,{entityId:entity.id,kind:'discusses',mentionId:mention.id});
 assert.equal(query(index,vault.id,false).items.length,1);
 store.run('UPDATE entities SET archived_at=? WHERE id=?',new Date().toISOString(),entity.id);assert.equal(query(index,vault.id,false).items.length,0);
 index.curate(vault.id,'2026-10-23',{label:'Independent'});
 vaults.lock(vault.id,{passphrase:'test-password'});
 for(const action of [()=>query(index,vault.id),()=>index.prepare(vault.id,page.id),()=>index.resolve(vault.id,mention.id),()=>index.curate(vault.id,'2026',{})])assert.throws(action,error=>error.status===423);
 vaults.unlock(vault.id,{passphrase:'test-password'});
 const deletion=new VaultDeletion(store),preview=deletion.preview(vault.id);
 index.curate(vault.id,'2026-10-23',{label:'Changed after preview'});
 assert.throws(()=>deletion.remove(vault.id,{name:preview.vault.name,fingerprint:preview.fingerprint,acknowledged:true}),error=>error.status===409);
 const current=deletion.preview(vault.id);deletion.remove(vault.id,{name:current.vault.name,fingerprint:current.fingerprint,acknowledged:true,passphrase:'test-password'});
 for(const table of ['temporal_dates','temporal_curation','temporal_relations','temporal_mentions','temporal_dirty','temporal_index_state'])assert.equal(store.get(`SELECT count(*) n FROM ${table} WHERE vault_id=?`,vault.id).n,0,table);
 assert.equal(store.all('PRAGMA foreign_key_check').length,0);
});

test('backup round trip remaps anchors and manual relations, rebuilds derived state, and supports legacy archives',async t=>{
 const {index,store,vault,create,knowledge,pages}=fixture(t);let page=create();
 const mention=index.pageEvidence(vault.id,page.id)[0],entity=knowledge.create(vault.id,{name:'A conference',type:'event'});
 index.curate(vault.id,'2026-10-23',{label:'Pinned day',pinned:true});index.curate(vault.id,'1848',{annotation:'Independent year'});
 index.relate(vault.id,mention.dateId,{entityId:entity.id,kind:'occurs_on',mentionId:mention.id});
 const backups=new VaultBackups(store),exported=await backups.export(vault.id),archive=JSON.parse(gunzipSync(exported.bytes));
 assert.equal(archive.tables.temporal_curation.length,2);assert.equal(archive.tables.temporal_index_state,undefined);
 const restored=await backups.import(exported.bytes,'Restored');const restoredPage=pages.list(restored.id)[0];
 assert.notEqual(restoredPage.id,page.id);assert.equal(store.get('SELECT count(*) n FROM temporal_index_state WHERE vault_id=?',restored.id).n,0);
 const result=query(index,restored.id,false);assert.equal(result.items.length,1);assert.equal(result.items[0].curation.label,'Pinned day');
 const relation=result.items[0].relations[0];assert.notEqual(relation.entityId,entity.id);assert.notEqual(relation.mentionId,mention.id);assert.equal(relation.evidence.status,'current');assert.equal(relation.evidence.reference.pageId,restoredPage.id);
 assert.equal(index.query(restored.id,'1848-01-01','1848-12-31').items[0].date.precision,'year');
 page=pages.update(vault.id,page.id,{...page,blocks:[block('other','23 October 2026')]});index.refresh(vault.id);
 const staleBackup=await backups.export(vault.id),staleRestore=await backups.import(staleBackup.bytes,'Stale evidence');
 assert.equal(query(index,staleRestore.id,false).items[0].relations[0].evidence.status,'stale');
 for(const table of Object.keys(archive.tables))if(table.startsWith('temporal_'))delete archive.tables[table];
 const legacy=await backups.import(gzipSync(JSON.stringify(archive)),'Legacy');assert.equal(query(index,legacy.id).items.length,1);
 assert.equal(query(index,legacy.id,false).items.length,0);
 const malformed=JSON.parse(gunzipSync(exported.bytes));malformed.tables.temporal_dates[0].value='2026-02-30';
 const count=store.get('SELECT count(*) n FROM vaults').n;
 await assert.rejects(backups.import(gzipSync(JSON.stringify(malformed)),'Invalid'),error=>error.status===400);
 assert.equal(store.get('SELECT count(*) n FROM vaults').n,count);assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);
});

test('persistent schema is additive and idempotent, and dirty evidence survives restart',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-temporal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const filename=path.join(directory,'test.sqlite');let db=openDatabase(filename),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Saved'}),pages=new Pages(store,new Knowledge(store)),index=new TemporalIndex(store);
 let page=pages.create(vault.id,{title:'Saved'});page=pages.update(vault.id,page.id,{...page,blocks:[block('a','23 October 2026')]});const mention=index.pageEvidence(vault.id,page.id)[0];
 index.curate(vault.id,'2026-10-23',{pinned:true});page=pages.update(vault.id,page.id,{...page,blocks:[block('a','24 October 2026')]});db.close();
 db=openDatabase(filename);t.after(()=>db.close());store=new Store(db);index=new TemporalIndex(store);
 assert.equal(index.resolve(vault.id,mention.id).status,'stale');assert.equal(query(index,vault.id).items.length,2);assert.equal(index.resolve(vault.id,mention.id).status,'stale');
 assert.equal(store.get('SELECT count(*) n FROM temporal_curation WHERE vault_id=?',vault.id).n,1);
});

test('temporal HTTP endpoints enforce vault scope and provide exact evidence without AI requests',async t=>{
 const {store,vault,create}=fixture(t),page=create();const app=createApp(store,'dist/client');app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
 const base=`http://127.0.0.1:${app.address().port}/api/temporal`,headers={'x-vault-id':vault.id,'x-noema-request':'1','content-type':'application/json'};
 const response=await fetch(`${base}/dates?from=2026-10-01&to=2026-10-31&references=all`,{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.items.length,1);
 const evidence=await (await fetch(`${base}/mentions/${result.items[0].mentions[0].id}`,{headers})).json();assert.equal(evidence.status,'current');assert.equal(evidence.reference.pageId,page.id);
 assert.equal((await fetch(`${base}/curation`,{method:'PUT',headers,body:JSON.stringify({value:'2026-10-23',label:'Curated'})})).status,200);
 assert.equal((await fetch(`${base}/dates?from=2026-02-30&to=2026-10-31`,{headers})).status,400);
 assert.equal((await fetch(`${base}/curation`,{method:'PUT',headers:{'content-type':'application/json','x-vault-id':vault.id},body:JSON.stringify({value:'2026'})})).status,403);
 assert.equal(store.get('SELECT count(*) n FROM ai_activity').n,0);
});


test('historical dates preserve BCE civil numbering, uncertainty, intervals and centuries without invented days',()=>{
 assert.equal(temporalDate('-0000'),null);assert.equal(temporalDate('0000'),null);
 assert.equal(temporalDate('-0001-02-29')?.precision,'day','1 BCE is astronomical leap year zero');
 assert.equal(temporalDate('-0002-02-29'),null);
 assert.equal(temporalDate('-0101-02-29','julian')?.precision,'day');assert.equal(temporalDate('-0101-02-29'),null);
 assert.equal(temporalDate('1816/1815'),null);assert.equal(temporalDate('~1815/1816'),null);
 const expressions=extractTemporal('44 BC; 12 March 0044 BCE; about 1848; between 1914 and 1918; 19th century; 1st century BCE; 44 BC (Old Style)');
 assert.deepEqual(expressions.map(x=>x.date?.value),['-0044','-0044-03-12','~1848','1914/1918','C19','C-1','-0044']);
 assert.equal(expressions.at(-1).date.calendar,'julian');
 assert.equal(temporalDisplay(temporalDate('-0044-03-12')),'12 March 44 BCE');
 assert.equal(temporalDisplay(temporalDate('~1848')),'circa 1848');
 assert.equal(temporalBounds(temporalDate('~1848')).approximate,true);
 assert.equal(temporalOverlaps(temporalDate('~1848'),'1847-01-01','1847-12-31'),false,'no invented approximation tolerance');
 assert.equal(temporalOverlaps(temporalDate('-0044/-0042'),'-0043-01-01','-0043-12-31'),true);
 assert.equal(temporalOverlaps(temporalDate('C-1'),'-0001-12-31','0001-01-01'),true);
 assert.equal(temporalOverlaps(temporalDate('C-1'),'0001-01-01','0001-12-31'),false);
 for(const text of ['circa 12 March 44 BCE','12th March 44 BCE','12th March44BCE','early June 44 BCE','about March 44 BCE','c. 12 March 44 BCE','approximately 12th March 44 BCE','late 44 BCE','ca. 1815','uncertain 19th century','mid-1815','44 BCE/43 BCE','around 12 March44BCE','early March1815','circa June44BCE(Julian)','mid-44 BCE','12st March0044BCE','between 12 March44BCE and 15 March44BCE','12 March44BCE to15March43BCE','1815 to about1816','ca. 12 March44BCE','12 Mar44BCE','44BCE or43BCE','1815 and 1820','in 1815 and 1820','circa 12 March44BCE to15March43BCE','March 12, 44 BCE','circa 1815 BCE','1815–1816 BCE','early 19th century','circa 1815 (Hebrew)','1815 to 1816 (Hebrew)','in 1815?','19th century?','1 January 1815 BCE?','between 1815 and circa 1816']) {
  const found=extractTemporal(text);assert.equal(found.length,1,text);assert.equal(found[0].date,null,text);assert.equal(found[0].text,text);
 }
});

test('historical range query and backup preserve calendar-local identities and original evidence',async t=>{
 const {store,vault,index,create}=fixture(t);
 create([block('history','44 BCE; circa 1815; between 1814 and 1816; 19th century; 44 BCE (Julian)')]);
 const bce=index.query(vault.id,'-0044-01-01','-0044-12-31',true);assert.equal(bce.items.length,1);assert.equal(bce.items[0].date.value,'-0044');
 assert.equal(index.query(vault.id,'-0044-01-01','-0044-12-31',true,'julian').items.length,1);
 const overlap=index.query(vault.id,'1815-06-01','1815-06-30',true);assert.deepEqual(overlap.items.map(x=>x.date.value),['C19','1814/1816','~1815']);
 assert.ok(overlap.items.every(x=>x.relationCount===0),'recognition is never a commitment');
 index.curate(vault.id,'~1815',{label:'Approximate knowledge',layer:'historical'});
 const backups=new VaultBackups(store),archive=await backups.export(vault.id),restored=await backups.import(archive.bytes,'History restored');
 const item=index.query(restored.id,'1815-01-01','1815-12-31',false).items[0];assert.equal(item.date.value,'~1815');assert.equal(item.curation.label,'Approximate knowledge');
 assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);
});

test('historical schema upgrade keeps existing curation and relationships with valid foreign keys',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-historical-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const filename=path.join(dir,'test.sqlite');let db=openDatabase(filename),store=new Store(db),vault=new Vaults(store).create({name:'Legacy historical'}),index=new TemporalIndex(store),knowledge=new Knowledge(store);
 index.curate(vault.id,'1815',{label:'Retained'});const event=knowledge.create(vault.id,{name:'Retained event',type:'event'});const relation=index.relate(vault.id,'gregorian:year:1815',{entityId:event.id,kind:'occurs_on'});
 // Reproduce the v1 date CHECK without discarding rows or child references.
 db.exec("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN; CREATE TABLE temporal_dates_v1 (vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,id TEXT NOT NULL,value TEXT NOT NULL,precision TEXT NOT NULL CHECK(precision IN ('day','month','year')),calendar TEXT NOT NULL CHECK(calendar IN ('gregorian','julian')),PRIMARY KEY(vault_id,id)); INSERT INTO temporal_dates_v1 SELECT * FROM temporal_dates; DROP TABLE temporal_dates; ALTER TABLE temporal_dates_v1 RENAME TO temporal_dates; COMMIT; PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON");db.close();
 db=openDatabase(filename);t.after(()=>db.close());store=new Store(db);index=new TemporalIndex(store);
 assert.equal(index.detail(vault.id,'gregorian:year:1815').curation.label,'Retained');assert.equal(index.detail(vault.id,'gregorian:year:1815').relations[0].id,relation.id);
 index.curate(vault.id,'1814/1816',{label:'New period'});index.relate(vault.id,'gregorian:interval:1814/1816',{entityId:event.id,kind:'ends_on'});
 assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);
});

test('association facets preserve one date identity while filtering accepted context before previews',async t=>{
 const {index,store,vault,knowledge}=fixture(t);index.curate(vault.id,'1815',{label:'Personal date',layer:'personal'});
 const historical=knowledge.create(vault.id,{name:'Historical event',type:'event'}),personal=knowledge.create(vault.id,{name:'Personal event',type:'event'});
 index.relate(vault.id,'gregorian:year:1815',{entityId:historical.id,kind:'occurs_on',layer:'historical'});
 index.relate(vault.id,'gregorian:year:1815',{entityId:personal.id,kind:'occurs_on',layer:'personal'});
 const search=layers=>index.query(vault.id,'1815-01-01','1815-12-31',false,'gregorian',{layers}).items;
 assert.equal(search(['knowledge']).length,0);
 assert.deepEqual(search(['historical'])[0].relations.map(row=>row.entityId),[historical.id]);assert.equal(search(['historical'])[0].relationCount,1);
 assert.deepEqual(search(['personal'])[0].relations.map(row=>row.entityId),[personal.id]);assert.equal(index.detail(vault.id,'gregorian:year:1815').relationCount,2);
 index.uncurate(vault.id,'gregorian:year:1815');assert.equal(search(['knowledge']).length,0,'explicit association facets do not leak through the default date layer');
 const backups=new VaultBackups(store),backup=await backups.export(vault.id),restored=await backups.import(backup.bytes,'Context restored');
 assert.deepEqual(index.query(restored.id,'1815-01-01','1815-12-31',false,'gregorian',{layers:['historical']}).items[0].relations.map(row=>row.layer),['historical']);
});
