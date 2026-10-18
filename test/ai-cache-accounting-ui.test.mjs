import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {AIActivityLog} from '../src/client/settings/AIActivityLog.tsx';
import {api} from '../src/client/api.ts';
test('activity displays known zeros and missing cache counts separately and exports both fields',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const item={id:'cache-counts',action:'page_title',status:'completed',startedAt:'2026-10-18T12:00:00Z',finishedAt:'2026-10-18T12:00:01Z',durationMs:1000,httpStatus:200,vaultId:'default',objectKind:'page',objectId:'note',objectTitle:'Note',revision:1,available:true,promptBytes:100,inputTokens:3056,cachedInputTokens:0,cacheWriteTokens:3053,outputTokens:24,model:'test',reasoningEffort:'none',debugRecorded:false};
 t.mock.method(api,'aiActivity',async()=>({items:[item,{...item,id:'unknown',cachedInputTokens:null,cacheWriteTokens:null}],nextCursor:null}));
 let exported;
 t.mock.method(URL,'createObjectURL',blob=>{exported=blob;return 'blob:activity-test';});t.mock.method(URL,'revokeObjectURL',()=>{});
 dom.window.HTMLAnchorElement.prototype.click=function(){};
 const root=createRoot(document.querySelector('#mount'));
 try {
  await act(async()=>root.render(React.createElement(AIActivityLog,{onClose(){},onOpenPage:async()=>{}})));
  const headers=[...document.querySelectorAll('th')].map(node=>node.textContent),rows=[...document.querySelectorAll('tbody tr')];
  const cell=(row,label)=>row.children[headers.indexOf(label)].textContent;
  assert.equal(cell(rows[0],'Cached input'),'0');assert.equal(cell(rows[0],'Cache writes'),'3,053');assert.equal(cell(rows[1],'Cached input'),'—');
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Export CSV').click());
  const csv=await exported.text();assert.match(csv,/"cachedInputTokens","cacheWriteTokens"/);assert.match(csv,/"3056","0","3053","24"/);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
