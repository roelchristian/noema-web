import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourceEnrichments} from '../src/server/modules/source-enrichments.ts';
import {SourceAuthorBackfill} from '../src/server/modules/source-author-backfill.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {recordPropertyProvenance,recordEntityNameProvenance,proposeValue,proposalIdentity,rawSourceHash} from '../src/server/modules/property-provenance.ts';

const unpack=bytes=>JSON.parse(gunzipSync(bytes).toString('utf8'));
const alter=(bytes,work)=>{const archive=unpack(bytes);work(archive);return gzipSync(JSON.stringify(archive));};
const stamp='2026-10-23T01:02:03.000Z';
function fixture(t) {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-provenance-backups-')),db=openDatabase(path.join(directory,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),vaults=new Vaults(store),vault=vaults.create({name:'Synthetic provenance'}).id,backups=new VaultBackups(store),files=new SourceFiles(store);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 const file=files.add(vault,'Fixture.txt',Buffer.from('Synthetic source evidence\nNo provider requests.'));
 const entity=knowledge.create(vault,{name:'Manually named source',type:'source',attachmentIds:[file.id]});
 store.run("UPDATE source_files SET status='ready',text=?,enrichment_status='completed' WHERE id=?",'Synthetic source evidence\nNo provider requests.',file.id);
 const current=store.get('SELECT * FROM source_files WHERE id=?',file.id),hash=rawSourceHash(current.text);
 knowledge.property(vault,entity.id,{name:'author',value:'Uncertain historical author 0012'});
 const property=store.get("SELECT * FROM properties WHERE entity_id=? AND name='author'",entity.id);
 recordPropertyProvenance(store,vault,property.id,{origin:'manual',source_file_id:file.id,source_hash:hash,details:'Exact authored evidence'});
 recordEntityNameProvenance(store,vault,entity.id,{origin:'manual',source_file_id:file.id,source_hash:hash,details:'Exact title evidence'});
 store.run('UPDATE property_provenance SET created_at=?,updated_at=? WHERE property_id=?',stamp,stamp,property.id);
 store.run('UPDATE entity_name_provenance SET created_at=?,updated_at=? WHERE entity_id=?',stamp,stamp,entity.id);
 knowledge.property(vault,entity.id,{name:'publication date',value:'An uncertain legacy date'});
 const historical=store.get("SELECT * FROM properties WHERE entity_id=? AND name='publication date'",entity.id);
 recordPropertyProvenance(store,vault,historical.id,{origin:'imported',source_file_id:file.id,source_hash:'c'.repeat(64),details:'Stale imported evidence',stale:true});
 store.run('UPDATE property_provenance SET created_at=?,updated_at=? WHERE property_id=?',stamp,stamp,historical.id);
 const target=knowledge.create(vault,{name:'Archived suggested author',type:'person'});
 store.run('UPDATE entities SET archived_at=? WHERE id=?',stamp,target.id);
 const proposal=proposeValue(store,vault,{entity_id:entity.id,property_id:property.id,property_name:'author',target_id:target.id,origin:'ai',source_file_id:file.id,source_hash:hash,details:'Rejected inference retained'});
 store.run("UPDATE property_proposals SET status='rejected',created_at=?,updated_at=? WHERE id=?",stamp,stamp,proposal.id);
 const stale=proposeValue(store,vault,{entity_id:entity.id,kind:'entity_name',value:'Earlier inferred title',origin:'ai',source_file_id:file.id,source_hash:'a'.repeat(64),details:'Historical stale suggestion'});
 store.run("UPDATE source_author_jobs SET status='completed',content_hash=?,attempts=2,error=NULL,updated_at=? WHERE file_id=?",hash,stamp,file.id);
 store.run("INSERT OR IGNORE INTO source_author_jobs(file_id,vault_id,status,content_hash,attempts,updated_at) VALUES (?,?,'completed',?,2,?)",file.id,vault,hash,stamp);
 return {db,store,knowledge,vaults,vault,backups,entity,property,file:current,target,proposal,stale,hash};
}
function restoredRows(f,id) {
 const entity=f.store.get("SELECT * FROM entities WHERE vault_id=? AND name='Manually named source'",id),property=f.store.get("SELECT * FROM properties WHERE entity_id=? AND name='author'",entity.id),file=f.store.get('SELECT * FROM source_files WHERE entity_id=?',entity.id);
 return {entity,property,file};
}

test('provenance backup retains exact evidence and rejected decisions across remapped IDs',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault),restored=await f.backups.import(exported.bytes),r=restoredRows(f,restored.id);
 assert.equal(r.property.value,f.property.value);assert.notEqual(r.property.id,f.property.id);
 const historical=f.store.get("SELECT p.value,pp.* FROM properties p JOIN property_provenance pp ON pp.property_id=p.id WHERE p.entity_id=? AND p.name='publication date'",r.entity.id);
 assert.equal(historical.value,'An uncertain legacy date');assert.equal(historical.stale,1);assert.equal(historical.source_hash,'c'.repeat(64));assert.equal(historical.updated_at,stamp);
 for(const [table,key,current,old] of [['property_provenance','property_id',r.property.id,f.property.id],['entity_name_provenance','entity_id',r.entity.id,f.entity.id]]) {
  const before=f.store.get(`SELECT * FROM ${table} WHERE ${key}=?`,old),after=f.store.get(`SELECT * FROM ${table} WHERE ${key}=?`,current);
  assert.deepEqual({...after},{...before,[key]:current,vault_id:restored.id,source_file_id:r.file.id});
 }
 const proposals=f.store.all('SELECT * FROM property_proposals WHERE vault_id=?',restored.id),rejected=proposals.find(row=>row.status==='rejected');
 assert.equal(rejected.property_id,r.property.id);assert.notEqual(rejected.target_id,f.target.id);
 assert.equal(rejected.created_at,stamp);assert.equal(rejected.updated_at,stamp);
 assert.equal(rejected.id,proposalIdentity(restored.id,rejected));assert.notEqual(rejected.id,f.proposal.id);
 assert.equal(f.store.get('SELECT archived_at FROM entities WHERE id=?',rejected.target_id).archived_at,stamp);
 assert.equal(proposals.find(row=>row.kind==='entity_name').source_hash,'a'.repeat(64));
 const again=proposeValue(f.store,restored.id,{...rejected,details:'Repeated model extraction with a new explanation'});
 assert.equal(again.id,rejected.id);assert.equal(again.status,'rejected');assert.equal(again.details,'Rejected inference retained');
 assert.equal(f.store.get('SELECT COUNT(*) n FROM property_proposals WHERE vault_id=?',restored.id).n,2);
 const receipt=f.store.get('SELECT * FROM source_author_jobs WHERE file_id=?',r.file.id);
 assert.equal(receipt.status,'completed');assert.equal(receipt.content_hash,f.hash);assert.equal(receipt.attempts,2);assert.equal(receipt.updated_at,stamp);
 assert.ok(f.store.get('SELECT 1 FROM source_automation_pauses WHERE file_id=? AND vault_id=?',r.file.id,restored.id));
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('pre-provenance archive keeps unknown authorship and blocks automatic paid work after local source updates',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault);
 const bytes=alter(exported.bytes,a=>{for(const key of ['property_provenance','entity_name_provenance','property_proposals','source_author_jobs'])delete a.tables[key];});
 const restored=await f.backups.import(bytes),r=restoredRows(f,restored.id);
 assert.equal(f.store.get('SELECT origin FROM property_provenance WHERE property_id=?',r.property.id).origin,'legacy_unknown');
 assert.equal(f.store.get('SELECT origin FROM entity_name_provenance WHERE entity_id=?',r.entity.id).origin,'legacy_unknown');
 assert.equal(f.store.get('SELECT status FROM source_author_jobs WHERE file_id=?',r.file.id).status,'completed');
 // Restrict the synthetic original too: only restored records are under test.
 f.store.run('UPDATE vaults SET locked=1 WHERE id=?',f.vault);
 let calls=0;const spend=async()=>{calls++;throw Error('Provider work must remain suppressed');},intelligence={status:()=>({configured:true}),selection:()=>({}),extractSourceAuthors:spend,enrichSource:spend,generate:spend},activity=new AIActivityLog(f.store),backfill=new SourceAuthorBackfill(f.store,intelligence,activity),enrichments=new SourceEnrichments(f.store,intelligence,activity);
 t.after(()=>{backfill.close();enrichments.close();});
 await backfill.tick();await enrichments.tick();assert.equal(calls,0);
 // Local extraction can invalidate author receipts and queue enrichment later.
 f.store.run("UPDATE source_files SET text=text||'\nLocally extracted again',enrichment_status='pending' WHERE id=?",r.file.id);
 await backfill.tick();await enrichments.tick();assert.equal(calls,0);
 assert.ok(f.store.get('SELECT 1 FROM source_automation_pauses WHERE file_id=?',r.file.id));
});

test('restored in-flight enrichment and author jobs are paused instead of resuming provider work',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault);
 const bytes=alter(exported.bytes,a=>{a.tables.source_files[0].enrichment_status='running';a.tables.source_author_jobs[0].status='running';});
 const restored=await f.backups.import(bytes),r=restoredRows(f,restored.id);
 assert.equal(r.file.enrichment_status,'failed');assert.match(r.file.enrichment_error,/retry explicitly/i);
 assert.equal(f.store.get('SELECT status FROM source_author_jobs WHERE file_id=?',r.file.id).status,'completed');
});

test('malformed provenance, cross-vault references and invalid hashes roll back the whole vault',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault),before=f.vaults.list().length;
 const cases=[a=>a.tables.property_provenance[0].origin='assumed_manual',a=>a.tables.property_provenance[0].source_file_id='outside-backup',a=>a.tables.property_provenance[0].source_hash='invalid',a=>{const row=a.tables.property_provenance.find(row=>row.property_id===f.property.id);row.source_hash='b'.repeat(64);row.stale=0;},a=>a.tables.property_provenance.push(a.tables.property_provenance[0]),a=>a.tables.entity_name_provenance[0].entity_id='outside-backup',a=>a.tables.property_proposals[0].target_id='outside-backup',a=>a.tables.property_proposals[0].status='forgotten',a=>a.tables.property_proposals[0].source_hash='invalid',a=>a.tables.property_proposals.push(a.tables.property_proposals[0]),a=>a.tables.source_author_jobs[0].content_hash='b'.repeat(64),a=>a.tables.source_author_jobs[0].file_id='outside-backup'];
 for(const mutate of cases) {
  await assert.rejects(f.backups.import(alter(exported.bytes,mutate)),error=>error.status===400);
  assert.equal(f.vaults.list().length,before);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }
});
