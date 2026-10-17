import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {AIActivityLog} from '../src/client/settings/AIActivityLog.tsx';
import {api} from '../src/client/api.ts';
test('AI explanation entries render in the log and update when generation finishes',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 let status='running',opened;
 const item=()=>({id:'explanation-attempt',action:'block_explanation',status,startedAt:'2026-10-17T00:00:00Z',finishedAt:null,durationMs:null,httpStatus:null,vaultId:'default',objectKind:'page',objectId:'note',objectTitle:'Source note',revision:1,available:true,promptBytes:123,model:'test',reasoningEffort:'low'});
 const request=t.mock.method(api,'aiActivity',async()=>({items:[item()],nextCursor:null}));
 const root=createRoot(document.querySelector('#mount'));
 try{
  await act(async()=>root.render(React.createElement(AIActivityLog,{onClose(){},onOpenPage:async(vault,id)=>{opened=[vault,id];}})));
  assert.match(document.querySelector('tbody').textContent,/AI Explanation/);assert.equal(document.querySelector('.ai-activity-status').textContent,'running');
  status='completed';await act(async()=>window.dispatchEvent(new Event('noema:ai-activity')));
  assert.equal(document.querySelector('.ai-activity-status').textContent,'completed');assert.equal(request.mock.callCount(),2);
  await act(async()=>document.querySelector('.ai-activity-link').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));assert.deepEqual(opened,['default','note']);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
