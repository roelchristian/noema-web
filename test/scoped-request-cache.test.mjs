import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedRequest,resetSharedRequests} from '../src/client/state/scoped-request-cache.ts';

test('shared live requests isolate vault, version and access; independent cancellation cannot cancel another reader',async t=>{
 resetSharedRequests();t.after(resetSharedRequests);
 const calls=[];
 t.mock.method(globalThis,'fetch',(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})));
 const a=new AbortController(),b=new AbortController();
 const first=sharedRequest('a','source-files/file','v1',a.signal),second=sharedRequest('a','source-files/file','v1',b.signal);
 const cancelled=assert.rejects(first,{name:'AbortError'});
 assert.equal(calls.length,1);a.abort();await cancelled;assert.equal(calls[0].options.signal.aborted,false);
 calls[0].resolve(Response.json({id:'same-object'}));const value=await second;assert.equal(value.id,'same-object');
 const third=sharedRequest('a','source-files/file','v1'),foreign=sharedRequest('b','source-files/file','v1'),changed=sharedRequest('a','source-files/file','v2');
 assert.equal(calls.length,4,'completed values are not cached across a new access check');
 const rejected=Promise.all([third,foreign,changed].map(promise=>assert.rejects(promise,{name:'AbortError'})));
 resetSharedRequests();for(const call of calls.slice(1)){assert.equal(call.options.signal.aborted,true);call.resolve(Response.json({stale:true}));}await rejected;
 const current=sharedRequest('a','source-files/file','v1');assert.equal(calls.length,5);calls[4].resolve(Response.json({fresh:true}));assert.deepEqual(await current,{fresh:true});
});

test('all subscribers cancelling aborts transport and cannot poison a repeated request',async t=>{
 resetSharedRequests();t.after(resetSharedRequests);const calls=[];
 t.mock.method(globalThis,'fetch',(url,options)=>new Promise(resolve=>calls.push({options,resolve})));
 const controller=new AbortController(),pending=sharedRequest('v','entities/e','version',controller.signal),rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort();await rejected;assert.equal(calls[0].options.signal.aborted,true);
 const repeat=sharedRequest('v','entities/e','version');assert.equal(calls.length,2);
 calls[0].resolve(Response.json({old:true}));calls[1].resolve(Response.json({current:true}));assert.deepEqual(await repeat,{current:true});
});
