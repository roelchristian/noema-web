import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {BlockEditor} from '../src/client/editor/BlockEditor.tsx';
import {api} from '../src/client/api.ts';

async function editor(block,work) {
  const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost'});
  const keys=['window','document','Node','Element','HTMLElement','Range','Event','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
  const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:typeof dom.window[key]==='function'&&['getSelection','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]});
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.attachEvent=function(){};
  dom.window.HTMLElement.prototype.detachEvent=function(){};
  const originalSchema=api.entitySchema;api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
  const root=createRoot(document.querySelector('#mount'));
  let blocks=[block];
  const render=()=>root.render(React.createElement(BlockEditor,{vaultId:'default',blocks,entities:[],reviewMatches:[],onChange:next=>{blocks=next;render();},onOpenEntity(){},onCreateEntity(){},onAddAlias:async()=>{},onSave(){}}));
  try {
    await act(async()=>render());
    const host=document.querySelector('[data-block-id="p"] .block-content');
    const range=document.createRange();range.setStart(document.createTreeWalker(host,dom.window.NodeFilter.SHOW_TEXT).nextNode(),5);range.collapse(true);document.getSelection().addRange(range);
    await work({dom,host,blocks:()=>blocks});
  } finally {
    await act(async()=>root.unmount());api.entitySchema=originalSchema;dom.window.close();
    keys.forEach((key,i)=>{if(previous[i])Object.defineProperty(globalThis,key,previous[i]);else delete globalThis[key];});
  }
}
const paragraph={id:'p',type:'paragraph',checked:false,content:[{text:'FirstSecond',bold:true}]};
test('Enter and Shift+Enter split text into blocks, preserving formatting and moving the caret',async()=>{
  for(const shiftKey of [false,true])await editor(paragraph,async({dom,host,blocks})=>{
    const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',shiftKey,bubbles:true,cancelable:true});
    await act(async()=>host.dispatchEvent(event));
    assert.ok(event.defaultPrevented);
    assert.deepEqual(blocks().slice(0,2).map(block=>block.content),[[{text:'First',bold:true}],[{text:'Second',bold:true}]]);
    assert.equal(document.querySelector('br'),null);
    assert.equal(document.getSelection().anchorNode.parentElement.closest('[data-block-id]').dataset.blockId,blocks()[1].id);
  });
});
test('native line-break and paragraph input also create blocks without relying on keydown',async()=>{
  for(const inputType of ['insertLineBreak','insertParagraph'])await editor(paragraph,async({dom,host,blocks})=>{
    const event=new dom.window.InputEvent('beforeinput',{inputType,bubbles:true,cancelable:true});
    await act(async()=>host.dispatchEvent(event));
    assert.ok(event.defaultPrevented);
    assert.deepEqual(blocks().slice(0,2).map(block=>block.content[0].text),['First','Second']);
    assert.equal(document.querySelector('br'),null);
  });
});
test('Shift+Enter in a table cell creates a text block below the table',async()=>{
  await editor({...paragraph,type:'table',content:[],rows:[[[{text:'FirstSecond'}]]]},async({dom,host,blocks})=>{
    const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});
    await act(async()=>host.dispatchEvent(event));
    assert.ok(event.defaultPrevented);assert.equal(blocks()[0].rows[0][0][0].text,'FirstSecond');
    assert.equal(blocks()[1].type,'paragraph');assert.equal(document.querySelector('br'),null);
  });
});
