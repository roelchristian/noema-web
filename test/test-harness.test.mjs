import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverTestFiles,selectTests} from '../scripts/test.mjs';
import {providerBarrier} from './helpers/provider-barrier.mjs';

test('test discovery includes nested suites and requires an exact, unique group partition',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'noema-discovery-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'nested'));
  for(const file of ['root.test.mjs','nested/child.test.mjs','nested/helper.mjs'])await writeFile(join(directory,file),'');
  const files=await discoverTestFiles(directory);
  assert.deepEqual(files,[join(directory,'nested/child.test.mjs'),join(directory,'root.test.mjs')]);
  const groups={unit:[files[0]],dom:[files[1]],server:[]};
  assert.deepEqual(selectTests(files,groups),files);
  assert.deepEqual(selectTests(files,groups,'dom'),[files[1]]);
  assert.throws(()=>selectTests(files,{unit:[files[0]]}),/Ungrouped/);
  assert.throws(()=>selectTests(files,{unit:[...files,'absent.test.mjs']}),/absent/);
  assert.throws(()=>selectTests(files,{unit:files,dom:[files[0]]}),/Duplicate/);
  assert.throws(()=>selectTests(files,groups,'typo'),/Unknown/);
});

test('provider barrier fails diagnostically when entry never occurs and releases late provider work',{timeout:2000},async()=>{
  const barrier=providerBarrier('never-entered negative control'),request=Promise.withResolvers(),fallback=new Response(null,{status:503}),controller=new AbortController();
  controller.signal.addEventListener('abort',()=>request.reject(new Error('synthetic request aborted')),{once:true});
  try {
    await assert.rejects(barrier.waitForEntry(request.promise,{timeoutMs:20}),/never-entered negative control: provider entry timed out after 20ms/);
  }finally{await barrier.close(request.promise,{value:fallback,controller});}
  assert.equal(controller.signal.aborted,true,'a never-entered HTTP request is aborted during cleanup');
  assert.equal(await barrier.enter(),fallback,'cleanup releases even a provider that enters after the wait failed');
});

test('provider cleanup drains released work without aborting it or masking the primary failure',{timeout:2000},async()=>{
  const barrier=providerBarrier('cleanup negative control'),controller=new AbortController(),fallback=new Response(null,{status:503}),failure=new Error('synthetic primary assertion failure');
  let settled=false;
  const request=barrier.enter().then(value=>{assert.equal(value,fallback);settled=true;throw new Error('synthetic cleanup response status');});
  await assert.rejects(async()=>{
    try {await barrier.waitForEntry(request);throw failure;}
    finally {await barrier.close(request,{value:fallback,controller});}
  },error=>error===failure);
  assert.equal(settled,true,'held provider work drained before cleanup returned');
  assert.equal(controller.signal.aborted,false,'entered work drains before considering client abort');
});

test('provider cleanup aborts an entered request that cannot drain and preserves the primary failure',{timeout:2000},async()=>{
  const barrier=providerBarrier('drain timeout negative control'),controller=new AbortController(),request=Promise.withResolvers(),fallback=new Response(null,{status:503}),failure=new Error('synthetic failure before drain');
  controller.signal.addEventListener('abort',()=>request.reject(new Error('synthetic stalled request aborted')),{once:true});
  const provider=barrier.enter();
  await assert.rejects(async()=>{
    try {await barrier.waitForEntry(request.promise);throw failure;}
    finally {await barrier.close(request.promise,{value:fallback,controller,timeoutMs:20});}
  },error=>error===failure);
  assert.equal(controller.signal.aborted,true,'entered-but-stalled request is aborted after bounded drain');
  assert.equal(await provider,fallback,'provider work is released even when its route cannot drain');
});

test('provider barrier preserves early request errors and diagnoses completion without entry',{timeout:2000},async()=>{
  const failure=new Error('synthetic request failure'),failed=providerBarrier('failed request');
  await assert.rejects(failed.waitForEntry(Promise.reject(failure)),error=>error===failure);
  const completed=providerBarrier('completed request');
  await assert.rejects(completed.waitForEntry(Promise.resolve()),/completed request: request completed before provider entry/);
});

test('provider entry and release independently order an in-flight request',{timeout:2000},async()=>{
  const barrier=providerBarrier('ordered request'),request=Promise.withResolvers();
  let completed=false;
  const result=barrier.enter().then(value=>{completed=true;return value;});
  await barrier.waitForEntry(request.promise);
  assert.equal(completed,false,'entry alone cannot release the provider response');
  barrier.release('stale response');assert.equal(await result,'stale response');
  request.resolve();barrier.release('ignored second release');
});

test('DOM ownership is registered before mount and restores globals even after render and cleanup failures',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  let registered,restored=false;
  const env=setupDOM({after:cleanup=>{registered=cleanup;}});
  assert.equal(registered,env.close);
  assert.equal(window.matchMedia('(max-width: 600px)').matches,false);
  env.defer(()=>{restored=true;});
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  env.defer(()=>{throw new Error('synthetic cleanup failure');});
  function Broken(){throw new Error('synthetic mount failure');}
  await assert.rejects(async()=>await act(async()=>root.render(React.createElement(Broken))),/synthetic mount failure/);
  await assert.rejects(registered(),error=>error instanceof AggregateError&&error.errors[0].message==='synthetic cleanup failure');
  assert.equal(restored,true,'cleanup continues after an earlier cleanup fails');
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'window'),previous);
  await env.close(); // Idempotent, including when registered teardown follows explicit close.
});
