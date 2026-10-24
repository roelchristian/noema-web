import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {NotificationProvider} from '../src/client/notifications/NotificationProvider.tsx';
import {WorkspaceNotificationBridge} from '../src/client/notifications/WorkspaceNotificationBridge.tsx';
import {InlineNotice} from '../src/client/notifications/InlineNotice.tsx';
import {setupDOM} from './helpers/dom.mjs';

function barrier(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fakeWorkspace(){
 let state={vault:{id:'a',locked:false},busy:false,error:null,errorOccurrence:0,archiveUndo:[],archiveUndoOccurrence:0,saveFailures:[]};
 const listeners=new Set();
 const workspace={
  subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},snapshot:()=>state,
  patch:patch=>{state={...state,...patch};for(const listener of listeners)listener();},
  dismissError:()=>workspace.patch({error:null}),
  dismissArchiveUndo:operation=>{if(operation===state.archiveUndoOccurrence)workspace.patch({archiveUndo:[]});},
  restoreArchivedPages:async()=>{workspace.patch({archiveUndo:[]});},
 };
 return workspace;
}
async function fixture(t,initial={}){
 const env=setupDOM(t),workspace=fakeWorkspace(),root=createRoot(document.querySelector('#mount'));
 workspace.patch(initial);t.mock.timers.enable({apis:['setTimeout','Date']});
 env.defer(()=>act(async()=>root.unmount()));
 function Harness(){
  const state=useSyncExternalStore(workspace.subscribe,workspace.snapshot);
  return createElement(NotificationProvider,{activeVaultId:state.vault.locked?null:state.vault.id},
   createElement('input',{id:'synthetic-editor'}),
   !state.vault.locked&&state.saveFailures.map(issue=>createElement(InlineNotice,{key:issue.pageId,id:'save-'+issue.pageId,tone:'error',title:issue.message,announcement:'assertive'})),
   createElement(WorkspaceNotificationBridge,{workspace}));
 }
 await act(async()=>root.render(createElement(Harness)));
 return {workspace,tick:ms=>act(async()=>t.mock.timers.tick(ms)),patch:patch=>act(async()=>workspace.patch(patch))};
}
const archive={archiveUndo:[{id:'synthetic-page',revision:2}],archiveUndoOccurrence:1};
const undo=()=>[...document.querySelectorAll('.toast-item button')].find(button=>button.textContent==='Undo');

test('authoritative save failure coexists with unrelated archive acknowledgement and survives expiry',async t=>{
 const env=await fixture(t,{...archive,saveFailures:[{pageId:'draft',message:'Synthetic unfinished save failure'}]});
 assert.match(document.querySelector('#save-draft').textContent,/unfinished save failure/);
 assert.match(document.querySelector('.toast-item').textContent,/Page archived/);
 assert.equal(document.querySelectorAll('.toast-item').length,1,'Save failure has no duplicate global error');
 await env.tick(6000);
 assert.equal(document.querySelector('.toast-item'),null);
 assert.ok(document.querySelector('#save-draft'));
 assert.equal(env.workspace.snapshot().saveFailures.length,1);
});

test('same workspace error occurrence is not replayed but a repeated equal failure creates an independent event',async t=>{
 const env=await fixture(t,{error:'Synthetic equal failure',errorOccurrence:1});
 const original=document.querySelector('.toast-item').dataset.notificationId;
 await env.patch({busy:true});await env.patch({busy:false});
 assert.equal(document.querySelectorAll('.toast-item').length,1);
 assert.equal(document.querySelector('.toast-item').dataset.notificationId,original);
 await env.patch({error:'Synthetic equal failure',errorOccurrence:2});
 assert.equal(document.querySelectorAll('.toast-item').length,2);
 assert.notEqual(document.querySelectorAll('.toast-item')[1].dataset.notificationId,original);
});

test('archive waits until workspace is ready and a busy Undo keeps the operation actionable',async t=>{
 const env=await fixture(t,{...archive,busy:true});let restores=0;
 env.workspace.restoreArchivedPages=async()=>{restores++;env.workspace.patch({archiveUndo:[]});};
 assert.equal(document.querySelector('.toast-item'),null);
 await env.patch({busy:false});assert.ok(undo());
 await env.patch({busy:true});await act(async()=>undo().click());
 assert.equal(restores,0);
 assert.equal(env.workspace.snapshot().archiveUndo.length,1);
 assert.match(document.querySelector('.notice-action-error').textContent,/current operation/);
 assert.equal(undo().disabled,false);
 await env.tick(60000);assert.ok(undo(),'Failed action disables automatic expiry');
 await env.patch({busy:false});await act(async()=>undo().click());
 assert.equal(restores,1);assert.equal(document.querySelector('.toast-item'),null);
});

test('failed asynchronous Undo stays available for retry and binds the current vault operation',async t=>{
 const env=await fixture(t,archive),pending=barrier(),calls=[];let fail=true;
 env.workspace.restoreArchivedPages=async(items,expected)=>{calls.push({items,expected});if(fail){fail=false;await pending.promise;}env.workspace.patch({archiveUndo:[]});};
 document.querySelector('#synthetic-editor').focus();
 await act(async()=>undo().click());
 assert.equal(undo().disabled,true);
 assert.equal(document.querySelector('.toast-item').getAttribute('aria-busy'),'true');
 await act(async()=>pending.reject(new Error('Synthetic restore failed; retry')));
 assert.equal(undo().disabled,false);
 assert.equal(env.workspace.snapshot().archiveUndo.length,1);
 assert.match(document.querySelector('.notice-action-error').textContent,/restore failed/);
 await env.tick(60000);assert.ok(undo());
 await act(async()=>undo().click());
 assert.equal(calls.length,2);
 assert.deepEqual(calls[1],{items:archive.archiveUndo,expected:{vaultId:'a',operation:1}});
 assert.equal(document.querySelector('.toast-item'),null);
 assert.equal(document.activeElement.id,'synthetic-editor');
});

test('vault locking clears scoped error and archive text including announcement regions',async t=>{
 const env=await fixture(t,{...archive,error:'Protected synthetic vault error',errorOccurrence:1});
 assert.match(document.body.textContent,/Protected synthetic vault error/);assert.ok(undo());
 await env.patch({vault:{id:'a',locked:true}});
 assert.equal(document.querySelectorAll('.toast-item').length,0);
 assert.doesNotMatch(document.body.textContent,/Protected synthetic vault error|Page archived/);
});
