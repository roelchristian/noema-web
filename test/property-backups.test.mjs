import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {syncSourceProvenance} from '../src/server/modules/source-provenance.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBackupArchive as unpack,rewriteBackupArchive as alter} from './helpers/backup-archive.mjs';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {syncPropertyMetadata,persistedPropertyDefinitions,bindPropertyDefinition} from '../src/server/modules/property-storage.ts';

function fixture(t) {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-property-backups-')),db=openDatabase(path.join(directory,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),vaults=new Vaults(store),vault=vaults.create({name:'Typed backup fixture'}).id,backups=new VaultBackups(store);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 const schema=knowledge.addSubtype(vault,{type:'person',name:'Fixture subtype'}),subtype=schema.subtypes.find(item=>item.name==='Fixture subtype').id;
 for(const name of ['Publication Count','External ID'])knowledge.addTypeProperty(vault,{type:'person',subtype,name});
 const definitions=persistedPropertyDefinitions(store,vault);
 for(const [name,valueKind] of [['Publication Count','integer'],['External ID','identifier']]) {
  const definition=definitions.find(item=>item.legacyName===name&&item.scope.kind==='subtype');
  definition.valueKind=valueKind;
  store.run('UPDATE property_definitions SET definition_json=? WHERE vault_id=? AND id=?',JSON.stringify(definition),vault,definition.id);
 }
 const person=knowledge.create(vault,{name:'A fixture writer',type:'person',subtypes:[subtype]}),place=knowledge.create(vault,{name:'Archived fixture city',type:'place'});
 knowledge.property(vault,person.id,{name:'Publication Count',value:'00042'});
 knowledge.property(vault,person.id,{name:'External ID',value:'00000123'});
 knowledge.property(vault,person.id,{name:'birth date',value:'October 2026'});
 knowledge.property(vault,person.id,{name:'birthplace',target_id:place.id});
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23T00:00:00.000Z',place.id);
 const index=new TemporalIndex(store);index.refresh(vault);
 syncPropertyMetadata(store,vault);
 const properties=knowledge.detail(vault,person.id).properties;
 const count=properties.find(item=>item.name==='Publication Count');
 store.run('UPDATE property_value_metadata SET position=17 WHERE property_id=?',count.id);
 return {db,store,knowledge,vaults,vault,backups,person,place,subtype,properties,count};
}

test('typed backup round trips exact authored strings, subtype definitions, order, references and temporal authority',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault),archive=unpack(exported.bytes);
 assert.ok(archive.tables.property_definitions.length);
 assert.equal(archive.tables.property_value_metadata.find(row=>row.property_id===f.count.id).integer_value,42);
 assert.equal(archive.tables.properties.find(row=>row.id===f.count.id).value,'00042');
 const originalDefinitions=archive.tables.property_definitions.map(row=>row.id);
 const restored=await f.backups.import(exported.bytes,'Restored typed fixture');
 const person=f.knowledge.list(restored.id).find(item=>item.name===f.person.name),place=f.knowledge.list(restored.id).find(item=>item.name===f.place.name);
 assert.notEqual(person.id,f.person.id);assert.notEqual(person.subtypes[0],f.subtype);
 const properties=f.knowledge.detail(restored.id,person.id).properties;
 for(const old of f.properties) {
  const current=properties.find(item=>item.name===old.name);assert.ok(current);assert.notEqual(current.id,old.id);assert.equal(current.value,old.value);
 }
 assert.equal(properties.find(item=>item.name==='birthplace').target_id,place.id);
 assert.equal(place.archived_at,'2026-10-23T00:00:00.000Z');
 const count=properties.find(item=>item.name==='Publication Count'),metadata=f.store.get('SELECT * FROM property_value_metadata WHERE property_id=?',count.id);
 assert.equal(metadata.integer_value,42);assert.equal(metadata.position,17);assert.equal(metadata.compatibility,'valid');
 const definitions=persistedPropertyDefinitions(f.store,restored.id);
 assert.deepEqual(definitions.map(item=>item.id).sort(),originalDefinitions.sort());
 const custom=definitions.find(item=>item.legacyName==='Publication Count'&&item.scope.kind==='subtype');
 assert.equal(custom.valueKind,'integer');assert.equal(custom.scope.subtypeId,person.subtypes[0]);
 const date=properties.find(item=>item.name==='birth date'),dateMetadata=f.store.get('SELECT * FROM property_value_metadata WHERE property_id=?',date.id);
 assert.equal(dateMetadata.temporal_date_id,'gregorian:month:2026-10');
 assert.equal(f.store.get('SELECT date_id FROM temporal_property_values WHERE property_id=?',date.id).date_id,dateMetadata.temporal_date_id);
 assert.equal(f.store.get('SELECT property_hash FROM temporal_relations WHERE property_id=?',date.id).property_hash,f.store.get('SELECT property_hash FROM temporal_relations WHERE property_id=?',f.properties.find(item=>item.name==='birth date').id).property_hash);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('pre-definition backup imports without sidecars and retains incompatible authored literals',async t=>{
 const f=fixture(t),legacy=f.knowledge.create(f.vault,{name:'Legacy literal',type:'person'});
 f.knowledge.property(f.vault,legacy.id,{name:'birth date',value:'03/04/2026'});
 const exported=await f.backups.export(f.vault);
 const bytes=alter(exported.bytes,archive=>{delete archive.tables.property_definitions;delete archive.tables.property_value_metadata;delete archive.tables.temporal_property_values;delete archive.tables.temporal_property_dirty;});
 const restored=await f.backups.import(bytes),person=f.knowledge.list(restored.id).find(item=>item.name==='Legacy literal');
 const property=f.knowledge.detail(restored.id,person.id).properties[0];
 assert.equal(property.value,'03/04/2026');
 assert.equal(f.store.get('SELECT compatibility FROM property_value_metadata WHERE property_id=?',property.id).compatibility,'unresolved');
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('malformed typed mirrors and definitions roll back the entire imported vault',async t=>{
 const f=fixture(t),exported=await f.backups.export(f.vault),before=f.vaults.list().length;
 const cases=[
  archive=>archive.tables.property_value_metadata.find(row=>row.property_id===f.count.id).integer_value=43,
  archive=>archive.tables.property_value_metadata[0].definition_id='outside-this-backup',
  archive=>archive.tables.property_value_metadata.push(archive.tables.property_value_metadata[0]),
  archive=>archive.tables.property_value_metadata[0].position=-1,
  archive=>archive.tables.property_value_metadata[0].target_id='outside-this-backup',
  archive=>archive.tables.property_definitions[0].definition_json='{}',
  archive=>{const row=archive.tables.property_definitions.find(row=>row.id==='builtin:source:import_method');const definition=JSON.parse(row.definition_json);definition.origin='user_defined';definition.editable=true;row.definition_json=JSON.stringify(definition);},
  archive=>{const row=archive.tables.property_definitions.find(row=>JSON.parse(row.definition_json).scope.kind==='subtype');const definition=JSON.parse(row.definition_json);definition.scope.subtypeId='outside-this-backup';row.definition_json=JSON.stringify(definition);},
  archive=>archive.tables.temporal_property_values[0].raw_hash='invalid',
  archive=>archive.tables.temporal_property_values[0].raw_hash='a'.repeat(64),
  archive=>{const row=archive.tables.temporal_property_values[0];archive.tables.temporal_dates.push({id:'gregorian:year:2000',value:'2000',precision:'year',calendar:'gregorian'});row.date_id='gregorian:year:2000';archive.tables.property_value_metadata.find(item=>item.property_id===row.property_id).temporal_date_id=row.date_id;},
 ];
 for(const change of cases) {
  await assert.rejects(f.backups.import(alter(exported.bytes,change)),error=>error.status===400);
  assert.equal(f.vaults.list().length,before);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }
});


test('legacy multi-file Source split remaps sidecars and reconciles only file-specific managed metadata',async t=>{
 const f=fixture(t),files=new SourceFiles(f.store),first=files.add(f.vault,'First.txt',Buffer.from('First fixture source')),second=files.add(f.vault,'Second.txt',Buffer.from('Second fixture source'));
 const source=f.knowledge.create(f.vault,{name:'Legacy combined source',type:'source',attachmentIds:[first.id]});
 // Synthetic pre-one-file-policy database, never a real vault.
 f.store.run('DROP INDEX source_files_one_per_entity');
 f.store.run("UPDATE source_files SET entity_id=?,import_method='url',source_url='https://example.test/second' WHERE id=?",source.id,second.id);
 syncSourceProvenance(f.store,f.vault,source.id);
 f.knowledge.property(f.vault,source.id,{name:'publication date',value:'October 2026'});new TemporalIndex(f.store).refresh(f.vault);
 const exported=await f.backups.export(f.vault),archive=unpack(exported.bytes);
 assert.equal(archive.tables.source_files.filter(row=>row.entity_id===source.id).length,2);
 const restored=await f.backups.import(exported.bytes),sources=f.knowledge.list(restored.id).filter(item=>item.type==='source');
 assert.equal(sources.length,2);
 for(const entity of sources) {
  const file=f.store.get('SELECT * FROM source_files WHERE entity_id=?',entity.id),properties=f.knowledge.detail(restored.id,entity.id).properties;
  const currentMetadata=properties.filter(row=>f.store.get('SELECT origin,stale FROM property_provenance WHERE property_id=?',row.id)?.origin==='imported'&&!f.store.get('SELECT stale FROM property_provenance WHERE property_id=?',row.id)?.stale);
  assert.deepEqual(currentMetadata.filter(row=>row.name==='Import method').map(row=>row.value),[file.import_method]);
  assert.deepEqual(currentMetadata.filter(row=>row.name==='Source URL').map(row=>row.value),file.source_url?[file.source_url]:[]);
  // Imported historical values survive splitting as explicitly stale evidence.
  for(const row of properties.filter(row=>row.name==='Import method'&&row.value!==file.import_method||row.name==='Source URL'&&row.value!==file.source_url))assert.equal(f.store.get('SELECT stale FROM property_provenance WHERE property_id=?',row.id).stale,1);
  for(const property of properties)assert.ok(f.store.get('SELECT 1 FROM property_value_metadata WHERE property_id=?',property.id));
  const published=properties.find(item=>item.name==='publication date');assert.equal(published.value,'October 2026');assert.equal(f.store.get('SELECT temporal_date_id FROM property_value_metadata WHERE property_id=?',published.id).temporal_date_id,'gregorian:month:2026-10');
 }
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});


test('backup retains an explicitly selected subtype definition when a core field shares its name',async t=>{
 const f=fixture(t),definitions=persistedPropertyDefinitions(f.store,f.vault),native=definitions.find(item=>item.id==='builtin:person:birth_date');
 const scoped={...native,id:'fixture:scoped:birth-date',valueKind:'short_text',origin:'user_defined',cardinality:'many',scope:{kind:'subtype',type:'person',subtypeId:f.subtype}};
 f.store.run('INSERT INTO entity_subtype_properties (vault_id,subtype_id,name) VALUES (?,?,?)',f.vault,f.subtype,'birth date');
 f.store.run('INSERT INTO property_definitions (vault_id,id,definition_json) VALUES (?,?,?)',f.vault,scoped.id,JSON.stringify(scoped));
 const date=f.properties.find(item=>item.name==='birth date');bindPropertyDefinition(f.store,f.vault,date.id,scoped.id);
 const exported=await f.backups.export(f.vault),restored=await f.backups.import(exported.bytes),person=f.knowledge.list(restored.id).find(item=>item.name===f.person.name),property=f.knowledge.detail(restored.id,person.id).properties.find(item=>item.name==='birth date');
 const metadata=f.store.get('SELECT * FROM property_value_metadata WHERE property_id=?',property.id);
 assert.equal(metadata.definition_id,scoped.id);assert.equal(metadata.text_value,'October 2026');
 assert.equal(property.value,'October 2026');assert.equal(metadata.temporal_date_id,null,'a short-text definition does not acquire a typed date pointer');
 assert.equal(f.store.get('SELECT date_id FROM temporal_property_values WHERE property_id=?',property.id).date_id,'gregorian:month:2026-10','existing authoritative temporal evidence is retained');
});
