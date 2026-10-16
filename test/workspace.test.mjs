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
