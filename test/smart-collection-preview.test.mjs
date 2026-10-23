import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {useSmartCollectionPreview} from '../src/client/organization/useSmartCollectionPreview.ts';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(t) {
  const env=setupDOM(t),requests=[];let state;
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',(url,options)=>{const pending=deferred();requests.push({url,...options,...pending});return pending.promise;});
  const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  function Probe(props) {state=useSmartCollectionPreview(props.vault,props.definition,props.enabled);return React.createElement('pre',null,JSON.stringify(state));}
  let props={vault:'first',definition:{version:1,rule:{field:'title',value:'first'}},enabled:true};
  const render=async patch=>{props={...props,...patch};await act(async()=>root.render(React.createElement(Probe,props)));};
  const tick=async(ms=400)=>act(async()=>t.mock.timers.tick(ms));
  const respond=async(index,value,ok=true)=>act(async()=>requests[index].resolve({ok,status:ok?200:400,json:async()=>value}));
  await render({});return {requests,render,tick,respond,state:()=>state};
}

test('preview waits for a settled draft and coalesces rapid edits without whole-vault requests',async t=>{
  const f=await fixture(t);assert.equal(f.state().loading,true);
  await f.tick(399);assert.equal(f.requests.length,0);
  for(let index=0;index<20;index++)await f.render({definition:{version:1,rule:{field:'title',value:String(index)}}});
  await f.tick(399);assert.equal(f.requests.length,0);await f.tick(1);assert.equal(f.requests.length,1);
  assert.equal(JSON.parse(f.requests[0].body).rule.rule.value,'19');assert.equal(f.requests[0].headers['X-Vault-Id'],'first');
  await f.respond(0,{matches:[{id:'current'}]});assert.equal(f.state().result.matches[0].id,'current');assert.equal(f.state().loading,false);
});

test('obsolete preview responses cannot overwrite a newer draft even when abort is ignored',async t=>{
  const f=await fixture(t);await f.tick();
  await f.render({definition:{version:1,rule:{field:'title',value:'newer'}}});assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.state().result,undefined);
  await f.tick();await f.respond(1,{matches:[{id:'newer'}]});await f.respond(0,{matches:[{id:'obsolete'}]});
  assert.equal(f.state().result.matches[0].id,'newer');
});

test('vault switches clear prior results, abort pending work, and do not disclose late foreign responses',async t=>{
  const f=await fixture(t);await f.tick();await f.respond(0,{matches:[{id:'first-vault'}]});
  await f.render({definition:{version:1,rule:{field:'title',value:'pending'}}});await f.tick();
  await f.render({vault:'second'});assert.equal(f.state().result,undefined);assert.equal(f.requests[1].signal.aborted,true);
  await f.tick();await f.respond(2,{matches:[{id:'second-vault'}]});await f.respond(1,{matches:[{id:'private-first-vault'}]});
  assert.equal(f.state().result.matches[0].id,'second-vault');assert.doesNotMatch(document.body.textContent,/private-first-vault/);
  await f.render({enabled:false});assert.equal(f.state().result,undefined);assert.equal(f.state().loading,false);
});

test('failed previews expose an error rather than a fabricated empty result, and retry with a changed draft',async t=>{
  const f=await fixture(t);await f.tick();await f.respond(0,{error:'Invalid rule'},false);
  assert.equal(f.state().error,'Invalid rule');assert.equal(f.state().result,undefined);assert.equal(f.state().loading,false);
  await f.render({definition:{version:1,rule:{field:'title',value:'valid'}}});assert.equal(f.state().error,undefined);await f.tick();await f.respond(1,{matches:[]});
  assert.deepEqual(f.state().result,{matches:[]});assert.equal(f.state().error,undefined);
});
