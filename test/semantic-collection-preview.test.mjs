import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {useSemanticCollectionPreview} from '../src/client/organization/useSemanticCollectionPreview.ts';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(t) {
 const env=setupDOM(t),requests=[];let state;t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',(url,options)=>{const pending=deferred();requests.push({url,...options,...pending});return pending.promise;});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 function Probe(props){state=useSemanticCollectionPreview(props.vault,props.description,props.enabled,props.options);return React.createElement('pre',null,JSON.stringify(state));}
 let props={vault:'first',description:'Substantial discussion of algebra',enabled:true};
 const render=async patch=>{props={...props,...patch};await act(async()=>root.render(React.createElement(Probe,props)));};
 const evaluate=async()=>act(async()=>{void state.evaluate();});
 const respond=async(index,value,ok=true)=>act(async()=>requests[index].resolve({ok,status:ok?200:400,json:async()=>ok&&requests[index].url.endsWith('semantic-evaluate')?{evaluationToken:'token-'+index,preview:value}:value}));
 await render({});return {requests,render,evaluate,respond,state:()=>state,tick:ms=>act(async()=>t.mock.timers.tick(ms)),unmount:()=>act(async()=>root.unmount())};
}

test('semantic previews make no request on mount or description edits; Evaluate is explicit and blank/disabled actions do nothing',async t=>{
 const f=await fixture(t);for(let index=0;index<20;index++)await f.render({description:'Description '+index});assert.equal(f.requests.length,0);
 await f.evaluate();assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(f.requests[0].body),{semantic:{version:1,description:'Description 19',threshold:.55,minCoverage:.5}});assert.equal(f.requests[0].headers['X-Vault-Id'],'first');
 await f.respond(0,{items:[],unevaluated:12});assert.deepEqual(f.state().result,{items:[],unevaluated:12});
 await f.render({description:'   '});await f.evaluate();assert.equal(f.requests.length,1);await f.render({description:'Nonempty',enabled:false});await f.evaluate();assert.equal(f.requests.length,1);
});

test('description edits invalidate evaluated results and abort work without automatically purchasing another evaluation',async t=>{
 const f=await fixture(t);await f.evaluate();await f.respond(0,{items:[{id:'old'}]});
 await f.render({description:'Changed scope'});assert.equal(f.state().result,undefined);assert.equal(f.state().stale,true);assert.equal(f.requests.length,1);
 await f.evaluate();await f.render({description:'Changed again'});assert.equal(f.requests[1].signal.aborted,true);await f.respond(1,{items:[{id:'obsolete'}]});assert.equal(f.state().result,undefined);assert.equal(f.requests.length,2);
});

test('repeated Evaluate ignores reversed obsolete responses even when transport ignores cancellation',async t=>{
 const f=await fixture(t);await f.evaluate();await f.evaluate();assert.equal(f.requests[0].signal.aborted,true);
 await f.respond(1,{items:[{id:'new'}]});await f.respond(0,{items:[{id:'old'}]});assert.equal(f.state().result.items[0].id,'new');assert.equal(f.state().loading,false);
});

test('switching vaults clears results and never accepts a late response from the previous vault',async t=>{
 const f=await fixture(t);await f.evaluate();await f.render({vault:'second'});assert.equal(f.state().result,undefined);assert.equal(f.state().stale,false);assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests.length,1);
 await f.evaluate();await f.respond(1,{items:[{id:'second'}]});await f.respond(0,{items:[{id:'private-first'}]});assert.equal(f.state().result.items[0].id,'second');assert.doesNotMatch(document.body.textContent,/private-first/);
});

test('semantic failures are distinct from empty and unevaluated; explicit retry can recover without a draft edit',async t=>{
 const f=await fixture(t);await f.evaluate();await f.respond(0,{error:'Embeddings unavailable'},false);assert.equal(f.state().error,'Embeddings unavailable');assert.equal(f.state().result,undefined);
 await f.evaluate();assert.equal(f.state().error,undefined);await f.respond(1,{items:[],unevaluated:9});assert.equal(f.state().error,undefined);assert.equal(f.state().result.unevaluated,9);
});

test('saved descriptions and evaluated tokens refresh bounded previews without requesting another description embedding',async t=>{
 const f=await fixture(t);await f.render({options:{collectionId:'saved-collection',savedDescription:'Substantial discussion of algebra'}});assert.equal(f.state().canSave,true);
 await f.tick(400);assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/semantic-preview$/);assert.equal(JSON.parse(f.requests[0].body).collection_id,'saved-collection');await f.respond(0,{items:[],unevaluated:3});
 await f.tick(5000);assert.equal(f.requests.length,2);assert.match(f.requests[1].url,/semantic-preview$/);await f.respond(1,{items:[{id:'now-indexed'}],unevaluated:2});assert.equal(f.state().result.items[0].id,'now-indexed');
 await f.render({description:'New scope',options:{collectionId:'saved-collection',savedDescription:'Substantial discussion of algebra'}});assert.equal(f.state().canSave,false);await f.tick(6000);assert.equal(f.requests.length,2);
 await f.evaluate();assert.match(f.requests[2].url,/semantic-evaluate$/);await f.respond(2,{items:[],unevaluated:0});assert.equal(f.state().evaluationToken,'token-2');assert.equal(f.state().canSave,true);await f.tick(5000);assert.match(f.requests[3].url,/semantic-preview$/);assert.equal(JSON.parse(f.requests[3].body).evaluationToken,'token-2');
});
