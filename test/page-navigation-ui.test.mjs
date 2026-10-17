import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../src/client/App.tsx';
import {api} from '../src/client/api.ts';
const page=id=>({id,vault_id:'a',title:id,blocks:[{id:id+'-body',type:'paragraph',checked:false,content:[{text:'Body '+id}]}],sourceIds:[],revision:1,updated_at:''});
test('sidebar note switching preserves mounted shell and outgoing editor until asynchronous content is ready',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Range','DOMParser','InputEvent','MouseEvent','Event','PointerEvent','MutationObserver','getSelection','getComputedStyle','innerWidth','innerHeight','localStorage','CSS','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 for(const key of keys){const value=key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='getSelection'?()=>dom.window.getSelection():key==='ResizeObserver'?class{observe(){}disconnect(){}}:key==='PointerEvent'?dom.window.MouseEvent:key==='CSS'?{escape:value=>value}:dom.window[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 document.queryCommandState=()=>false;
 Object.defineProperty(dom.window.HTMLElement.prototype,'isContentEditable',{get(){return this.getAttribute('contenteditable')==='true';}});
 localStorage.setItem('noema-knowledge-panel-open','true');localStorage.setItem('noema-address/a',JSON.stringify({view:'pages',pageId:'one'}));
 t.mock.method(api,'vaults',async()=>[{id:'a',name:'A',locked:false}]);t.mock.method(api,'pages',async()=>[page('one'),page('two')]);t.mock.method(api,'entities',async()=>[]);t.mock.method(api,'organization',async()=>({collections:[],folders:[],locations:[],memberships:[],favourites:[]}));
 t.mock.method(api,'aiNotifications',async()=>({items:[],running:[],unreadCount:0,through:0}));t.mock.method(api,'enrichments',async()=>[]);
 let finish;t.mock.method(api,'page',async(_vault,id)=>id==='one'?page('one'):new Promise(resolve=>finish=resolve));
 const root=createRoot(document.querySelector('#mount'));
 try {
  await act(async()=>root.render(React.createElement(App)));
  const sidebar=document.querySelector('.sidebar'),header=document.querySelector('.topbar'),editor=document.querySelector('.page'),content=document.querySelector('#content'),knowledge=document.querySelector('#intelligence-panel'),tools=document.querySelector('.page-toolbar');assert.ok(editor);assert.ok(knowledge);sidebar.scrollTop=75;
  const select=id=>document.querySelector('.page-link[title="'+id+'"]');
  await act(async()=>select('two').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(document.querySelector('.sidebar'),sidebar);assert.equal(document.querySelector('.topbar'),header);assert.equal(document.querySelector('.page'),editor);assert.equal(document.querySelector('#intelligence-panel'),knowledge);assert.equal(document.querySelector('.page-toolbar'),tools);assert.equal(sidebar.scrollTop,75);
  assert.equal(content.getAttribute('aria-busy'),'true');assert.ok(content.hasAttribute('inert'));assert.match(document.querySelector('.page-navigation-status').textContent,/Opening two/);assert.ok(!document.body.textContent.includes('Loading workspace'));assert.equal(select('one').disabled,false);
  await act(async()=>finish(page('two')));
  assert.equal(document.querySelector('.sidebar'),sidebar);assert.equal(document.querySelector('.topbar'),header);assert.notEqual(document.querySelector('.page'),editor);assert.equal(document.querySelector('#page-title').value,'two');assert.equal(content.getAttribute('aria-busy'),'false');assert.ok(!content.hasAttribute('inert'));assert.equal(document.querySelector('.page-navigation-status'),null);assert.equal(sidebar.scrollTop,75);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
