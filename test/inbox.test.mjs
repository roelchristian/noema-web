import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxPages } from '../src/client/organization/inbox.ts';
import { Workspace } from '../src/client/state/workspace.ts';
import { api } from '../src/client/api.ts';

test('Inbox contains only pages without collection membership and ignores entity locations', () => {
  const pages = ['draft', 'organized', 'same-id'].map(id => ({id, title: id, updated_at: ''}));
  const organization = {collections: [{id: 'research', name: 'Research'}], folders: [], favourites: [], locations: [
    {kind: 'page', item_id: 'organized', collection_id: 'research', folder_id: null},
    {kind: 'entity', item_id: 'same-id', collection_id: 'research', folder_id: null},
  ]};
  assert.deepEqual(inboxPages(pages, organization).map(page => page.id), ['draft', 'same-id']);
  organization.locations.push({kind: 'page', item_id: 'draft', collection_id: 'research', folder_id: 'folder'});
  assert.deepEqual(inboxPages(pages, organization).map(page => page.id), ['same-id']);
  organization.locations = [];
  assert.deepEqual(inboxPages(pages, organization), pages);
});

test('New Note opens the editor from a collection and leaves the note in Inbox', async t => {
  const vault = {id: 'vault', name: 'Vault', locked: false};
  const page = {id: 'new', vault_id: vault.id, title: 'Untitled', blocks: [], sourceIds: [], revision: 1, updated_at: ''};
  t.mock.method(api, 'vaults', async () => [vault]);
  t.mock.method(api, 'pages', async () => []);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'organization', async () => ({collections: [{id: 'research', name: 'Research'}], folders: [], locations: [], favourites: []}));
  const create = t.mock.method(api, 'createPage', async () => page);
  const organize = t.mock.method(api, 'organize', async () => { throw new Error('Creating a note must not require organization'); });
  const workspace = new Workspace();
  try {
    await workspace.selectVault(vault.id);
    workspace.openOrganization('research');
    await workspace.newPage();
    assert.equal(create.mock.callCount(), 1);
    assert.equal(organize.mock.callCount(), 0);
    assert.equal(workspace.snapshot().view, 'pages');
    assert.equal(workspace.snapshot().page.id, page.id);
    assert.deepEqual(inboxPages(workspace.snapshot().pages, workspace.snapshot().organization), [page]);
    workspace.showInbox();
    assert.equal(workspace.snapshot().view, 'inbox');
  } finally { workspace.titler.dispose(); workspace.saver.dispose(); }
});
