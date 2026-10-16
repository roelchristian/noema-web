import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { pageIcons, isPageIconId } from '../src/shared/page-icons.ts';

test('the curated suite has 50 unique symbols across five groups', () => {
  assert.equal(pageIcons.length, 50);
  assert.equal(new Set(pageIcons.map(icon => icon.id)).size, 50);
  assert.equal(new Set(pageIcons.map(icon => icon.group)).size, 5);
  for (const icon of pageIcons) { assert.ok(icon.path); assert.ok(isPageIconId(icon.id)); }
  assert.equal(isPageIconId('arbitrary-svg'), false);
});

test('page icons save, survive ordinary edits and Trash, reset, and reject invalid input', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), pages = new Pages(store, new Knowledge(store));
    let page = pages.create('default', {title: 'Ideas'});
    assert.equal(page.icon, null);
    page = pages.update('default', page.id, {...page, icon: 'idea'});
    assert.equal(pages.list('default').find(p => p.id === page.id).icon, 'idea');
    const {icon, ...legacyInput} = page;
    page = pages.update('default', page.id, {...legacyInput, title: 'More ideas'});
    assert.equal(page.icon, 'idea');
    for (const invalid of ['unknown', '', '😀', 42, {}, false]) {
      assert.throws(() => pages.update('default', page.id, {...page, icon: invalid}), error => error.status === 400);
    }
    assert.throws(() => pages.update('default', page.id, {...page, icon: 'star', revision: page.revision - 1}), error => error.status === 409);
    pages.delete('default', page.id);
    assert.equal(pages.trash('default')[0].icon, 'idea');
    page = pages.restore('default', page.id);
    assert.equal(page.icon, 'idea');
    page = pages.update('default', page.id, {...page, icon: null});
    assert.equal(pages.get('default', page.id).icon, null);
    assert.equal(page.title, 'More ideas');
  } finally { db.close(); }
});

test('existing notebooks receive an additive icon migration, retained on reopening', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-icons-'));
  const filename = path.join(directory, 'legacy.sqlite');
  let db = new DatabaseSync(filename);
  db.exec("CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, blocks TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO pages VALUES ('old','Existing note','[]','2026-01-01');");
  db.close();
  try {
    db = openDatabase(filename);
    let store = new Store(db), pages = new Pages(store, new Knowledge(store));
    let page = pages.get('default', 'old');
    assert.equal(page.title, 'Existing note');
    assert.equal(page.icon, null);
    pages.update('default', page.id, {...page, icon: 'book'});
    db.close(); db = openDatabase(filename);
    store = new Store(db); pages = new Pages(store, new Knowledge(store));
    assert.equal(pages.get('default', 'old').icon, 'book');
  } finally { db.close(); rmSync(directory, {recursive: true, force: true}); }
});
