import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/client/api.ts';
import {Workspace} from '../src/client/state/workspace.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const organization={collections:[],folders:[],locations:[],memberships:[],favourites:[]};
const note=(vault='a',id='note')=>({id,vault_id:vault,title:id,blocks:[],sourceIds:[],revision:1,updated_at:''});
function fixture(t,address={view:'pages',pageId:'note'}) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage=new Map(address?[['noema-address/a',JSON.stringify(address)]]:[]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false},{id:'b',name:'B',locked:false}]);
  t.mock.method(api,'page',async(vault,id)=>note(vault,id));
  t.mock.method(api,'pages',async()=>[note()]);t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>organization);t.mock.method(api,'archivedPages',async()=>[]);
  const workspace=new Workspace();t.after(()=>{workspace.saver.dispose();workspace.titler.dispose();});return workspace;
}
test('startup resolves vault access once and publishes note before slow inventories',async t=>{
  const workspace=fixture(t),lists=deferred(),calls=[];
  t.mock.method(api,'vaults',async()=>{calls.push('access');return [{id:'a',name:'A',locked:false}];});
  t.mock.method(api,'page',async()=>{calls.push('body');return note();});
  t.mock.method(api,'pages',async()=>{calls.push('pages');return lists.promise;});
  t.mock.method(api,'organization',async()=>{calls.push('organization');return lists.promise.then(()=>organization);});
  await workspace.init();
  assert.equal(workspace.snapshot().page.id,'note');assert.equal(workspace.snapshot().busy,false);
  assert.deepEqual(calls,['access','body','pages','organization']);
  assert.equal(workspace.snapshot().pages.length,0);
  lists.resolve([note()]);await tick();
  assert.equal(workspace.snapshot().pages[0].id,'note');
});
test('archive is deferred without permanently omitting its inventory',async t=>{
  const workspace=fixture(t,null),archive=deferred();
  t.mock.method(api,'archivedPages',async()=>archive.promise);
  await workspace.init();assert.equal(workspace.snapshot().busy,false);assert.deepEqual(workspace.snapshot().archive,[]);
  archive.resolve([{...note('a','old'),archived_at:'today'}]);await tick();
  assert.equal(workspace.snapshot().archive[0].id,'old');
});
test('locked vault starts no content requests',async t=>{
  const workspace=fixture(t);let bodies=0,lists=0;
  t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:true}]);
  t.mock.method(api,'page',async()=>{bodies++;return note();});t.mock.method(api,'pages',async()=>{lists++;return [];});
  await workspace.init();assert.equal(bodies,0);assert.equal(lists,0);assert.equal(workspace.snapshot().vault.locked,true);
});
test('a switch aborts pending startup and ignores a late old-vault body',async t=>{
  const workspace=fixture(t),body=deferred();let signal;
  t.mock.method(api,'page',async(vault,id,abort)=>{if(vault==='a'){signal=abort;return body.promise;}return note(vault,id);});
  const first=workspace.init();await tick();
  await workspace.selectVault('b');assert.equal(signal.aborted,true);assert.equal(workspace.snapshot().vault.id,'b');
  body.resolve(note());await first;await tick();
  assert.equal(workspace.snapshot().vault.id,'b');assert.equal(workspace.snapshot().page,null);
});
test('deferred inventory failures remain visible and retryable',async t=>{
  const workspace=fixture(t);let attempts=0;
  t.mock.method(api,'pages',async()=>{if(++attempts===1)throw new Error('synthetic offline');return [note()];});
  await workspace.init();await tick();assert.match(workspace.snapshot().error,/Workspace lists could not load/);
  assert.equal(workspace.snapshot().page.id,'note');await workspace.retryInventories();await tick();
  assert.equal(attempts,2);assert.equal(workspace.snapshot().pages[0].id,'note');
});
test('retry restores a pending source destination after initial inventory failure',async t=>{
  const workspace=fixture(t,{view:'source',sourceId:'source'});let attempts=0;
  t.mock.method(api,'entities',async()=>{if(++attempts===1)throw new Error('synthetic offline');return [{id:'source',vault_id:'a',type:'source',name:'Source',aliases:[]}];});
  await workspace.init();assert.equal(workspace.snapshot().view,'organization');assert.match(workspace.snapshot().error,/Workspace lists could not load/);
  await workspace.retryInventories();assert.equal(workspace.snapshot().view,'source');assert.equal(workspace.snapshot().sourceId,'source');
});
test('inventory racing a page mutation fetches current lists rather than overwriting the mutation',async t=>{
  const workspace=fixture(t),lists=deferred();let attempts=0;
  t.mock.method(api,'pages',async()=>{if(++attempts===1)return lists.promise;return [{...note(),title:'New name'}];});
  await workspace.init();
  workspace.updatePage({title:'New name'});
  lists.resolve([note()]);await tick();
  assert.equal(attempts,2);assert.equal(workspace.snapshot().pages[0].title,'New name');
});
