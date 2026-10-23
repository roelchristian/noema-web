import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
const fail=(fn,status=400)=>assert.throws(fn,error=>error.status===status);
function fixture(work){const db=openDatabase(':memory:');try{const store=new Store(db),knowledge=new Knowledge(store);work({db,store,knowledge});}finally{db.close();}}

test('typed writes validate native targets, scalars and cardinality while old clients preserve exact authored values',()=>fixture(({store,knowledge})=>{
 const person=knowledge.create('default',{name:'Typed Person',type:'person'}),wrong=knowledge.create('default',{name:'Wrong',type:'person'}),place=knowledge.create('default',{name:'Right',type:'place'});
 fail(()=>knowledge.property('default',person.id,{name:'birthplace',target_id:wrong.id,definition_id:'builtin:person:birthplace'}));
 const unresolved=knowledge.property('default',person.id,{name:'birthplace',value:'A historical settlement?',definition_id:'builtin:person:birthplace'}).properties[0];
 assert.equal(unresolved.metadata.compatibility,'unresolved');assert.equal(unresolved.target_id,null);
 fail(()=>knowledge.property('default',person.id,{name:'birthplace',target_id:place.id,definition_id:'builtin:person:birthplace'}),409);
 knowledge.remove('default',person.id,'properties',unresolved.id);
 const linked=knowledge.property('default',person.id,{name:'birthplace',target_id:place.id,definition_id:'builtin:person:birthplace'}).properties[0];assert.equal(linked.metadata.target_id,place.id);
 fail(()=>knowledge.property('default',person.id,{name:'website',value:'not a URL',definition_id:'builtin:person:website'}));
 const legacy=knowledge.property('default',person.id,{name:'website',value:'  authored invalid URL  '}).properties.find(p=>p.name==='website');
 assert.equal(legacy.value,'  authored invalid URL  ');assert.equal(legacy.metadata.compatibility,'legacy_incompatible');
 fail(()=>knowledge.property('default',person.id,{name:'website',value:legacy.value,definition_id:'builtin:person:website'},legacy.id));
 const edited=knowledge.property('default',person.id,{name:'website',value:' still authored ',definition_id:'builtin:person:website',compatibility_mode:'legacy'},legacy.id).properties.find(p=>p.id===legacy.id);
 assert.equal(edited.value,' still authored ');assert.equal(edited.id,legacy.id);
 fail(()=>knowledge.property('default',person.id,{name:'website',value:'bad',definition_id:'builtin:person:website',compatibility_mode:'legacy'}));
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','legacy-duplicate',person.id,'website','another old value',null);
 assert.equal(knowledge.detail('default',person.id).properties.filter(p=>p.name==='website').length,2);
 knowledge.property('default',person.id,{name:'website',value:'kept',definition_id:'builtin:person:website',compatibility_mode:'legacy'},legacy.id);
 assert.equal(store.get('SELECT value FROM properties WHERE id=?','legacy-duplicate').value,'another old value');
}));

test('typed dates use canonical temporal evidence and preserve partial precision, Julian calendar and approximate legacy literals',()=>fixture(({store,knowledge})=>{
 const person=knowledge.create('default',{name:'Temporal Person',type:'person'});
 const uncertain=knowledge.create('default',{name:'Uncertain Temporal Person',type:'person'});
 const unresolved=knowledge.property('default',uncertain.id,{name:'birth date',value:'circa 1815',definition_id:'builtin:person:birth_date'}).properties[0];
 assert.equal(unresolved.metadata.compatibility,'unresolved');assert.equal(unresolved.metadata.temporal_date_id,null);
 let value=knowledge.property('default',person.id,{name:'birth date',value:'1815-12',definition_id:'builtin:person:birth_date'}).properties[0];
 assert.equal(value.value,'1815-12');assert.equal(value.metadata.temporal_date_id,'gregorian:month:1815-12');assert.equal(value.metadata.text_value,null);
 const id=value.id;
 value=knowledge.property('default',person.id,{name:'birth date',value:'10 December 1815 (Julian)',definition_id:'builtin:person:birth_date'},id).properties[0];
 assert.equal(value.id,id);assert.equal(value.value,'10 December 1815 (Julian)');assert.equal(value.metadata.temporal_date_id,'julian:day:1815-12-10');
 fail(()=>knowledge.property('default',person.id,{name:'birth date',value:'not a supported date',definition_id:'builtin:person:birth_date'},id));
 value=knowledge.property('default',person.id,{name:'birth date',value:'circa 1815',definition_id:'builtin:person:birth_date'},id).properties[0];
 assert.equal(value.value,'circa 1815');assert.equal(value.metadata.compatibility,'unresolved');assert.equal(value.metadata.temporal_date_id,null);
 assert.ok(store.get('SELECT 1 FROM temporal_relations WHERE property_id=?',id),'earlier temporal evidence retained');
 const org=knowledge.create('default',{name:'Founded Organization',type:'organization'});
 value=knowledge.property('default',org.id,{name:'founded',value:'1901',definition_id:'builtin:organization:founded'}).properties[0];assert.equal(value.metadata.temporal_date_id,'gregorian:year:1901');
}));

test('indexable coordinates and custom integer/identifier definitions retain raw strings and scoped IDs',()=>fixture(({store,knowledge})=>{
 const place=knowledge.create('default',{name:'Coordinates',type:'place'});
 const coordinates=knowledge.property('default',place.id,{name:'coordinates',value:' 51.5, -0.12 ',definition_id:'builtin:place:coordinates'}).properties[0];
 assert.equal(coordinates.value,' 51.5, -0.12 ');assert.equal(coordinates.metadata.latitude,51.5);assert.equal(coordinates.metadata.longitude,-0.12);
 knowledge.addTypeProperty('default',{type:'person',subtype:'person:writer',name:'Edition'});
 const person=knowledge.create('default',{name:'Number Writer',type:'person',subtypes:['person:writer']});
 const def=knowledge.schema('default').propertyDefinitions.find(d=>d.legacyName==='Edition');
 store.run('UPDATE property_definitions SET definition_json=? WHERE vault_id=? AND id=?',JSON.stringify({...def,valueKind:'integer',validation:{min:1}}),'default',def.id);
 fail(()=>knowledge.property('default',person.id,{name:'Edition',value:'0',definition_id:def.id}));
 const integer=knowledge.property('default',person.id,{name:'Edition',value:'0012',definition_id:def.id}).properties[0];assert.equal(integer.value,'0012');assert.equal(integer.metadata.integer_value,12);
 assert.equal(store.get('SELECT integer_value FROM property_value_metadata WHERE property_id=?',integer.id).integer_value,12);
 const invalid=knowledge.create('default',{name:'Outside subtype',type:'person'});fail(()=>knowledge.property('default',invalid.id,{name:'Edition',value:'2',definition_id:def.id}));
}));


test('typed multiple values retain stable IDs and append order across edits and archive',()=>fixture(({store,knowledge})=>{
 const work=knowledge.create('default',{name:'Ordered Work',type:'creativework'}),first=knowledge.create('default',{name:'First Author',type:'person'}),second=knowledge.create('default',{name:'Second Author',type:'person'});
 knowledge.property('default',work.id,{name:'author',target_id:first.id,definition_id:'builtin:creativework:author'});
 let values=knowledge.property('default',work.id,{name:'author',target_id:second.id,definition_id:'builtin:creativework:author'}).properties;
 assert.deepEqual(values.map(value=>value.target_id),[first.id,second.id]);
 const ids=values.map(value=>value.id);assert.deepEqual(values.map(value=>value.metadata.position),[0,1]);
 fail(()=>knowledge.property('default',work.id,{name:'author',target_id:second.id,definition_id:'builtin:creativework:author'}),409);
 store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',first.id);
 knowledge.property('default',work.id,{name:'author',target_id:first.id,definition_id:'builtin:creativework:author'},ids[0]);
 values=knowledge.detail('default',work.id).properties;assert.deepEqual(values.map(value=>value.id),ids);assert.equal(values[0].target_id,first.id);
}));
