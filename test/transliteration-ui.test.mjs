import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {PageToolbar} from '../src/client/editor/PageToolbar.tsx';
import {TransliterationBar} from '../src/client/editor/TransliterationBar.tsx';
import {ReadOnlyPageBlocks} from '../src/client/editor/ReadOnlyPageBlocks.tsx';
import {readTransliteration} from '../src/client/state/transliteration-preferences.ts';

for(const [name,text,expected] of [['Greek','θεός','theós'],['Old Church Slavonic','Ⱄⰾⱁⰲⱁ ѹ ꙗ ъЬ Ъь','Slovo u ya ŭĬ Ŭĭ'],['Bulgarian','ъЬ Ъь','ăʹ Ăʹ'],['Russian','ъЬ Ъь','ʺʹ ʺʹ']])test(`three-dot menu controls ${name} transliteration on a locked page and remembers its page preference`,async t=>{
  const env=setupDOM(t);
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
  env.defer(()=>{if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;});
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
  const choose=async label=>{
    await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
    await act(async()=>document.querySelector('[data-menu-action="Transliteration"]').click());
    const selected=document.querySelector(`[data-menu-action="${label}"]`);
    assert.equal(selected.disabled,false);
    await act(async()=>selected.click());
  };
  await choose('Below paragraphs');
  assert.ok(document.querySelector('[aria-label="Transliteration controls"]'));
  assert.equal(document.querySelector('[aria-label="Hide transliteration"]').textContent,'Hide');
  assert.equal(document.querySelector('[aria-label="Hide transliteration"] svg'),null);
  assert.equal(document.querySelector('.block-transliteration').lastElementChild.textContent,expected);
  assert.equal(readTransliteration('test/'+page.id),'below');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'below');
  assert.equal(readTransliteration('different/page'),'off');
  assert.equal(document.querySelector('.transliteration-label'),null);
  const layoutControl=document.querySelector('[aria-label="Transliteration layout"]');
  assert.equal(layoutControl.value,'below');
  await act(async()=>{layoutControl.value='side-by-side';layoutControl.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(readTransliteration('test/'+page.id),'side-by-side');
  assert.equal(localStorage.getItem('noema-transliteration:test/'+page.id),'side-by-side');
  assert.equal(document.querySelector('.transliteration-label'),null);
  assert.equal(document.querySelector('[data-block-id="p"]').dataset.transliterationLayout,'side-by-side');
  assert.equal(document.querySelectorAll('[contenteditable="true"]').length,0);
  await act(async()=>{root.unmount();});
  const remount=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>remount.unmount()));
  await act(async()=>remount.render(React.createElement(React.Fragment,null,
    React.createElement(ReadOnlyPageBlocks,{language:page.language,blocks:page.blocks,entities:[],pages:[],vaultId:'test',pageId:page.id,onOpenEntity:noop,onOpenPage:noop}),
    React.createElement(TransliterationBar,{pageKey:'test/'+page.id}))));
  assert.ok(document.querySelector('.block-transliteration'));
  const restoredControl=document.querySelector('[aria-label="Transliteration layout"]');
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
