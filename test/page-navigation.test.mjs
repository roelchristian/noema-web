import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/client/api.ts';
import {Workspace} from '../src/client/state/workspace.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const page=(id,vault='a')=>({id,vault_id:vault,title:id,blocks:[{id:id+'-body',type:'paragraph',checked:false,content:[{text:'Content '+id}]}],sourceIds:[],revision:1,updated_at:''});
async function fixture(t){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
 t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false},{id:'b',name:'B',locked:false}]);
 t.mock.method(api,'pages',async vault=>['one','two','three'].map(id=>page(id,vault)));
 t.mock.method(api,'entities',async()=>[]);
 t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
 t.mock.method(api,'page',async(vault,id)=>page(id,vault));
 const workspace=new Workspace();await workspace.selectVault('a');await workspace.openPage('one');
 t.after(()=>{workspace.saver.dispose();workspace.titler.dispose();if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
 return {workspace,storage};
}
test('note navigation stays local, preserves shell data and publishes the new page only when ready',async t=>{
 const {workspace,storage}=await fixture(t),original=workspace.snapshot(),pending=deferred(),states=[];
 t.mock.method(api,'page',()=>pending.promise);workspace.subscribe(()=>states.push(workspace.snapshot()));
 const navigation=workspace.openPage('two');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(workspace.snapshot().busy,false);assert.equal(workspace.snapshot().loadingPageId,'two');assert.equal(workspace.snapshot().page,original.page);
 assert.equal(JSON.parse(storage.get('noema-address/a')).pageId,'one');
 pending.resolve(page('two'));await navigation;
 assert.equal(workspace.snapshot().page.id,'two');assert.equal(workspace.snapshot().loadingPageId,null);assert.equal(JSON.parse(storage.get('noema-address/a')).pageId,'two');
 assert.ok(states.every(state=>!state.busy&&state.vault===original.vault&&state.pages===original.pages&&state.entities===original.entities&&state.organization===original.organization));
});
test('latest note selection wins even when an aborted request resolves late',async t=>{
 const {workspace}=await fixture(t),second=deferred(),third=deferred(),signals=[];
 t.mock.method(api,'page',(_vault,id,signal)=>{signals.push(signal);return id==='two'?second.promise:third.promise;});
 const a=workspace.openPage('two');await new Promise(resolve=>setImmediate(resolve));const b=workspace.openPage('three');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(signals[0].aborted,true);third.resolve(page('three'));await b;second.resolve(page('two'));await a;
 assert.equal(workspace.snapshot().page.id,'three');assert.equal(workspace.snapshot().recent[0].item_id,'three');assert.equal(workspace.snapshot().loadingPageId,null);
});
test('save failure keeps the current editor and prevents fetching another note',async t=>{
 const {workspace}=await fixture(t),original=workspace.snapshot().page;
 workspace.updatePage({title:'Unsaved draft'});const request=t.mock.method(api,'page',async()=>page('two'));
 t.mock.method(api,'savePage',async()=>{throw new Error('Save failed');});
 await assert.rejects(workspace.openPage('two'),/Save failed/);
 assert.equal(request.mock.callCount(),0);assert.equal(workspace.snapshot().page.id,original.id);assert.equal(workspace.snapshot().page.title,'Unsaved draft');assert.equal(workspace.snapshot().saveStatus,'error');assert.equal(workspace.snapshot().loadingPageId,null);assert.equal(workspace.snapshot().busy,false);
});
test('opening a note flushes edits before the fetch and rejects edits to the outgoing page during loading',async t=>{
 const {workspace}=await fixture(t),write=deferred(),calls=[];
 workspace.updatePage({title:'Draft to save'});
 t.mock.method(api,'savePage',async(_vault,_id,input)=>{calls.push('save');await write.promise;return {...input,revision:2};});
 t.mock.method(api,'page',async(_vault,id)=>{calls.push('fetch');return page(id);});
 const navigation=workspace.openPage('two');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['save']);workspace.updatePage({title:'Stale outgoing edit'});assert.equal(workspace.snapshot().page.title,'Draft to save');
 write.resolve();await navigation;assert.deepEqual(calls,['save','fetch']);assert.equal(workspace.snapshot().page.id,'two');
});
test('fetch failure preserves the old note and selecting it again cancels an in-flight switch',async t=>{
 const {workspace}=await fixture(t),original=workspace.snapshot().page;
 t.mock.method(api,'page',async()=>{throw new Error('Offline');});await assert.rejects(workspace.openPage('two'),/Offline/);
 assert.equal(workspace.snapshot().page,original);assert.equal(workspace.snapshot().loadingPageId,null);
 const pending=deferred();let calls=0,signal;t.mock.method(api,'page',(_vault,_id,s)=>{calls++;signal=s;return pending.promise;});
 await workspace.openPage('one');assert.equal(calls,0);
 const navigation=workspace.openPage('two');await new Promise(resolve=>setImmediate(resolve));await workspace.openPage('one');assert.equal(signal.aborted,true);pending.resolve(page('two'));await navigation;
 assert.equal(workspace.snapshot().page,original);assert.equal(workspace.snapshot().loadingPageId,null);
});
test('vault changes invalidate pending page loads from the previous vault',async t=>{
 const {workspace}=await fixture(t),pending=deferred();t.mock.method(api,'page',()=>pending.promise);
 const navigation=workspace.openPage('two');await new Promise(resolve=>setImmediate(resolve));await workspace.selectVault('b');pending.resolve(page('two'));await navigation;
 assert.equal(workspace.snapshot().vault.id,'b');assert.equal(workspace.snapshot().page,null);assert.equal(workspace.snapshot().loadingPageId,null);assert.equal(workspace.snapshot().busy,false);
});
