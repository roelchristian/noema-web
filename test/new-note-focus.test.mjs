import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {PageEditor} from '../src/client/editor/PageEditor.tsx';
import {api} from '../src/client/api.ts';
test('only a creation intent focuses the body at zero; reopening and updates preserve focus',async t=>{
 const dom=new JSDOM('<div id="mount"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Range','DOMParser','InputEvent','MouseEvent','Event','PointerEvent','MutationObserver','getSelection','getComputedStyle','innerWidth','innerHeight','localStorage','CSS','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 for(const key of keys){const value=key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='getSelection'?()=>dom.window.getSelection():key==='requestAnimationFrame'?dom.window.requestAnimationFrame.bind(dom.window):key==='cancelAnimationFrame'?dom.window.cancelAnimationFrame.bind(dom.window):key==='ResizeObserver'?class{observe(){}disconnect(){}}:key==='PointerEvent'?dom.window.MouseEvent:key==='CSS'?{escape:value=>value}:dom.window[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 dom.window.scrollTo=()=>{};
 dom.window.HTMLElement.prototype.attachEvent=()=>{};dom.window.HTMLElement.prototype.detachEvent=()=>{};
 document.queryCommandState=()=>false;
 Object.defineProperty(dom.window.HTMLElement.prototype,'isContentEditable',{get(){return this.getAttribute('contenteditable')==='true';}});

 t.mock.method(api,'entitySchema',async()=>({types:[],subtypes:[]}));
 const root=createRoot(document.querySelector('#mount'));
 let consumed=0;
 const page={id:'new',vault_id:'a',title:'Untitled',blocks:[{id:'body',type:'paragraph',checked:false,content:[]}],sourceIds:[],revision:1,updated_at:''};
 const props={page,pages:[],entities:[],saveStatus:'saved',onChange(){},onOpenPage(){},onOpenEntity(){},onCreateEntity(){},onSave(){},onIdentify:async()=>{},onAddAlias:async()=>{},onCreationFocusConsumed:()=>consumed++};
 try{
  const outside=document.createElement('button');document.body.append(outside);outside.focus();
  await act(async()=>root.render(React.createElement(PageEditor,props)));
  assert.equal(document.activeElement,outside);assert.equal(consumed,0);
  await act(async()=>root.render(React.createElement(PageEditor,{...props,focusNewBody:true})));
  const body=document.querySelector('[contenteditable="true"]');
  assert.equal(document.activeElement,body);
  assert.ok(body.contains(getSelection().anchorNode));
  assert.equal(getSelection().anchorOffset,0);assert.equal(getSelection().isCollapsed,true);assert.equal(consumed,1);
  assert.equal(document.querySelector('#page-title').value,'Untitled');
  document.querySelector('#page-title').focus();
  await act(async()=>root.render(React.createElement(PageEditor,{...props,focusNewBody:true,page:{...page,revision:2,blocks:[{...page.blocks[0],content:[{text:'Saved body'}]}]}})));
  assert.equal(document.activeElement,document.querySelector('#page-title'));assert.equal(consumed,1);
  await act(async()=>root.render(React.createElement(PageEditor,{...props,focusNewBody:false,page:{...page,title:'AI title',revision:3}})));
  assert.equal(document.activeElement,document.querySelector('#page-title'));
  outside.focus();
  await act(async()=>root.render(React.createElement(PageEditor,{...props,key:'reopened'})));
  assert.equal(document.activeElement,outside);assert.equal(consumed,1);

  // An initial writing session omits the whole heading, including its margin.
  await act(async()=>root.render(React.createElement(PageEditor,{...props,key:'initial',hideTitle:true,focusNewBody:true})));
  const initialBody=document.querySelector('[contenteditable="true"]');
  assert.equal(document.querySelector('.page-title-heading'),null);
  assert.equal(document.querySelector('#page-title'),null);
  assert.equal(document.activeElement,initialBody);
  const selection=getSelection(),caretNode=selection.anchorNode,caretOffset=selection.anchorOffset;
  for(const updated of [{...page,revision:2},{...page,title:'Garden plans',revision:2,enrichmentPending:false}]){
   await act(async()=>root.render(React.createElement(PageEditor,{...props,key:'initial',hideTitle:true,focusNewBody:false,page:updated})));
   assert.equal(document.querySelector('.page-title-heading'),null);
   assert.equal(document.querySelector('[contenteditable="true"]'),initialBody);
   assert.equal(document.activeElement,initialBody);
   assert.equal(selection.anchorNode,caretNode);assert.equal(selection.anchorOffset,caretOffset);
  }
  outside.focus();
  await act(async()=>root.render(React.createElement(PageEditor,{...props,key:'reopened-enriched',page:{...page,title:'Garden plans'}})));
  assert.equal(document.querySelector('#page-title').value,'Garden plans');
  assert.equal(document.activeElement,outside);
  await act(async()=>root.render(React.createElement(PageEditor,{...props,key:'reopened-untitled'})));
  assert.equal(document.querySelector('#page-title').value,'Untitled');
  assert.equal(document.activeElement,outside);
 }finally{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
});
