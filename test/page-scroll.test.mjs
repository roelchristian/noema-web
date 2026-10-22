import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {usePageScroll} from '../src/client/state/use-page-scroll.ts';

async function setup(t){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const names=['window','document','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'];
 const descriptors=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
 const observers=[],moves=[];let max=3000;
 class Observer{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
 for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='ResizeObserver'?Observer:name==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[name]});
 window.scrollTo=options=>{moves.push(options);window.scrollY=Math.min(options.top,max);window.scrollX=options.left;};
 let state={view:'pages',busy:false,vault:{id:'a',locked:false},page:{id:'one',vault_id:'a'},loadingPageId:null};
 const listeners=new Set();
 const workspace={snapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 function Harness(){
  usePageScroll(workspace);
  const current=useSyncExternalStore(workspace.subscribe,workspace.snapshot);
  // Simulate the browser clamping scroll during DOM replacement, before layout effects.
  return React.createElement('div',{id:'content',key:current.view+'/'+current.vault.id+'/'+current.page.id,ref:node=>{if(node)window.scrollY=Math.min(window.scrollY,max);}},current.page.id);
 }
 const root=createRoot(document.querySelector('#mount'));
 await act(async()=>root.render(React.createElement(Harness)));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();names.forEach((name,i)=>{if(descriptors[i])Object.defineProperty(globalThis,name,descriptors[i]);else delete globalThis[name];});});
 const update=async patch=>{await act(async()=>{state={...state,...patch};for(const fn of listeners)fn();});};
 const open=async(id,vault='a')=>update({view:'pages',busy:false,vault:{id:vault,locked:false},page:{id,vault_id:vault},loadingPageId:null});
 return {open,update,moves,observers,setMax:value=>{max=value;},resize:async()=>{await act(async()=>{for(const observer of observers)if(observer.connected)observer.callback();});}};
}
test('page revisits restore exact offsets before paint even after a shorter document clamps the viewport',async t=>{
 const {open,moves,setMax}=await setup(t);
 assert.deepEqual(moves.at(-1),{left:0,top:0,behavior:'instant'});
 window.scrollY=1450;window.scrollX=12;setMax(100);await open('two');assert.equal(window.scrollY,0);
 window.scrollY=70;window.scrollX=0;setMax(3000);await open('one');assert.equal(window.scrollY,1450);assert.equal(window.scrollX,12);
 await open('two');assert.equal(window.scrollY,70);assert.equal(window.scrollX,0);
});
test('loading and same-page refreshes preserve position, while leaving Library and switching vaults keep page offsets independent',async t=>{
 const {open,update,moves}=await setup(t);window.scrollY=800;const count=moves.length;
 await update({loadingPageId:'two'});await update({page:{id:'one',vault_id:'a',revision:2}});
 assert.equal(moves.length,count);assert.equal(window.scrollY,800);
 await update({view:'organization',loadingPageId:null});window.scrollY=35;await open('one');assert.equal(window.scrollY,800);
 await open('one','b');assert.equal(window.scrollY,0);window.scrollY=240;
 await open('one','a');assert.equal(window.scrollY,800);await open('one','b');assert.equal(window.scrollY,240);
});
test('restoration retries delayed image layout but stops once the user starts scrolling',async t=>{
 const {open,setMax,resize}=await setup(t);window.scrollY=1800;await open('two');
 setMax(100);await open('one');assert.equal(window.scrollY,100);
 await open('two');await open('one');assert.equal(window.scrollY,100);
 setMax(2500);await resize();assert.equal(window.scrollY,1800);
 await open('two');setMax(100);await open('one');assert.equal(window.scrollY,100);
 window.dispatchEvent(new window.WheelEvent('wheel'));window.scrollY=60;setMax(2500);await resize();assert.equal(window.scrollY,60);
});

test('entity home scroll is independent of editor and other entity destinations',async t=>{
 const {open,update}=await setup(t);
 window.scrollY=850;
 await update({view:'entity',entityId:'subject-one'});assert.equal(window.scrollY,0);
 window.scrollY=420;
 await update({entityId:'subject-two'});assert.equal(window.scrollY,0);
 window.scrollY=160;
 await update({entityId:'subject-one'});assert.equal(window.scrollY,420);
 await open('one');assert.equal(window.scrollY,850);
 await update({view:'entity',entityId:'subject-two'});assert.equal(window.scrollY,160);
});
