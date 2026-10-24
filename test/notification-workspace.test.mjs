import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/client/api.ts';
import {Workspace} from '../src/client/state/workspace.ts';

function barrier() {
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

async function fixture(t) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size;}}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  const vaults=[{id:'a',name:'Synthetic A',locked:false},{id:'b',name:'Synthetic B',locked:false}];
  const pages=new Map(['one','two'].map(id=>[id,{id,vault_id:'a',title:`Synthetic ${id}`,blocks:[],sourceIds:[],revision:1,updated_at:'2026-10-24'}]));
  const organization={collections:[],folders:[],locations:[],memberships:[],favourites:[]},calls=[];
  t.mock.method(api,'vaults',async()=>vaults);
  t.mock.method(api,'pages',async vault=>vault==='a'?[...pages.values()].filter(page=>!page.archived_at):[]);
  t.mock.method(api,'archivedPages',async vault=>vault==='a'?[...pages.values()].filter(page=>page.archived_at).map(page=>({...page,folderId:null,folderName:null,collectionIds:[],subjectIds:[]})):[]);
  t.mock.method(api,'page',async(_vault,id)=>structuredClone(pages.get(id)));
  t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>organization);
  t.mock.method(api,'lock',async id=>({...vaults.find(vault=>vault.id===id),locked:true}));
  t.mock.method(api,'archivePage',async(vault,id,revision,archived=true)=>{
    calls.push({vault,id,revision,archived});
    const original=pages.get(id);assert.equal(revision,original.revision);
    const page={...original,revision:revision+1,archived_at:archived?'2026-10-24':null};pages.set(id,page);return page;
  });
  const workspace=new Workspace();
  t.after(()=>{workspace.saver.dispose();workspace.titler.dispose();});
  await workspace.selectVault('a');
  return {workspace,pages,calls};
}

test('equal general failures remain separate notification occurrences',async t=>{
  const {workspace}=await fixture(t);
  workspace.report(new Error('Synthetic failure'));
  const first=workspace.snapshot().errorOccurrence;
  workspace.report(new Error('Synthetic failure'));
  assert.equal(workspace.snapshot().error,'Synthetic failure');
  assert.equal(workspace.snapshot().errorOccurrence,first+1);
});

test('save failure remains authoritative without a duplicate application error',async t=>{
  const {workspace}=await fixture(t);
  t.mock.method(api,'savePage',async()=>{throw new Error('Synthetic save failure');});
  await workspace.openPage('one');workspace.updatePage({title:'Unfinished synthetic work'});
  await assert.rejects(workspace.saver.flush(),/Synthetic save failure/);
  assert.equal(workspace.snapshot().error,null);
  assert.equal(workspace.snapshot().saveFailures.length,1);
  workspace.dismissError();
  assert.equal(workspace.snapshot().saveFailures[0].pageId,'one');
});

test('an older archive dismissal cannot discard the newer Undo operation',async t=>{
  const {workspace}=await fixture(t);
  await workspace.archivePages(['one']);const older=workspace.snapshot().archiveUndoOccurrence;
  await workspace.archivePages(['two']);const current=workspace.snapshot().archiveUndoOccurrence;
  assert.ok(current>older);
  workspace.dismissArchiveUndo(older);
  assert.deepEqual(workspace.snapshot().archiveUndo.map(item=>item.id),['two']);
  workspace.dismissArchiveUndo(current);assert.deepEqual(workspace.snapshot().archiveUndo,[]);
});

test('failed Undo retains the original operation for retry',async t=>{
  const {workspace}=await fixture(t);
  await workspace.archivePages(['one']);
  const items=workspace.snapshot().archiveUndo,operation=workspace.snapshot().archiveUndoOccurrence;
  const original=api.archivePage;
  t.mock.method(api,'archivePage',async()=>{throw new Error('Synthetic restore failure');});
  await assert.rejects(workspace.restoreArchivedPages(items,{vaultId:'a',operation}),/Synthetic restore failure/);
  assert.deepEqual(workspace.snapshot().archiveUndo,items);
  assert.equal(workspace.snapshot().archiveUndoOccurrence,operation);
  t.mock.method(api,'archivePage',original);
  await workspace.restoreArchivedPages(items,{vaultId:'a',operation});
  assert.deepEqual(workspace.snapshot().archiveUndo,[]);
});

test('stale Undo callback cannot restore in a different vault or supersede a newer archive',async t=>{
  const {workspace,calls}=await fixture(t);
  await workspace.archivePages(['one']);const items=workspace.snapshot().archiveUndo,operation=workspace.snapshot().archiveUndoOccurrence;
  await workspace.archivePages(['two']);
  await workspace.restoreArchivedPages(items,{vaultId:'a',operation});
  assert.equal(calls.filter(call=>!call.archived).length,0);
  await workspace.selectVault('b');
  await workspace.restoreArchivedPages(items,{vaultId:'a',operation});
  assert.equal(calls.filter(call=>!call.archived).length,0);
  assert.equal(workspace.snapshot().vault.id,'b');
});

test('retry after partial Undo uses only remaining authoritative revisions',async t=>{
  const {workspace,calls}=await fixture(t);
  await workspace.archivePages(['one','two']);
  const items=workspace.snapshot().archiveUndo,operation=workspace.snapshot().archiveUndoOccurrence;
  const restore=api.archivePage;let fail=true;
  t.mock.method(api,'archivePage',async(...args)=>{if(args[1]==='two'&&fail){fail=false;throw new Error('Synthetic second restore failure');}return restore(...args);});
  await assert.rejects(workspace.restoreArchivedPages(items,{vaultId:'a',operation}),/Synthetic second restore failure/);
  assert.deepEqual(workspace.snapshot().archiveUndo.map(item=>item.id),['two']);
  await workspace.restoreArchivedPages(items,{vaultId:'a',operation});
  assert.deepEqual(calls.filter(call=>!call.archived).map(call=>call.id),['one','two']);
  assert.deepEqual(workspace.snapshot().archiveUndo,[]);
});

test('locking during an in-flight Undo invalidates its late state patch',async t=>{
  const {workspace,pages}=await fixture(t);
  await workspace.archivePages(['one']);const items=workspace.snapshot().archiveUndo,operation=workspace.snapshot().archiveUndoOccurrence;
  const entered=barrier(),released=barrier();
  t.mock.method(api,'archivePage',async()=>{entered.resolve();await released.promise;return {...pages.get('one'),archived_at:null,revision:3};});
  const restoring=workspace.restoreArchivedPages(items,{vaultId:'a',operation});
  await entered.promise;await workspace.lock();released.resolve();await restoring;
  assert.equal(workspace.snapshot().vault.locked,true);
  assert.deepEqual(workspace.snapshot().pages,[]);
  assert.equal(workspace.snapshot().page,null);
});
