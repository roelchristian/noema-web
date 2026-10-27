import { test } from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './helpers/dom.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace } from '../src/client/state/workspace.ts';
import { api } from '../src/client/api.ts';
import { PageEditor } from '../src/client/editor/PageEditor.tsx';

async function setup(t) {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:()=>null, setItem:()=>{}}});
  const vault = {id:'vault', name:'Vault', locked:false};
  const entity = {id:'ada', vault_id:vault.id, name:'Ada Lovelace', type:'person', subtypes:[], description:''};
  let stored = {id:'note', vault_id:vault.id, title:'Notes', blocks:[{id:'paragraph', type:'paragraph', checked:false, content:[{text:'Read Ada Lovelace today.'}]}], sourceIds:[], revision:1, updated_at:''};
  const writes = [];
  t.mock.method(api,'vaults',async()=>[vault]);
  t.mock.method(api,'archivedPages',async()=>[]);t.mock.method(api,'pages',async()=>[stored]);
  t.mock.method(api,'page',async()=>structuredClone(stored));
  t.mock.method(api,'entities',async()=>[entity]);
  t.mock.method(api,'organization',async()=>({collections:[], folders:[], locations:[], memberships:[], favourites:[]}));
  t.mock.method(api,'savePage',async(_vault,_id,page)=>{stored={...structuredClone(page),revision:page.revision+1};writes.push(stored);return stored;});
  const workspace = new Workspace();
  t.after(()=>{
    workspace.titler.dispose();workspace.saver.dispose();
    if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete globalThis.localStorage;
  });
  await workspace.selectVault(vault.id);await workspace.openPage(stored.id);
  return {workspace,writes,entity};
}

test('removed tags remain excluded through idle matching, explicit saves, and reopening', async t => {
  const {workspace, writes} = await setup(t);
  const blocks = [{id: 'paragraph', type: 'paragraph', checked: false, content: [{text: 'Ada Lovelace', skipAutoTag: true}, {text: ' and Ada Lovelace'}]}];
  workspace.updatePage({blocks});
  await workspace.saver.flush();
  assert.deepEqual(writes[0].blocks[0].content, [{text: 'Ada Lovelace', skipAutoTag: true}, {text: ' and '}, {entityId: 'ada', mentionText: 'Ada Lovelace'}]);
  await workspace.openPage('note');
  await workspace.identifyEntities();
  assert.deepEqual(workspace.snapshot().page.blocks, writes[0].blocks);
  assert.equal(workspace.saver.hasPending, false);
});

test('saving a selection alias refreshes the catalog and tags other occurrences without reload', async t => {
  const {workspace, writes, entity} = await setup(t);
  t.mock.method(api, 'addEntityAlias', async (vault, id, alias) => {
    assert.equal(vault, 'vault'); assert.equal(id, entity.id); assert.equal(alias, 'Zyrus');
    return {...entity, aliases: ['Zyrus']};
  });
  workspace.updatePage({blocks: [{id: 'paragraph', type: 'paragraph', checked: false, content: [{text: 'Zyrus and Zyrus.'}]}]});
  await workspace.addEntityAlias(entity.id, 'Zyrus');
  assert.deepEqual(workspace.snapshot().entities[0].aliases, ['Zyrus']);
  await workspace.saver.flush();
  assert.deepEqual(writes[0].blocks[0].content, [{entityId: entity.id, mentionText: 'Zyrus'}, {text: ' and '}, {entityId: entity.id, mentionText: 'Zyrus'}, {text: '.'}]);
});

test('failed alias saves leave the catalog unchanged and propagate errors for retry', async t => {
  const {workspace, entity} = await setup(t);
  t.mock.method(api, 'addEntityAlias', async () => { throw new Error('Alias save failed'); });
  await assert.rejects(workspace.addEntityAlias(entity.id, 'Zyrus'), /Alias save failed/);
  assert.deepEqual(workspace.snapshot().entities, [entity]);
});

test('opening a page waits for its body and review cache before presenting the editor', async t => {
  const {workspace} = await setup(t);
  let finish;
  const previous = workspace.snapshot().page;
  const page = {...previous,id:'other-note',entityMatchCache:{revision:1,key:'hydrated',matches:[]}};
  t.mock.method(api, 'page', async () => new Promise(resolve => { finish = resolve; }));
  const opening = workspace.openPage(page.id);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finish,'function');
  assert.equal(workspace.snapshot().busy,false);
  assert.equal(workspace.snapshot().loadingPageId,page.id);
  assert.equal(workspace.snapshot().page,previous);
  finish(page);
  await opening;
  assert.equal(workspace.snapshot().busy,false);
  assert.equal(workspace.snapshot().page.entityMatchCache.key,'hydrated');
});

test('idle identification links existing entities, autosaves them, and remains idempotent', async t => {
  const {workspace,writes} = await setup(t);
  const statuses=[];workspace.subscribe(()=>statuses.push(workspace.snapshot().saveStatus));
  await workspace.identifyEntities();
  assert.deepEqual(workspace.snapshot().page.blocks[0].content,[{text:'Read '},{entityId:'ada', mentionText: 'Ada Lovelace'},{text:' today.'}]);
  assert.equal(workspace.snapshot().saveStatus,'pending');
  await workspace.saver.flush();
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].blocks,workspace.snapshot().page.blocks);
  assert.ok(statuses.includes('identifying'));
  assert.ok(statuses.includes('saving'));
  assert.equal(workspace.snapshot().saveStatus,'saved');
  await workspace.identifyEntities();
  assert.equal(workspace.saver.hasPending,false);
  assert.equal(writes.length,1);
});

test('explicit saves prepare automatic links and newer edits survive in-flight writes', async t => {
  const {workspace} = await setup(t);
  let finish;
  const writes=[];
  t.mock.method(api,'savePage',async(_vault,_id,page)=>{
    writes.push(structuredClone(page));
    if(writes.length===1)return new Promise(resolve=>{finish=()=>resolve({...page,revision:2});});
    return {...page,revision:3};
  });
  workspace.updatePage({blocks:[{id:'paragraph',type:'paragraph',checked:false,content:[{text:'Ada Lovelace wrote notes.'}]}]});
  const saving=workspace.saver.flush();
  while(!finish)await Promise.resolve();
  workspace.updatePage({blocks:[{id:'paragraph',type:'paragraph',checked:false,content:[{text:'Ada Lovelace wrote newer notes.'}]}]});
  finish();await saving;
  assert.equal(writes.length,2);
  assert.equal(writes[1].revision,2);
  assert.deepEqual(workspace.snapshot().page.blocks[0].content,[{entityId:'ada', mentionText: 'Ada Lovelace'},{text:' wrote newer notes.'}]);
  assert.equal(workspace.snapshot().page.revision,3);
});

test('identification defers while selecting text or using an editor menu, IME, or dialog', async t => {
  const {workspace,writes}=await setup(t);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  let blocked=false, selected=false;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>blocked?{}:null,getSelection:()=>({isCollapsed:!selected})}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;});
  selected=true;await workspace.identifyEntities();
  selected=false;blocked=true;await workspace.identifyEntities();
  assert.equal(workspace.saver.hasPending,false);
  assert.equal(workspace.snapshot().page.blocks[0].content[0].text,'Read Ada Lovelace today.');
  workspace.updatePage({title:'Saved during composition'});await workspace.saver.flush();
  assert.equal(writes[0].blocks[0].content[0].text,'Read Ada Lovelace today.');
  blocked=false;await workspace.identifyEntities();await workspace.saver.flush();
  assert.equal(writes.length,2);
  assert.equal(workspace.snapshot().page.blocks[0].content[1].entityId,'ada');
});

test('editor footer announces identification, saving, saved and retry states', t => {
  setupDOM(t);
  const page={id:'note',vault_id:'vault',title:'Notes',blocks:[],sourceIds:[],revision:1,updated_at:''};
  for(const [saveStatus,label] of [['identifying','Identifying entities…'],['pending','Waiting to save…'],['saving','Saving…'],['saved','Edited just now'],['error','Could not save changes']]) {
    const html=renderToStaticMarkup(createElement(PageEditor,{page,entities:[],saveStatus,onChange:()=>{},onOpenEntity:()=>{},onCreateEntity:()=>{},onSave:()=>{},onIdentify:async()=>{}}));
    const footer=html.slice(html.indexOf('<footer'),html.indexOf('</footer>'));
    assert.ok(footer.includes(label));
    assert.match(footer,/role="status"/);
    assert.equal(footer.includes('Retry'),saveStatus==='error');
  }
});

test('editor recognition stays cached across progress and recomputes once for alias changes',async t=>{
  const {setupEntityDOM}=await import('./helpers/entity-dom.mjs');
  const {act}=await import('react');
  const env=await setupEntityDOM(t);
  t.mock.timers.enable({apis:['setTimeout']});
  const page={id:'note',vault_id:'vault',title:'Notes',blocks:[],sourceIds:[],revision:1,updated_at:'',entityMatchCache:{revision:1,key:'cached',matches:[]}};
  const person={id:'ada',vault_id:'vault',name:'Ada',type:'person',subtypes:[],description:''};
  const source={...person,id:'pdf',type:'source',sourceStatus:'processing'};
  let entities=[person,source],matches=0,identifications=0;
  t.mock.method(api,'entityMatches',async()=>{matches++;return {revision:1,key:'fresh',matches:[]};});
  const identify=async()=>{identifications++;};
  const render=async()=>act(async()=>env.root.render(createElement(PageEditor,{page,entities,pages:[],saveStatus:'saved',onChange(){},onOpenPage(){},onOpenEntity(){},onCreateEntity(){},onSave(){},onIdentify:identify,onAddAlias:async()=>{}})));
  try {
    await render();await act(async()=>t.mock.timers.tick(2000));
    const initialIdentifications=identifications;
    for(let n=0;n<4;n++) {
      entities=[person,{...source,sourceSize:n}];await render();
      await act(async()=>t.mock.timers.tick(2000));
    }
    assert.equal(matches,0,'four progress renders reused hydrated matching cache');
    assert.equal(identifications,initialIdentifications,'progress did not reschedule recognition');
    entities=[{...person,aliases:['Augusta']},source];await render();
    await act(async()=>t.mock.timers.tick(2000));
    assert.equal(matches,1,'alias dictionary change refreshed matches once');
    assert.equal(identifications,initialIdentifications+1);
    console.log(JSON.stringify({entityMatching:{progressRenders:4,progressRecomputes:0,aliasRecomputes:matches}}));
  } finally {await env.close();}
});
