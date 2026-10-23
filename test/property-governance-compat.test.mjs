import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {EntityClassificationImpact} from '../src/server/modules/entity-classification-impact.ts';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
import {bindPropertyDefinition} from '../src/server/modules/property-storage.ts';
import {inheritedPropertyDefinitions,propertyDefinitionConflicts} from '../src/shared/property-definitions.ts';
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-governance-review-')),db=openDatabase(path.join(dir,'review.sqlite')),store=new Store(db);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 return {db,store,knowledge:new Knowledge(store),backups:new VaultBackups(store),classification:new EntityClassificationImpact(store),definitions:new PropertyDefinitionGovernance(store)};
}
const rejects=(work,status=400)=>assert.throws(work,error=>error.status===status);

test('Knowledge reclassification retains exact outgoing and archived incoming references through backup restore',async t=>{
 const {db,store,knowledge,backups,classification}=fixture(t);
 const place=knowledge.create('default',{name:'Review retained place',type:'place',subtypes:['place:city']}),owner=knowledge.create('default',{name:'Review archived owner',type:'person'});
 const coordinates=knowledge.property('default',place.id,{name:'coordinates',value:' 51.50, -0.120 ',definition_id:'builtin:place:coordinates'}).properties.find(p=>p.name==='coordinates');
 const reference=knowledge.property('default',owner.id,{name:'birthplace',target_id:place.id,definition_id:'builtin:person:birthplace'}).properties.find(p=>p.name==='birthplace');
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',owner.id);
 const snapshot=store.all('SELECT * FROM properties WHERE entity_id=? OR target_id=? ORDER BY id',place.id,place.id),before=store.get('SELECT total_changes() AS n').n;
 const impact=classification.preview('default',place.id,{type:'person',subtypes:[]});
 assert.equal(store.get('SELECT total_changes() AS n').n,before,'impact preview is read-only');
 assert.equal(impact.incoming.find(item=>item.propertyId===reference.id).archived,true);
 rejects(()=>knowledge.update('default',place.id,{name:place.name,type:'person',subtypes:[]}));
 knowledge.update('default',place.id,{name:place.name,type:'person',subtypes:[],classification_mode:'retain_legacy',impact_fingerprint:impact.fingerprint});
 assert.deepEqual(store.all('SELECT * FROM properties WHERE entity_id=? OR target_id=? ORDER BY id',place.id,place.id),snapshot);
 for(let i=0;i<2;i++){
  const outgoing=knowledge.detail('default',place.id).properties.find(p=>p.id===coordinates.id);
  assert.equal(outgoing.metadata.definition_id,'builtin:place:coordinates');assert.equal(outgoing.metadata.compatibility,'legacy_incompatible');assert.equal(outgoing.value,' 51.50, -0.120 ');
  const incoming=knowledge.detail('default',owner.id).properties.find(p=>p.id===reference.id);assert.equal(incoming.target_id,place.id);assert.equal(incoming.metadata.compatibility,'legacy_incompatible');
 }
 const archive=await backups.export('default'),restored=await backups.import(archive.bytes),restoredEntities=knowledge.list(restored.id);
 const retained=knowledge.detail(restored.id,restoredEntities.find(e=>e.name===place.name).id),archivedOwner=knowledge.detail(restored.id,restoredEntities.find(e=>e.name===owner.name).id);
 assert.equal(retained.type,'person');const restoredCoordinates=retained.properties.find(p=>p.name==='coordinates');assert.equal(restoredCoordinates.value,coordinates.value);assert.equal(restoredCoordinates.metadata.definition_id,'builtin:place:coordinates');assert.equal(restoredCoordinates.metadata.compatibility,'legacy_incompatible');
 assert.ok(archivedOwner.archived_at);assert.equal(archivedOwner.properties.find(p=>p.name==='birthplace').target_id,retained.id);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('separate stable definitions sharing a legacy name keep cardinality isolated and bindings on restore',async t=>{
 const {store,knowledge,definitions,backups}=fixture(t);
 const main=definitions.create('default',{name:'Review Shared Fact',key:'review_shared_main',scope:{kind:'main_type',type:'concept'},valueKind:'integer',cardinality:'one'});
 const scoped=definitions.create('default',{name:'Review Shared Fact',key:'review_shared_scoped',scope:{kind:'subtype',type:'concept',subtypeId:'concept:mathematics'},valueKind:'short_text',cardinality:'many'});
 const entity=knowledge.create('default',{name:'Review distinct definitions',type:'concept',subtypes:['concept:mathematics']});
 const scalar=knowledge.property('default',entity.id,{name:main.legacyName,value:'0012',definition_id:main.id}).properties[0];
 knowledge.property('default',entity.id,{name:scoped.legacyName,value:'authored text',definition_id:scoped.id});
 const values=knowledge.detail('default',entity.id).properties;
 const mainValue=values.find(p=>p.id===scalar.id),scopedValue=values.find(p=>p.value==='authored text');
 assert.equal(mainValue.metadata.definition_id,main.id);assert.equal(mainValue.metadata.compatibility,'valid');assert.equal(mainValue.metadata.integer_value,12);
 assert.equal(scopedValue.metadata.definition_id,scoped.id);assert.equal(scopedValue.metadata.compatibility,'valid');
 rejects(()=>knowledge.property('default',entity.id,{name:main.legacyName,value:'13',definition_id:main.id}),409);
 knowledge.property('default',entity.id,{name:scoped.legacyName,value:'another authored text',definition_id:scoped.id});
 assert.equal(knowledge.detail('default',entity.id).properties.find(p=>p.id===scalar.id).metadata.compatibility,'valid');
 const archive=await backups.export('default'),restored=await backups.import(archive.bytes),restoredEntity=knowledge.list(restored.id).find(e=>e.name===entity.name),restoredValues=knowledge.detail(restored.id,restoredEntity.id).properties;
 assert.equal(restoredValues.find(p=>p.value==='0012').metadata.definition_id,main.id);assert.equal(restoredValues.find(p=>p.value==='0012').metadata.compatibility,'valid');
 assert.equal(restoredValues.find(p=>p.value==='authored text').metadata.definition_id,scoped.id);
});

test('new existing-subtype catalogue references and identifiers round trip without adding future classifications',async t=>{
 const {db,knowledge,backups}=fixture(t);
 const person=knowledge.create('default',{name:'Review catalogue writer',type:'person',subtypes:['person:writer']}),book=knowledge.create('default',{name:'Review catalogue book',type:'creativework',subtypes:['creativework:book']}),language=knowledge.create('default',{name:'Review catalogue language',type:'culture',subtypes:['culture:language']});
 knowledge.property('default',person.id,{name:'published works',target_id:book.id,definition_id:'builtin:person:writer:published_works'});
 knowledge.property('default',book.id,{name:'isbn',value:'0000123456789',definition_id:'builtin:creativework:isbn'});
 knowledge.property('default',language.id,{name:'iso 639 code',value:'eng',definition_id:'builtin:culture:language:iso_639_code'});
 const schema=knowledge.schema('default');assert.equal(schema.subtypes.length,50);assert.ok(!schema.subtypes.some(s=>s.name==='Software'));
 const archive=await backups.export('default'),restored=await backups.import(archive.bytes),entities=knowledge.list(restored.id),restoredBook=entities.find(e=>e.name===book.name),restoredWriter=knowledge.detail(restored.id,entities.find(e=>e.name===person.name).id);
 assert.equal(restoredWriter.properties.find(p=>p.name==='published works').target_id,restoredBook.id);
 assert.equal(knowledge.detail(restored.id,restoredBook.id).properties.find(p=>p.name==='isbn').value,'0000123456789');
 assert.equal(knowledge.detail(restored.id,entities.find(e=>e.name===language.name).id).properties.find(p=>p.name==='iso 639 code').metadata.definition_id,'builtin:culture:language:iso_639_code');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});


test('catalogue upgrade exposes a semantic conflict without replacing a legacy scoped definition or authored literal',t=>{
 const {store,knowledge}=fixture(t),nativeId='builtin:person:writer:published_works';
 const native=JSON.parse(store.get('SELECT definition_json FROM property_definitions WHERE vault_id=? AND id=?','default',nativeId).definition_json);
 store.run('DELETE FROM property_definitions WHERE vault_id=? AND id=?','default',nativeId);
 const legacy={...native,id:'legacy:review:published-works',origin:'user_defined',valueKind:'short_text',allowedTargetTypes:[],allowedTargetSubtypes:[]};
 store.run('INSERT INTO property_definitions VALUES (?,?,?)','default',legacy.id,JSON.stringify(legacy));
 const entity=knowledge.create('default',{name:'Review legacy catalogue overlap',type:'person',subtypes:['person:writer']});
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','review-legacy-catalogue',entity.id,'published works','Original authored bibliography 0012',null);
 bindPropertyDefinition(store,'default','review-legacy-catalogue',legacy.id);
 const schema=knowledge.schema('default'),definitions=inheritedPropertyDefinitions(schema,'person',['person:writer']);
 assert.ok(schema.propertyDefinitions.some(d=>d.id===nativeId));assert.ok(schema.propertyDefinitions.some(d=>d.id===legacy.id));
 assert.ok(propertyDefinitionConflicts(definitions).some(conflict=>conflict.key==='published_works'));
 const property=knowledge.detail('default',entity.id).properties.find(p=>p.id==='review-legacy-catalogue');
 assert.equal(property.value,'Original authored bibliography 0012');assert.equal(property.metadata.definition_id,legacy.id);assert.equal(property.metadata.compatibility,'valid');
 rejects(()=>knowledge.property('default',entity.id,{name:'published works',value:'Another unresolved work',definition_id:nativeId}),409);
 knowledge.property('default',entity.id,{name:'published works',value:'Still authored 0012'},property.id);
 assert.equal(knowledge.detail('default',entity.id).properties.find(p=>p.id===property.id).metadata.definition_id,legacy.id);
});
