import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inventoryProperties} from '../src/server/modules/property-inventory.ts';

function fixture(filename=':memory:') {
 const db=new DatabaseSync(filename);
 db.exec(`CREATE TABLE entities (id TEXT PRIMARY KEY,vault_id TEXT,type TEXT,subtypes TEXT,archived_at TEXT);
 CREATE TABLE properties (id TEXT PRIMARY KEY,entity_id TEXT,name TEXT,value TEXT,target_id TEXT);
 INSERT INTO entities VALUES ('person','fixture','person','["a","b"]',NULL),('place','fixture','place','[]','2020'),('wrong','fixture','person','[]',NULL),('foreign','other','place','[]',NULL),('source','fixture','source','[]',NULL);
 INSERT INTO properties VALUES ('birth1','person','birth date','some day',NULL),('birth2','person','Birth Date','1900',NULL),('url','person','website','not a url',NULL),('archived','person','birthplace',NULL,'place'),('wrong-type','person','birthplace',NULL,'wrong'),('foreign','person','birthplace',NULL,'foreign'),('missing','person','birthplace',NULL,'missing'),('unresolved','person','birthplace','uncertain village',NULL),('source-url','source','Source URL','https://example.com',NULL);
 CREATE TABLE entity_subtypes(id TEXT,vault_id TEXT,type TEXT,name TEXT);
 INSERT INTO entity_subtypes VALUES ('a','fixture','person','A'),('b','fixture','person','B'),('other','other','person','Other');
 CREATE TABLE entity_subtype_properties(vault_id TEXT,subtype_id TEXT,name TEXT);
 INSERT INTO entity_subtype_properties VALUES ('fixture','a','Shared'),('fixture','b','shared');
 CREATE TABLE temporal_property_values(property_id TEXT,vault_id TEXT,date_id TEXT,reason TEXT);
 INSERT INTO temporal_property_values VALUES ('birth1','fixture',NULL,'unresolved legacy date');
 CREATE TABLE temporal_relations(property_id TEXT,vault_id TEXT,date_id TEXT);
 INSERT INTO temporal_relations VALUES ('birth2','fixture','1900');`);
 return db;
}
test('inventory is read-only and reports legacy values, references, cardinality and stored temporal evidence',()=>{
 const db=fixture();
 try {
  db.exec('PRAGMA query_only=ON');
  const before=db.prepare('SELECT * FROM properties ORDER BY id').all();
  const report=inventoryProperties(db,'fixture');
  assert.equal(report.totalProperties,9);
  assert.deepEqual(report.caseVariants,[{key:'birth_date',names:['birth date','Birth Date']}]);
  assert.ok(report.incompatible.some(row=>row.propertyId==='birth1'&&row.reason==='ambiguous-or-unsupported-date'));
  assert.ok(report.incompatible.some(row=>row.propertyId==='url'));
  assert.ok(report.cardinalityViolations.some(row=>row.key==='birth_date'&&row.propertyIds.length===2));
  assert.deepEqual(report.problematicReferences.map(row=>row.reasons),[['archived'],['target-type'],['cross-vault'],['dangling']]);
  assert.deepEqual(report.representation.unresolvedLiterals,['unresolved']);
  assert.equal(report.legacyDates[0].evidence[0].reason,'unresolved legacy date');
  assert.equal(report.legacyDates[1].relations[0].date_id,'1900');
  assert.equal(report.systemManagedProperties[0].propertyId,'source-url');
  assert.equal(report.customSubtypeDefinitions.length,2);
  assert.equal(report.subtypeOverlaps[0].status,'requires-definition-comparison');
  assert.deepEqual(db.prepare('SELECT * FROM properties ORDER BY id').all(),before);
  assert.equal(inventoryProperties(db,'other').totalProperties,0);
 } finally {db.close();}
});
test('CLI opens only an explicit fixture read-only and does not migrate a legacy database',()=>{
 const directory=mkdtempSync(join(tmpdir(),'noema-inventory-'));
 try {
  const filename=join(directory,'legacy.sqlite'),db=fixture(filename);db.close();
  const result=spawnSync(process.execPath,['--import','tsx','scripts/property-inventory.mjs',filename,'fixture'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).totalProperties,9);
  const reopened=new DatabaseSync(filename,{readOnly:true});
  try {assert.equal(reopened.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name='schema_migrations'").get().count,0);}finally{reopened.close();}
  const missing=spawnSync(process.execPath,['--import','tsx','scripts/property-inventory.mjs'],{encoding:'utf8'});assert.equal(missing.status,2);
 } finally {rmSync(directory,{recursive:true,force:true});}
});

test('legacy single subtype column remains visible without migrating entities',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(`CREATE TABLE entities(id TEXT,vault_id TEXT,type TEXT,subtype TEXT);
   INSERT INTO entities VALUES ('work','fixture','creativework','creativework:book'),('language','fixture','culture','culture:language');
   CREATE TABLE properties(id TEXT,entity_id TEXT,name TEXT,value TEXT,target_id TEXT);
   INSERT INTO properties VALUES ('language-ref','work','language',NULL,'language');`);
  db.exec('PRAGMA query_only=ON');
  const report=inventoryProperties(db,'fixture');
  assert.deepEqual(report.problematicReferences,[]);
  assert.equal(report.totalProperties,1);
 } finally {db.close();}
});
