import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {createReadingAnchor} from '../src/shared/reading-continuity.ts';
import {SourceReadingContinuity,jumpToReadingOffset} from '../src/client/sources/SourceReadingContinuity.tsx';

test('source reading automatically restores a verified position and respects subsequent navigation',async t=>{
 const {dom,defer}=setupDOM(t,{html:'<div id="mount"></div><article><span data-source-start="0" data-source-end="100">'+('A passage with enough text to anchor safely. '.repeat(3))+'</span></article>'});
 const keys=['ResizeObserver','KeyboardEvent','sessionStorage'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 let resized=()=>{};
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='ResizeObserver'?class {constructor(callback){resized=callback;}observe(){}disconnect(){}}:dom.window[key]});
 const fetchBefore=globalThis.fetch;
 defer(()=>{globalThis.fetch=fetchBefore;keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});});
 const text=document.querySelector('span').textContent;
 const file={id:'file',vault_id:'vault',text,textHash:'revision'};
 const anchor=createReadingAnchor(file.id,file.textHash,text,10);
 let finish;
 globalThis.fetch=async(url,options)=>options?.method==='PUT'?Response.json({}):new Promise(resolve=>{finish=()=>resolve(Response.json({resume:{id:'resume',label:'',anchor,resolution:{status:'resolved',offset:10}},bookmarks:[]}));});
 const scrolls=[];
 dom.window.scrollBy=position=>scrolls.push(position.top);
 dom.window.Range.prototype.getBoundingClientRect=function(){return {top:this.startOffset*10,height:20};};
 const article={current:document.querySelector('article')};
 const root=createRoot(document.querySelector('#mount'));
 defer(()=>act(()=>root.unmount()));
 const mount=key=>root.render(React.createElement(SourceReadingContinuity,{key,file,article}));
 await act(async()=>mount('server'));
 await act(async()=>finish());
 assert.equal(scrolls.at(-1),76,'server reading anchor is restored without clicking Continue reading');
 sessionStorage.setItem('noema-source-position/'+JSON.stringify(['vault','file']),JSON.stringify(createReadingAnchor(file.id,file.textHash,text,20)));
 await act(async()=>mount('session'));
 await act(async()=>finish());
 assert.equal(scrolls.at(-1),176,'newer same-tab anchor takes precedence over an older server save');
 const count=scrolls.length;
 await act(async()=>dom.window.dispatchEvent(new dom.window.Event('wheel')));
 resized();
 assert.equal(scrolls.length,count,'layout changes do not pull the user back after scrolling');
 await act(async()=>mount('interaction'));
 await act(async()=>dom.window.dispatchEvent(new dom.window.Event('wheel')));
 await act(async()=>finish());
 assert.equal(scrolls.length,count,'late resume responses do not override deliberate navigation');
});


test('reading jumps locate endnotes by source offset after their display order changes',t=>{
 const {dom}=setupDOM(t,{html:'<article><span data-source-start="0" data-source-end="10" data-source-atomic="true">Body</span><span data-source-start="30" data-source-end="40" data-source-atomic="true">Later body</span><span data-source-start="10" data-source-end="20" data-source-atomic="true">Endnote</span></article>'});
 const leaves=[...document.querySelectorAll('span')];
 leaves.forEach((leaf,index)=>{leaf.getBoundingClientRect=()=>({top:[100,200,900][index]});});
 let top;dom.window.scrollBy=position=>{top=position.top;};
 jumpToReadingOffset(document.querySelector('article'),15);assert.equal(top,876);
 jumpToReadingOffset(document.querySelector('article'),35);assert.equal(top,176);
});
