import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderDropHandlers } from '../src/client/organization/folder-drop.ts';
import { startFolderDrag } from '../src/client/organization/folder-drag.ts';
import { pageBreadcrumbs } from '../src/client/organization/breadcrumbs.ts';
import { startPageDrag } from '../src/client/organization/page-drag.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Organizer } from '../src/server/modules/organization.ts';

function drag(vaultId = 'default', pageId = 'welcome') {
  const values = new Map();
  const event = {
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    currentTarget: {contains: target => target === 'inside'}, relatedTarget: null,
    dataTransfer: {types: [], setData(type, value) { values.set(type, value); this.types.push(type); }, getData(type) { return values.get(type) || ''; }},
  };
  startPageDrag(event, vaultId, pageId);
  return event;
}
function setup(overrides = {}) {
  const hover = [], status = [], errors = [], moves = [];
  const options = {
    folder: {id: 'target', name: 'Target', parent_id: null}, vaultId: 'default', pages: [{id: 'welcome'}],
    data: {locations: [], folders: []}, pending: false, moving: {current: false},
    onHover: id => hover.push(id), onStatus: message => status.push(message),
    onMove: async (...args) => { moves.push(args); }, onMoveFolder: async (...args) => { moves.push(args); }, onError: error => errors.push(error), ...overrides,
  };
  return {handlers: folderDropHandlers(options), options, hover, status, errors, moves};
}

test('dropping a note on a Library folder replaces its location and preserves memberships and favourites', async () => {
  const db = openDatabase(':memory:');
  try {
    const org = new Organizer(new Store(db));
    const source = org.saveFolder('default', {name: 'Source'}).folders[0];
    const target = org.saveFolder('default', {name: 'Target', parent_id: source.id}).folders.find(folder => folder.id !== source.id);
    const collection = org.saveCollection('default', {name: 'Reading'}).collections[0];
    const note = {kind: 'page', item_id: 'welcome'};
    org.locate('default', {...note, folder_id: source.id});
    org.membership('default', {...note, collection_id: collection.id});
    org.favourite('default', {...note, favourite: true});
    const before = org.list('default');
    let updated;
    const {handlers, status} = setup({folder: target, data: before, onMove: async (item_id, folder_id) => { updated = org.locate('default', {kind: 'page', item_id, folder_id}); }});
    const event = drag();
    await handlers.onDrop(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(updated.locations.map(item => ({...item})), [{...note, folder_id: target.id}]);
    assert.deepEqual(updated.memberships, before.memberships);
    assert.deepEqual(updated.favourites, before.favourites);
    assert.equal(status.at(-1), 'Note moved to Target.');
  } finally { db.close(); }
});

test('folder hover advertises a move and stays highlighted across children', () => {
  const {handlers, hover} = setup();
  const event = drag();
  handlers.onDragOver(event);
  assert.equal(event.prevented, true);
  assert.equal(event.dataTransfer.dropEffect, 'move');
  assert.deepEqual(hover, ['target']);
  event.relatedTarget = 'inside';
  handlers.onDragLeave(event);
  assert.deepEqual(hover, ['target']);
  event.relatedTarget = null;
  handlers.onDragLeave(event);
  assert.deepEqual(hover, ['target', null]);
});

test('folder drops reject foreign, unknown, external, busy and redundant moves', async () => {
  const {handlers, moves} = setup();
  await handlers.onDrop(drag('another-vault'));
  await handlers.onDrop(drag('default', 'missing'));
  const external = drag(); external.dataTransfer.types = ['text/plain'];
  handlers.onDragOver(external);
  await handlers.onDrop(external);
  assert.equal(external.prevented, false);
  assert.deepEqual(moves, []);
  const pending = setup({pending: true});
  await pending.handlers.onDrop(drag());
  assert.deepEqual(pending.moves, []);
  const busy = setup({moving: {current: true}});
  await busy.handlers.onDrop(drag());
  assert.deepEqual(busy.moves, []);
  const same = setup({data: {locations: [{kind: 'page', item_id: 'welcome', folder_id: 'target'}]}});
  await same.handlers.onDrop(drag());
  assert.deepEqual(same.moves, []);
  assert.equal(same.status.at(-1), 'Note is already in Target.');
});

test('duplicate drops wait for the active move and failures release the guard for retry', async () => {
  let release, calls = 0;
  const error = new Error('Save failed');
  const {handlers, options, errors, status} = setup({onMove: async () => {
    calls++;
    if (calls === 1) await new Promise((resolve, reject) => { release = () => reject(error); });
  }});
  const first = handlers.onDrop(drag());
  assert.equal(options.moving.current, true);
  await handlers.onDrop(drag());
  assert.equal(calls, 1);
  release(); await first;
  assert.deepEqual(errors, [error]);
  assert.equal(status.at(-1), 'Could not move note. Try again.');
  assert.equal(options.moving.current, false);
  await handlers.onDrop(drag());
  assert.equal(calls, 2);
  assert.equal(status.at(-1), 'Note moved to Target.');
});

function folderDrag(vaultId = 'default', folderId = 'source') {
  const event = drag();
  event.dataTransfer.types = [];
  startFolderDrag(event, vaultId, folderId);
  return event;
}

test('folder drops move a whole subtree without rewriting note locations or curated memberships', async () => {
  const db = openDatabase(':memory:');
  try {
    const org = new Organizer(new Store(db));
    const source = org.saveFolder('default', {name: 'Source'}).folders[0];
    const child = org.saveFolder('default', {name: 'Child', parent_id: source.id}).folders.find(folder => folder.id !== source.id);
    const target = org.saveFolder('default', {name: 'Destination'}).folders.find(folder => folder.id !== source.id && folder.id !== child.id);
    const collection = org.saveCollection('default', {name: 'Reading'}).collections[0];
    org.locate('default', {kind: 'page', item_id: 'welcome', folder_id: child.id});
    org.locate('default', {kind: 'entity', item_id: 'earthsea', folder_id: source.id});
    org.membership('default', {kind: 'page', item_id: 'welcome', collection_id: collection.id});
    org.favourite('default', {kind: 'folder', item_id: source.id, favourite: true});
    org.favourite('default', {kind: 'page', item_id: 'welcome', favourite: true});
    const before = org.list('default');
    let updated;
    const {handlers, status} = setup({folder: target, data: before, onMoveFolder: async (source, parent_id) => {
      updated = org.saveFolder('default', {name: source.name, parent_id}, source.id);
    }});
    const event = folderDrag('default', source.id);
    handlers.onDragOver(event);
    assert.equal(event.dataTransfer.dropEffect, 'move');
    await handlers.onDrop(event);
    assert.equal(updated.folders.find(folder => folder.id === source.id).parent_id, target.id);
    assert.equal(updated.folders.find(folder => folder.id === child.id).parent_id, source.id);
    assert.deepEqual(updated.locations, before.locations);
    assert.deepEqual(updated.memberships, before.memberships);
    assert.deepEqual(updated.favourites, before.favourites);
    assert.deepEqual(pageBreadcrumbs(updated, {id: 'welcome', title: 'Note'}).map(crumb => crumb.label), ['Pages', 'Destination', 'Source', 'Child', 'Note']);
    assert.equal(status.at(-1), 'Folder moved to Destination.');
    assert.throws(() => org.saveFolder('default', {name: 'Destination', parent_id: child.id}, target.id), error => error.status === 400);
    assert.deepEqual(org.list('default'), updated);
  } finally { db.close(); }
});

test('folder drops reject cycles, redundant moves, unknown folders and foreign vaults', async () => {
  const folders = [
    {id: 'source', name: 'Source', parent_id: null},
    {id: 'child', name: 'Child', parent_id: 'source'},
    {id: 'deep', name: 'Deep', parent_id: 'child'},
    {id: 'peer', name: 'Peer', parent_id: null},
  ];
  for (const target of folders.slice(0, 3)) {
    const {handlers, moves, status} = setup({folder: target, data: {folders, locations: []}});
    await handlers.onDrop(folderDrag());
    assert.deepEqual(moves, []);
    assert.equal(status.at(-1), 'Cannot move a folder into itself or its subfolders.');
  }
  const {handlers, moves, status} = setup({folder: folders[0], data: {folders, locations: []}});
  await handlers.onDrop(folderDrag('default', 'child'));
  assert.equal(status.at(-1), 'Folder is already in Source.');
  await handlers.onDrop(folderDrag('another-vault'));
  await handlers.onDrop(folderDrag('default', 'missing'));
  assert.deepEqual(moves, []);
});

test('failed folder moves report errors and release the guard for retry', async () => {
  const source = {id: 'source', name: 'Source', parent_id: null};
  const error = new Error('Failed to persist');
  let calls = 0;
  const {handlers, errors, options, status} = setup({data: {folders: [source], locations: []}, onMoveFolder: async () => { if (++calls === 1) throw error; }});
  await handlers.onDrop(folderDrag());
  assert.deepEqual(errors, [error]);
  assert.equal(options.moving.current, false);
  assert.equal(status.at(-1), 'Could not move folder. Try again.');
  await handlers.onDrop(folderDrag());
  assert.equal(calls, 2);
  assert.equal(status.at(-1), 'Folder moved to Target.');
});
