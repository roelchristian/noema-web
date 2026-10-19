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
  t.mock.method(api, 'organization', async () => ({collections: [], folders: [], locations: [], memberships: [], favourites: []}));
  const workspace = new Workspace();
  const reloaded = new Workspace();
  try {
    await workspace.selectVault('a');
    assert.equal(workspace.snapshot().view, 'organization');
    assert.equal(workspace.snapshot().page, null);
    assert.deepEqual(workspace.snapshot().organizationContext, {collection: '', folder: ''});
    await workspace.openPage('one');
    await workspace.openPage('two');
    workspace.recordRecent('entity', 'person');
    workspace.recordRecent('entity', 'person');
    assert.deepEqual(workspace.snapshot().recent.map(item => item.item_id), ['person', 'two', 'one']);
    await workspace.selectVault('b');
    assert.equal(workspace.snapshot().view, 'organization');
    assert.equal(workspace.snapshot().page, null);
    assert.deepEqual(workspace.snapshot().recent, []);
    workspace.recordRecent('entity', 'other-person');
    await reloaded.selectVault('a');
    assert.equal(reloaded.snapshot().view, 'pages');
    assert.equal(reloaded.snapshot().page.id, 'two');
    await reloaded.openPage('one');
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
  const org = {collections: [], folders: [], locations: [{kind: 'page', item_id: 'note', folder_id: 'desk'}], memberships: [], favourites: [{kind: 'page', item_id: 'note'}]};
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
  t.mock.method(api, 'restorePage', async () => { stored = {...stored, revision: 4}; return stored; });
  t.mock.method(api, 'permanentlyDeletePage', async () => ({ok: true}));
  const workspace = new Workspace();
  try {
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
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

test('sidebar rename flushes the current draft and can rename another page without opening it', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => null, setItem: () => {}}});
  const page = id => ({id, vault_id: 'a', title: id, blocks: [], sourceIds: [], revision: 1, updated_at: ''});
  const stored = new Map([['one', page('one')], ['two', page('two')]]), writes = [];
  let organization = {collections: [], folders: [], locations: [], memberships: [], favourites: []};
  t.mock.method(api, 'vaults', async () => [{id: 'a', name: 'A', locked: false}]);
  t.mock.method(api, 'pages', async () => [...stored.values()]);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'organization', async () => organization);
  t.mock.method(api, 'page', async (_vault, id) => stored.get(id));
  t.mock.method(api, 'savePage', async (_vault, id, input) => {
    assert.equal(input.revision, stored.get(id).revision);
    const result = {...input, revision: input.revision + 1}; stored.set(id, result); writes.push({id, title: input.title}); return result;
  });
  t.mock.method(api, 'organize', async (_vault, route, input) => {
    assert.equal(route, 'favourites');
    organization = {...organization, favourites: input.favourite ? [{kind: input.kind, item_id: input.item_id}] : []};
    return organization;
  });
  const workspace = new Workspace();
  try {
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
    workspace.updatePage({title: 'Unsaved draft'});
    await workspace.renamePage('two', 'Second note');
    assert.deepEqual(writes.map(write => write.id), ['one', 'two']);
    assert.equal(workspace.snapshot().page.id, 'one');
    assert.equal(workspace.snapshot().page.title, 'Unsaved draft');
    assert.equal(workspace.snapshot().pages.find(page => page.id === 'two').title, 'Second note');
    await workspace.renamePage('one', 'First note');
    assert.equal(workspace.snapshot().page.title, 'First note');
    assert.equal(workspace.snapshot().page.revision, 3);
    await workspace.togglePageFavourite('two');
    assert.equal(workspace.snapshot().organization.favourites[0].item_id, 'two');
    await workspace.togglePageFavourite('two');
    assert.deepEqual(workspace.snapshot().organization.favourites, []);
  } finally {
    workspace.saver.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});

test('new untitled pages observe server titles without another autosave', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const vault={id:'a',name:'A',locked:false};
  let stored={id:'new',vault_id:'a',title:'Untitled',revision:1,blocks:[],sourceIds:[],updated_at:''};
  const writes=[];
  t.mock.method(api,'vaults',async()=>[vault]);
  t.mock.method(api,'pages',async()=>[]);
  t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  t.mock.method(api,'createPage',async()=>structuredClone(stored));
  t.mock.method(api,'savePage',async(_vault,_id,input)=>{
    assert.equal(input.revision,stored.revision);
    stored={...structuredClone(input),revision:input.revision+1};writes.push(stored);return structuredClone(stored);
  });
  const generate=t.mock.method(api,'generateTitle',async()=>assert.fail('Browser dispatched enrichment'));
  const read=t.mock.method(api,'page',async(vault,id)=>{
    assert.equal(vault,'a');assert.equal(id,'new');
    stored={...stored,title:'Community garden plan'};
    return structuredClone(stored);
  });
  const workspace=new Workspace();
  try {
    await workspace.selectVault('a');await workspace.newPage();
    workspace.updatePage({blocks:[{id:'text',type:'paragraph',content:[{text:'Build raised beds for the community garden.'}]}]});
    await workspace.saver.flush();t.mock.timers.tick(10000);
    for(let n=0;n<5;n++)await Promise.resolve();
    await workspace.saver.flush();
    assert.equal(generate.mock.callCount(),0);assert.equal(read.mock.callCount(),1);assert.equal(writes.length,1);
    assert.equal(stored.title,'Community garden plan');
    assert.equal(workspace.snapshot().page.title,stored.title);
    assert.equal(workspace.snapshot().pages[0].title,stored.title);
    assert.equal(workspace.snapshot().page.revision,stored.revision);
  } finally {workspace.titler.dispose();workspace.saver.dispose();}
});

test('page icon changes update navigation immediately and autosave alongside content', async t => {
  const original = {id: 'icons', vault_id: 'a', title: 'Icon page', blocks: [], sourceIds: [], revision: 1, icon: null, updated_at: ''};
  t.mock.method(api, 'vaults', async () => [{id: 'a', name: 'A', locked: false}]);
  t.mock.method(api, 'pages', async () => [original]);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'page', async () => original);
  t.mock.method(api, 'organization', async () => ({collections: [], folders: [], locations: [], memberships: [], favourites: []}));
  const writes = [];
  t.mock.method(api, 'savePage', async (_vault, _id, page) => { writes.push(page); return {...page, revision: page.revision + 1, updated_at: '2026-10-17T09:30:00.000Z'}; });
  const workspace = new Workspace();
  try {
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
    workspace.updatePage({icon: 'compass'});
    assert.equal(workspace.snapshot().pages[0].icon, 'compass');
    workspace.updatePage({title: 'Directions'});
    await workspace.saver.flush();
    assert.equal(writes.at(-1).icon, 'compass');
    assert.equal(writes.at(-1).title, 'Directions');
    assert.equal(workspace.snapshot().pages[0].updated_at, '2026-10-17T09:30:00.000Z');
    assert.equal(workspace.snapshot().page.updated_at, '2026-10-17T09:30:00.000Z');
    workspace.updatePage({icon: null});
    await workspace.saver.flush();
    assert.equal(workspace.snapshot().pages[0].icon, null);
    assert.equal(writes.at(-1).icon, null);
  } finally { workspace.saver.dispose(); workspace.titler.dispose(); }
});

test('opening an existing untitled page observes server enrichment after reload', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let stored={id:'existing',vault_id:'a',title:'Untitled',revision:2,blocks:[{id:'body',type:'paragraph',content:[{text:'A detailed plan for the community garden.'}]}],sourceIds:[],updated_at:''};
  t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);
  t.mock.method(api,'pages',async()=>[stored]);
  t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  t.mock.method(api,'page',async()=>structuredClone(stored));
  t.mock.method(api,'savePage',async(_vault,_id,input)=>{
    assert.equal(input.revision,stored.revision);
    stored={...structuredClone(input),revision:input.revision+1};return structuredClone(stored);
  });
  const generate=t.mock.method(api,'generateTitle',async()=>assert.fail('Browser dispatched enrichment'));
  const workspace=new Workspace();
  try {
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
    stored={...stored,title:'Community garden plan'};
    t.mock.timers.tick(10000);for(let n=0;n<5;n++)await Promise.resolve();
    await workspace.saver.flush();
    assert.equal(generate.mock.callCount(),0);assert.equal(stored.title,'Community garden plan');
    assert.equal(workspace.snapshot().page.title,stored.title);
    await workspace.openPage(stored.id);t.mock.timers.tick(6000);
    assert.equal(generate.mock.callCount(),0,'Opening a named page never dispatches enrichment');
  } finally {workspace.titler.dispose();workspace.saver.dispose();}
});

test('reviewing a scanned entity updates in place without entering the workspace loading state', async t => {
  const original={id:'note',vault_id:'a',title:'Research',blocks:[],sourceIds:[],revision:1,updated_at:''};
  const order=[];
  let finishReview;
  let stored=original;
  t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);
  t.mock.method(api,'pages',async()=>[original]);
  t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  t.mock.method(api,'page',async()=>stored);
  t.mock.method(api,'savePage',async(_vault,_id,page)=>{order.push('save');stored={...page,revision:2};return stored;});
  const scan={id:'scan',revision:3,suggestions:[]}, entity={id:'bob',name:'Bob',type:'person',subtypes:[]};
  const edits=[{id:'suggestion',name:'Robert',type:'person',subtypes:[],existingId:null}];
  t.mock.method(api,'reviewEntity',async(vault,id,revision,scanId,suggestionId,decision,receivedEdits)=>{
    assert.deepEqual(receivedEdits,edits);
    order.push('review');assert.deepEqual([vault,id,revision,scanId,suggestionId,decision],['a','note',2,'scan','suggestion','accepted']);
    stored={...stored,revision:3,blocks:[{id:'b',type:'paragraph',content:[{entityId:'bob'}],checked:false}]};
    return new Promise(resolve=>{finishReview=()=>resolve({page:stored,scan,entities:[entity]});});
  });
  const workspace=new Workspace();
  try{
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
    workspace.updatePage({title:'Updated research'});
    const busyStates=[];
    const unsubscribe=workspace.subscribe(()=>busyStates.push(workspace.snapshot().busy));
    const pending=workspace.reviewEntity('scan','suggestion','accepted',edits);
    while(!finishReview)await Promise.resolve();
    assert.equal(workspace.snapshot().reviewing,true);
    assert.equal(workspace.snapshot().busy,false);
    workspace.updatePage({title:'Concurrent edit'});
    assert.equal(workspace.snapshot().page.title,'Updated research','Editing pauses during the atomic review write');
    await assert.rejects(workspace.reviewEntity('scan','other','rejected'),/Another note operation/);
    finishReview();
    assert.deepEqual(await pending,scan);
    assert.equal(workspace.snapshot().reviewing,false);
    assert.ok(busyStates.every(value=>value===false),'The editor and panel never unmount for a review');
    unsubscribe();
    assert.deepEqual(order,['save','review']);
    assert.deepEqual(workspace.snapshot().page,stored);
    assert.deepEqual(workspace.snapshot().entities,[entity]);
    assert.equal(workspace.snapshot().busy,false);
    await workspace.openPage('note');
    assert.deepEqual(workspace.snapshot().page,stored,'Opening the note retains the accepted mention');
  }finally{workspace.saver.dispose();workspace.titler.dispose();}
});

test('a failed asynchronous review retains the note and releases the editing lock', async t => {
  const original={id:'note',vault_id:'a',title:'Research',blocks:[],sourceIds:[],revision:1,updated_at:''};
  t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);
  t.mock.method(api,'pages',async()=>[original]);
  t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  t.mock.method(api,'page',async()=>original);
  t.mock.method(api,'reviewEntity',async()=>{throw new Error('Connection lost');});
  const workspace=new Workspace();
  try {
    await workspace.selectVault('a');
    if (workspace.snapshot().pages[0]) await workspace.openPage(workspace.snapshot().pages[0].id);
    await assert.rejects(workspace.reviewEntity('scan','suggestion','rejected'),/Connection lost/);
    assert.deepEqual(workspace.snapshot().page,original);
    assert.equal(workspace.snapshot().busy,false);
    assert.equal(workspace.snapshot().reviewing,false);
    workspace.updatePage({title:'Still editable'});
    assert.equal(workspace.snapshot().page.title,'Still editable');

  } finally {workspace.saver.dispose();workspace.titler.dispose();}
});

test('folder moves and collection membership changes use independent API operations', async t => {
  const vault = {id: 'a', name: 'A', locked: false};
  const organization = {collections: [{id: 'reading', name: 'Reading'}], folders: [{id: 'desk', name: 'Desk', parent_id: null}], locations: [], memberships: [], favourites: []};
  t.mock.method(api, 'vaults', async () => [vault]);
  t.mock.method(api, 'pages', async () => []);
  t.mock.method(api, 'entities', async () => []);
  t.mock.method(api, 'organization', async () => organization);
  const organize = t.mock.method(api, 'organize', async () => organization);
  const workspace = new Workspace();
  try {
    await workspace.selectVault(vault.id);
    workspace.openOrganization('', 'desk');
    await workspace.locatePage('note', '', 'desk');
    await workspace.locatePage('note', 'reading', null);
    await workspace.locatePage('note', 'reading', null, true);
    await workspace.locatePage('note', '', null);
    assert.deepEqual(organize.mock.calls.map(call => call.arguments), [
      ['a', 'locations', {kind: 'page', item_id: 'note', folder_id: 'desk', remove: false}],
      ['a', 'memberships', {kind: 'page', item_id: 'note', collection_id: 'reading', remove: false}],
      ['a', 'memberships', {kind: 'page', item_id: 'note', collection_id: 'reading', remove: true}],
      ['a', 'locations', {kind: 'page', item_id: 'note', folder_id: null, remove: false}],
    ]);
    assert.deepEqual(workspace.snapshot().organizationContext, {collection: '', folder: 'desk'});
    workspace.openOrganization('reading');
    workspace.setOrganization(organization);
    assert.deepEqual(workspace.snapshot().organizationContext, {collection: 'reading', folder: ''});
  } finally { workspace.titler.dispose(); workspace.saver.dispose(); }
});
