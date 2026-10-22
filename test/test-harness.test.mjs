import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverTestFiles,selectTests} from '../scripts/test.mjs';

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
