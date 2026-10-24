import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {TemporalProperties} from '../src/server/modules/temporal-properties.ts';
import {setupPropertyStorage,persistedPropertyDefinitions,syncPropertyMetadata,propertyMetadata} from '../src/server/modules/property-storage.ts';
import {classifyPropertyValue,validatePropertyValue} from '../src/shared/property-values.ts';
import {propertyDefinitionFor} from '../src/shared/property-definitions.ts';

const authored=db=>db.prepare('SELECT id,entity_id,name,value,target_id FROM properties ORDER BY id').all().map(row=>({...row}));
function removeTypedSchema(db){
 for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'property_metadata_%' OR name LIKE 'property_same_vault_%' OR name='entity_property_metadata_invalidate' OR name='entity_property_vault_move' OR name='property_owner_vault_move')").all())db.exec(`DROP TRIGGER ${row.name}`);
 db.exec('DROP TABLE property_value_metadata; DROP TABLE property_definitions; DELETE FROM schema_migrations WHERE version=5');
}
test('additive legacy migration preserves exact authored rows, IDs, duplicates and incompatible states and is idempotent',()=>{
 const directory=mkdtempSync(join(tmpdir(),'noema-property-migration-')),filename=join(directory,'fixture.sqlite');let db=openDatabase(filename);
 try {
  const other=new Vaults(new Store(db)).create({name:'Legacy reference vault'});
  const foreign=new Knowledge(new Store(db)).create(other.id,{name:'Legacy cross-vault target',type:'place'});
  db.prepare("DELETE FROM properties WHERE entity_id='ursula' AND name='birthplace'").run();
  removeTypedSchema(db);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-cross-vault','ursula','Legacy Foreign Ref',null,foreign.id);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-date','ursula','birth date','circa 1929',null);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-date-2','ursula','birth date','10/21/1929',null);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-url','ursula','website','unreviewed legacy address',null);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-ref','ursula','birthplace','uncertain historical village',null);
  db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-orphan','ursula','Unusual Field','000123',null);
  new TemporalProperties(new Store(db)).refresh('default',100);
  const temporalBefore=db.prepare('SELECT * FROM temporal_property_values ORDER BY property_id').all().map(row=>({...row}));
  const dirtyBefore=db.prepare('SELECT * FROM temporal_property_dirty ORDER BY property_id').all().map(row=>({...row}));
  const before=authored(db);db.close();db=openDatabase(filename);
  assert.deepEqual(db.prepare('SELECT * FROM temporal_property_values ORDER BY property_id').all().map(row=>({...row})),temporalBefore);
  assert.deepEqual(db.prepare('SELECT * FROM temporal_property_dirty ORDER BY property_id').all().map(row=>({...row})),dirtyBefore);
  assert.deepEqual(authored(db),before);
  let metadata=propertyMetadata(new Store(db),'default','ursula');
  assert.equal(metadata.get('legacy-date').compatibility,'legacy_incompatible');
  assert.equal(metadata.get('legacy-url').compatibility,'legacy_incompatible');
  assert.equal(metadata.get('legacy-ref').compatibility,'unresolved');
  assert.equal(metadata.get('legacy-orphan').text_value,'000123');
  assert.equal(metadata.get('legacy-cross-vault').compatibility,'legacy_incompatible');
  assert.equal(metadata.get('legacy-cross-vault').target_id,null);
  assert.match(metadata.get('legacy-cross-vault').reason,/another vault/);
  assert.equal(db.prepare('SELECT target_id FROM properties WHERE id=?').get('legacy-cross-vault').target_id,foreign.id);
  const count=db.prepare('SELECT count(*) n FROM property_definitions').get().n;
  db.exec('DELETE FROM schema_migrations WHERE version=5');setupPropertyStorage(db);
  assert.deepEqual(authored(db),before);assert.equal(db.prepare('SELECT count(*) n FROM property_definitions').get().n,count);
  db.close();db=openDatabase(filename);assert.deepEqual(authored(db),before);
 } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
test('typed custom subtype definitions remain scoped; raw legacy workflows invalidate mirrors and preserve stable order',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),knowledge=new Knowledge(store);
  const actor=knowledge.create('default',{name:'Actor',type:'person',subtypes:['person:actor']});
  knowledge.addTypeProperty('default',{type:'person',subtype:'person:actor',name:'credits'});
  const definitions=persistedPropertyDefinitions(store,'default'),custom=definitions.find(item=>item.legacyName==='credits');
  assert.equal(custom.scope.kind,'subtype');
  store.run('UPDATE property_definitions SET definition_json=? WHERE vault_id=? AND id=?',JSON.stringify({...custom,valueKind:'integer'}),'default',custom.id);
  store.run('INSERT INTO properties VALUES (?,?,?,?,?)','credits-1',actor.id,'credits','007',null);
  syncPropertyMetadata(store,'default',actor.id);
  assert.equal(propertyMetadata(store,'default',actor.id).get('credits-1').integer_value,7);
  assert.equal(persistedPropertyDefinitions(store,'default').filter(item=>item.legacyName==='credits').length,1);
  store.run('UPDATE property_value_metadata SET position=9 WHERE property_id=?','credits-1');
  store.run('INSERT INTO properties VALUES (?,?,?,?,?)','aaa-sorts-first',actor.id,'credits','2',null);
  syncPropertyMetadata(store,'default',actor.id);
  assert.equal(propertyMetadata(store,'default',actor.id).get('aaa-sorts-first').position,10);
  assert.equal(propertyMetadata(store,'default',actor.id).get('credits-1').position,9);
  store.run('UPDATE properties SET value=? WHERE id=?','legacy authored note','credits-1');
  assert.equal(store.get('SELECT integer_value FROM property_value_metadata WHERE property_id=?','credits-1').integer_value,null);
  const value=propertyMetadata(store,'default',actor.id).get('credits-1');assert.equal(value.position,9);assert.equal(value.compatibility,'legacy_incompatible');
  const changes=store.get('SELECT total_changes() n').n;
  propertyMetadata(store,'default',actor.id);propertyMetadata(store,'default',actor.id);
  assert.equal(store.get('SELECT total_changes() n').n,changes,'steady metadata reads do not write unchanged mirrors');
  assert.equal(store.get('SELECT value FROM properties WHERE id=?','credits-1').value,'legacy authored note');
 } finally {db.close();}
});
test('new references and typed mirrors enforce vault ownership while archived references survive',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),knowledge=new Knowledge(store),other=new Vaults(store).create({name:'Other'});
  const foreign=knowledge.create(other.id,{name:'Foreign',type:'place'});
  assert.throws(()=>store.run('INSERT INTO properties VALUES (?,?,?,?,?)','bad-ref','ursula','birthplace',null,foreign.id),/same vault/);
  store.run("DELETE FROM properties WHERE entity_id='ursula' AND name='birthplace'");
  const target=knowledge.create('default',{name:'Archived location',type:'place'});
  store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-01-01',target.id);
  store.run('INSERT INTO properties VALUES (?,?,?,?,?)','archive-ref','ursula','birthplace',null,target.id);
  const metadata=propertyMetadata(store,'default','ursula').get('archive-ref');assert.equal(metadata.target_id,target.id);assert.equal(metadata.compatibility,'valid');
  const definition=persistedPropertyDefinitions(store,other.id).find(item=>item.id==='builtin:person:birthplace');
  assert.throws(()=>store.run('UPDATE property_value_metadata SET vault_id=?,definition_id=?,target_id=? WHERE property_id=?',other.id,definition.id,foreign.id,'archive-ref'),/owner vault/);
  assert.throws(()=>store.run('UPDATE entities SET vault_id=? WHERE id=?',other.id,target.id),/impact path/);
  store.run('INSERT INTO properties VALUES (?,?,?,?,?)','scalar-owner-move','ursula','nationality','preserved',null);
  syncPropertyMetadata(store,'default','ursula');
  assert.throws(()=>store.run('UPDATE properties SET entity_id=? WHERE id=?',foreign.id,'scalar-owner-move'),/impact path/);
  assert.equal(store.get('SELECT entity_id FROM properties WHERE id=?','scalar-owner-move').entity_id,'ursula');
 } finally {db.close();}
});
test('typed scalar validation preserves identifiers, tri-state booleans, precision and rejects invalid civil timestamps',()=>{
 const base=propertyDefinitionFor('person','nationality');
 const classify=(kind,raw,validation={})=>classifyPropertyValue({...base,valueKind:kind,validation},{name:'test',value:raw,target_id:null});
 assert.equal(classify('identifier','000123').text_value,'000123');
 const reference={name:'custom',value:null,target_id:'person-id'},target={type:'person',subtypes:[],vault_id:'default'};
 assert.equal(classifyPropertyValue({...base,origin:'user_defined'},reference,target).compatibility,'legacy_incompatible');
 assert.match(validatePropertyValue({...base,origin:'user_defined'},reference,target),/scalar/);
 assert.equal(classify('boolean','false').boolean_value,0);assert.equal(classify('boolean','unknown').compatibility,'unknown');
 assert.equal(classify('integer','01').integer_value,1);assert.equal(classify('integer','2.3').compatibility,'legacy_incompatible');
 assert.equal(classify('integer','3',{min:4}).compatibility,'legacy_incompatible');
 assert.equal(classify('quantity','2.5 km').unit,'km');assert.equal(classify('coordinates','91, 180').compatibility,'legacy_incompatible');
 assert.equal(classify('date','1929').compatibility,'valid');assert.equal(classify('date','circa 1929').compatibility,'valid');
 assert.equal(classify('date','10/21/1929').compatibility,'unresolved');
 assert.equal(classify('date','30 February 2026').compatibility,'legacy_incompatible');
 const approximate=classifyPropertyValue({...base,valueKind:'date'},{name:'birth date',value:'circa 1815',target_id:null});
 assert.equal(approximate.compatibility,'valid');assert.equal(approximate.temporal_date_id,null);
 assert.equal(validatePropertyValue({...base,valueKind:'date'},{name:'birth date',value:'circa 1815',target_id:null}),null);
 for(const raw of ['2026-02-30T12:00:00Z','2026-01-01T24:00:00Z','2026-01-01T12:00:00'])assert.equal(classify('datetime',raw).compatibility,'legacy_incompatible');
 assert.equal(classify('datetime','2024-02-29T12:00:00+05:30').compatibility,'valid');
 assert.equal(validatePropertyValue({...base,valueKind:'identifier',validation:{pattern:'^\\d{6}$'}},{name:'id',value:'000123',target_id:null}),null);
});
