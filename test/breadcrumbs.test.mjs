import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderBreadcrumbs, pageBreadcrumbs } from '../src/client/organization/breadcrumbs.ts';

const folders = [
  {id: 'parent', name: 'Research', parent_id: null},
  {id: 'child', name: 'Sources', parent_id: 'parent'},
  {id: 'other', name: 'Writing', parent_id: null},
];
const page = {id: 'note', title: 'Reading notes', updated_at: ''};
const organization = {
  folders, collections: [{id: 'theme', name: 'Theme'}], favourites: [],
  locations: [{kind: 'entity', item_id: 'note', folder_id: 'other'}, {kind: 'page', item_id: 'note', folder_id: 'child'}],
  memberships: [{kind: 'page', item_id: 'note', collection_id: 'theme'}],
};

test('page breadcrumbs use Pages and the absolute folder ancestry with clickable folder targets', () => {
  const crumbs = pageBreadcrumbs(organization, page);
  assert.deepEqual(crumbs.map(item => item.label), ['Pages', 'Research', 'Sources', 'Reading notes']);
  assert.deepEqual(crumbs.map(item => item.target), [
    {collection: '', folder: ''}, {collection: '', folder: 'parent'}, {collection: '', folder: 'child'}, undefined,
  ]);
  assert.ok(!crumbs.some(item => item.label === 'Library' || item.label === 'Theme' || item.label === 'Writing'));
});

test('moving a note replaces its breadcrumb location; unfiled notes omit folders', () => {
  assert.deepEqual(pageBreadcrumbs({...organization, locations: [{kind: 'page', item_id: 'note', folder_id: 'other'}]}, page).map(item => item.label), ['Pages', 'Writing', 'Reading notes']);
  assert.deepEqual(pageBreadcrumbs({...organization, locations: []}, {...page, title: ''}).map(item => item.label), ['Pages', 'Untitled']);
  assert.deepEqual(pageBreadcrumbs({...organization, locations: [{kind: 'page', item_id: 'note', folder_id: null}]}, page).map(item => item.label), ['Pages', 'Reading notes']);
});

test('folder breadcrumb traversal handles stale references and cycles without looping', () => {
  assert.deepEqual(folderBreadcrumbs(folders, 'missing'), []);
  assert.deepEqual(folderBreadcrumbs([{id: 'a', name: 'A', parent_id: 'b'}, {id: 'b', name: 'B', parent_id: 'a'}], 'a').map(item => item.label), ['B', 'A']);
});
