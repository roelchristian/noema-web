import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Organizer } from '../src/server/modules/organization.ts';

const fails = (work, status) => assert.throws(work, error => error.status === status);
test('one folder location, independent memberships, nested folders, isolation and restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-organization-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    let store = new Store(db), org = new Organizer(store);
    assert.deepEqual(org.list('default'), {collections: [], folders: [], locations: [], memberships: [], favourites: []});
    const a = org.saveCollection('default', {name: 'Reading'}).collections[0].id;
    const b = org.saveCollection('default', {name: 'Writing'}).collections.find(c => c.id !== a).id;
    fails(() => org.saveCollection('default', {name: 'Nested', parent_id: a}), 400);
    const root = org.saveFolder('default', {name: 'Books'}).folders[0].id;
    const child = org.saveFolder('default', {name: 'Fiction', parent_id: root}).folders.find(f => f.id !== root).id;
    fails(() => org.saveFolder('default', {name: 'Cycle', parent_id: child}, root), 400);
    fails(() => org.saveFolder('default', {name: 'Coupled', collection_id: a}), 400);
    const item = {kind: 'page', item_id: 'welcome'};
    org.locate('default', {...item, folder_id: root});
    org.membership('default', {...item, collection_id: a});
    org.membership('default', {...item, collection_id: b});
    org.membership('default', {...item, collection_id: b});
    assert.equal(org.list('default').memberships.length, 2);
    assert.equal(org.list('default').locations[0].folder_id, root);
    org.locate('default', {...item, folder_id: child});
    assert.equal(org.list('default').locations.length, 1);
    assert.equal(org.list('default').memberships.length, 2);
    org.membership('default', {...item, collection_id: b, remove: true});
    assert.equal(org.list('default').locations[0].folder_id, child);
    org.membership('default', {...item, collection_id: b});
    assert.equal(store.get('SELECT count(*) AS n FROM pages WHERE id=?', 'welcome').n, 1);
    org.favourite('default', {...item, favourite: true});
    org.membership('default', {kind: 'entity', item_id: 'earthsea', collection_id: a});
    fails(() => org.locate('default', {...item, collection_id: b, folder_id: root}), 400);
    fails(() => org.membership('default', {...item, collection_id: a, folder_id: root}), 400);
    fails(() => org.membership('default', {...item, collection_id: 'missing'}), 404);
    fails(() => org.locate('default', {...item, folder_id: 'missing'}), 404);
    fails(() => org.membership('default', {kind: 'page', item_id: 'missing', collection_id: a}), 404);
    fails(() => org.membership('default', {...item, collection_id: a, remove: 'yes'}), 400);
    store.run("INSERT INTO vaults(id,name,updated_at) VALUES ('other','Other','now')");
    store.run("INSERT INTO pages(id,title,blocks,updated_at,vault_id) VALUES ('other-note','Other','[]','now','other')");
    fails(() => org.locate('other', {kind: 'page', item_id: 'other-note', folder_id: root}), 404);
    fails(() => org.membership('other', {kind: 'page', item_id: 'other-note', collection_id: a}), 404);
    fails(() => org.saveFolder('other', {name: 'Invalid', parent_id: root}), 404);
    org.saveFolder('default', {name: 'Novels', parent_id: null}, child);
    org.saveFolder('default', {name: 'Novels', parent_id: root}, child);
    db.close(); db = openDatabase(filename); store = new Store(db); org = new Organizer(store);
    assert.equal(org.list('default').locations[0].folder_id, child);
    assert.equal(org.list('default').memberships.length, 3);
    assert.equal(org.list('default').folders.find(f => f.id === child).parent_id, root);
    org.remove('default', 'collections', a);
    assert.equal(org.list('default').folders.length, 2);
    assert.equal(org.list('default').locations[0].folder_id, child);
    assert.equal(org.list('default').memberships.length, 1);
    org.locate('default', {...item, folder_id: null});
    assert.equal(org.list('default').locations.length, 0);
    assert.equal(org.list('default').memberships.length, 1);
    org.locate('default', {...item, folder_id: child});
    org.remove('default', 'folders', root);
    assert.equal(org.list('default').folders.length, 0);
    assert.equal(org.list('default').locations[0].folder_id, null);
    assert.equal(org.list('default').memberships.length, 1);
    assert.equal(org.list('default').favourites.length, 1);
    assert.ok(store.get('SELECT id FROM pages WHERE id=?', 'welcome'));
    store.run('DELETE FROM pages WHERE id=?', 'welcome');
    assert.equal(org.list('default').locations.length, 0);
    assert.equal(org.list('default').memberships.length, 0);
    assert.equal(org.list('default').favourites.length, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('legacy migration preserves trees, all memberships, trashed items and deterministic single locations', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-folder-migration-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    // Recreate the previous organization schema around a real seeded notebook.
    db.exec(`PRAGMA foreign_keys=OFF;
      DROP TRIGGER page_organization_cleanup; DROP TRIGGER entity_organization_cleanup;
      DROP TABLE item_locations; DROP TABLE collection_memberships; DROP TABLE folders;
      CREATE TABLE folders (id TEXT PRIMARY KEY,vault_id TEXT,name TEXT,collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
      CREATE TABLE item_locations (vault_id TEXT,kind TEXT,item_id TEXT,collection_id TEXT,folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,PRIMARY KEY(vault_id,kind,item_id,collection_id));
      INSERT INTO collections VALUES ('a','default','First'),('b','default','Second');
      INSERT INTO folders VALUES ('desk','default','Desk','a',NULL),('nested','default','Notes','a','desk'),('second','default','Other','b',NULL),('unfiled','default','Legacy',NULL,NULL);
      INSERT INTO item_locations VALUES ('default','page','welcome','b','second'),('default','page','welcome','a','nested'),('default','entity','earthsea','a',NULL),('default','entity','ursula','','unfiled');
      UPDATE pages SET deleted_at='2026-10-17' WHERE id='welcome';`);
    db.close(); db = openDatabase(filename);
    let org = new Organizer(new Store(db));
    assert.equal(org.list('default').locations.filter(item => item.kind === 'page').length, 0);
    db.prepare("UPDATE pages SET deleted_at=NULL WHERE id='welcome'").run();
    const migrated = org.list('default');
    assert.equal(migrated.collections.length, 2);
    assert.equal(migrated.folders.length, 4);
    assert.ok(migrated.folders.every(folder => !('collection_id' in folder)));
    assert.equal(migrated.folders.find(folder => folder.id === 'nested').parent_id, 'desk');
    assert.deepEqual({...migrated.locations.find(item => item.item_id === 'welcome')}, {kind: 'page', item_id: 'welcome', folder_id: 'nested'});
    assert.equal(migrated.memberships.length, 3);
    assert.equal(migrated.locations.find(item => item.item_id === 'ursula').folder_id, 'unfiled');
    db.close(); db = openDatabase(filename); org = new Organizer(new Store(db));
    assert.deepEqual(org.list('default'), migrated);
    org.remove('default', 'collections', 'a');
    assert.equal(org.list('default').folders.length, 4);
    assert.equal(org.list('default').locations.find(item => item.item_id === 'welcome').folder_id, 'nested');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('folder favourites persist, enforce vault scope, and clean up deleted subtrees', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-folder-favourites-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    let store = new Store(db), org = new Organizer(store);
    const root = org.saveFolder('default', {name: 'Desk'}).folders[0].id;
    const child = org.saveFolder('default', {name: 'Notes', parent_id: root}).folders.find(f => f.id !== root).id;
    org.favourite('default', {kind: 'folder', item_id: root, favourite: true});
    org.favourite('default', {kind: 'folder', item_id: child, favourite: true});
    org.favourite('default', {kind: 'folder', item_id: child, favourite: true});
    org.favourite('default', {kind: 'page', item_id: 'welcome', favourite: true});
    org.favourite('default', {kind: 'entity', item_id: 'earthsea', favourite: true});
    assert.equal(org.list('default').favourites.length, 4);
    store.run("INSERT INTO vaults(id,name,updated_at) VALUES ('other','Other','now')");
    fails(() => org.favourite('other', {kind: 'folder', item_id: root, favourite: true}), 404);
    fails(() => org.favourite('default', {kind: 'folder', item_id: 'missing', favourite: true}), 404);
    fails(() => org.favourite('default', {kind: 'folder', item_id: root, favourite: 'yes'}), 400);
    // Folders remain storage containers rather than members of other folders/collections.
    fails(() => org.locate('default', {kind: 'folder', item_id: root, folder_id: child}), 400);
    fails(() => org.membership('default', {kind: 'folder', item_id: root, collection_id: 'any'}), 400);
    org.favourite('default', {kind: 'folder', item_id: root, favourite: false});
    assert.equal(org.list('default').favourites.length, 3);
    org.favourite('default', {kind: 'folder', item_id: root, favourite: true});
    db.close(); db = openDatabase(filename); store = new Store(db); org = new Organizer(store);
    assert.equal(org.list('default').favourites.filter(item => item.kind === 'folder').length, 2);
    org.saveFolder('default', {name: 'Renamed'}, root);
    assert.equal(org.list('default').favourites.length, 4);
    org.remove('default', 'folders', root);
    assert.equal(org.list('default').favourites.length, 2);
    assert.ok(org.list('default').favourites.every(item => item.kind !== 'folder'));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('upgrading favourites preserves page and entity stars and allows folders after restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-favourites-upgrade-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    db.exec(`DROP TRIGGER page_organization_cleanup; DROP TRIGGER entity_organization_cleanup; DROP TRIGGER folder_favourite_cleanup;
      DROP TABLE favourites;
      CREATE TABLE favourites (vault_id TEXT NOT NULL REFERENCES vaults(id),kind TEXT NOT NULL CHECK(kind IN ('page','entity')),item_id TEXT NOT NULL,PRIMARY KEY(vault_id,kind,item_id));
      INSERT INTO favourites VALUES ('default','page','welcome'),('default','entity','earthsea');`);
    db.close(); db = openDatabase(filename);
    let org = new Organizer(new Store(db));
    assert.equal(org.list('default').favourites.length, 2);
    const folder = org.saveFolder('default', {name: 'Starred'}).folders[0].id;
    org.favourite('default', {kind: 'folder', item_id: folder, favourite: true});
    db.close(); db = openDatabase(filename); org = new Organizer(new Store(db));
    assert.equal(org.list('default').favourites.length, 3);
    db.prepare("DELETE FROM pages WHERE id='welcome'").run();
    db.prepare("DELETE FROM entities WHERE id='earthsea'").run();
    org.remove('default', 'folders', folder);
    assert.deepEqual(org.list('default').favourites, []);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});
