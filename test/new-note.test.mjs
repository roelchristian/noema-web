import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {Workspace} from '../src/client/state/workspace.ts';
import {api} from '../src/client/api.ts';

test('creation persists exact placement and rolls back invalid or cross-vault destinations',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-new-note-')),filename=path.join(dir,'test.sqlite');
 let db=openDatabase(filename);
 try{
  let store=new Store(db),pages=new Pages(store,new Knowledge(store)),org=new Organizer(store);
  const collection=org.saveCollection('default',{name:'Research'}).collections[0].id;
  const parent=org.saveFolder('default',{name:'Projects'}).folders[0].id;
  const folder=org.saveFolder('default',{name:'Field notes',parent_id:parent}).folders.find(f=>f.parent_id===parent).id;
  const grouped=pages.create('default',{destination:{collection}});
  const nested=pages.create('default',{destination:{folder}});
  const root=pages.create('default',{});
  let data=org.list('default');
  assert.ok(data.memberships.some(m=>m.item_id===grouped.id&&m.collection_id===collection));
  assert.ok(!data.locations.some(l=>l.item_id===grouped.id)); // Collection notes remain unfiled / in Inbox.
  assert.ok(!data.memberships.some(m=>m.item_id===nested.id));
  assert.ok(!data.locations.some(l=>l.item_id===root.id));
  store.run("INSERT INTO vaults(id,name,updated_at) VALUES ('other','Other','now')");
  const count=()=>store.get('SELECT count(*) AS n FROM pages').n,before=count();
  for(const [vault,destination] of [['default',{folder:'missing'}],['default',{collection,folder:'missing'}],['default',{collection:'missing'}],['other',{folder}],['other',{collection}],['default',{folder:42}]]){
   assert.throws(()=>pages.create(vault,{destination}));assert.equal(count(),before);
  }
  // Prove rollback even when placement itself fails after inserting the page.
  db.exec("CREATE TRIGGER fail_placement BEFORE INSERT ON item_locations BEGIN SELECT RAISE(ABORT,'placement failed'); END");
  assert.throws(()=>pages.create('default',{destination:{folder}}),/placement failed/);assert.equal(count(),before);
  db.exec('DROP TRIGGER fail_placement');
  db.close();db=openDatabase(filename);store=new Store(db);org=new Organizer(store);
  data=org.list('default');
  assert.equal(data.locations.find(l=>l.item_id===nested.id).folder_id,folder);
  assert.equal(data.folders.find(f=>f.id===folder).parent_id,parent);
  assert.ok(data.memberships.some(m=>m.item_id===grouped.id&&m.collection_id===collection));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('workspace captures creation destination before flush and ignores stale context outside organization',async t=>{
 const org={collections:[{id:'c',name:'Research'}],folders:[{id:'f',name:'Field notes',parent_id:null}],locations:[],memberships:[],favourites:[]};
 t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);
 t.mock.method(api,'pages',async()=>[]);
 t.mock.method(api,'entities',async()=>[]);
 t.mock.method(api,'organization',async()=>org);
 let n=0;const create=t.mock.method(api,'createPage',async(vault)=>({id:'new-'+(++n),vault_id:vault,title:'Untitled',blocks:[{id:'body',type:'paragraph',content:[]}],sourceIds:[],revision:1,updated_at:''}));
 const workspace=new Workspace();
 try{
  await workspace.selectVault('a');
  workspace.openOrganization('c','');
  let finishFlush;
  t.mock.method(workspace.saver,'flush',()=>new Promise(resolve=>finishFlush=resolve));
  const pending=workspace.newPage();
  workspace.setOrganizationContext({collection:'',folder:'f'});
  finishFlush();await pending;
  assert.deepEqual(create.mock.calls[0].arguments,['a',{collection:'c',folder:''}]);
  assert.equal(workspace.snapshot().organization.memberships[0].collection_id,'c');
  assert.equal(workspace.snapshot().creationFocusPageId,'new-1');
  workspace.consumeCreationFocus('wrong');assert.equal(workspace.snapshot().creationFocusPageId,'new-1');
  workspace.consumeCreationFocus('new-1');assert.equal(workspace.snapshot().creationFocusPageId,null);
  t.mock.method(workspace.saver,'flush',async()=>{});
  workspace.openOrganization('','f');await workspace.newPage();
  assert.deepEqual(create.mock.calls[1].arguments,['a',{collection:'',folder:'f'}]);
  assert.equal(workspace.snapshot().organization.locations[0].folder_id,'f');
  // Page view retains the folder context but creates at root.
  await workspace.newPage();
  assert.deepEqual(create.mock.calls[2].arguments,['a',{collection:'',folder:''}]);
  await workspace.showInbox();await workspace.newPage();
  assert.deepEqual(create.mock.calls[3].arguments,['a',{collection:'',folder:''}]);
 }finally{workspace.saver.dispose();}
});

test('initial editing session survives autosave, metadata and same-note selection; leaving ends it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const org={collections:[],folders:[],locations:[],memberships:[],favourites:[]};
 t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);
 t.mock.method(api,'pages',async()=>[]);
 t.mock.method(api,'entities',async()=>[]);
 t.mock.method(api,'organization',async()=>org);
 let stored={id:'new',vault_id:'a',title:'Untitled',blocks:[{id:'body',type:'paragraph',checked:false,content:[]}],sourceIds:[],revision:1,updated_at:''};
 t.mock.method(api,'createPage',async()=>stored);
 t.mock.method(api,'savePage',async(_vault,_id,input)=>stored={...input,revision:input.revision+1});
 t.mock.method(api,'page',async()=>stored);
 t.mock.method(api,'pageMetadata',async()=>({...stored,title:'Garden plans',enrichmentPending:false}));
 const workspace=new Workspace();
 try{
  await workspace.selectVault('a');await workspace.newPage();
  workspace.consumeCreationFocus('new');
  assert.equal(workspace.snapshot().initialEditingPageId,'new');
  workspace.updatePage({blocks:[{...stored.blocks[0],content:[{text:'A detailed plan for our community garden'}]}]});
  await workspace.saver.flush();
  assert.equal(workspace.snapshot().initialEditingPageId,'new');
  t.mock.timers.tick(2000);for(let n=0;n<10;n++)await Promise.resolve();
  assert.equal(workspace.snapshot().page.title,'Garden plans');
  assert.equal(workspace.snapshot().pages[0].title,'Garden plans');
  assert.equal(workspace.snapshot().initialEditingPageId,'new');
  await workspace.openPage('new');assert.equal(workspace.snapshot().initialEditingPageId,'new');
  // Rename uses busy/remount during persistence but is still the same session.
  await workspace.renamePage('new','My garden');
  assert.equal(workspace.snapshot().page.title,'My garden');
  assert.equal(workspace.snapshot().initialEditingPageId,'new');
  workspace.showInbox();assert.equal(workspace.snapshot().initialEditingPageId,null);
  await workspace.openPage('new');
  assert.equal(workspace.snapshot().initialEditingPageId,null);
  assert.equal(workspace.snapshot().creationFocusPageId,null);
  await workspace.newPage();
  assert.equal(workspace.snapshot().initialEditingPageId,'new');
  workspace.showEntities();assert.equal(workspace.snapshot().initialEditingPageId,null);
 }finally{workspace.saver.dispose();workspace.titler.dispose();}
});
