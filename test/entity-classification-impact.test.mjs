import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {EntityClassificationImpact,assertNoHierarchyCycle} from '../src/server/modules/entity-classification-impact.ts';
import {propertyDefinitionFor} from '../src/shared/property-definitions.ts';
import {syncPropertyMetadata} from '../src/server/modules/property-storage.ts';
const reject=(work,status=400)=>assert.throws(work,error=>error.status===status);
function fixture(work){const db=openDatabase(':memory:');try{const store=new Store(db);work({db,store,knowledge:new Knowledge(store),impact:new EntityClassificationImpact(store)});}finally{db.close();}}

test('classification impact is read-only, includes archived incoming references and requires explicit retention',()=>fixture(({store,knowledge,impact})=>{
 const place=knowledge.create('default',{name:'A Place',type:'place'}),person=knowledge.create('default',{name:'Archived Person',type:'person'});
 knowledge.property('default',person.id,{name:'birthplace',target_id:place.id,definition_id:'builtin:person:birthplace'});
 knowledge.property('default',place.id,{name:'coordinates',value:'20, 30',definition_id:'builtin:place:coordinates'});
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',person.id);
 const rows=store.all('SELECT * FROM properties WHERE entity_id=? OR target_id=? ORDER BY id',place.id,place.id);
 const count=store.get('SELECT total_changes() AS count').count;
 const preview=impact.preview('default',place.id,{type:'person',subtypes:[]});
 assert.equal(store.get('SELECT total_changes() AS count').count,count);
 assert.equal(preview.incoming.length,1);assert.equal(preview.incoming[0].archived,true);assert.equal(preview.outgoing.length,1);assert.equal(preview.requiresConfirmation,true);
 reject(()=>impact.assertAllowed('default',place.id,{type:'person',subtypes:[]}));
 assert.equal(impact.assertAllowed('default',place.id,{type:'person',subtypes:[]},{mode:'retain_legacy',fingerprint:preview.fingerprint}).fingerprint,preview.fingerprint);
 store.run("UPDATE entities SET type='person',subtypes='[]' WHERE id=?",place.id);
 impact.afterChange('default',place.id,preview);
 assert.deepEqual(store.all('SELECT * FROM properties WHERE entity_id=? OR target_id=? ORDER BY id',place.id,place.id),rows);
 const reference=rows.find(row=>row.target_id===place.id),metadata=store.get('SELECT * FROM property_value_metadata WHERE property_id=?',reference.id);
 assert.equal(metadata.compatibility,'legacy_incompatible');assert.equal(metadata.target_id,null);
 const coordinates=rows.find(row=>row.name==='coordinates'),retained=store.get('SELECT * FROM property_value_metadata WHERE property_id=?',coordinates.id);
 assert.equal(retained.definition_id,'builtin:place:coordinates');assert.equal(retained.compatibility,'legacy_incompatible');
}));

test('subtype removal preserves bound authored values and stale impact tokens are rejected',()=>fixture(({store,knowledge,impact})=>{
 knowledge.addTypeProperty('default',{type:'person',subtype:'person:actor',name:'Legacy Stage Note'});
 const entity=knowledge.create('default',{name:'Actor',type:'person',subtypes:['person:actor']});
 knowledge.property('default',entity.id,{name:'Legacy Stage Note',value:'exact 0012'});
 const preview=impact.preview('default',entity.id,{type:'person',subtypes:[]});assert.equal(preview.outgoing.length,1);
 store.run('UPDATE properties SET value=? WHERE entity_id=?','changed after preview',entity.id);
 reject(()=>impact.assertAllowed('default',entity.id,{type:'person',subtypes:[]},{mode:'retain_legacy',fingerprint:preview.fingerprint}),409);
 const fresh=impact.preview('default',entity.id,{type:'person',subtypes:[]});
 const definitionId=store.get('SELECT definition_id FROM property_value_metadata WHERE property_id=?',fresh.outgoing[0].propertyId).definition_id;
 store.run("UPDATE entities SET subtypes='[]' WHERE id=?",entity.id);impact.afterChange('default',entity.id,fresh);
 assert.equal(store.get('SELECT definition_id FROM property_value_metadata WHERE property_id=?',fresh.outgoing[0].propertyId).definition_id,definitionId);
 assert.equal(store.get('SELECT value FROM properties WHERE entity_id=?',entity.id).value,'changed after preview');
 reject(()=>impact.preview('default',entity.id,{type:'place',subtypes:['person:actor']}));
 const other=new Vaults(store).create({name:'Other'});reject(()=>impact.preview(other.id,entity.id,{type:'person',subtypes:[]}),404);
}));

test('target subtype loss previews language-reference impact and schema edits invalidate confirmation',()=>fixture(({store,knowledge,impact})=>{
 const language=knowledge.create('default',{name:'A Language',type:'culture',subtypes:['culture:language']}),work=knowledge.create('default',{name:'A Work',type:'creativework'});
 const property=knowledge.property('default',work.id,{name:'language',target_id:language.id,definition_id:'builtin:creativework:language'}).properties.find(row=>row.name==='language');
 const preview=impact.preview('default',language.id,{type:'culture',subtypes:[]});assert.equal(preview.incoming[0].propertyId,property.id);
 const row=store.get('SELECT definition_json FROM property_definitions WHERE vault_id=? AND id=?','default','builtin:creativework:language');
 const definition=JSON.parse(row.definition_json);definition.description='Meaning reviewed after preview';store.run('UPDATE property_definitions SET definition_json=? WHERE vault_id=? AND id=?',JSON.stringify(definition),'default',definition.id);
 reject(()=>impact.assertAllowed('default',language.id,{type:'culture',subtypes:[]},{mode:'retain_legacy',fingerprint:preview.fingerprint}),409);
}));

test('unchanged classification never strands historical incompatible or orphan authored data',()=>fixture(({store,knowledge,impact})=>{
 const entity=knowledge.create('default',{name:'Historical Person',type:'person'});
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','orphan',entity.id,'Historical unmanaged key','uncertain 001',null);
 const preview=impact.assertAllowed('default',entity.id,{type:'person',subtypes:[]});assert.equal(preview.requiresConfirmation,false);
 assert.deepEqual(preview.outgoing,[]);assert.equal(store.get('SELECT value FROM properties WHERE id=?','orphan').value,'uncertain 001');
}));

test('hierarchical guards include archived name-only paths, aliases and unchanged legacy cycles',()=>fixture(({store,knowledge})=>{
 const a=knowledge.create('default',{name:'A',type:'organization'}),b=knowledge.create('default',{name:'B',type:'organization'}),c=knowledge.create('default',{name:'C',type:'organization'});
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','parent-a',a.id,'Parent Company',null,b.id);
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','parent-b',b.id,'parent organization',null,c.id);
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',b.id);
 reject(()=>assertNoHierarchyCycle(store,'default',c.id,a.id,'parent_organization'),409);
 reject(()=>assertNoHierarchyCycle(store,'default',c.id,c.id,'parent_organization'),409);
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','old-cycle',c.id,'Parent Organization',null,a.id);
 assert.doesNotThrow(()=>assertNoHierarchyCycle(store,'default',c.id,a.id,'parent_organization','old-cycle'));
 reject(()=>assertNoHierarchyCycle(store,'default',c.id,b.id,'parent_organization','old-cycle'),409);
 assert.doesNotThrow(()=>assertNoHierarchyCycle(store,'default',c.id,a.id,'collaborator'));
}));

test('enabling hierarchy on a custom key previews cycles across existing plain legacy links',()=>fixture(({store,knowledge})=>{
 const a=knowledge.create('default',{name:'Mentor A',type:'person'}),b=knowledge.create('default',{name:'Mentor B',type:'person'});
 knowledge.addTypeProperty('default',{type:'person',subtype:'person:researcher',name:'Mentor Chain'});
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','mentor-a',a.id,'Mentor Chain',null,b.id);
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','mentor-b',b.id,'Mentor Chain',null,a.id);
 const definition={...propertyDefinitionFor('person','birthplace'),id:'fixture:mentor',key:'mentor_chain',legacyName:'Mentor Chain',scope:{kind:'main_type',type:'person'},origin:'user_defined',allowedTargetTypes:['person'],allowedTargetSubtypes:[],validation:{hierarchical:false}};
 store.run('INSERT INTO property_definitions VALUES (?,?,?)','default',definition.id,JSON.stringify(definition));syncPropertyMetadata(store,'default');
 reject(()=>assertNoHierarchyCycle(store,'default',a.id,b.id,{...definition,validation:{hierarchical:true}}),409);
}));

test('classification preview distinguishes consulted Sources from Creative Works with attached evidence',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-classification-source-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),files=new SourceFiles(store);
 try {
  const knowledge=new Knowledge(store),file=files.add('default','consulted.md',Buffer.from('Synthetic consulted material'));
  const source=knowledge.create('default',{name:'Consulted copy',type:'source',attachmentIds:[file.id]});
  const impact=new EntityClassificationImpact(store),preview=impact.preview('default',source.id,{type:'creativework',subtypes:['creativework:article']});
  assert.ok(preview.structuralBlockers.length);reject(()=>impact.assertAllowed('default',source.id,preview.proposed,{mode:'retain_legacy',fingerprint:preview.fingerprint}));
  assert.equal(knowledge.require('default',source.id).type,'source');assert.equal(store.get('SELECT entity_id FROM source_files WHERE id=?',file.id).entity_id,source.id);
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
