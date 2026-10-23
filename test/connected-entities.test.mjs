import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectedEntities, connectedEntityItems } from '../src/client/intelligence/ConnectedEntities.tsx';
const entities = [
  {id:'zoe',name:'Zoe',type:'person',vault_id:'vault',updated_at:'2026-01-01'},
  {id:'ada',name:'Ada',type:'person',vault_id:'vault',updated_at:'2026-03-01'},
  {id:'paris',name:'Paris',type:'place',vault_id:'vault',updated_at:'2026-02-01'},
  {id:'missing',name:'Not mentioned',type:'person',vault_id:'vault',updated_at:'2026-04-01'},
  {id:'foreign',name:'Foreign',type:'person',vault_id:'other',updated_at:'2026-05-01'},
];
const page = {id:'note',vault_id:'vault',title:'Notes',sourceIds:[],blocks:[
  {type:'paragraph',content:[{entityId:'zoe'}, {entityId:'ada',mentionText:'A'}, {entityId:'foreign'}, {text:'Paris'}]},
  {type:'table',content:[],rows:[[[{entityId:'paris'}, {entityId:'paris'}, {entityId:'paris'}, {entityId:'ada'}]]]},
]};
const ids = (type,sort) => connectedEntityItems(page,entities,type,sort).map(entity=>entity.id);
test('connected entity types include table mentions, deduplicate aliases, and exclude unmentioned and foreign entities', () => {
  assert.deepEqual(ids('all','name-asc'),['ada','paris','zoe']);
  assert.deepEqual(ids('person','name-asc'),['ada','zoe']);
  assert.deepEqual(ids('place','name-asc'),['paris']);
  assert.deepEqual(ids('source','name-asc'),[]);
});
test('connected entity sorting supports name, first mention, mention frequency and modification date', () => {
  assert.deepEqual(ids('all','name-desc'),['zoe','paris','ada']);
  assert.deepEqual(ids('all','page-order'),['zoe','ada','paris']);
  assert.deepEqual(ids('all','mentions'),['paris','ada','zoe']);
  assert.deepEqual(ids('all','updated'),['ada','paris','zoe']);
  assert.deepEqual(entities.map(entity=>entity.id),['zoe','ada','paris','missing','foreign']);
});
test('sidebar defaults to page frequency and exposes a compact page-relevant sort menu', () => {
  const html = renderToStaticMarkup(createElement(ConnectedEntities,{page,entities,onOpenEntity(){}}));
  assert.equal((html.match(/role="tab"/g) ?? []).length,3);
  assert.match(html,/role="tablist" aria-label="Connected entity types"/);
  assert.match(html,/aria-selected="true"/);
  assert.match(html,/Sort connected entities/);
  for(const label of ['All','Person','Place']) assert.ok(html.includes(`aria-label="${label} (`));
  assert.match(html,/Sort connected entities · Most mentions/);
  assert.match(html,/aria-haspopup="menu"/);
  assert.match(html,/aria-checked="true"[^>]*>.*?Most mentions/);
  assert.match(html,/First appearance/);
  assert.doesNotMatch(html,/Switch to Z–A/);
  const list=html.slice(html.indexOf('knowledge-connected-list'));
  assert.ok(list.indexOf('Paris')<list.indexOf('Ada'));
  assert.ok(list.indexOf('Ada')<list.indexOf('Zoe'));
  assert.doesNotMatch(html,/<select/);
  assert.match(renderToStaticMarkup(createElement(ConnectedEntities,{page:{...page,blocks:[]},entities,onOpenEntity(){}})),/Entities/);
});

test('equally frequent entities follow the page rather than the alphabet',()=>{
  const tiedPage={...page,blocks:[{type:'paragraph',content:[{entityId:'zoe'},{entityId:'ada'}]}]};
  assert.deepEqual(connectedEntityItems(tiedPage,entities,'all','mentions').map(entity=>entity.id),['zoe','ada']);
});

test('sidebar hover and keyboard focus use the same preview card as editor mentions',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');
 const {act,Fragment}=await import('react');
 const {createRoot}=await import('react-dom/client');
 const {EntityPreview}=await import('../src/client/components/EntityPreview.tsx');
 const env=setupDOM(t),{dom}=env;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'PointerEvent');
 Object.defineProperty(globalThis,'PointerEvent',{configurable:true,writable:true,value:dom.window.MouseEvent});
 env.defer(()=>{if(previous)Object.defineProperty(globalThis,'PointerEvent',previous);else delete globalThis.PointerEvent;});
 t.mock.timers.enable({apis:['setTimeout']});
 const fullEntities=entities.map(entity=>({...entity,description:entity.id==='ada'?'':'About '+entity.name,subtypes:[]}));
 const opened=[],root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(createElement(Fragment,null,
  createElement(ConnectedEntities,{page,entities:fullEntities,onOpenEntity:id=>opened.push(id)}),
  createElement('article',{className:'page'},createElement('div',{id:'blocks'},createElement('div',{className:'block-content',contentEditable:true,suppressContentEditableWarning:true},createElement('span',{className:'mention','data-entity':'ada','data-mention-text':'Ada in the editor'},'Ada in the editor')))),
  createElement(EntityPreview,{entities:fullEntities,onOpen:id=>opened.push(id)}),
 )));
 const row=document.querySelector('.knowledge-connected-list [data-entity="paris"]');
 await act(async()=>row.querySelector('span').dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true})));
 await act(async()=>t.mock.timers.tick(279));assert.equal(document.querySelector('#entity-preview'),null);
 await act(async()=>t.mock.timers.tick(1));
 assert.equal(document.querySelector('#entity-preview-title').textContent,'Paris');
 assert.equal(document.querySelector('#entity-preview-description').textContent,'About Paris');
 assert.equal(document.querySelector('.remove-entity-tag'),null);
 await act(async()=>document.querySelector('.mention').dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true})));
 await act(async()=>t.mock.timers.tick(280));
 assert.equal(document.querySelectorAll('#entity-preview').length,1);assert.equal(document.querySelector('#entity-preview-title').textContent,'Ada');
 assert.equal(document.querySelector('#entity-preview-description'),null);assert.equal(document.querySelector('#entity-preview').hasAttribute('aria-describedby'),false);
 assert.equal(document.querySelectorAll('.entity-preview-actions button').length,2);
 assert.equal(document.querySelector('.entity-preview-open').textContent,'Open entity');
 assert.ok(document.querySelector('.entity-preview-open svg'));assert.ok(document.querySelector('[aria-label="Remove entity tag"] svg'));
 await act(async()=>{row.focus();t.mock.timers.tick(0);});
 assert.equal(document.querySelector('#entity-preview-title').textContent,'Paris');
 await act(async()=>row.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));
 assert.equal(document.activeElement,document.querySelector('#entity-preview button'));
 await act(async()=>document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 assert.equal(document.querySelector('#entity-preview'),null);assert.equal(document.activeElement,row);
 await act(async()=>row.dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true})));
 await act(async()=>t.mock.timers.tick(280));
 await act(async()=>document.querySelector('#entity-preview button').click());
 assert.deepEqual(opened,['paris']);assert.equal(document.querySelector('#entity-preview'),null);
 await act(async()=>document.querySelector('.mention').dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true})));
 await act(async()=>t.mock.timers.tick(280));
 await act(async()=>document.querySelector('[aria-label="Remove entity tag"]').click());
 assert.equal(document.querySelector('.mention'),null);
 assert.equal(document.querySelector('[data-skip-auto-tag]').textContent,'Ada in the editor');
 assert.equal(document.querySelector('#entity-preview'),null);
});
