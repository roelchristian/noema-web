import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {useCollectionRuleGeneration} from '../src/client/organization/useCollectionRuleGeneration.ts';
import {useExampleCollectionPreview} from '../src/client/organization/useExampleCollectionPreview.ts';

const suggested={rule:{version:1,root:{field:'title',operator:'contains',value:'algebra'}},warnings:['Recent means updated after a displayed date.'],requiresConfirmation:true};
async function fixture(t){
 const env=setupDOM(t),calls=[];let state;const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(globalThis,'fetch',(url,options)=>new Promise(resolve=>calls.push({url,...options,resolve})));
 let props={vault:'one',prompt:'Recent algebra notes',enabled:true};function Probe(){state=useCollectionRuleGeneration(props.vault,props.prompt,props.enabled);return React.createElement('pre',null,JSON.stringify(state));}
 const render=async patch=>{props={...props,...patch};await act(async()=>root.render(React.createElement(Probe)));};
 const generate=()=>act(async()=>{void state.generate();});const respond=(index,result=suggested,ok=true)=>act(async()=>calls[index].resolve({ok,status:ok?200:400,json:async()=>result}));
 await render({});return {calls,render,generate,respond,state:()=>state};
}

test('natural-language rules are generated explicitly as reviewable suggestions, never on prompt edits or saved automatically',async t=>{
 const f=await fixture(t);for(let index=0;index<10;index++)await f.render({prompt:'Recent notes '+index});assert.equal(f.calls.length,0);
 await f.generate();assert.equal(f.calls.length,1);assert.match(f.calls[0].url,/organization\/generate-rules$/);assert.deepEqual(JSON.parse(f.calls[0].body),{description:'Recent notes 9'});await f.respond(0);assert.deepEqual(f.state().result,suggested);assert.equal(f.calls.length,1);
 await f.render({enabled:false});assert.equal(f.state().result,undefined);await f.generate();assert.equal(f.calls.length,1);
});

test('changed prompts and vaults abort pending generation and cannot accept reversed obsolete suggestions',async t=>{
 const f=await fixture(t);await f.generate();await f.render({prompt:'New prompt'});assert.equal(f.calls[0].signal.aborted,true);await f.generate();await f.respond(1);await f.respond(0,{...suggested,warnings:['obsolete']});assert.deepEqual(f.state().result,suggested);
 await f.generate();await f.render({vault:'two'});assert.equal(f.calls[2].signal.aborted,true);assert.equal(f.state().result,undefined);await f.respond(2,{...suggested,warnings:['private-other-vault']});assert.equal(f.state().result,undefined);assert.doesNotMatch(document.body.textContent,/private-other-vault/);
});

test('generation failures remain errors and can be explicitly retried without treating them as an empty rule',async t=>{
 const f=await fixture(t);await f.generate();await f.respond(0,{error:'Generated unsupported rule'},false);assert.equal(f.state().error,'Generated unsupported rule');assert.equal(f.state().result,undefined);await f.generate();await f.respond(1);assert.deepEqual(f.state().result,suggested);assert.equal(f.state().error,undefined);
});

test('example evaluation is explicit for drafts, vault-safe, and saved polling waits for pending work',async t=>{
 const env=setupDOM(t),calls=[];t.mock.timers.enable({apis:['setTimeout']});let state;const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(globalThis,'fetch',(url,options)=>new Promise(resolve=>calls.push({url,...options,resolve})));
 const examples={version:1,positivePageIds:['first','second'],negativePageIds:[],threshold:.55,minCoverage:.5,negativeMargin:.05};let props={vault:'one',examples,enabled:true};
 function Probe(){state=useExampleCollectionPreview(props.vault,props.examples,props.enabled,props.saved);return React.createElement('pre',null,JSON.stringify(state));}
 const render=patch=>act(async()=>{props={...props,...patch};root.render(React.createElement(Probe));}),tick=ms=>act(async()=>t.mock.timers.tick(ms)),evaluate=()=>act(async()=>{void state.evaluate();}),respond=index=>act(async()=>calls[index].resolve({ok:true,json:async()=>({items:[{item_id:'synthetic'}]})}));
 await render({});await tick(6000);assert.equal(calls.length,0);await evaluate();assert.match(calls[0].url,/example-preview$/);assert.deepEqual(JSON.parse(calls[0].body),{examples});await respond(0);assert.equal(state.canSave,true);
 await render({vault:'two'});assert.equal(state.canSave,false);assert.equal(state.result,undefined);await tick(6000);assert.equal(calls.length,1);
 await render({saved:examples});await tick(400);assert.equal(calls.length,2);await tick(2000);assert.equal(calls.length,2,'slow saved previews must not restart while pending');await respond(1);assert.equal(state.canSave,true);await tick(5000);assert.equal(calls.length,3);
 await render({vault:'third'});await respond(2);assert.equal(state.result,undefined);assert.equal(calls[2].signal.aborted,true);
});
