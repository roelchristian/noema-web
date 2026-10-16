import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { Vaults } from '../src/server/modules/vaults.ts';

const rejects = (work, status = 400) => assert.throws(work, error => error.status === status);

test('subtypes inherit live main-type fields, never define their own, and retain entity-specific values', () => {
  const db = openDatabase(':memory:');
  try {
    const knowledge = new Knowledge(new Store(db));
    const actor = knowledge.create('default', {name: 'An actor', type: 'person', subtype: 'person:actor'});
    const writer = knowledge.create('default', {name: 'A writer', type: 'person', subtype: 'person:writer'});
    assert.ok(actor.propertyNames.includes('birthplace'));
    const withBirthplace = knowledge.property('default', actor.id, {name: 'birthplace', target_id: 'berkeley'});
    assert.equal(withBirthplace.properties[0].target_id, 'berkeley');
    assert.equal(knowledge.detail('default', writer.id).properties.length, 0);
    rejects(() => knowledge.property('default', actor.id, {name: 'awards', value: 'Award'}));
    rejects(() => knowledge.property('default', actor.id, {name: 'awards', value: 'Award'}, withBirthplace.properties[0].id));
    rejects(() => knowledge.addSubtype('default', {type: 'person', name: 'Director', properties: ['awards']}));
    rejects(() => knowledge.addTypeProperty('default', {type: 'person', subtype: 'person:actor', name: 'awards'}));
    knowledge.addTypeProperty('default', {type: 'person', name: 'awards'});
    knowledge.property('default', actor.id, {name: 'awards', value: 'Award'});
    assert.ok(knowledge.detail('default', writer.id).propertyNames.includes('awards'));
    assert.equal(knowledge.detail('default', writer.id).properties.length, 0);
    // Freeform fields on a main-type entity become inherited fields too.
    knowledge.property('default', 'ursula', {name: 'occupation', value: 'Writer'});
    knowledge.property('default', actor.id, {name: 'occupation', value: 'Actor'});
    assert.deepEqual(knowledge.update('default',actor.id,{name: 'Renamed',type: 'person'}).subtypes, ['person:actor']);
    assert.deepEqual(knowledge.update('default',actor.id,{name: 'Renamed',type: 'person',subtypes: []}).subtypes, []);
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
    const schema = knowledge.addSubtype('default',{type: 'person',name: 'Researcher'});
    const subtype = schema.subtypes.find(s => s.name === 'Researcher');
    assert.ok(subtype);
    rejects(() => knowledge.addSubtype('default',{type: 'person',name: ' researcher '}),409);
    rejects(() => knowledge.addSubtype('default',{type: 'person',name: 'ACTOR'}),409);
    rejects(() => knowledge.addSubtype('default',{type: 'person:actor',name: 'Nested'}));
    rejects(() => knowledge.create(vault.id,{name: 'Wrong vault',type: 'person',subtype: subtype.id}));
    knowledge.addTypeProperty('default',{type: 'person',name: 'research area'});
    assert.ok(!knowledge.schema(vault.id).properties.person.includes('research area'));
    const researcher = knowledge.create('default',{name: 'Researcher',type: 'person',subtype: subtype.id});
    knowledge.property('default',researcher.id,{name: 'research area',value: 'Ecology'});
    // Existing fields are imported on migration without losing values.
    db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run('legacy-property','ursula','legacy field','preserved',null);
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
    knowledge.property('default',entity.id,{name: 'shared field',value: 'Now a main-type entity'});
    assert.ok(knowledge.schema('default').properties.person.includes('shared field'));
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
