import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {EntityScanReview} from '../src/client/intelligence/EntityScanReview.tsx';
import {api} from '../src/client/api.ts';

test('review renders incoming rows during scanning and enables review only after final persistence',async()=>{
  const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
  const keys=['window','document','Node','Element','HTMLElement','MutationObserver','HTMLSelectElement','HTMLInputElement','CustomEvent','Event','IS_REACT_ACT_ENVIRONMENT'];
  const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.HTMLElement.prototype.attachEvent=function(){};
  dom.window.HTMLElement.prototype.detachEvent=function(){};
  const root=createRoot(document.querySelector('#mount')),originalScan=api.scanEntities,originalSchema=api.entitySchema;
  let progress,finish,confirmed;
  api.entitySchema=async()=>({properties:{},subtypes:[],subtypeProperties:{}});
  api.scanEntities=async(_vault,_id,_revision,onProgress)=>{progress=onProgress;return new Promise(resolve=>finish=resolve);};
  const page={id:'page',vault_id:'default',revision:1,title:'Test'};
  const suggestion={id:'city',name:'Charlemagne, Quebec',aliases:['Charlemagne'],type:'place',subtypes:[],evidence:'Charlemagne',reason:'City',status:'pending',existingId:null};
  let scan=null;
  const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onReview:async()=>{},onScan:result=>{confirmed=result;scan=result;render();}}));
  const click=async selector=>act(async()=>document.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  try {
    await act(async()=>render());await click('.entity-detect-action');
    assert.ok(progress);
    await act(async()=>progress({id:'preview1',revision:1,suggestions:[suggestion]}));
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,1);
    assert.match(document.querySelector('.entity-scan-live-status').textContent,/1 entities found/);
    assert.match(document.querySelector('.entity-review-table').textContent,/Aliases: Charlemagne/);
    assert.equal(document.querySelector('[aria-label="Accept Charlemagne, Quebec"]').disabled,true);
    assert.equal(confirmed,undefined);
    const final={id:'saved',revision:1,suggestions:[suggestion,{...suggestion,id:'region',name:'Quebec',aliases:[],evidence:'Quebec'}]};
    await act(async()=>progress({...final,id:'preview2'}));
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,2);
    await act(async()=>finish(final));
    assert.equal(confirmed.id,'saved');
    assert.equal(document.querySelector('.entity-scan-live-status'),null);
    assert.equal(document.querySelector('[aria-label="Accept Charlemagne, Quebec"]').disabled,false);
    await click('[aria-label="Edit Charlemagne, Quebec"]');
    assert.equal(document.querySelector('[aria-label="Aliases for Charlemagne, Quebec"]').value,'Charlemagne');
  }finally{
    await act(async()=>root.unmount());api.scanEntities=originalScan;api.entitySchema=originalSchema;dom.window.close();
    keys.forEach((key,i)=>{if(previous[i])Object.defineProperty(globalThis,key,previous[i]);else delete globalThis[key];});
  }
});
