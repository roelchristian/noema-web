import {DOMAINS} from '../src/shared/domains.ts';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Bibliography} from '../src/server/modules/bibliography.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {PageHistory} from '../src/server/modules/page-history.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {rewriteBackupArchive as alter} from './helpers/backup-archive.mjs';

const stamp='2026-10-24T12:00:00.000Z';
function fixture(t) {
 const db=openDatabase(':memory:'),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Synthetic bibliography'}).id,knowledge=new Knowledge(store),backups=new VaultBackups(store);
 t.after(()=>db.close());
 const bibliography=new Bibliography(store),imported=bibliography.import(vault,{raw:'@misc{FixtureKey,title={Metadata only synthetic source}}',decisions:[{index:0,action:'create'}]}),source=knowledge.find(vault,imported.sourceIds[0]);
 store.run('DELETE FROM bibliographic_records WHERE source_id=?',source.id);
 const fields={title:'Authored synthetic title',author:'{Synthetic Research Group} and Example, Alice',year:'0012',custom:'Unrecognized {raw} value'};
 const provenance=Object.fromEntries(Object.keys(fields).map(key=>[key,{origin:'bibtex',at:stamp}]));
 provenance.year.origin='ai';
 provenance.title.history=[{value:'Earlier extracted title',origin:'ai',at:stamp},{value:'Earlier authored title',origin:'manual',at:stamp}];
 store.run("INSERT INTO entity_domains(entity_id,domain_id,origin) VALUES(?,?,'inferred')",source.id,DOMAINS[0].id);
 const raw='% Preserve comments and macros\n@string{x="synthetic"}\n@unknown{FixtureKey,title=x,custom={Unrecognized {raw} value}}\n';
 const batchId=createHash('sha256').update(raw).digest('hex');
 store.run('INSERT INTO bibliographic_import_batches(id,vault_id,raw) VALUES(?,?,?)',batchId,vault,raw);
 store.run('INSERT INTO bibliographic_records(source_id,vault_id,citation_key,entry_type,fields_json,provenance_json,raw_imports_json,revision) VALUES(?,?,?,?,?,?,?,?)',source.id,vault,'FixtureKey','unknown',JSON.stringify(fields),JSON.stringify(provenance),JSON.stringify([batchId]),3);
 store.run('INSERT INTO bibliographic_proposals(id,source_id,vault_id,revision,provider,fields_json,created_at) VALUES(?,?,?,?,?,?,?)','synthetic-proposal',source.id,vault,2,'crossref',JSON.stringify({title:'Unconfirmed alternative'}),stamp);
 return {db,store,vault,source,backups,fields,provenance,raw,batchId};
}

test('bibliographic backup preserves metadata-only records, raw evidence and stale review proposals with remapped Source IDs',async t=>{
 const f=fixture(t),archive=await f.backups.export(f.vault),restored=await f.backups.import(archive.bytes),entity=f.store.get('SELECT * FROM entities WHERE vault_id=? AND name=?',restored.id,f.source.name),record=f.store.get('SELECT * FROM bibliographic_records WHERE source_id=?',entity.id);
 assert.notEqual(entity.id,f.source.id);assert.equal(record.vault_id,restored.id);assert.equal(record.citation_key,'FixtureKey');assert.equal(record.entry_type,'unknown');assert.equal(record.revision,3);
 assert.equal(f.store.get('SELECT origin FROM entity_domains WHERE entity_id=? AND domain_id=?',entity.id,DOMAINS[0].id).origin,'inferred');
 assert.deepEqual(JSON.parse(record.fields_json),f.fields);assert.deepEqual(JSON.parse(record.provenance_json),f.provenance);assert.deepEqual(JSON.parse(record.raw_imports_json),[f.batchId]);assert.equal(f.store.get('SELECT raw FROM bibliographic_import_batches WHERE vault_id=? AND id=?',restored.id,f.batchId).raw,f.raw);
 const proposal=f.store.get('SELECT * FROM bibliographic_proposals WHERE source_id=?',entity.id);
 assert.notEqual(proposal.id,'synthetic-proposal');assert.equal(proposal.vault_id,restored.id);assert.equal(proposal.revision,2);assert.equal(proposal.created_at,stamp);assert.equal(JSON.parse(proposal.fields_json).title,'Unconfirmed alternative');
 assert.equal(f.store.get('SELECT count(*) n FROM source_files WHERE entity_id=?',entity.id).n,0);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 const legacy=await f.backups.import(alter(archive.bytes,a=>{delete a.tables.bibliographic_import_batches;a.tables.bibliographic_records[0].raw_imports_json=JSON.stringify([f.raw]);}));
 const legacyRecord=f.store.get('SELECT source_id FROM bibliographic_records WHERE vault_id=?',legacy.id);
 assert.deepEqual(new Bibliography(f.store).get(legacy.id,legacyRecord.source_id).rawImports,[f.raw]);
});

test('pre-bibliography backups restore without invented records or network consent',async t=>{
 const f=fixture(t),archive=await f.backups.export(f.vault),bytes=alter(archive.bytes,a=>{delete a.tables.bibliographic_records;delete a.tables.bibliographic_proposals;delete a.tables.bibliographic_import_batches;});
 const restored=await f.backups.import(bytes);
 assert.equal(f.store.get('SELECT count(*) n FROM bibliographic_records WHERE vault_id=?',restored.id).n,0);
 assert.equal(f.store.get('SELECT count(*) n FROM bibliographic_proposals WHERE vault_id=?',restored.id).n,0);
});

test('reviewed single-Source import survives backup with its stable identity and original evidence',async t=>{
 const f=fixture(t),bibliography=new Bibliography(f.store);
 const raw='% Original scoped evidence\n@book{DifferentIncomingKey,title={Reviewed replacement},publisher={Synthetic Press},custom={Still retained}}';
 const preview=bibliography.sourceImportPreview(f.vault,f.source.id,raw);
 const choices=Object.fromEntries(preview.conflicts.map(conflict=>[conflict.field,conflict.field==='title'?'incoming':'current']));
 const updated=bibliography.sourceImport(f.vault,f.source.id,{raw,batchId:preview.batchId,revision:preview.revision,fields:choices});
 assert.equal(updated.citationKey,'FixtureKey');assert.equal(updated.entryType,'unknown');
 const archive=await f.backups.export(f.vault),restored=await f.backups.import(archive.bytes);
 const source=f.store.get('SELECT id FROM entities WHERE vault_id=? AND name=?',restored.id,f.source.name);
 const record=bibliography.get(restored.id,source.id);
 assert.notEqual(record.sourceId,f.source.id);assert.equal(record.citationKey,'FixtureKey');
 assert.equal(record.fields.title,'Reviewed replacement');assert.equal(record.fields.publisher,'Synthetic Press');
 assert.deepEqual(record.rawImports,[f.raw,raw]);assert.deepEqual(record.provenance,updated.provenance);
 const exported=JSON.parse(bibliography.sourceExport(restored.id,source.id).sidecar);
 assert.equal(exported.records.length,1);assert.equal(exported.records[0].sourceId,source.id);
 assert.deepEqual(new Set(exported.importBatches.map(batch=>batch.raw)),new Set([f.raw,raw]));
 assert.equal(f.store.get('SELECT count(*) n FROM source_files WHERE entity_id=?',source.id).n,0);
});

test('invalid bibliographic references, provenance, values and revisions roll back entire restored vault',async t=>{
 const f=fixture(t),archive=await f.backups.export(f.vault),before=f.store.get('SELECT count(*) n FROM vaults').n;
 const corruptions=[
  a=>{a.tables.bibliographic_records[0].source_id='outside-archive';},
  a=>{a.tables.bibliographic_records[0].fields_json='{"title":{"bad":true}}';},
  a=>{a.tables.bibliographic_records[0].provenance_json='{"title":{"origin":"confidence_only","at":"2026-10-24T12:00:00Z"}}';},
  a=>{a.tables.bibliographic_records[0].raw_imports_json='[42]';},
  a=>{a.tables.bibliographic_records[0].provenance_json=JSON.stringify({title:{origin:'manual',at:stamp,history:[{value:'bad origin',origin:'confidence_only',at:stamp}]}});},
  a=>{a.tables.bibliographic_import_batches[0].raw='Tampered raw data';},
  a=>{a.tables.bibliographic_records[0].raw_imports_json=JSON.stringify(['a'.repeat(64)]);},
  a=>{a.tables.bibliographic_records.push({...a.tables.bibliographic_records[0]});},
  a=>{a.tables.bibliographic_proposals[0].revision=4;},
  a=>{a.tables.bibliographic_proposals[0].provider='arbitrary-provider';},
 ];
 for(const change of corruptions) {
  await assert.rejects(f.backups.import(alter(archive.bytes,change)),error=>error.status===400);
  assert.equal(f.store.get('SELECT count(*) n FROM vaults').n,before);
 }
});


test('bibliographic citations keep consistent remapped identities in current pages and historical snapshots',async t=>{
 const f=fixture(t),pages=new Pages(f.store,new Knowledge(f.store)),history=new PageHistory(f.store);
 let page=pages.create(f.vault,{title:'Synthetic bibliographic citations'});
 const reference={id:'synthetic-citation',sourceId:f.source.id,locator:'12–14',label:'page'};
 page=pages.update(f.vault,page.id,{...page,blocks:[{id:'cited',type:'paragraph',checked:false,content:[{text:'Evidence',bibliographicReference:reference}]}]});
 const checkpoint=history.checkpoint(f.vault,page.id,{revision:page.revision,name:'Cited version'});
 const archive=await f.backups.export(f.vault),restored=await f.backups.import(archive.bytes),newPage=pages.list(restored.id).find(item=>item.title===page.title),actual=pages.get(restored.id,newPage.id).blocks[0].content[0].bibliographicReference;
 assert.notEqual(actual.id,reference.id);assert.notEqual(actual.sourceId,f.source.id);assert.equal(actual.locator,'12–14');assert.equal(actual.label,'page');
 const version=history.list(restored.id,newPage.id).find(item=>item.name===checkpoint.name),snapshot=history.get(restored.id,newPage.id,version.id).snapshot;
 assert.deepEqual(snapshot.blocks[0].content[0].bibliographicReference,actual);
 const corrupt=alter(archive.bytes,a=>{const blocks=JSON.parse(a.tables.pages[0].blocks);blocks[0].content[0].bibliographicReference.sourceId='outside-archive';a.tables.pages[0].blocks=JSON.stringify(blocks);});
 await assert.rejects(f.backups.import(corrupt),error=>error.status===400);
});
