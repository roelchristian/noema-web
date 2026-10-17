import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/client/state/workspace.ts';
import { api } from '../src/client/api.ts';

function setup(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  }});
  const vaults = [{id: 'a', name: 'A', locked: false}, {id: 'b', name: 'B', locked: false}];
  const page = {id: 'note', vault_id: 'a', title: 'A note', blocks: [], sourceIds: [], revision: 1, updated_at: ''};
  const organization = {collections: [{id: 'theme', name: 'Theme'}], folders: [
    {id: 'parent', name: 'Parent', parent_id: null}, {id: 'nested', name: 'Nested', parent_id: 'parent'},
  ], locations: [{kind: 'page', item_id: page.id, folder_id: 'nested'}], memberships: [], favourites: []};
  const loadPages = t.mock.method(api, 'pages', async id => id === 'a' ? [page] : []);
  t.mock.method(api, 'vaults', async () => vaults);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'organization', async id => id === 'a' ? organization : {...organization, collections: [], folders: [], locations: []});
  const loadPage = t.mock.method(api, 'page', async () => ({...page, title: 'Fresh title'}));
  const loadTrash = t.mock.method(api, 'trash', async () => []);
  const workspaces = [];
  function create() { const workspace = new Workspace(); workspaces.push(workspace); return workspace; }
  t.after(() => {
    for (const workspace of workspaces) { workspace.saver.dispose(); workspace.titler.dispose(); }
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  });
  return {storage, vaults, page, organization, create, loadPage, loadPages, loadTrash};
}

test('refresh restores nested folder and collection navigation without overwriting the saved address while loading', async t => {
  const {create, storage, organization} = setup(t);
  const first = create(); await first.init();
  first.openOrganization('', 'parent');
  first.setOrganizationContext({folder: 'nested'});
  const stored = storage.get('noema-address/a');
  organization.folders[1].name = 'Renamed';
  organization.folders[1].parent_id = null;
  const refreshed = create(); await refreshed.init();
  assert.deepEqual(refreshed.snapshot().organizationContext, {collection: '', folder: 'nested'});
  assert.equal(refreshed.snapshot().view, 'organization');
  assert.equal(storage.get('noema-address/a'), stored);
  refreshed.openOrganization('theme');
  const collectionRefresh = create(); await collectionRefresh.init();
  assert.deepEqual(collectionRefresh.snapshot().organizationContext, {collection: 'theme', folder: ''});
});

test('refresh reopens the current note with fresh content and preserves recent history', async t => {
  const {create, storage, loadPage} = setup(t);
  const first = create(); await first.init();
  first.openOrganization('', 'nested'); await first.openPage('note');
  const recent = storage.get('noema-recent/a');
  const refreshed = create(); await refreshed.init();
  assert.equal(refreshed.snapshot().view, 'pages');
  assert.equal(refreshed.snapshot().page.id, 'note');
  assert.equal(refreshed.snapshot().page.title, 'Fresh title');
  assert.deepEqual(refreshed.snapshot().organizationContext, {collection: '', folder: 'nested'});
  assert.equal(loadPage.mock.callCount(), 2);
  assert.equal(storage.get('noema-recent/a'), recent);
});

test('vaults retain independent addresses and locked vaults defer restoration until unlock', async t => {
  const {create, storage, vaults, loadPage, loadPages} = setup(t);
  const first = create(); await first.selectVault('a'); await first.openPage('note');
  const saved = storage.get('noema-address/a');
  await first.selectVault('b'); first.showInbox();
  await first.selectVault('a');
  assert.equal(first.snapshot().page.id, 'note');
  vaults[0].locked = true;
  const pagesBefore = loadPages.mock.callCount(), noteBefore = loadPage.mock.callCount();
  const locked = create(); await locked.init();
  assert.equal(locked.snapshot().page, null);
  assert.equal(loadPages.mock.callCount(), pagesBefore);
  assert.equal(loadPage.mock.callCount(), noteBefore);
  assert.equal(storage.get('noema-address/a'), saved);
  vaults[0].locked = false;
  await locked.selectVault('a');
  assert.equal(locked.snapshot().page.id, 'note');
  await locked.selectVault('b');
  assert.equal(locked.snapshot().view, 'inbox');
  assert.equal(locked.snapshot().page, null);
});

test('missing, malformed and deleted destinations fall back safely to Library', async t => {
  const {create, storage, loadPage} = setup(t);
  storage.set('noema-vault', 'a');
  for (const value of ['{bad', 'null', '[]', '{"view":"unknown"}', '{"view":["pages"]}', '{"view":null}', JSON.stringify({view: 'organization', folder: 'deleted'}), JSON.stringify({view: 'organization', collection: 'deleted'}), JSON.stringify({view: 'pages', pageId: 'deleted', folder: 'nested'})]) {
    storage.set('noema-address/a', value);
    const refreshed = create(); await refreshed.init();
    assert.equal(refreshed.snapshot().view, 'organization');
    assert.deepEqual(refreshed.snapshot().organizationContext, {collection: '', folder: ''});
    assert.equal(refreshed.snapshot().page, null);
    assert.equal(refreshed.snapshot().error, null);
  }
  assert.equal(loadPage.mock.callCount(), 0);
});

test('refresh retains other library views, and navigation works without browser storage', async t => {
  const {create, loadTrash} = setup(t);
  for (const view of ['favourites', 'recent', 'inbox', 'entities', 'trash']) {
    const workspace = create(); await workspace.init();
    if (view === 'favourites') workspace.showOrganization(true);
    else if (view === 'recent') workspace.showRecent();
    else if (view === 'inbox') workspace.showInbox();
    else if (view === 'entities') workspace.showEntities();
    else await workspace.showTrash();
    const refreshed = create(); await refreshed.init();
    assert.equal(refreshed.snapshot().view, view);
  }
  assert.equal(loadTrash.mock.callCount(), 2);
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); },
  }});
  const workspace = create(); await workspace.init(); workspace.openOrganization('', 'nested');
  assert.deepEqual(workspace.snapshot().organizationContext, {collection: '', folder: 'nested'});
  assert.equal(workspace.snapshot().error, null);
});
