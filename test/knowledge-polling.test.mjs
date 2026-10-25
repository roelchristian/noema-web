import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pollKnowledge} from '../src/client/intelligence/knowledge-polling.ts';

const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(overrides={}) {
  const timers=new Map();let id=0,statusCalls=0,refreshes=0,visible=true;
  let status={version:'one',pending:true,pendingFields:['summary']};const observed=[];
  const poll=pollKnowledge({
    status:async()=>{statusCalls++;return status;},refresh:async()=>{refreshes++;},onStatus:value=>observed.push(value),visible:()=>visible,
    schedule:(callback,delay)=>{const token=++id;timers.set(token,{callback,delay});return token;},unschedule:token=>timers.delete(token),...overrides,
  });
  return {poll,timers,observed,set status(value){status=value;},set visible(value){visible=value;},get counts(){return {statusCalls,refreshes};},tick(delay){const entry=[...timers.entries()].find(([,timer])=>timer.delay===delay);assert.ok(entry,'timer '+delay);timers.delete(entry[0]);entry[1].callback();}};
}
test('Knowledge polls compact status quickly while pending and slowly after completion/failure/cancellation',async()=>{
  const f=fixture();await flush();assert.deepEqual(f.counts,{statusCalls:1,refreshes:1});
  f.tick(2_000);await flush();assert.deepEqual(f.counts,{statusCalls:2,refreshes:1},'unchanged version skips the public payload');
  f.status={version:'completed',pending:false,pendingFields:[]};f.tick(2_000);await flush();assert.equal(f.counts.refreshes,2);assert.equal(f.observed.at(-1).pending,false);
  for(const version of ['failed','cancelled']){f.status={version,pending:false,pendingFields:[]};f.tick(60_000);await flush();assert.equal(f.observed.at(-1).version,version);assert.equal([...f.timers.values()][0].delay,60_000);}
  f.visible=false;f.poll.wake();await flush();const calls=f.counts.statusCalls;assert.equal(f.timers.size,0);f.visible=true;f.poll.wake();await flush();assert.equal(f.counts.statusCalls,calls+1);
  f.poll.stop();assert.equal(f.timers.size,0);
});
test('Knowledge coalesces wakeups, retries failed payloads, and aborts page-switch requests without applying stale status',async()=>{
  let finish,statusCalls=0,refreshes=0,signal;
  const f=fixture({status:current=>{signal=current;statusCalls++;return new Promise(resolve=>{finish=resolve;});},refresh:async()=>{refreshes++;if(refreshes===1)throw new Error('offline');}});
  f.poll.wake();f.poll.wake();assert.equal(statusCalls,1);
  finish({version:'one',pending:false,pendingFields:[]});await flush();assert.equal(f.observed.length,0);f.tick(0);assert.equal(statusCalls,2);
  finish({version:'one',pending:false,pendingFields:[]});await flush();assert.equal(refreshes,2,'failed payload does not consume the version');assert.equal(f.observed.length,1);
  f.poll.wake();assert.equal(statusCalls,3);f.poll.stop();assert.equal(signal.aborted,true);
  finish({version:'old-page',pending:true,pendingFields:['summary']});await flush();assert.equal(f.observed.length,1);assert.equal(f.timers.size,0);
});
