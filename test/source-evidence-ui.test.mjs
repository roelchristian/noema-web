import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {SourceEvidence} from '../src/client/sources/SourceEvidence.tsx';

test('OCR gaps expose recoveries, honest coverage limits, and correctly positioned page highlights',async t=>{
 const dom=new JSDOM('<div id="mount"></div>');
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'],prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const evidence={originalAvailable:true,rawExtraction:{ocrPages:2,pageEvidence:[{page:1,method:'ocr',coordinateSystem:'normalized-bottom-left',text:'Recovered text',coverage:{detectedRegions:10,unmatchedRegions:2,retriedRegions:2,recoveredRegions:1,unresolvedRegions:1},regions:[{bounds:[0.1,0.2,0.3,0.1],reason:'unmatched-detected-text',status:'recovered',recoveredText:'Regan Arts.'},{bounds:[2,0,1,1],reason:'low-confidence',status:'unresolved'}]},{page:2,method:'ocr',text:'Next page',regions:[]}]}};
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>evidence}));
 let page=1;const root=createRoot(document.querySelector('#mount'));
 const render=()=>root.render(React.createElement(SourceEvidence,{vaultId:'v',fileId:'f',pageCount:2,page,onPage:next=>{page=next;render();}}));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});});
 await act(async()=>render());
 assert.match(document.body.textContent,/1 recovered · 1 unresolved/);assert.match(document.body.textContent,/not a completeness guarantee/);assert.match(document.body.textContent,/Regan Arts/);
 const buttons=document.querySelectorAll('.source-evidence-regions button');
 await act(async()=>buttons[0].click());
 const highlight=document.querySelector('.source-evidence-region-box');assert.ok(highlight);assert.equal(highlight.style.left,'10%');assert.ok(Math.abs(parseFloat(highlight.style.top)-70)<0.001);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
 await act(async()=>buttons[1].click());assert.equal(document.querySelector('.source-evidence-region-box'),null,'invalid bounds must not produce page overlays');
 await act(async()=>buttons[0].click());
 await act(async()=>{const select=document.querySelector('select');select.value='2';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(page,2);assert.equal(document.querySelector('.source-evidence-region-box'),null);assert.match(document.body.textContent,/Next page/);
});
