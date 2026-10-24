import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/client/state/workspace.ts';
import {entityURL, readWorkspaceURL, workspaceURL} from '../src/client/state/navigation-address.ts';
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
  t.mock.method(api,'archivedPages',async()=>[]);const loadPages = t.mock.method(api, 'pages', async id => id === 'a' ? [page] : []);
  t.mock.method(api, 'vaults', async () => vaults);
  const entities = [{id:'person',name:'Ada',type:'person'},{id:'concept',name:'Computation',type:'concept'},{id:'source',name:'Book',type:'source'}];
  t.mock.method(api, 'entities', async () => entities);
  t.mock.method(api, 'organization', async id => id === 'a' ? organization : {...organization, collections: [], folders: [], locations: []});
  const loadPage = t.mock.method(api, 'page', async () => ({...page, title: 'Fresh title'}));
  const loadTrash = t.mock.method(api, 'trash', async () => []);
  const workspaces = [];
  function create() { const workspace = new Workspace(); workspaces.push(workspace); return workspace; }
  t.after(() => {
    for (const workspace of workspaces) { workspace.saver.dispose(); workspace.titler.dispose(); }
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  });
  return {storage, vaults, page, organization, entities, create, loadPage, loadPages, loadTrash};
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
  await first.selectVault('b'); await first.showInbox();
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
    else if (view === 'inbox') await workspace.showInbox();
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


test('entity homes have independent history, persist across reload, and keep source navigation specialized', async t => {
  const {create, storage} = setup(t);
  const workspace = create(); await workspace.init(); await workspace.openPage('note');
  workspace.openEntity('person');
  assert.equal(workspace.snapshot().view, 'pages');
  assert.equal(workspace.snapshot().entityPanelId, 'person');
  assert.equal(workspace.snapshot().entityId, null);
  await workspace.openEntityHome('person');
  assert.equal(workspace.snapshot().view, 'entity');
  assert.equal(workspace.snapshot().entityId, 'person');
  assert.equal(workspace.snapshot().entityPanelId, null);
  assert.equal(workspace.snapshot().page.id, 'note');
  assert.equal(JSON.parse(storage.get('noema-address/a')).subjectId, 'person');
  const refreshed = create(); await refreshed.init();
  assert.equal(refreshed.snapshot().view, 'entity');
  assert.equal(refreshed.snapshot().entityId, 'person');
  await workspace.openEntityHome('concept');
  await workspace.goHistory(-1);
  assert.equal(workspace.snapshot().entityId, 'person');
  await workspace.goHistory(-1);
  assert.equal(workspace.snapshot().view, 'pages');
  assert.equal(workspace.snapshot().entityId, null);
  assert.equal(workspace.snapshot().entityPanelId, 'person');
  await workspace.goHistory(1);
  assert.equal(workspace.snapshot().entityId, 'person');
  await workspace.openEntityHome('source');
  assert.equal(workspace.snapshot().view, 'source');
  assert.equal(workspace.snapshot().sourceId, 'source');
  assert.equal(workspace.snapshot().entityId, null);
});

test('leaving a note for an entity flushes its draft and a failed save retains the editor', async t => {
  const {create} = setup(t);
  const workspace = create(); await workspace.init(); await workspace.openPage('note');
  workspace.updatePage({title:'Unsaved research'});
  t.mock.method(api, 'savePage', async () => {throw new Error('Save failed');});
  await assert.rejects(workspace.openEntityHome('person'), /Save failed/);
  assert.equal(workspace.snapshot().view, 'pages');
  assert.equal(workspace.snapshot().entityId, null);
  assert.equal(workspace.snapshot().page.title, 'Unsaved research');
  t.mock.method(api, 'savePage', async (_vault, _id, page) => ({...page,revision:2}));
  await workspace.openEntityHome('person');
  assert.equal(workspace.snapshot().view, 'entity');
  assert.equal(workspace.saver.hasPending, false);
});

test('deleted entity homes fall back to entities and cannot be restored by history or reload', async t => {
  const {create, entities} = setup(t);
  const workspace = create(); await workspace.init(); await workspace.openEntityHome('person');
  entities.splice(entities.findIndex(entity => entity.id === 'person'), 1);
  await workspace.refreshEntities();
  assert.equal(workspace.snapshot().view, 'entities');
  assert.equal(workspace.snapshot().entityId, null);
  await workspace.goHistory(-1);
  assert.equal(workspace.snapshot().view, 'organization');
  const refreshed = create(); await refreshed.selectVault('a', {vaultId:'a',view:'entity',subjectId:'person',pageId:null,entityId:null,collection:'',folder:''});
  assert.equal(refreshed.snapshot().view, 'entities');
  assert.match(refreshed.snapshot().error, /entity is unavailable/);
});

test('entity URLs distinguish the full workspace from an optional contextual panel', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable:true,value:{location:{search:'?vault=a&view=entity&subject=person&entity=concept'}}});
  t.after(() => {if (descriptor) Object.defineProperty(globalThis,'window',descriptor); else delete globalThis.window;});
  const address = readWorkspaceURL();
  assert.equal(address.view, 'entity');
  assert.equal(address.subjectId, 'person');
  assert.equal(address.entityId, 'concept');
  assert.equal(workspaceURL(address), '/?vault=a&view=entity&subject=person&entity=concept');
  assert.equal(entityURL('vault with spaces', 'person/1'), '/?vault=vault+with+spaces&view=entity&subject=person%2F1');
});

test('direct entity links survive browser history traversal and canonicalize deleted targets', async t => {
  const {create, entities} = setup(t);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget(), entries = [{url:'/?vault=a&view=entity&subject=person',state:null}];
  let index = 0;
  const location = {pathname:'/',search:'?vault=a&view=entity&subject=person',href:'https://noema.test/?vault=a&view=entity&subject=person'};
  const setLocation = url => {const next = new URL(url, 'https://noema.test');Object.assign(location,{pathname:next.pathname,search:next.search,href:next.href});};
  const history = {
    get state() {return entries[index].state;},
    replaceState(state, _title, url) {entries[index]={state,url};setLocation(url);},
    pushState(state, _title, url) {entries.splice(++index);entries.push({state,url});setLocation(url);},
    go(direction) {index+=direction;setLocation(entries[index].url);target.dispatchEvent(new Event('popstate'));},
  };
  Object.defineProperty(globalThis, 'window', {configurable:true,value:{location,history,addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target)}});
  const workspace = create(), detach = workspace.attachBrowserNavigation();
  t.after(() => {detach();if (descriptor) Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window;});
  await workspace.init();
  assert.equal(workspace.snapshot().entityId, 'person');
  assert.equal(entries.length, 1);
  await workspace.openEntityHome('concept');
  assert.equal(location.search, '?vault=a&view=entity&subject=concept');
  await workspace.goHistory(-1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workspace.snapshot().entityId, 'person');
  await workspace.goHistory(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workspace.snapshot().entityId, 'concept');
  entities.splice(entities.findIndex(entity => entity.id === 'person'), 1);
  await workspace.refreshEntities();
  await workspace.goHistory(-1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workspace.snapshot().view, 'entities');
  assert.equal(workspace.snapshot().entityId, null);
  assert.equal(location.search, '?vault=a&view=entities');
  assert.equal(entries.length, 2);
  assert.match(workspace.snapshot().error, /entity is unavailable/);
});

test('Calendar participates in history, waits for saves, and leaves the page available on a failed transition',async t=>{
 const {create,page}=setup(t),workspace=create();await workspace.init();await workspace.openPage(page.id);
 const original=workspace.snapshot().page;
 const flush=t.mock.method(workspace.saver,'flush',async()=>{throw new Error('Synthetic interrupted save');});
 await assert.rejects(workspace.showCalendar(),/interrupted save/);
 assert.equal(workspace.snapshot().view,'pages');assert.equal(workspace.snapshot().page,original);assert.equal(workspace.snapshot().busy,false);
 flush.mock.restore();await workspace.showCalendar();assert.equal(workspace.snapshot().view,'calendar');assert.equal(workspace.snapshot().page,original);
 await workspace.goHistory(-1);assert.equal(workspace.snapshot().view,'pages');
 await workspace.goHistory(1);assert.equal(workspace.snapshot().view,'calendar');const refreshed=create();await refreshed.init();assert.equal(refreshed.snapshot().view,'calendar');
 const url=workspaceURL({vaultId:'a',view:'calendar',pageId:null,entityId:null,collection:'',folder:''});assert.equal(url,'/?vault=a&view=calendar');
});

test('Inbox facets flush pending saves and retain independent browser and session addresses',async t=>{
 const {create,storage}=setup(t),workspace=create();await workspace.init();await workspace.openPage('note');
 const order=[];let finish;
 t.mock.method(workspace.saver,'flush',()=>order.length?Promise.resolve():new Promise(resolve=>{order.push('flush');finish=resolve;}));
 const pending=workspace.showInbox('organise');assert.equal(workspace.snapshot().view,'pages');
 finish();await pending;assert.equal(workspace.snapshot().view,'inbox');assert.equal(workspace.snapshot().inboxFacet,'organise');
 await workspace.showInbox('issues');assert.deepEqual(order,['flush']);
 await workspace.goHistory(-1); // restore the previous facet without leaving the shell
 assert.equal(workspace.snapshot().inboxFacet,'organise');
 assert.equal(JSON.parse(storage.get('noema-address/a')).inboxFacet,'organise');
 const refreshed=create();await refreshed.init();assert.equal(refreshed.snapshot().inboxFacet,'organise');
});

test('legacy Review Centre addresses canonicalize to the Inbox review facet',async t=>{
 const {create,storage}=setup(t);storage.set('noema-vault','a');storage.set('noema-address/a',JSON.stringify({view:'review'}));
 const workspace=create();await workspace.init();assert.equal(workspace.snapshot().view,'inbox');assert.equal(workspace.snapshot().inboxFacet,'review');
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{search:'?vault=a&view=review'}}});
 try{const address=readWorkspaceURL();assert.equal(address.view,'inbox');assert.equal(address.inboxFacet,'review');assert.match(workspaceURL(address),/view=inbox&facet=review/);}
 finally{if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;}
});
