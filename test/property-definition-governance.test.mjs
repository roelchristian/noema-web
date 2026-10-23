import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
const fails=(work,status=400)=>assert.throws(work,error=>error.status===status);
function fixture(work){const db=openDatabase(':memory:');try{const store=new Store(db),knowledge=new Knowledge(store),governance=new PropertyDefinitionGovernance(store);work({db,store,knowledge,governance});}finally{db.close();}}
test('custom definitions add main/subtype fields and protect stable keys, scope and builtin definitions',()=>fixture(({store,knowledge,governance})=>{
 const definition=governance.create('default',{name:'Page Count',key:'page_count',scope:{kind:'main_type',type:'creativework'},valueKind:'integer',cardinality:'one',validation:{min:0},label:'Pages'});
 assert.match(definition.id,/^custom:/);assert.equal(definition.key,'page_count');
 assert.ok(knowledge.schema('default').properties.creativework.includes('Page Count'));
 const book=knowledge.create('default',{name:'Synthetic book',type:'creativework',subtypes:['creativework:book']});
 const value=knowledge.property('default',book.id,{name:'Page Count',value:'0012',definition_id:definition.id}).properties.find(item=>item.name==='Page Count');assert.equal(value.value,'0012');assert.equal(value.metadata.integer_value,12);
 const after=governance.update('default',definition.id,{label:'Number of Pages'});assert.equal(after.id,definition.id);assert.equal(after.key,'page_count');assert.equal(after.legacyName,'Page Count');
 for(const patch of [{key:'renamed'},{id:'renamed'},{name:'Renamed'},{scope:{kind:'subtype',type:'creativework',subtypeId:'creativework:book'}}])fails(()=>governance.update('default',definition.id,patch));
 fails(()=>governance.update('default','builtin:person:birth_date',{label:'Not protected'}),403);
 fails(()=>governance.create('default',{name:'Another birth date',key:'birth_date',scope:{kind:'subtype',type:'person',subtypeId:'person:writer'}}),409);
 governance.create('default',{name:'Shared custom name',key:'shared_custom',scope:{kind:'subtype',type:'person',subtypeId:'person:writer'}});
 fails(()=>governance.create('default',{name:'Shared custom name',key:'different_key',scope:{kind:'subtype',type:'person',subtypeId:'person:actor'}}),409);
 const other=new Vaults(store).create({name:'Other'});fails(()=>governance.impact(other.id,definition.id,{label:'Cross vault'}),404);
}));
test('readonly impact requires fresh explicit confirmation and preserves every incompatible/duplicate authored row',()=>fixture(({db,store,knowledge,governance})=>{
 const definition=governance.create('default',{name:'Legacy Count',scope:{kind:'subtype',type:'person',subtypeId:'person:writer'}});
 const person=knowledge.create('default',{name:'Writer',type:'person',subtypes:['person:writer']});
 knowledge.property('default',person.id,{name:'Legacy Count',value:'unknown edition'});knowledge.property('default',person.id,{name:'Legacy Count',value:'002'});
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',person.id);
 const before=store.all('SELECT * FROM properties WHERE entity_id=? ORDER BY id',person.id),changes=store.get('SELECT total_changes() AS n').n;
 const patch={valueKind:'integer',cardinality:'one'},impact=governance.impact('default',definition.id,patch);
 assert.equal(store.get('SELECT total_changes() AS n').n,changes);assert.equal(impact.affectedValues,2);assert.equal(impact.incompatible.length,2);
 fails(()=>governance.update('default',definition.id,patch),409);
 store.run('UPDATE properties SET value=? WHERE id=?','still authored',before[0].id);
 fails(()=>governance.update('default',definition.id,{...patch,impactFingerprint:impact.fingerprint,confirmCompatibility:true}),409);
 const fresh=governance.impact('default',definition.id,patch);governance.update('default',definition.id,{...patch,impactFingerprint:fresh.fingerprint,confirmCompatibility:true});
 assert.equal(JSON.stringify(store.all('SELECT id,name,target_id FROM properties WHERE entity_id=? ORDER BY id',person.id)),JSON.stringify(before.map(({id,name,target_id})=>({id,name,target_id}))));
 assert.equal(store.get('SELECT value FROM properties WHERE id=?',before[0].id).value,'still authored');
 assert.equal(store.all('SELECT * FROM property_value_metadata WHERE definition_id=?',definition.id).filter(item=>item.compatibility==='legacy_incompatible').length,2);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}));
test('reference constraints and introducing hierarchy detect archived targets and existing cycles without coercion',()=>fixture(({store,knowledge,governance})=>{
 const definition=governance.create('default',{name:'Parent Group',scope:{kind:'main_type',type:'organization'},valueKind:'entity_reference',allowedTargetTypes:['organization']});
 const a=knowledge.create('default',{name:'A',type:'organization'}),b=knowledge.create('default',{name:'B',type:'organization'});
 knowledge.property('default',a.id,{name:'Parent Group',target_id:b.id,definition_id:definition.id});knowledge.property('default',b.id,{name:'Parent Group',target_id:a.id,definition_id:definition.id});
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',b.id);
 const impact=governance.impact('default',definition.id,{validation:{hierarchical:true}});assert.equal(impact.incompatible.length,2);assert.ok(impact.incompatible.every(item=>item.reason.includes('cycle')));
 fails(()=>governance.update('default',definition.id,{validation:{hierarchical:true}}),409);
 governance.update('default',definition.id,{validation:{hierarchical:true},impactFingerprint:impact.fingerprint,confirmCompatibility:true});
 assert.equal(store.get('SELECT target_id FROM properties WHERE entity_id=?',a.id).target_id,b.id);
 assert.equal(governance.impact('default',definition.id,{allowedTargetTypes:['person']}).incompatible.length,2);
 fails(()=>governance.impact('default',definition.id,{valueKind:'short_text',allowedTargetTypes:[],allowedTargetSubtypes:[]}));
}));
test('custom definition validation rejects invalid target scopes and malformed constraints',()=>fixture(({governance})=>{
 const scope={kind:'main_type',type:'person'};
 for(const patch of [{valueKind:'enum'},{validation:{pattern:'['}},{validation:{min:4,max:2}},{valueKind:'short_text',allowedTargetTypes:['place']},{valueKind:'entity_reference',allowedTargetTypes:['person'],allowedTargetSubtypes:['culture:language']}])fails(()=>governance.create('default',{name:'Invalid',scope,...patch}));
}));
