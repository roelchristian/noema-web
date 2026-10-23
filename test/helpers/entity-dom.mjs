import assert from 'node:assert/strict';
import {act} from 'react';
import {setupDOM} from './dom.mjs';
import {clearEntityDrafts} from '../../src/client/knowledge/entity-drafts.ts';

/** Fresh entity UI ownership; register every cleanup before React can mount. */
export async function setupEntityDOM(t,{vaultId='v'}={}) {
 const env=setupDOM(t,{html:'<!doctype html><div id="mount"></div>'}),{dom}=env;
 clearEntityDrafts(vaultId);
 env.defer(()=>clearEntityDrafts(vaultId));
 dom.window.HTMLElement.prototype.scrollTo=function(){};
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const {createRoot}=await import('react-dom/client');
 const root=createRoot(document.querySelector('#mount'));
 env.defer(()=>act(async()=>root.unmount()));
 const click=async selector=>{
  const target=document.querySelector(selector);assert.ok(target,selector);
  await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 };
 return {...env,root,click};
}
