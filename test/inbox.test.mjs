import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxPages } from '../src/client/organization/inbox.ts';
import { Workspace } from '../src/client/state/workspace.ts';
import { api } from '../src/client/api.ts';

test('Inbox contains only pages without folder locations and ignores entity locations', () => {
  const pages = ['draft', 'organized', 'same-id'].map(id => ({id, title: id, updated_at: ''}));
  const organization = {collections: [{id: 'research', name: 'Research'}], folders: [], favourites: [], memberships: [{kind: 'page', item_id: 'draft', collection_id: 'research'}], locations: [
    {kind: 'page', item_id: 'organized', folder_id: 'folder'},
    {kind: 'entity', item_id: 'same-id', folder_id: 'folder'},
  ]};
  assert.deepEqual(inboxPages(pages, organization).map(page => page.id), ['draft', 'same-id']);
  organization.locations.push({kind: 'page', item_id: 'draft', folder_id: 'folder'});
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
  t.mock.method(api, 'organization', async () => ({collections: [{id: 'research', name: 'Research'}], folders: [], locations: [], memberships: [], favourites: []}));
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

test('Triage metadata and preview use existing records without content or enrichment writes', async () => {
  const {openDatabase}=await import('../src/server/database.ts');
  const {Store}=await import('../src/server/store.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Organizer}=await import('../src/server/modules/organization.ts');
  const db=openDatabase(':memory:'), store=new Store(db), pages=new Pages(store,new Knowledge(store)), organizer=new Organizer(store);
  try {
    const page=pages.create('default',{title:'Untitled',blocks:[{id:'p',type:'paragraph',checked:false,content:[{text:'Synthetic content'}]}]});
    pages.update('default',page.id,{title:page.title,revision:page.revision,blocks:[{id:'p',type:'paragraph',checked:false,content:[{text:'Synthetic content'}]}]});
    store.run("INSERT INTO page_reading_notes VALUES (?, 'default', NULL, NULL, 'hash', 0, 4, 'text', '{}', '2026-10-23')",page.id);
    const summary=pages.list('default').find(item=>item.id===page.id);
    assert.equal(summary.isReadingNote,true);assert.equal(summary.hasEntityAssociations,false);
    new Knowledge(store).associatePage('default','earthsea',page.id,{});
    assert.equal(pages.list('default').find(item=>item.id===page.id).hasEntityAssociations,true);
    const before=JSON.stringify(store.all('SELECT * FROM pages WHERE id=?',page.id));
    const changes=store.get('SELECT total_changes() AS n').n;
    const preview=pages.preview('default',page.id);
    assert.equal(preview.title,'Untitled');assert.equal(preview.blocks[0].content[0].text,'Synthetic content');
    assert.equal(store.get('SELECT total_changes() AS n').n,changes);
    assert.equal(JSON.stringify(store.all('SELECT * FROM pages WHERE id=?',page.id)),before);
    assert.throws(()=>pages.preview('other',page.id),error=>error.status===404);
    const folder=organizer.saveFolder('default',{name:'Filed'}).folders[0].id;
    organizer.locate('default',{kind:'page',item_id:page.id,folder_id:folder,expected_folder_id:null});
    assert.throws(()=>organizer.locate('default',{kind:'page',item_id:page.id,folder_id:folder,expected_folder_id:null}),error=>error.status===409);
    store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(Array.from({length:81},(_,index)=>({id:String(index),type:'paragraph',checked:false,content:[]}))),page.id);
    assert.equal(pages.preview('default',page.id).blocks.length,80);assert.equal(pages.preview('default',page.id).truncated,true);
    pages.delete('default',page.id);
    assert.throws(()=>pages.preview('default',page.id),error=>error.status===404);
  } finally {db.close();}
});

test('Triage keeps only for the session, stops at the end, and ignores stale previews', async t => {
  const {setupDOM}=await import('./helpers/dom.mjs');const fixture=setupDOM(t);
  const {createRoot}=await import('react-dom/client');const {act,createElement}=await import('react');
  const {InboxTriage}=await import('../src/client/organization/InboxTriage.tsx');
  const pages=['a','b','c'].map(id=>({id,title:id,updated_at:''}));
  const requests=[];
  t.mock.method(api,'pagePreview',(_vault,id,signal)=>new Promise(resolve=>requests.push({id,signal,resolve})));
  const root=createRoot(document.querySelector('#mount'));fixture.defer(()=>act(()=>root.unmount()));
  const noop=()=>{};let currentPages=pages;
  const render=()=>act(()=>root.render(createElement(InboxTriage,{vaultId:'default',pages:currentPages,allPages:pages,entities:[],data:{collections:[],folders:[],locations:[],memberships:[],favourites:[]},checked:new Set(),onToggle:noop,onChanged:noop,onOpenPage:noop,onOpenEntity:noop,onTrash:noop,onBusyChange:noop,onSelectAll:noop})));
  const click=async text=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===text);assert.ok(button,text);await act(()=>button.click());};
  await render();assert.equal(requests.length,1);assert.equal(requests[0].id,'a');
  await click('Next');assert.equal(requests[0].signal.aborted,true);assert.equal(requests[1].id,'b');
  await act(()=>requests[0].resolve({id:'a',title:'a',blocks:[{id:'late',type:'paragraph',checked:false,content:[{text:'STALE CONTENT'}]}],revision:1,updated_at:''}));
  assert.doesNotMatch(document.body.textContent,/STALE CONTENT/);
  await click('Keep in Inbox');assert.equal(document.querySelector('.inbox-detail h2').textContent,'c');
  await click('Previous');assert.equal(document.querySelector('.inbox-detail h2').textContent,'a');
  currentPages=pages.filter(page=>page.id!=='a');await render();assert.equal(document.querySelector('.inbox-detail h2').textContent,'c');
  await click('Keep in Inbox');assert.match(document.body.textContent,/Session complete/);assert.equal(document.querySelector('.inbox-detail h2'),null);
  await click('Review kept pages');assert.equal(document.querySelector('.inbox-detail h2').textContent,'b');
});
