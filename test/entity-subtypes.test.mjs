import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import {builtinSubtypes} from '../src/shared/entity-schema.ts';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
import { Vaults } from '../src/server/modules/vaults.ts';

const rejects = (work, status = 400) => assert.throws(work, error => error.status === status);

test('subtype icon preferences persist, inherit defaults, and resolve multiple and custom subtypes',async()=>{
 const {defaultAppearance,parseAppearance}=await import('../src/client/settings/appearance.ts');
 const {resolveEntityIcon,entityIconName}=await import('../src/shared/entity-icons.ts');
 const book={type:'creativework',subtypes:['creativework:book']},song={type:'creativework',subtypes:['creativework:song']};
 assert.equal(resolveEntityIcon(book),'book');assert.equal(resolveEntityIcon(song),'music');
 assert.equal(resolveEntityIcon({type:'person',subtypes:['person:writer']}),null);
 assert.equal(resolveEntityIcon({type:'person'}),null);
 assert.equal(entityIconName({type:'person'}),'person');
 const appearance=defaultAppearance();appearance.subtypeIcons={'creativework:song':'star','creativework:book':null,'custom-id':'feather'};
 const restored=parseAppearance(JSON.stringify(appearance));assert.deepEqual(restored.subtypeIcons,appearance.subtypeIcons);
 assert.equal(resolveEntityIcon(song,restored.subtypeIcons),'star');assert.equal(resolveEntityIcon(book,restored.subtypeIcons),null);
 assert.equal(resolveEntityIcon({type:'creativework',subtypes:['custom-id']},restored.subtypeIcons),'feather');
 assert.equal(resolveEntityIcon({type:'creativework',subtypes:['creativework:book','creativework:song']},{'creativework:song':'star'}),'star');
 assert.equal(entityIconName({...song,icon:'star'}),'page:star');assert.equal(entityIconName({...song,icon:null}),'creativework');
 assert.equal(parseAppearance('{"subtypeIcons":{"creativework:song":"<svg>","custom-id":42}}').subtypeIcons['creativework:song'],undefined);
 assert.deepEqual(parseAppearance('{"subtypeIcons":[]}').subtypeIcons,{});
});

test('subtype icons render in mentions and update existing editable mentions without changing their text',async t=>{
 const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const {Icon,SubtypeIconContext}=await import('../src/client/components/Icon.tsx');
 const {pageIcons}=await import('../src/shared/page-icons.ts');
 const {segmentHTML,syncEditableSegments,readSegments}=await import('../src/client/editor/segments.tsx');
 const {setupDOM}=await import('./helpers/dom.mjs');setupDOM(t);
 const song={id:'song',vault_id:'default',name:'A song',type:'creativework',subtypes:['creativework:song'],description:'',updated_at:''};
 const path=id=>pageIcons.find(item=>item.id===id).path;
 assert.ok(renderToStaticMarkup(createElement(SubtypeIconContext.Provider,{value:{'creativework:song':'star'}},createElement(Icon,{name:song.type,entity:song}))).includes(path('star')));
 const content=[{text:'Listen to '},{entityId:song.id},{text:' today.'}],editor=document.createElement('div');document.body.append(editor);
 editor.innerHTML=segmentHTML(content,[song]);assert.equal(editor.querySelector('.mention path').getAttribute('d'),path('music'));
 syncEditableSegments(editor,content,[{...song,icon:'star'}],{blockId:'test'});
 assert.equal(editor.querySelector('.mention path').getAttribute('d'),path('star'));assert.deepEqual(readSegments(editor),content);assert.equal(editor.textContent,'Listen to A song today.');
});

test('subtypes inherit category fields and own scoped definitions while values remain entity-specific', () => {
  const db = openDatabase(':memory:');
  try {
    const knowledge = new Knowledge(new Store(db));
    const actor = knowledge.create('default', {name: 'An actor', type: 'person', subtype: 'person:actor'});
    const writer = knowledge.create('default', {name: 'A writer', type: 'person', subtype: 'person:writer'});
    assert.ok(actor.propertyNames.includes('birthplace'));
    const withBirthplace = knowledge.property('default', actor.id, {name: 'birthplace', target_id: 'berkeley'});
    assert.equal(withBirthplace.properties[0].target_id, 'berkeley');
    assert.equal(knowledge.detail('default', writer.id).properties.length, 0);
    rejects(() => knowledge.property('default', actor.id, {name: 'synthetic actor credit', value: 'Award'}));
    rejects(() => knowledge.property('default', actor.id, {name: 'synthetic actor credit', value: 'Award'}, withBirthplace.properties[0].id));
    rejects(() => knowledge.addSubtype('default', {type: 'person', name: 'Director', properties: ['synthetic actor credit']}));
    knowledge.addTypeProperty('default', {type: 'person', subtype:'person:actor',name: 'synthetic actor credit'});
    knowledge.property('default', actor.id, {name: 'synthetic actor credit', value: 'Award'});
    assert.ok(!knowledge.detail('default', writer.id).propertyNames.includes('synthetic actor credit'));
    const otherActor=knowledge.create('default',{name:'Another actor',type:'person',subtypes:['person:actor']});
    assert.ok(otherActor.propertyNames.includes('synthetic actor credit'));assert.deepEqual(otherActor.properties,[]);
    assert.equal(knowledge.detail('default', writer.id).properties.length, 0);
    rejects(()=>knowledge.property('default','ursula',{name:'unknown synthetic field',value:'Writer'}));
    rejects(()=>knowledge.addTypeProperty('default',{type:'person',name:'occupation'}));
    assert.deepEqual(knowledge.update('default',actor.id,{name: 'Renamed',type: 'person'}).subtypes, ['person:actor']);
    rejects(()=>knowledge.update('default',actor.id,{name:'Renamed',type:'person',subtypes:[]}));
    const award=knowledge.detail('default',actor.id).properties.find(p=>p.name==='synthetic actor credit');knowledge.remove('default',actor.id,'properties',award.id);
    assert.deepEqual(knowledge.update('default',actor.id,{name:'Renamed',type:'person',subtypes:[]}).subtypes,[]);
    rejects(() => knowledge.create('default', {name: 'Wrong parent', type: 'place', subtype: 'person:actor'}));
    rejects(() => knowledge.create('default', {name: 'Unknown', type: 'person', subtype: 'missing'}));
    rejects(() => knowledge.update('default',writer.id,{name: 'Wrong parent',type: 'place',subtype: 'person:writer'}));
    // Switching parents must not silently create fields through a subtype.
    rejects(() => knowledge.update('default',actor.id,{name: 'Renamed',type: 'place',subtype: 'place:city'}));
    assert.equal(knowledge.require('default',actor.id).type, 'person');
    knowledge.remove('default',actor.id,'properties',withBirthplace.properties[0].id);
    assert.ok(knowledge.schema('default').properties.person.includes('birthplace'));
  } finally { db.close(); }
});

test('custom subtypes and properties are scoped to their vault and persist across restarts', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'noema-subtypes-'));
  const filename = path.join(dir,'test.sqlite');
  let db = openDatabase(filename);
  try {
    let store = new Store(db), knowledge = new Knowledge(store);
    const vault = new Vaults(store).create({name: 'Other vault'});
    const schema = knowledge.addSubtype('default',{type: 'person',name: 'Field researcher'});
    const subtype = schema.subtypes.find(s => s.name === 'Field researcher');
    assert.ok(subtype);
    rejects(() => knowledge.addSubtype('default',{type: 'person',name: ' field researcher '}),409);
    rejects(() => knowledge.addSubtype('default',{type: 'person',name: 'ACTOR'}),409);
    rejects(() => knowledge.addSubtype('default',{type: 'person:actor',name: 'Nested'}));
    rejects(() => knowledge.create(vault.id,{name: 'Wrong vault',type: 'person',subtype: subtype.id}));
    knowledge.addTypeProperty('default',{type: 'person',subtype:subtype.id,name: 'research area'});
    assert.equal(knowledge.schema(vault.id).subtypeProperties[subtype.id],undefined);
    const researcher = knowledge.create('default',{name: 'Field researcher',type: 'person',subtype: subtype.id});
    knowledge.property('default',researcher.id,{name: 'research area',value: 'Ecology'});
    // Existing fields are imported on migration without losing values.
    db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-property','ursula','legacy field','preserved',null);
    db.prepare('DELETE FROM schema_migrations WHERE version=2').run();
    db.close(); db = openDatabase(filename);
    store = new Store(db); knowledge = new Knowledge(store);
    assert.deepEqual(knowledge.detail('default',researcher.id).subtypes,[subtype.id]);
    assert.equal(knowledge.detail('default',researcher.id).properties[0].value,'Ecology');
    assert.ok(knowledge.schema('default').properties.person.includes('legacy field'));
    assert.equal(knowledge.detail('default','ursula').properties.find(p => p.id === 'legacy-property').value,'preserved');
    assert.ok(knowledge.schema(vault.id).subtypes.some(s => s.id === 'person:writer'));
  } finally { db.close(); rmSync(dir,{recursive: true,force: true}); }
});


test('multiple subtypes can be added, removed, validated and saved without creating subtype fields', () => {
  const db = openDatabase(':memory:');
  try {
    const knowledge = new Knowledge(new Store(db));
    const selection = ['person:actor', 'person:writer'];
    const entity = knowledge.create('default',{name: 'Actor and writer',type: 'person',subtypes: [...selection, 'person:actor']});
    assert.deepEqual(entity.subtypes,selection);
    assert.deepEqual(knowledge.list('default').find(e => e.id === entity.id).subtypes,selection);
    assert.deepEqual(knowledge.update('default',entity.id,{name: entity.name,type: 'person'}).subtypes,selection);
    knowledge.property('default',entity.id,{name: 'nationality',value: 'Filipino'});
    rejects(() => knowledge.property('default',entity.id,{name: 'subtype-only',value: 'No'}));
    rejects(() => knowledge.addTypeProperty('default',{type: 'person',subtypes: selection,name: 'subtype-only'}));
    for (const subtypes of [null, 'person:actor', [null], [123], ['missing'], ['person:actor','place:city']]) {
      rejects(() => knowledge.update('default',entity.id,{name: entity.name,type: 'person',subtypes}));
    }
    rejects(() => knowledge.create('default',{name: 'Ambiguous',type: 'person',subtypes: selection,subtype: 'person:actor'}));
    assert.deepEqual(knowledge.detail('default',entity.id).subtypes,selection);
    assert.deepEqual(knowledge.update('default',entity.id,{name: entity.name,type: 'person',subtypes: ['person:writer']}).subtypes,['person:writer']);
    assert.deepEqual(knowledge.update('default',entity.id,{name: entity.name,type: 'person',subtypes: []}).subtypes,[]);
    rejects(()=>knowledge.property('default',entity.id,{name:'shared field',value:'No implicit schema creation'}));
    const nationality=knowledge.detail('default',entity.id).properties.find(p=>p.name==='nationality');
    rejects(()=>knowledge.update('default',entity.id,{name:entity.name,type:'place'}));
    knowledge.remove('default',entity.id,'properties',nationality.id);
    assert.deepEqual(knowledge.update('default',entity.id,{name: entity.name,type: 'place'}).subtypes,[]);
  } finally { db.close(); }
});

test('single-subtype database migration preserves selections and multiple selections survive restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'noema-multi-subtypes-'));
  const filename = path.join(dir,'test.sqlite');
  let db = openDatabase(filename);
  try {
    // Recreate the preceding database shape with a saved single subtype.
    db.exec("ALTER TABLE entities DROP COLUMN subtypes; UPDATE entities SET subtype='person:writer' WHERE id='ursula';");
    db.close(); db = openDatabase(filename);
    let knowledge = new Knowledge(new Store(db));
    assert.deepEqual(knowledge.detail('default','ursula').subtypes,['person:writer']);
    knowledge.update('default','ursula',{name: 'Ursula K. Le Guin',type: 'person',subtypes: ['person:writer','person:artist']});
    db.close(); db = openDatabase(filename); knowledge = new Knowledge(new Store(db));
    assert.deepEqual(knowledge.detail('default','ursula').subtypes,['person:writer','person:artist']);
    knowledge.update('default','ursula',{name: 'Ursula K. Le Guin',type: 'person',subtypes: []});
    db.close(); db = openDatabase(filename); knowledge = new Knowledge(new Store(db));
    assert.deepEqual(knowledge.detail('default','ursula').subtypes,[]);
    assert.deepEqual(knowledge.detail('default','berkeley').subtypes,[]);
  } finally { db.close(); rmSync(dir,{recursive: true,force: true}); }
});


test('schema definition metadata is additive and custom identities stay vault scoped', () => {
  const db=openDatabase(':memory:');
  try {
    const knowledge=new Knowledge(new Store(db));
    const before=knowledge.schema('default');
    assert.ok(before.properties.person.includes('birth date'));
    const definition=before.propertyDefinitions.find(item=>item.id==='builtin:person:birth_date');
    assert.equal(definition.label,'Birth Date');
    assert.equal(definition.compatibility,'legacy');
    knowledge.addTypeProperty('default',{type:'person',subtype:'person:writer',name:'Custom Field'});
    const custom=knowledge.schema('default').propertyDefinitions.find(item=>item.legacyName==='Custom Field');
    assert.equal(custom.scope.subtypeId,'person:writer');
    assert.equal(custom.origin,'user_defined');
    assert.ok(!knowledge.schema('elsewhere').propertyDefinitions.some(item=>item.id===custom.id));
    assert.equal(knowledge.schema('default').propertyDefinitions.find(item=>item.legacyName==='Custom Field').id,custom.id);
  } finally {db.close();}
});


test('additive native subtype seeding preserves legacy and colliding custom identities across restart',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-additional-subtypes-')),filename=path.join(dir,'fixture.sqlite');
 let db=openDatabase(filename);
 try {
  let store=new Store(db),knowledge=new Knowledge(store);
  // Synthetic prior catalogue: remove only the additive definitions, preserving all authored data.
  const newIds=builtinSubtypes.filter(item=>item.description).map(item=>item.id);
  for(const id of newIds)store.run("DELETE FROM property_definitions WHERE json_extract(definition_json,'$.scope.subtypeId')=?",id);
  store.run('INSERT INTO entity_subtypes VALUES (?,?,?,?)','custom-building','default','place','Building');
  // An older imported/raw custom identity can even occupy a newly reserved native ID.
  store.run('INSERT INTO entity_subtypes VALUES (?,?,?,?)','creativework:journal','default','creativework','Legacy periodical');
  store.run('INSERT INTO entity_subtype_properties VALUES (?,?,?)','default','custom-building','Local code');
  const custom=knowledge.create('default',{name:'Custom building fixture',type:'place',subtypes:['custom-building']});
  knowledge.property('default',custom.id,{name:'Local code',value:'0007'});
  const legacy=knowledge.create('default',{name:'Legacy periodical fixture',type:'creativework',subtypes:['creativework:journal']});
  const before={entities:store.all('SELECT * FROM entities ORDER BY id'),properties:store.all('SELECT * FROM properties ORDER BY id'),domains:store.all('SELECT * FROM entity_domains ORDER BY entity_id,domain_id')};
  db.close();db=openDatabase(filename);store=new Store(db);knowledge=new Knowledge(store);
  const first=knowledge.schema('default'),second=knowledge.schema('default');
  assert.deepEqual(second,first);
  assert.equal(first.subtypes.filter(item=>item.type==='place'&&item.name==='Building').length,2);
  assert.equal(first.subtypes.filter(item=>item.id==='creativework:journal').length,1);
  assert.equal(first.subtypes.find(item=>item.id==='creativework:journal').origin,'user_defined');
  assert.ok(!first.propertyDefinitions.some(item=>item.id==='builtin:creativework:journal:issn'||item.id==='builtin:creativework:academic-paper:journal'));
  assert.ok(!knowledge.detail('default',legacy.id).propertyNames.includes('issn'));
  assert.deepEqual(knowledge.detail('default',custom.id).subtypes,['custom-building']);
  assert.equal(knowledge.detail('default',custom.id).properties[0].value,'0007');
  assert.deepEqual(store.all('SELECT * FROM entities ORDER BY id'),before.entities);
  assert.deepEqual(store.all('SELECT * FROM properties ORDER BY id'),before.properties);
  assert.deepEqual(store.all('SELECT * FROM entity_domains ORDER BY entity_id,domain_id'),before.domains);
  const count=store.get('SELECT count(*) AS n FROM property_definitions').n;
  db.close();db=openDatabase(filename);store=new Store(db);knowledge=new Knowledge(store);
  assert.deepEqual(knowledge.schema('default'),first);assert.equal(store.get('SELECT count(*) AS n FROM property_definitions').n,count);
  const native=knowledge.create('default',{name:'Native building fixture',type:'place',subtypes:['place:building','place:historical-place','place:landmark']});
  assert.deepEqual(native.properties,[]);assert.ok(native.propertyNames.includes('architectural style'));
  assert.equal(native.propertyNames.filter(name=>name==='established').length,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});


test('new typed fields enforce native targets and preserve identifiers, units and uncertain dates',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),knowledge=new Knowledge(store),governance=new PropertyDefinitionGovernance(store);
  const paper=knowledge.create('default',{name:'Synthetic paper',type:'creativework',subtypes:['creativework:academic-paper','creativework:article']});
  const journal=knowledge.create('default',{name:'Synthetic journal',type:'creativework',subtypes:['creativework:journal']});
  const wrongWork=knowledge.create('default',{name:'Synthetic book',type:'creativework',subtypes:['creativework:book']});
  const put=(entity,name,value,id)=>knowledge.property('default',entity.id,{name,value,definition_id:id}).properties.find(item=>item.name===name);
  const journalId='builtin:creativework:academic-paper:journal';
  rejects(()=>knowledge.property('default',paper.id,{name:'journal',target_id:wrongWork.id,definition_id:journalId}));
  knowledge.property('default',paper.id,{name:'journal',target_id:journal.id,definition_id:journalId});
  assert.deepEqual(knowledge.referenceOptions('default',{types:['creativework'],subtypes:['creativework:journal']}).items.map(item=>item.id),[journal.id]);
  const issn=put(journal,'issn','0000-001X','builtin:creativework:journal:issn');
  assert.equal(issn.value,'0000-001X');assert.equal(issn.metadata.text_value,'0000-001X');assert.equal(issn.metadata.integer_value,null);
  const natural=knowledge.create('default',{name:'Synthetic mountain',type:'place',subtypes:['place:natural-feature']});
  const elevation=put(natural,'elevation','1200 m','builtin:place:natural-feature:elevation');
  assert.equal(elevation.metadata.decimal_value,1200);assert.equal(elevation.metadata.unit,'m');
  const theorem=knowledge.create('default',{name:'Synthetic result',type:'concept',subtypes:['concept:theorem','concept:mathematics']});
  const proven=put(theorem,'proven','circa 1900','builtin:concept:theorem:proven');
  assert.equal(proven.value,'circa 1900');assert.equal(proven.metadata.compatibility,'valid');assert.equal(proven.metadata.temporal_date_id,'gregorian:year:~1900');
  const updated=knowledge.property('default',theorem.id,{name:'proven',value:'1901',definition_id:'builtin:concept:theorem:proven'},proven.id).properties.find(item=>item.id===proven.id);
  assert.equal(updated.metadata.temporal_date_id,'gregorian:year:1901');
  rejects(()=>governance.update('default',journalId,{label:'Changed native field'}),403);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {db.close();}
});

test('Thing and narrative taxonomy are additive; legacy identity and domains remain deliberate',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),knowledge=new Knowledge(store),schema=knowledge.schema('default');
  assert.equal(knowledge.require('default','ursula').referentStatus,'unspecified');
  assert.deepEqual(schema.subtypes.filter(s=>s.type==='thing').map(s=>s.name),['Food','Ingredient','Dish','Beverage','Material','Substance','Artefact']);
  for(const id of ['person:fictional-character','organism:fictional-taxon','concept:folkloric-archetype','concept:mythological-creature','concept:role','creativework:recipe','culture:cultural-tradition'])assert.ok(schema.subtypes.some(s=>s.id===id));
  const species=knowledge.create('default',{name:'Alumahan taxon',type:'organism',subtypes:['organism:animal','organism:taxon']});
  const ingredient=knowledge.create('default',{name:'Alumahan ingredient',type:'thing',subtypes:['thing:food','thing:ingredient']});
  const dish=knowledge.create('default',{name:'Grilled alumahan',type:'thing',subtypes:['thing:food','thing:dish']});
  knowledge.property('default',ingredient.id,{name:'derived from',target_id:species.id});
  knowledge.property('default',dish.id,{name:'ingredients',target_id:ingredient.id});
  const origin=knowledge.create('default',{name:'Synthetic novel',type:'creativework'});
  const character=knowledge.create('default',{name:'A nonhuman narrative agent',type:'person',subtypes:['person:fictional-character'],referentStatus:'fictional'});
  knowledge.property('default',character.id,{name:'setting',target_id:origin.id});
  knowledge.property('default',character.id,{name:'originating work',target_id:origin.id});
  const settingDefinition=schema.propertyDefinitions.find(d=>d.scope.type==='person'&&d.key==='setting');
  assert.equal(settingDefinition.valueKind,'entity_reference');assert.deepEqual(settingDefinition.allowedTargetTypes,['creativework','place']);
  const before=knowledge.require('default',character.id);
  assert.equal(knowledge.update('default',character.id,{name:before.name,type:before.type}).referentStatus,'fictional');
  rejects(()=>knowledge.create('default',{name:'Invalid',type:'thing',referentStatus:'false'}));
  const domain=store.get('SELECT id FROM domains ORDER BY id LIMIT 1').id;
  const legacy=knowledge.create('default',{name:'Legacy food Concept',type:'concept',domainIds:[domain]});
  rejects(()=>knowledge.update('default',legacy.id,{name:legacy.name,type:'thing',domainIds:[]}),409);
  assert.deepEqual(knowledge.require('default',legacy.id).domainIds,[domain]);
  assert.equal(knowledge.require('default',legacy.id).type,'concept');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {db.close();}
});

test('decorated entity identities survive unrelated progress and update icon preferences',async()=>{
 const {createEntityIconDecorator}=await import('../src/shared/entity-icons.ts');
 const decorate=createEntityIconDecorator(),icons={},person={id:'person',type:'creativework',subtypes:['creativework:book']},source={id:'source',type:'source',subtypes:[],sourceStatus:'queued'};
 const first=decorate([person,source],icons),second=decorate([person,{...source,sourceStatus:'processing'}],icons);
 assert.equal(second[0],first[0]);assert.notEqual(second[1],first[1]);assert.equal(second[0].icon,'book');
 const changed=decorate([person],{'creativework:book':'star'});assert.notEqual(changed[0],first[0]);assert.equal(changed[0].icon,'star');
});
