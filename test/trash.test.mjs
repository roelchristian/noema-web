import { SourceFiles } from '../src/server/modules/source-files.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages, trashRetentionMs } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { Organizer } from '../src/server/modules/organization.ts';
import { createApp } from '../src/server/http.ts';

const fails = (work, status) => assert.throws(work, error => error.status === status);
test('Trash preserves content, sources, and organization across restart and restore', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-trash-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  let time = new Date('2026-01-01T12:00:00.000Z');
  try {
    let store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store, knowledge, () => time), org = new Organizer(store);
    const page = pages.create('default', {title: 'Keep my note'});
    const source = knowledge.create('default', {name: 'Reference', type: 'source',attachmentIds:[new SourceFiles(store).add('default','reference.txt',Buffer.from('Primary source original')).id]});
    const saved = pages.update('default', page.id, {...page, sourceIds: [source.id]});
    const collection = org.saveCollection('default', {name: 'Workspace'}).collections[0];
    const folder = org.saveFolder('default', {name: 'Desk'}).folders[0];
    org.locate('default', {kind: 'page', item_id: page.id, folder_id: folder.id});
    org.membership('default', {kind: 'page', item_id: page.id, collection_id: collection.id});
    org.favourite('default', {kind: 'page', item_id: page.id, favourite: true});
    pages.delete('default', page.id);
    assert.ok(!pages.list('default').some(note => note.id === page.id));
    fails(() => pages.get('default', page.id), 404);
    fails(() => pages.update('default', page.id, saved), 404);
    fails(() => pages.delete('default', page.id), 404);
    fails(() => org.favourite('default', {kind: 'page', item_id: page.id, favourite: true}), 404);
    assert.deepEqual(org.list('default').favourites, []);
    assert.deepEqual(org.list('default').locations, []);
    assert.deepEqual(org.list('default').memberships, []);
    assert.equal(pages.trash('default')[0].deleted_at, time.toISOString());
    assert.equal(pages.trash('default')[0].expires_at, new Date(time.getTime() + trashRetentionMs).toISOString());
    db.close(); db = openDatabase(filename); store = new Store(db); knowledge = new Knowledge(store); pages = new Pages(store, knowledge, () => time); org = new Organizer(store);
    assert.equal(pages.trash('default').length, 1);
    const restored = pages.restore('default', page.id);
    assert.deepEqual(restored.blocks, saved.blocks);
    assert.deepEqual(restored.sourceIds, [source.id]);
    assert.equal(restored.revision, saved.revision + 2);
    assert.equal(org.list('default').locations[0].folder_id, folder.id);
    assert.equal(org.list('default').memberships[0].collection_id, collection.id);
    assert.equal(org.list('default').favourites[0].item_id, page.id);
    assert.deepEqual(pages.trash('default'), []);
    fails(() => pages.update('default', page.id, saved), 409);
    fails(() => pages.permanentlyDelete('default', page.id), 404);
    // A later move to Trash receives its own full retention window.
    time = new Date(time.getTime() + 7 * 86400000);
    pages.delete('default', page.id);
    assert.equal(pages.trash('default')[0].deleted_at, time.toISOString());
    pages.permanentlyDelete('default', page.id);
    assert.equal(store.get('SELECT id FROM pages WHERE id=?', page.id), undefined);
    assert.equal(store.get('SELECT page_id FROM page_sources WHERE page_id=?', page.id), undefined);
    assert.equal(store.get('SELECT item_id FROM item_locations WHERE item_id=?', page.id), undefined);
    assert.equal(store.get('SELECT item_id FROM collection_memberships WHERE item_id=?', page.id), undefined);
    assert.equal(store.get('SELECT item_id FROM favourites WHERE item_id=?', page.id), undefined);
    assert.ok(knowledge.find('default', source.id));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('retention expires at 30 days, respects vault scope, and never removes active notes', () => {
  const db = openDatabase(':memory:');
  let time = new Date('2026-01-01T00:00:00.000Z');
  try {
    const store = new Store(db), pages = new Pages(store, new Knowledge(store), () => time);
    store.run("INSERT INTO vaults(id,name,updated_at) VALUES ('other','Other','now')");
    const a = pages.create('default', {title: 'A'}), b = pages.create('other', {title: 'B'});
    pages.delete('default', a.id); pages.delete('other', b.id);
    assert.deepEqual(pages.trash('missing'), []);
    fails(() => pages.restore('other', a.id), 404);
    fails(() => pages.permanentlyDelete('other', a.id), 404);
    time = new Date(time.getTime() + trashRetentionMs - 1000);
    assert.equal(pages.trash('default').length, 1);
    time = new Date(time.getTime() + 1000);
    fails(() => pages.restore('default', a.id), 404);
    assert.deepEqual(pages.trash('default'), []);
    assert.ok(store.get('SELECT id FROM pages WHERE id=?', b.id));
    pages.purgeExpired();
    assert.equal(store.get('SELECT id FROM pages WHERE id=?', b.id), undefined);
    assert.ok(pages.get('default', 'welcome'));
  } finally { db.close(); }
});

test('application startup removes expired Trash without waiting for a visit', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), pages = new Pages(store, new Knowledge(store));
    const old = pages.create('default', {title: 'Expired'}), fresh = pages.create('default', {title: 'Recent'});
    pages.delete('default', old.id); pages.delete('default', fresh.id);
    store.run('UPDATE pages SET deleted_at=? WHERE id=?', new Date(Date.now() - trashRetentionMs - 1000).toISOString(), old.id);
    const server = createApp(store, '/tmp');
    assert.equal(store.get('SELECT id FROM pages WHERE id=?', old.id), undefined);
    assert.ok(store.get('SELECT id FROM pages WHERE id=?', fresh.id));
    server.close();
  } finally { db.close(); }
});
