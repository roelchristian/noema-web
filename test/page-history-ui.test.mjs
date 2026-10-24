import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historySessions,compareHistoryBlocks} from '../src/client/editor/page-history-model.ts';
import {Workspace} from '../src/client/state/workspace.ts';
import {api} from '../src/client/api.ts';
const version=(id,time,extra={})=>({id,kind:'edit',name:null,pinned:false,createdAt:`2026-10-23T${time}:00Z`,...extra});
test('timeline groups ordinary edits while keeping checkpoints and restoration separate',()=>{
  const input=[version('5','12:15'),version('4','12:10'),version('3','12:09',{kind:'checkpoint',name:'Draft',pinned:true}),version('2','12:08',{kind:'restore'}),version('1','12:07')];
  assert.deepEqual(historySessions(input).map(session=>session.versions.map(item=>item.id)),[['5','4'],['3'],['2'],['1']]);
  assert.equal(input.length,5);
});
const block=(id,text)=>({id,type:'paragraph',checked:false,content:[{text}]});
test('history compares stable block IDs without treating reordered blocks as text edits',()=>{
  assert.deepEqual(compareHistoryBlocks([block('a','old'),block('b','kept'),block('c','removed')],[block('b','kept'),block('a','new'),block('d','added')]).map(item=>[item.id,item.kind]),[['a','modified'],['c','removed'],['d','added']]);
});
async function setup(t) {
  const page={id:'p',vault_id:'v',title:'Note',blocks:[block('b','Old')],sourceIds:[],revision:1,updated_at:''};
  t.mock.method(api,'vaults',async()=>[{id:'v',name:'Vault',locked:false}]);
  t.mock.method(api,'archivedPages',async()=>[]);t.mock.method(api,'pages',async()=>[page]);t.mock.method(api,'entities',async()=>[]);
  t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
  t.mock.method(api,'page',async()=>page);
  t.mock.method(api,'pageMetadata',async()=>({}));
  const workspace=new Workspace();await workspace.selectVault('v');await workspace.openPage('p');
  t.after(()=>{workspace.saver.dispose();workspace.titler.dispose();});
  return {workspace,page};
}
test('restore flushes pending save, checks latest revision, then replaces authoritative state',async t=>{
  const {workspace,page}=await setup(t);const events=[];let persisted=page;
  t.mock.method(api,'savePage',async(_v,_id,draft)=>{events.push('save');return persisted={...draft,revision:2};});
  t.mock.method(api,'page',async()=>{events.push('latest');return persisted;});
  t.mock.method(api,'restorePageVersion',async(_v,_id,version,revision)=>{events.push('restore');assert.equal(version,'historical');assert.equal(revision,2);return {...page,revision:3,title:'Restored'};});
  workspace.updatePage({blocks:[block('b','Pending edit')]});
  await workspace.changePageHistory('restore','historical');
  assert.deepEqual(events,['save','latest','restore']);assert.equal(workspace.snapshot().page.title,'Restored');
  assert.equal(workspace.snapshot().page.revision,3);assert.equal(workspace.saver.pendingPage('v','p'),undefined);
});
test('failed pending save and stale revision cannot reach restore mutation',async t=>{
  const {workspace,page}=await setup(t);
  t.mock.method(api,'restorePageVersion',async()=>assert.fail('restore must not run'));
  t.mock.method(api,'savePage',async()=>{throw new Error('disk failure');});
  workspace.updatePage({title:'Pending'});
  await assert.rejects(workspace.changePageHistory('restore','historical'),/disk failure/);
  assert.equal(workspace.saver.pendingPage('v','p').title,'Pending');
  workspace.saver.discard('v','p');
  t.mock.method(api,'page',async()=>({...page,revision:9}));
  await assert.rejects(workspace.changePageHistory('restore','historical'),/changed elsewhere/);
});
test('navigation during latest-page check aborts restore before mutation',async t=>{
  const {workspace,page}=await setup(t);let finish;
  t.mock.method(api,'page',()=>new Promise(resolve=>{finish=resolve;}));
  t.mock.method(api,'restorePageVersion',async()=>assert.fail('restore must not run'));
  const pending=workspace.changePageHistory('restore','historical');
  for(let i=0;i<10&&!finish;i++)await Promise.resolve();
  workspace.showEntities();finish(page);
  await assert.rejects(pending,/page changed/);assert.equal(workspace.snapshot().view,'entities');
});
test('navigation after restore starts reconciles the target cache without replacing the new view',async t=>{
  const {workspace,page}=await setup(t);let finish;
  t.mock.method(api,'restorePageVersion',()=>new Promise(resolve=>{finish=resolve;}));
  const pending=workspace.changePageHistory('restore','historical');
  for(let i=0;i<15&&!finish;i++)await Promise.resolve();
  assert.ok(finish);workspace.showEntities();
  finish({...page,revision:2,title:'Restored after navigation'});await pending;
  assert.equal(workspace.snapshot().view,'entities');
  // Cached state is immediately authoritative, including when fresh revalidation is delayed.
  t.mock.method(api,'page',()=>new Promise(()=>{}));
  await workspace.openPage('p');
  assert.equal(workspace.snapshot().page.title,'Restored after navigation');
  assert.equal(workspace.snapshot().page.revision,2);assert.equal(workspace.saver.pendingPage('v','p'),undefined);
});
