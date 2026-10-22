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
