import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
const {ReviewCentre}=await import('../src/client/review/ReviewCentre.tsx');
css.deregister();
const item=(id,patch={})=>({id:'scan:'+id,category:'scan',originId:id,title:id,runId:'run-'+id,group:'decisions',state:'pending',decision:'Review detected entities and subtypes',count:2,updatedAt:'2026-10-23T10:00:00Z',...patch});
async function fixture(t,work){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost:5173'});
 dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
 const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','Event','sessionStorage','navigator','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const requests=[],opened=[];let respond=async url=>url.includes('?id=')?item('A'):({items:[item('A'),item('B')],errors:[],more:[]});
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});const result=await respond(String(url),options);return {ok:true,json:async()=>structuredClone(result)};});
 const root=createRoot(document.querySelector('#mount'));
 const render=async(vaultId='v')=>act(async()=>root.render(React.createElement(ReviewCentre,{vaultId,onOpen:async(...args)=>opened.push(args)})));
 const click=async selector=>{const target=typeof selector==='string'?document.querySelector(selector):selector;assert.ok(target,'Expected control');await act(async()=>target.click());};
 const search=async value=>{const input=document.querySelector('input[type="search"]');await act(async()=>{input.focus();const old=input.value;input.value=value;input._valueTracker?.setValue(old);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.KeyboardEvent('keyup',{bubbles:true,key:'a'}));});};
 try{await work({dom,requests,opened,render,click,search,respond:handler=>{respond=handler;}});}
 finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}

test('review queue keeps human actions specific to each workflow and separates work in progress',async t=>fixture(t,async({respond,render,click,requests})=>{
 respond(async()=>({items:[item('A'),item('Discovery',{id:'discovery:d',category:'discovery'}),item('Changed',{group:'operations',state:'stale'}),item('Reading',{category:'source',group:'activity',state:'queued',count:0})],errors:[],more:[]}));
 await render();assert.equal(document.querySelectorAll('.review-items li').length,2);
 assert.match(document.querySelector('.review-items').textContent,/Review entities/);assert.match(document.querySelector('.review-items').textContent,/Review discoveries/);
 await click('.review-filters button:nth-child(2)');assert.equal(sessionStorage.getItem('noema-review-filter/v'),'operations');assert.match(document.querySelector('.review-items').textContent,/Page changed/);assert.match(document.querySelector('.review-items').textContent,/Revisit page/);
 await click('.review-filters button:nth-child(3)');assert.match(document.querySelector('.review-items').textContent,/Queued/);assert.match(document.querySelector('.review-items').textContent,/View progress/);assert.equal(requests.length,1);assert.ok(requests.every(request=>request.options.method==='GET'));
}));

test('review search filters loaded work and restores search and selected view per vault',async t=>fixture(t,async({respond,render,search,click})=>{
 respond(async()=>({items:[item('Alpha',{group:'operations',state:'stale'}),item('Beta',{group:'operations',state:'stale'})],errors:[],more:[]}));
 await render();await click('.review-filters button:nth-child(2)');await search('Alpha');assert.equal(document.querySelectorAll('.review-items li').length,1);assert.equal(sessionStorage.getItem('noema-review-filter/v/query'),'Alpha');
 await render('other');assert.equal(document.querySelector('.review-filters button[aria-pressed="true"]').textContent,'To review0');assert.equal(document.querySelector('input').value,'');
 await render('v');assert.equal(document.querySelector('input').value,'Alpha');assert.equal(document.querySelectorAll('.review-items li').length,1);
 await search('missing');assert.match(document.querySelector('.review-empty').textContent,/No matching work/);await click('.review-empty button');assert.equal(document.querySelectorAll('.review-items li').length,2);
}));

test('failed refresh retains loaded work and retries without generating AI work',async t=>fixture(t,async({respond,render,click})=>{
 await render();respond(async()=>{throw new Error('Server unavailable');});await click('.review-refresh');assert.equal(document.querySelectorAll('.review-items li').length,2);assert.match(document.querySelector('[role="alert"]').textContent,/Previously loaded work is still shown/);
 respond(async()=>({items:[item('Recovered')],errors:[],more:[]}));await click('[role="alert"] button');assert.equal(document.querySelectorAll('.review-items li').length,1);assert.match(document.querySelector('.review-items').textContent,/Recovered/);assert.equal(document.querySelector('[role="alert"]'),null);
}));

test('opening revalidates saved run identity and refuses navigation when work changed',async t=>fixture(t,async({render,respond,click,opened,requests})=>{
 await render();respond(async url=>url.includes('?id=')?item('A',{runId:'replacement'}):({items:[item('A',{runId:'replacement'})],errors:[],more:[]}));
 await click('.review-item-action');assert.equal(opened.length,0);assert.match(document.querySelector('[role="status"]').textContent,/work changed/);assert.equal(requests.length,3);
 await click('.review-item-action');assert.equal(opened.length,1);assert.equal(opened[0][0].runId,'replacement');assert.equal(opened[0][1].aborted,false);
}));

test('partial coverage and pagination never imply that an unloaded queue is clear',async t=>fixture(t,async({respond,render,click,requests})=>{
 respond(async url=>url.endsWith('offset=50')?({items:[item('Older')],errors:[],more:[]}):({items:[],errors:['scan: saved status could not be loaded.'],more:['scan']}));
 await render();assert.match(document.querySelector('.review-empty').textContent,/Some work could not be checked/);assert.match(document.querySelector('[role="alert"]').textContent,/Other work is still available/);
 await click('.review-footer button');assert.ok(requests.some(request=>request.url.endsWith('offset=50')));assert.match(document.querySelector('.review-items').textContent,/Older/);assert.equal(document.querySelector('.review-footer button'),null);
}));
