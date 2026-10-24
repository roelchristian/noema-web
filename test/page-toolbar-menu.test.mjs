import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {PageToolbar} from '../src/client/editor/PageToolbar.tsx';
import {readMarkdownTyping,rememberMarkdownTyping} from '../src/client/state/markdown-preferences.ts';

async function toolbar(t,overrides={}) {
  const env=setupDOM(t);
  const prototype=env.dom.window.HTMLElement.prototype;
  const matches=prototype.matches,open=new WeakSet();
  prototype.matches=function(selector){return selector===':popover-open'?open.has(this):matches.call(this,selector);};
  prototype.showPopover=function(){open.add(this);};prototype.hidePopover=function(){open.delete(this);};
  prototype.getAnimations=()=>[];prototype.animate=()=>({});
  prototype.getBoundingClientRect=()=>({left:10,right:110,top:10,bottom:30,width:100,height:20});
  const noop=()=>{},changes=[];
  const page={id:'toolbar-test',vault_id:'test',title:'Example',blocks:[{id:'p',type:'paragraph',content:[{text:'**bold**'}]}],...overrides};
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  const props={page,onRevealInSidebar:noop,onUndo:noop,onRedo:noop,onEditLockChange:async()=>{},onAI:noop,onPresentationModeChange:noop,onExitFocus:noop,onOrganizationChange:noop,onDelete:async()=>{},onError:noop,onFeaturedImageChange:noop,onChangeBlocks:blocks=>changes.push(blocks),presentationMode:'standard',canUndo:true};
  const render=async()=>act(async()=>root.render(React.createElement(PageToolbar,props)));
  await render();
  const choose=async id=>{const action=document.querySelector(`[data-menu-id="${id}"]`);assert.ok(action,id);await act(async()=>action.click());};
  const showEditing=async()=>{await act(async()=>document.querySelector('[aria-label="More page actions"]').click());await choose('editing');};
  return {page,props,render,changes,choose,showEditing};
}

test('page menu groups actions, exposes shortcuts and separates typing preference from explicit conversion',async t=>{
  const ui=await toolbar(t);
  await act(async()=>rememberMarkdownTyping(false));
  await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
  assert.deepEqual([...document.querySelectorAll('.action-menu-heading')].map(node=>node.textContent),['Page','Navigation','Editing','Page management']);
  assert.equal(document.querySelector('[data-menu-id="find"] kbd').textContent,'⌘F / Ctrl+F');
  assert.equal(document.querySelector('.page-toolbar-reading'),null);
  await ui.choose('editing');
  assert.match(document.querySelector('[data-menu-id="markdown-typing"] small').textContent,/future typing/);
  await ui.choose('markdown-typing');
  assert.equal(readMarkdownTyping(),true);
  assert.equal(ui.changes.length,0,'typing preference must never convert existing content');
  await ui.showEditing();
  await ui.choose('markdown-convert');
  assert.equal(ui.changes.length,0,'opening conversion confirmation must not edit content');
  assert.match(document.querySelector('[data-menu-id="markdown-apply"] small').textContent,/this page.*undo/);
  await ui.choose('markdown-apply');
  assert.equal(ui.changes.length,1);
  assert.equal(ui.changes[0][0].content[0].bold,true);
  assert.deepEqual(ui.page.blocks[0].content,[{text:'**bold**'}],'conversion must not mutate its input');
});

test('conversion remains disabled for archived and locked pages while typing preference stays available',async t=>{
  const ui=await toolbar(t,{editLocked:true});
  for(const state of [{editLocked:true},{archived_at:'2026-10-24'}]){
    ui.props.page={...ui.page,editLocked:false,...state};await ui.render();
    await ui.showEditing();
    assert.equal(document.querySelector('[data-menu-id="markdown-convert"]').disabled,true);
    assert.equal(document.querySelector('[data-menu-id="markdown-typing"]').disabled,false);
    await ui.choose('markdown-convert');
    assert.equal(ui.changes.length,0);
    await act(async()=>document.querySelector('[aria-label="More page actions"]').click());
  }
});

test('Escape backs out of the innermost confirmation and restores its stable trigger',async t=>{
  const ui=await toolbar(t);
  await ui.showEditing();await ui.choose('markdown-convert');
  const popup=document.querySelector('[aria-label="Format existing Markdown…"]');
  await act(async()=>popup.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(document.activeElement.dataset.menuId,'markdown-convert');
  assert.equal(document.querySelector('[aria-label="More page actions"]').getAttribute('aria-expanded'),'true');
  assert.equal(ui.changes.length,0);
});
