import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationStore} from '../src/client/notifications/notification-store.ts';
import {MAX_TOASTS} from '../src/client/notifications/notification-reducer.ts';
function fixture(){let now=0,id=0;const tasks=new Map();const clock={now:()=>now,setTimeout:(fn,ms)=>{const key=++id;tasks.set(key,{at:now+ms,fn});return key;},clearTimeout:key=>tasks.delete(key)};const store=createNotificationStore(clock);return {store,tasks,tick(ms){const end=now+ms;while(true){const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;}};}
const input=(message='Saved',extra={})=>({tone:'success',message,scope:{kind:'global'},...extra});
test('occurrences, dedupe identity, stable slots and two visible deadlines',()=>{const {store,tick}=fixture();const a=store.commands.notify(input()),b=store.commands.notify(input()),c=store.commands.notify(input());assert.notEqual(a,b);assert.equal(store.getSnapshot().length,3);tick(4000);assert.deepEqual(store.getSnapshot().map(r=>r.occurrenceId),[c]);tick(3999);assert.equal(store.getSnapshot().length,1);tick(1);assert.equal(store.getSnapshot().length,0);const d=store.commands.notify(input('same',{dedupeKey:'copy'}));tick(1000);const e=store.commands.notify(input('same',{dedupeKey:'copy'}));assert.notEqual(d,e);store.commands.update(d,{message:'stale'});assert.equal(store.getSnapshot()[0].message,'same');tick(3000);assert.equal(store.getSnapshot().length,1);tick(1000);assert.equal(store.getSnapshot().length,0);});
test('remaining visible time pauses independently for hover focus and hidden',()=>{const {store,tick,tasks}=fixture();const id=store.commands.notify(input());tick(1000);store.pause(id,'hover',true);tick(5000);store.pause(id,'focus',true);store.pause(id,'hover',false);tick(5000);store.pause(id,'hidden',true);store.pause(id,'focus',false);tick(5000);store.pause(id,'hidden',false);tick(2999);assert.equal(store.getSnapshot().length,1);tick(1);assert.equal(store.getSnapshot().length,0);assert.equal(tasks.size,0);});
test('important errors survive later successes and bounded pressure',()=>{const {store}=fixture();const error=store.commands.notify(input('Failed',{tone:'error',priority:'important'}));for(let i=0;i<100;i++)store.commands.notify(input(String(i)));assert.equal(store.getSnapshot().length,MAX_TOASTS);assert.equal(store.getSnapshot()[0].occurrenceId,error);const important=store.commands.notify(input('Next failure',{tone:'error',priority:'important'}));assert.ok(store.getSnapshot().some(r=>r.occurrenceId===important));});
test('unrelated patches do not renew deadline; disposal cancels pending timers',()=>{const {store,tick,tasks}=fixture();const id=store.commands.notify(input());tick(3500);store.commands.update(id,{description:'Details'});tick(499);assert.equal(store.getSnapshot().length,1);tick(1);assert.equal(store.getSnapshot().length,0);store.commands.notify(input());store.destroy();assert.equal(tasks.size,0);});
test('async action barrier prevents double activation, failure retained and retry succeeds',async()=>{const {store,tick}=fixture();let reject,resolve,calls=0;const action=()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});};const id=store.commands.notify(input('Undo',{actions:[{label:'Undo',run:action}]}));const first=store.runAction(id,0);void store.runAction(id,0);assert.equal(calls,1);assert.equal(store.getSnapshot()[0].pendingAction,true);tick(9000);reject(new Error('Retry this operation'));await first;assert.equal(store.getSnapshot()[0].actionError,'Retry this operation');assert.equal(store.getSnapshot()[0].pendingAction,false);tick(9000);assert.equal(store.getSnapshot().length,1);const retry=store.runAction(id,0);resolve();await retry;assert.equal(store.getSnapshot().length,0);});
test('vault transition invalidates records, callbacks and delayed completion',async()=>{const {store,tasks}=fixture();store.commands.setActiveVault('a');let resolve,dismissed=0;const id=store.commands.notify(input('Private',{scope:{kind:'vault',vaultId:'a'},onDismiss:()=>dismissed++,actions:[{label:'Undo',run:()=>new Promise(yes=>resolve=yes)}]}));const pending=store.runAction(id,0);store.commands.setActiveVault('b');resolve();await pending;assert.equal(store.getSnapshot().length,0);assert.equal(dismissed,0);assert.equal(tasks.size,0);store.commands.notify(input('Stale',{scope:{kind:'vault',vaultId:'a'}}));assert.equal(store.getSnapshot().length,0);});

test('an important event takes the next queued slot under full queue pressure',()=>{
 const {store}=fixture();
 store.commands.notify(input('Visible persistent',{durationMs:null}));
 store.commands.notify(input('Visible routine'));
 for(let i=2;i<MAX_TOASTS;i++)store.commands.notify(input(`Queued ${i}`));
 const important=store.commands.notify(input('Important failure',{tone:'error',priority:'important'}));
 assert.equal(store.getSnapshot().length,MAX_TOASTS);
 assert.equal(store.getSnapshot()[2].occurrenceId,important);
});

test('a replaced occurrence ignores stale action failure and stale updates',async()=>{
 const {store,tick,tasks}=fixture();let reject;
 const old=store.commands.notify(input('Old undo',{dedupeKey:'archive',actions:[{label:'Undo',run:()=>new Promise((_,no)=>reject=no)}]}));
 const pending=store.runAction(old,0);
 const current=store.commands.notify(input('New undo',{dedupeKey:'archive'}));
 reject(new Error('Failure from replaced action'));await pending;
 store.commands.update(old,{message:'Stale update'});
 assert.deepEqual(store.getSnapshot().map(record=>record.occurrenceId),[current]);
 assert.equal(store.getSnapshot()[0].message,'New undo');
 assert.equal(store.getSnapshot()[0].actionError,undefined);
 tick(4000);assert.equal(store.getSnapshot().length,0);assert.equal(tasks.size,0);
});

test('updating a pending action cannot permit a second activation or lose its failure',async()=>{
 const {store}=fixture();let reject,calls=0;
 const id=store.commands.notify(input('Undo',{actions:[{label:'Undo',run:()=>{calls++;return new Promise((_,no)=>reject=no);}}]}));
 const pending=store.runAction(id,0);
 store.commands.update(id,{description:'Still restoring'});
 await store.runAction(id,0);assert.equal(calls,1);
 reject(new Error('Restoration failed'));await pending;
 assert.equal(store.getSnapshot()[0].pendingAction,false);
 assert.equal(store.getSnapshot()[0].actionError,'Restoration failed');
});
