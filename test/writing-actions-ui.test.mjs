import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {WritingReview} from '../src/client/editor/WritingReview.tsx';
import {writingReviewChanges,applyWritingReviewEdits} from '../src/client/editor/writing-review.ts';
const before=[{text:'Before '}],selected=[{text:'a weak claim',italic:true},{math:'x=1',text:''},{entityId:'entity',mentionText:'Entity'}],after=[{text:' after.'}];
const target={blockId:'p',scope:'span',snapshot:JSON.stringify([...before,...selected,...after]),before,selected,after,texts:[{id:'p:0',text:'a weak claim'}]};
const change=writingReviewChanges([target],[{id:'p:0',replacement:'a precise claim',reason:'Synthetic mock'}])[0];
test('selected prose proposals preserve boundaries, marks, math and entities; partial acceptance rebases',()=>{
 const result=applyWritingReviewEdits(change);
 assert.deepEqual(result.content,[...before,{text:'a precise claim',italic:true},...selected.slice(1),...after]);
 assert.deepEqual(target.selected,selected);assert.equal(result.remaining,undefined);
});
test('before/after preview disables stale acceptance and Escape dismisses without accepting',async()=>{
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
 const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 keys.forEach(key=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]}));
 const root=createRoot(document.querySelector('#mount'));let accepted=0,closed=0;
 const props={action:'recast',persona:{id:'editor',version:2,origin:'builtin',expression:'expressive'},change,entities:[],onAccept(){accepted++;return null;},onDismiss(){},onClose(){closed++;}};
 try{
  await act(async()=>root.render(React.createElement(WritingReview,{...props,stale:true})));
  assert.match(document.body.textContent,/Before and after/);assert.match(document.body.textContent,/The Editor · v2 · expressive/);
  const accept=[...document.querySelectorAll('button')].find(button=>button.textContent==='Accept');assert.equal(accept.disabled,true);accept.click();assert.equal(accepted,0);
  await act(async()=>document.querySelector('aside').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(closed,1);assert.equal(accepted,0);
  await act(async()=>root.render(React.createElement(WritingReview,{...props,stale:false})));
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Accept').click());assert.equal(accepted,1);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>previous[index]?Object.defineProperty(globalThis,key,previous[index]):delete globalThis[key]);}
});
