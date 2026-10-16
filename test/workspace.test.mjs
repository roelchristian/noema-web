import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/client/api.ts';
import { Workspace } from '../src/client/state/workspace.ts';

test('recent history persists per vault, deduplicates items and clears when locked', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }});
  const vaults = [{id: 'a', name: 'A', locked: false}, {id: 'b', name: 'B', locked: false}];
  const page = id => ({id, vault_id: 'a', title: id, blocks: [], sourceIds: [], revision: 1, updated_at: ''});
  t.mock.method(api, 'vaults', async () => vaults);
  t.mock.method(api, 'pages', async vault => vault === 'a' ? [page('one'), page('two')] : []);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'page', async (_vault, id) => page(id));
  t.mock.method(api, 'organization', async () => ({collections: [], folders: [], locations: [], favourites: []}));
  const workspace = new Workspace();
  const reloaded = new Workspace();
  try {
    await workspace.selectVault('a');
    await workspace.openPage('two');
    workspace.recordRecent('entity', 'person');
    workspace.recordRecent('entity', 'person');
    assert.deepEqual(workspace.snapshot().recent.map(item => item.item_id), ['person', 'two', 'one']);
    await workspace.selectVault('b');
    assert.deepEqual(workspace.snapshot().recent, []);
    workspace.recordRecent('entity', 'other-person');
    await reloaded.selectVault('a');
    assert.deepEqual(reloaded.snapshot().recent.map(item => item.item_id), ['one', 'person', 'two']);
    assert.ok(!reloaded.snapshot().recent.some(item => item.item_id === 'other-person'));
    for (let n = 0; n < 60; n++) reloaded.recordRecent('entity', String(n));
    assert.equal(reloaded.snapshot().recent.length, 50);
    vaults[0].locked = true;
    await reloaded.selectVault('a');
    reloaded.recordRecent('entity', 'locked');
    assert.deepEqual(reloaded.snapshot().recent, []);
    assert.deepEqual(reloaded.snapshot().organization.collections, []);
  } finally {
    workspace.saver.dispose(); reloaded.saver.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});


test('moving to Trash flushes pending edits and restoring opens a fresh page', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => null, setItem: () => {}}});
  const original = {id: 'note', vault_id: 'a', title: 'Original', blocks: [], sourceIds: [], revision: 1, updated_at: ''};
  const org = {collections: [], folders: [], locations: [{kind: 'page', item_id: 'note', collection_id: '', folder_id: 'desk'}], favourites: [{kind: 'page', item_id: 'note'}]};
  const calls = [];
  let stored = {...original};
  t.mock.method(api, 'vaults', async () => [{id: 'a', name: 'A', locked: false}]);
  t.mock.method(api, 'pages', async () => [original]);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'organization', async () => org);
  t.mock.method(api, 'page', async () => stored);
  t.mock.method(api, 'savePage', async (_vault, _id, page) => { calls.push('save'); stored = {...page, revision: 2}; return stored; });
  t.mock.method(api, 'deletePage', async () => { calls.push('trash'); return {ok: true}; });
  t.mock.method(api, 'trash', async () => [{...stored, deleted_at: '2026-01-01', expires_at: '2026-01-31'}]);
  t.mock.method(api, 'restorePage', async () => ({...stored, revision: 4}));
  t.mock.method(api, 'permanentlyDeletePage', async () => ({ok: true}));
  const workspace = new Workspace();
  try {
    await workspace.selectVault('a');
    workspace.updatePage({title: 'Unsaved changes'});
    await workspace.deletePage();
    assert.deepEqual(calls, ['save', 'trash']);
    assert.equal(workspace.snapshot().page, null);
    assert.deepEqual(workspace.snapshot().pages, []);
    assert.deepEqual(workspace.snapshot().organization.favourites, []);
    assert.deepEqual(workspace.snapshot().organization.locations, []);
    await workspace.showTrash();
    assert.equal(workspace.snapshot().view, 'trash');
    assert.equal(workspace.snapshot().trash[0].title, 'Unsaved changes');
    await workspace.restorePage('note');
    assert.equal(workspace.snapshot().view, 'pages');
    assert.equal(workspace.snapshot().page.title, 'Unsaved changes');
    assert.equal(workspace.snapshot().page.revision, 4);
    assert.equal(workspace.snapshot().organization.favourites[0].item_id, 'note');
    assert.deepEqual(workspace.snapshot().trash, []);
    await workspace.deletePage(); await workspace.showTrash();
    await workspace.permanentlyDeletePage('note');
    assert.deepEqual(workspace.snapshot().trash, []);
  } finally {
    workspace.saver.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});
