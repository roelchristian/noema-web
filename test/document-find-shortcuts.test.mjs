import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {DocumentFind} from '../src/client/editor/DocumentFind.tsx';
import {searchSurfaces} from '../src/client/editor/document-find.ts';

test('document shortcuts toggle Find/Replace from page controls while respecting other surfaces',async t=>{
 const env=setupDOM(t,{html:'<button id="toolbar">Page tools</button><input id="outside"><article class="page"><input id="page-title"><div id="mount"></div></article>'});
 // Model the browser capability even when the 150 ms debounce fires under load.
 // Use the real search engine, while keeping worker delivery asynchronous.
 const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 const workers=[];
 class SearchWorker {
  stopped=false;
  constructor(){workers.push(this);}
  postMessage({surfaces,options}){const data=searchSurfaces(surfaces,options);queueMicrotask(()=>{if(!this.stopped)this.onmessage?.({data});});}
  terminate(){this.stopped=true;}
 }
 Object.defineProperty(globalThis,'Worker',{configurable:true,value:SearchWorker});
 env.defer(()=>{if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else delete globalThis.Worker;});
 const previousCSS=Object.getOwnPropertyDescriptor(globalThis,'CSS');
 Object.defineProperty(globalThis,'CSS',{configurable:true,value:{}});
 env.defer(()=>{if(previousCSS)Object.defineProperty(globalThis,'CSS',previousCSS);else delete globalThis.CSS;});
 // Own the component's debounce/dismissal clock without real animation waits.
 env.defer(()=>t.mock.timers.reset());
 const root=createRoot(document.querySelector('#mount'));
 env.defer(()=>act(async()=>root.unmount()));
 const blocks=[];
 await act(async()=>root.render(React.createElement(DocumentFind,{blocks,entities:[],disabled:false,onChange(){}})));
 assert.equal(document.querySelector('.document-find-shell').hidden,true);
 assert.equal(document.querySelector('.document-find-trigger'),null);
 t.mock.timers.enable({apis:['setTimeout']});
 const find=()=>document.querySelector('.document-find-shell[aria-hidden="false"] .document-find-query');
 const replacement=()=>document.querySelector('[aria-label="Replace with"]');
 async function press(target,options){target.focus();const event=new env.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,...options});await act(async()=>target.dispatchEvent(event));return event.defaultPrevented;}
 const toolbar=document.querySelector('#toolbar');
 for(const options of [{key:'f',metaKey:true},{key:'f',ctrlKey:true}]){
  assert.equal(await press(toolbar,options),true);assert.equal(document.activeElement,find());assert.equal(replacement(),null);assert.equal(document.querySelector('.document-find-count-slot').getAttribute('aria-hidden'),'true');assert.equal(document.querySelector('.document-find-top').dataset.hasCount,'false');
  assert.equal(await press(find(),options),true);assert.equal(find(),null);
 }
 for(const options of [{key:'h',ctrlKey:true},{key:'ƒ',code:'KeyF',metaKey:true,altKey:true},{key:'H',metaKey:true,shiftKey:true},{key:'H',ctrlKey:true,shiftKey:true}]){
  assert.equal(await press(toolbar,options),true);assert.ok(replacement());assert.equal(document.activeElement,find());
  assert.equal(await press(find(),options),true);assert.equal(find(),null);
 }
 // A different shortcut switches modes; repeating it closes the panel.
 await press(toolbar,{key:'f',metaKey:true});await press(find(),{key:'h',ctrlKey:true});assert.ok(replacement());
 await press(find(),{key:'f',metaKey:true});assert.ok(find());assert.equal(replacement(),null);
 await press(toolbar,{key:'Escape'});assert.equal(find(),null);
 // The menu invocation still refocuses and selects the current query.
 await press(toolbar,{key:'f',metaKey:true});find().value='existing';
 await act(async()=>document.dispatchEvent(new Event('noema:document-find')));assert.equal(document.activeElement,find());assert.equal(find().selectionStart,0);assert.equal(find().selectionEnd,8);
 await press(find(),{key:'Escape'});
 assert.equal(await press(document.querySelector('#outside'),{key:'f',metaKey:true}),false);assert.equal(find(),null);
 const dialog=document.createElement('dialog');dialog.setAttribute('open','');document.body.append(dialog);
 assert.equal(await press(toolbar,{key:'f',metaKey:true}),false);assert.equal(find(),null);dialog.remove();
 document.querySelector('article').setAttribute('inert','');
 assert.equal(await press(toolbar,{key:'f',metaKey:true}),false);assert.equal(find(),null);document.querySelector('article').removeAttribute('inert');
 assert.equal(await press(toolbar,{key:'f',metaKey:true,isComposing:true}),false);assert.equal(find(),null);
 assert.equal(await press(toolbar,{key:'f',ctrlKey:true,altKey:true}),false);assert.equal(find(),null);
 await act(async()=>document.dispatchEvent(new Event('noema:document-find')));assert.ok(find());
 const fallbackShell=document.querySelector('.document-find-shell');assert.equal(fallbackShell.hidden,false);
 await press(find(),{key:'Escape'});assert.equal(fallbackShell.dataset.state,'closing');
 assert.equal(fallbackShell.hasAttribute('inert'),true);assert.ok(document.querySelector('.document-find-query'));
 await act(async()=>t.mock.timers.tick(199));assert.equal(fallbackShell.hidden,false);assert.equal(fallbackShell.dataset.state,'closing');
 await act(async()=>t.mock.timers.tick(1));assert.equal(fallbackShell.hidden,true);
 // The close button shares the exit animation; animation completion removes the bar.
 await act(async()=>document.dispatchEvent(new Event('noema:document-find')));
 await act(async()=>document.querySelector('.document-find-close').click());
 const shell=document.querySelector('.document-find-shell');assert.equal(shell.dataset.state,'closing');
 const finished=new Event('animationend',{bubbles:true});Object.defineProperty(finished,'animationName',{value:'document-find-dismiss'});
 await act(async()=>shell.dispatchEvent(finished));assert.equal(shell.hidden,true);assert.equal(document.querySelector('.document-find-query'),null);
 // Reopening during exit cancels the pending dismissal.
 await act(async()=>document.dispatchEvent(new Event('noema:document-find')));await press(find(),{key:'Escape'});
 await press(toolbar,{key:'f',metaKey:true});assert.equal(shell.dataset.state,'open');assert.equal(shell.hasAttribute('inert'),false);
 await act(async()=>t.mock.timers.tick(200));assert.equal(shell.hidden,false);assert.equal(shell.dataset.state,'open','cancelled fallback cannot dismiss a reopened panel');
 // Reduced motion closes immediately, including through the button.
 env.dom.window.matchMedia=query=>({matches:query==='(prefers-reduced-motion: reduce)'});
 await act(async()=>document.querySelector('.document-find-close').click());assert.equal(shell.hidden,true);
 // Exercise the debounced worker path deliberately, rather than relying on
 // every shortcut operation to finish before its timer fires.
 await act(async()=>document.dispatchEvent(new Event('noema:document-find')));
 const priorWorkers=workers.length;
 await act(async()=>t.mock.timers.tick(149));assert.equal(workers.length,priorWorkers);
 await act(async()=>t.mock.timers.tick(1));assert.equal(workers.length,priorWorkers+1);
 assert.ok(workers.every(worker=>worker.stopped));
 // Cleanup removes the document-level listener.
 await act(async()=>root.render(null));assert.equal(await press(toolbar,{key:'f',metaKey:true}),false);
});

test('active-hit marker follows wrapped range geometry and cleans up without styling the block',async t=>{
 const {trackDocumentFindMarker}=await import('../src/client/editor/document-find-marker.ts');
 const env=setupDOM(t,{html:'<article class="page"><div data-block-id="b"><div class="block-controls"></div><div class="block-content">Search result</div></div></article><span id="marker" hidden></span>'});
 const article=document.querySelector('article'),block=document.querySelector('[data-block-id]'),controls=document.querySelector('.block-controls'),marker=document.querySelector('#marker');
 const box=(left,top,width=20,height=20)=>({left,top,width,height,right:left+width,bottom:top+height});
 controls.getClientRects=()=>[box(40,200)];controls.getBoundingClientRect=()=>box(40,200);
 const range=document.createRange();range.selectNodeContents(document.querySelector('.block-content'));
 let top=220;range.getClientRects=()=>[box(100,top)];
 const original=article.innerHTML,stop=trackDocumentFindMarker(marker,article,block,range);env.defer(stop);
 assert.equal(marker.style.left,'46px');assert.equal(marker.style.top,'230px');assert.equal(marker.hidden,false);assert.equal(article.innerHTML,original);
 top=260;window.dispatchEvent(new Event('resize'));await new Promise(resolve=>requestAnimationFrame(resolve));assert.equal(marker.style.top,'270px');
 top=-50;document.dispatchEvent(new Event('scroll'));await new Promise(resolve=>requestAnimationFrame(resolve));assert.equal(marker.dataset.visible,'false');
 stop();assert.equal(marker.hidden,true);assert.equal(article.innerHTML,original);
});

test('result navigation scrolls smoothly to the wrapped hit and respects reduced motion',async t=>{
 const {scrollDocumentFindMatch}=await import('../src/client/editor/document-find-scroll.ts');
 const env=setupDOM(t,{html:'<main><header class="topbar"></header><article class="page"><div>Result</div></article></main><div id="find"></div>'});
 const article=document.querySelector('article'),panel=document.querySelector('#find');
 document.querySelector('.topbar').getBoundingClientRect=()=>({bottom:50});panel.getBoundingClientRect=()=>({bottom:100});
 const range=document.createRange();range.selectNodeContents(article.firstChild);
 let top=150;range.getClientRects=()=>[{top,bottom:top+20,width:50,height:20}];
 const calls=[];window.scrollTo=options=>calls.push(options);
 scrollDocumentFindMatch(range,article,panel);assert.equal(calls.length,0,'visible hit stays in place');
 top=1500;scrollDocumentFindMatch(range,article,panel);assert.equal(calls.length,1);assert.equal(calls[0].behavior,'smooth');assert.ok(calls[0].top>0);
 env.dom.window.matchMedia=()=>({matches:true});top=-100;scrollDocumentFindMatch(range,article,panel);assert.equal(calls[1].behavior,'instant');assert.equal(calls[1].top,0);
});
