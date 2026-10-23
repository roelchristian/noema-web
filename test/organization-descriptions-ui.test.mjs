import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import {collectionDefinitionUnchanged} from '../src/client/organization/collection-draft.ts';

test('human description saves bypass unavailable matching previews and send no matching configuration or provider action',async t=>{
 const env=setupDOM(t),{createRoot}=await import('react-dom/client'),{CollectionDialog}=await import('../src/client/organization/CollectionDialog.tsx'),root=createRoot(document.querySelector('#mount')),requests=[],saves=[];env.defer(()=>act(async()=>root.unmount()));t.mock.timers.enable({apis:['setTimeout']});
 env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'domains',async()=>({domains:[]}));t.mock.method(api,'entities',async()=>[]);t.mock.method(api,'organize',async(vault,route,body)=>{saves.push({vault,route,body});return {collections:[],folders:[],memberships:[],locations:[],favourites:[]};});
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,...options});return {ok:false,status:409,json:async()=>({error:'Saved matching inputs are unavailable'})};});
 for(const matching of ['semantic','examples']){
  const collection={id:matching,name:'Existing collection',description:'Old purpose',kind:'smart',matching,...(matching==='semantic'?{semantic:{version:1,description:'Matching scope',threshold:.55,minCoverage:.5}}:{examples:{version:1,positivePageIds:['missing-a','missing-b'],negativePageIds:[],threshold:.55,minCoverage:.5,negativeMargin:.05}})},data={collections:[collection],folders:[],memberships:[],locations:[],favourites:[]};
  await act(async()=>root.render(React.createElement(CollectionDialog,{key:matching,vaultId:'fixture',data,collection,onChanged:()=>{},onClose:()=>{}})));await act(async()=>t.mock.timers.tick(400));assert.match(document.body.textContent,/Saved matching inputs are unavailable/);
  const human=document.querySelector('textarea[aria-label="Description"]');assert.equal(human.value,'Old purpose');if(matching==='semantic')assert.equal(document.querySelector('textarea[aria-label="Matching description"]').value,'Matching scope');
  Object.getOwnPropertyDescriptor(env.dom.window.HTMLTextAreaElement.prototype,'value').set.call(human,'New human purpose');await act(async()=>human.dispatchEvent(new Event('input',{bubbles:true})));
  const save=[...document.querySelectorAll('button')].find(button=>button.textContent==='Save collection');assert.equal(save.disabled,false);await act(async()=>save.click());assert.deepEqual(saves.at(-1),{vault:'fixture',route:'collections/'+matching,body:{name:'Existing collection',description:'New human purpose'}});
  assert.equal(collectionDefinitionUnchanged(collection,{kind:'smart',matching,...(matching==='semantic'?{semantic:{minCoverage:.5,threshold:.55,description:'Matching scope',version:1}}:{examples:collection.examples})}),true);
  assert.equal(collectionDefinitionUnchanged(collection,{kind:'smart',matching:matching==='semantic'?'examples':'semantic'}),false);
 }
 assert.ok(requests.every(request=>request.url.endsWith('semantic-preview')||request.url.endsWith('example-preview')));assert.equal(saves.length,2);
});
