import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {api} from '../src/client/api.ts';
import {EntityNeighborhood} from '../src/client/knowledge/EntityNeighborhood.tsx';
async function fixture(t,work){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost:5173'});
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const entity=(id,name,extra={})=>({id,name,vault_id:'v',type:'person',description:'',subtypes:[],updated_at:'2026-10-22',...extra});
 const data={rootId:'a',nodes:[entity('a','Ada'),entity('b','Babbage',{archived_at:'2026-10-22'})],edges:[{id:'relationship:r',sourceId:'a',targetId:'b',label:'worked with',kind:'relationship'},{id:'property:p',sourceId:'b',targetId:'a',label:'Colleague',kind:'property'}],relationTypes:['worked with'],truncated:false};
 const requests=[];t.mock.method(api,'entityNeighborhood',async(...args)=>{requests.push(args);return data;});
 const root=createRoot(document.querySelector('#mount'));let opened,inspected;
 const click=async(selector)=>{const element=document.querySelector(selector);assert.ok(element,selector);await act(async()=>element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 try{await act(async()=>root.render(React.createElement(EntityNeighborhood,{vaultId:'v',id:'a',refreshKey:'',onOpen:id=>opened=id,onInspect:id=>inspected=id})));await work({dom,data,requests,click,root,opened:()=>opened,inspected:()=>inspected});}
 finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}
test('graph arrows preserve edge kinds and keyboard navigation opens archived identities',async t=>fixture(t,async({dom,opened,inspected,click})=>{
 assert.equal(document.querySelectorAll('.en-edge-relationship').length,1);assert.equal(document.querySelectorAll('.en-edge-property').length,1);
 assert.match(document.querySelector('.en-edge-property title').textContent,/Babbage → Ada: Colleague \(property reference\)/);
 assert.ok(document.querySelector('.en-edge-property path').getAttribute('marker-end'));
 const node=document.querySelector('[aria-label="Open Babbage · Archived"]');
 await act(async()=>node.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));assert.equal(opened(),'b');
 await click('.en-inspect button');assert.equal(inspected(),'b');
 await click('.en-controls button:last-child');assert.equal(document.querySelector('svg'),null);
 assert.equal(document.querySelectorAll('.en-edge-list li').length,2);assert.match(document.querySelector('.en-edge-list').textContent,/Property reference/);
 assert.equal(document.querySelector('.en-controls button:last-child').getAttribute('aria-pressed'),'true');
 await click('.en-controls button:first-child');assert.ok(document.querySelector('svg'));
}));
test('distance and relationship label changes reload bounded graph with abort signals',async t=>fixture(t,async({dom,requests})=>{
 const selectors=document.querySelectorAll('.en-controls select');
 await act(async()=>{selectors[0].value='2';selectors[0].dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(requests.at(-1)[2],2);assert.equal(requests[0][4].aborted,true);
 await act(async()=>{selectors[1].value='worked with';selectors[1].dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(requests.at(-1)[3],'worked with');assert.match(document.querySelector('.eh-writing-hint').textContent,/property references.*remain visible/);
}));
