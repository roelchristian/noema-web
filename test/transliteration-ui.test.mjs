import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {PageToolbar} from '../src/client/editor/PageToolbar.tsx';
import {TransliterationBar} from '../src/client/editor/TransliterationBar.tsx';
import {TransliterationBlock} from '../src/client/editor/TransliterationBlock.tsx';
import {blockTransliterationSegments} from '../src/shared/transliteration.ts';
import {readSegments,segmentHTML} from '../src/client/editor/segments.tsx';
import {ReadOnlyPageBlocks} from '../src/client/editor/ReadOnlyPageBlocks.tsx';
import {readTransliteration,rememberTransliteration} from '../src/client/state/transliteration-preferences.ts';

for(const [name,text,expected] of [['Greek','θεός','theós'],['Old Church Slavonic','Ⱄⰾⱁⰲⱁ ѹ ꙗ ъЬ Ъь','Slovo u ja ŭĬ Ŭĭ'],['Bulgarian','ъЬ Ъь','ăʹ Ăʹ'],['Russian','ъЬ Ъь','ʺʹ ʺʹ'],['Armenian','Հայաստան Երևան ու','Hayastan Erevan u'],['Farsi','سلام فارسی','slām fārsy'],['Tajik','Тоҷикистон Ҷумҳурӣ','Tojikiston Jumhurī']])test(`three-dot menu controls ${name} transliteration on a locked page and remembers its page preference`,async t=>{
  const env=setupDOM(t);
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
  env.defer(()=>{if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;});
  const optGroupDescriptor=Object.getOwnPropertyDescriptor(globalThis,'HTMLOptGroupElement');
  Object.defineProperty(globalThis,'HTMLOptGroupElement',{configurable:true,value:env.dom.window.HTMLOptGroupElement});
  env.defer(()=>{if(optGroupDescriptor)Object.defineProperty(globalThis,'HTMLOptGroupElement',optGroupDescriptor);else delete globalThis.HTMLOptGroupElement;});
  const prototype=env.dom.window.HTMLElement.prototype;
  const matches=prototype.matches,open=new WeakSet();
  prototype.matches=function(selector){return selector===':popover-open'?open.has(this):matches.call(this,selector);};
  prototype.showPopover=function(){open.add(this);};
  prototype.hidePopover=function(){open.delete(this);};
  prototype.getAnimations=()=>[];prototype.animate=()=>({});
  prototype.getBoundingClientRect=()=>({left:10,right:110,top:10,bottom:30,width:100,height:20});
  const page={id:'locked-translit-'+name,vault_id:'test',title:'Example',language:name,editLocked:true,blocks:[{id:'p',type:'paragraph',content:[{text}]}]};
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  const noop=()=>{};
  const render=()=>root.render(React.createElement(React.Fragment,null,
    React.createElement(PageToolbar,{page,onRevealInSidebar:noop,onUndo:noop,onRedo:noop,onEditLockChange:async()=>{},onAI:noop,onPresentationModeChange:noop,onExitFocus:noop,onOrganizationChange:noop,onDelete:async()=>{},onError:noop,onFeaturedImageChange:noop,onChangeBlocks:()=>assert.fail('view settings must not edit blocks'),presentationMode:'standard'}),
    React.createElement(ReadOnlyPageBlocks,{language:page.language,blocks:page.blocks,entities:[],pages:[],vaultId:'test',pageId:page.id,onOpenEntity:noop,onOpenPage:noop}),
    React.createElement(TransliterationBar,{pageKey:'test/'+page.id})));
  await act(async()=>render());
  assert.equal(document.querySelector('.transliteration-bar'),null);
  const toggle=async()=>{
    await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
    const action=document.querySelector('[data-menu-action="Transliteration"]');
    assert.equal(action.disabled,false);
    assert.equal(action.getAttribute('aria-haspopup'),null);
    await act(async()=>action.click());
  };
  await toggle();
  assert.ok(document.querySelector('[aria-label="Transliteration controls"]'));
  assert.equal(document.querySelector('.transliteration-bar-label').textContent,'Transliteration');
  assert.ok(document.querySelector('.transliteration-bar .select-trigger[role="combobox"]'));
  assert.equal(document.querySelector('[aria-label="Hide transliteration"]').textContent,'Hide');
  assert.equal(document.querySelector('[aria-label="Hide transliteration"] svg'),null);
  assert.equal(document.querySelector('.block-transliteration').lastElementChild.textContent,expected);
  assert.equal(readTransliteration('test/'+page.id),'below');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'below');
  assert.equal(readTransliteration('different/page'),'off');
  assert.equal(document.querySelector('.transliteration-label'),null);
  const layoutControl=document.querySelector('select[aria-label="Transliteration layout"]');
  assert.equal(layoutControl.value,'below');
  await act(async()=>{document.querySelector('.transliteration-bar .select-trigger').click();
    document.querySelector('.transliteration-bar [role="option"]:last-child').click();});
  assert.equal(readTransliteration('test/'+page.id),'side-by-side');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'side-by-side');
  assert.equal(document.querySelector('.transliteration-label'),null);
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'side-by-side');
  assert.equal(document.querySelectorAll('[contenteditable="true"]').length,0);
  await toggle();
  assert.equal(document.querySelector('.transliteration-bar'),null);
  await toggle();
  assert.equal(readTransliteration('test/'+page.id),'side-by-side');

  await act(async()=>{root.unmount();});
  const remount=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>remount.unmount()));
  await act(async()=>remount.render(React.createElement(React.Fragment,null,
    React.createElement(ReadOnlyPageBlocks,{language:page.language,blocks:page.blocks,entities:[],pages:[],vaultId:'test',pageId:page.id,onOpenEntity:noop,onOpenPage:noop}),
    React.createElement(TransliterationBar,{pageKey:'test/'+page.id}))));
  assert.ok(document.querySelector('.block-transliteration'));
  const restoredControl=document.querySelector('select[aria-label="Transliteration layout"]');
  assert.equal(restoredControl.value,'side-by-side');
  await act(async()=>{restoredControl.value='below';restoredControl.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'below');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'below');
  await act(async()=>document.querySelector('[aria-label="Hide transliteration"]').click());
  assert.equal(readTransliteration('test/'+page.id),'off');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'off');
  assert.equal(document.querySelector('.transliteration-bar'),null);
  assert.equal(document.querySelector('.block-transliteration'),null);
});


test('transliteration preserves inline marks, scripts and math while hiding citations',async t=>{
  const env=setupDOM(t);
  const block={id:'styled',type:'paragraph',content:[
    {text:'Жизнь',bold:true,italic:true,underline:true,strike:true},
    {text:'ж',superscript:true},{text:'ш',subscript:true},
    {text:'x^{2}+y_{1}',math:true},
    {text:' [ref]',sourceReference:{id:'r'}},
  ]};
  const original=structuredClone(block);
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  await act(async()=>root.render(React.createElement(TransliterationBlock,{content:blockTransliterationSegments(block,[])})));
  const display=document.querySelector('.block-transliteration');
  assert.equal(display.querySelector('s u em strong').textContent,'Žiznʹ');
  assert.equal(display.querySelector('sup').textContent,'ž');
  assert.equal(display.querySelector('sub').textContent,'š');
  assert.ok(display.querySelector('.katex'));
  assert.equal(display.textContent.includes('[ref]'),false);
  assert.deepEqual(block,original);
  const host=document.createElement('div');
  host.innerHTML='<sup>ж</sup><sub>ш</sub>';
  assert.deepEqual(readSegments(host),[{text:'ж',superscript:true},{text:'ш',subscript:true}]);
  host.innerHTML=segmentHTML(readSegments(host),[],undefined,true,undefined,false);
  assert.equal(host.querySelector('sup').textContent,'ж');
  assert.equal(host.querySelector('sub').textContent,'ш');
});


test('mobile uses below paragraphs and hides side-by-side controls while retaining the desktop preference',async t=>{
  const env=setupDOM(t);
  let mobile=true;
  const changes=new Set();
  window.matchMedia=query=>({matches:query==='(max-width: 750px)'&&mobile,addEventListener:(_type,listener)=>changes.add(listener),removeEventListener:(_type,listener)=>changes.delete(listener)});
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:window.localStorage});
  env.defer(()=>{if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;});
  const prototype=window.HTMLElement.prototype;
  const matches=prototype.matches,open=new WeakSet();
  prototype.matches=function(selector){return selector===':popover-open'?open.has(this):matches.call(this,selector);};
  prototype.showPopover=function(){open.add(this);};prototype.hidePopover=function(){open.delete(this);};
  prototype.getAnimations=()=>[];prototype.animate=()=>({});
  prototype.getBoundingClientRect=()=>({left:10,right:110,top:10,bottom:30,width:100,height:20});
  const page={id:'mobile-translit',vault_id:'test',title:'Mobile',blocks:[{id:'p',type:'paragraph',content:[{text:'Жизнь'}]}]};
  const pageKey='test/'+page.id;
  rememberTransliteration(pageKey,'side-by-side');
  const root=createRoot(document.querySelector('#mount')),noop=()=>{};
  env.defer(()=>act(async()=>root.unmount()));
  await act(async()=>root.render(React.createElement(React.Fragment,null,
    React.createElement(PageToolbar,{page,onRevealInSidebar:noop,onUndo:noop,onRedo:noop,onEditLockChange:async()=>{},onAI:noop,onPresentationModeChange:noop,onExitFocus:noop,onOrganizationChange:noop,onDelete:async()=>{},onError:noop,onFeaturedImageChange:noop,onChangeBlocks:noop,presentationMode:'standard'}),
    React.createElement(ReadOnlyPageBlocks,{blocks:page.blocks,entities:[],pages:[],vaultId:'test',pageId:page.id,onOpenEntity:noop,onOpenPage:noop}),
    React.createElement(TransliterationBar,{pageKey}))));
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'below');
  assert.equal(document.querySelector('.transliteration-bar .select-trigger'),null);
  assert.equal(document.querySelector('.transliteration-bar select'),null);
  assert.equal(document.querySelector('.transliteration-bar').textContent,'TransliterationHide');
  await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
  assert.equal(document.querySelector('[data-menu-action="Transliteration"]').getAttribute('aria-checked'),'true');
  await act(async()=>document.querySelector('[data-menu-action="Transliteration"]').click());
  assert.equal(readTransliteration(pageKey),'off');
  await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
  await act(async()=>document.querySelector('[data-menu-action="Transliteration"]').click());
  assert.equal(readTransliteration(pageKey),'side-by-side');
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'below');
  await act(async()=>{mobile=false;for(const listener of changes)listener();});
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'side-by-side');
  assert.equal(document.querySelector('.transliteration-bar select').value,'side-by-side');
});
