import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { EntityMatches } from '../src/server/modules/entity-matches.ts';
const rejects = (work,status) => assert.throws(work,error => error.status === status);
function setup(filename = ':memory:') {
  const db = openDatabase(filename), store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store,knowledge);
  return {db,store,knowledge,pages,matches:new EntityMatches(store,pages,knowledge)};
}
function fixture(env) {
  const donald = env.knowledge.create('default',{name:'Donald Trump',type:'person',aliases:['Trump']});
  const ivanka = env.knowledge.create('default',{name:'Ivanka Trump',type:'person',aliases:['Trump']});
  let page = env.pages.create('default',{title:'Cached ambiguity'});
  page = env.pages.update('default',page.id,{...page,blocks:[
    {id:'p',type:'paragraph',checked:false,content:[{text:'Before '},{text:'Tr',bold:true},{text:'ump spoke. Trump listened.',italic:true}]},
    {id:'table',type:'table',checked:false,content:[],rows:[[[{text:'Trump'}]]]},
  ]});
  return {donald,ivanka,page};
}
test('review items materialize once per revision and catalog and survive server restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'noema-match-cache-')), filename = path.join(dir,'cache.sqlite');
  let env = setup(filename);
  try {
    const {page} = fixture(env), first = env.matches.get('default',page.id,page.revision);
    assert.equal(first.matches.length,3);
    assert.deepEqual(first.matches.map(({blockId,row,col,start,end}) => ({blockId,row,col,start,end})), [
      {blockId:'p',row:undefined,col:undefined,start:7,end:12},
      {blockId:'p',row:undefined,col:undefined,start:20,end:25},
      {blockId:'table',row:0,col:0,start:0,end:5},
    ]);
    // A cache hit returns the stored materialization rather than rescanning the body.
    env.store.run('UPDATE page_entity_match_cache SET matches=? WHERE page_id=?',JSON.stringify(first.matches.map(item=>({...item,context:'Stored review item'}))),page.id);
    assert.equal(env.matches.get('default',page.id).matches[0].context,'Stored review item');
    env.db.close(); env = setup(filename);
    assert.equal(env.matches.get('default',page.id).matches[0].context,'Stored review item');
    assert.equal(env.store.get('SELECT count(*) AS count FROM page_entity_match_cache').count,1);
  } finally { env.db.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('page edits invalidate cached items; alias changes replace the cache and stale requests are rejected', () => {
  const env = setup();
  try {
    const {page,ivanka} = fixture(env), first = env.matches.get('default',page.id);
    env.knowledge.update('default',ivanka.id,{name:ivanka.name,type:'person',aliases:[]});
    const changed = env.matches.get('default',page.id);
    assert.notEqual(changed.key,first.key); assert.deepEqual(changed.matches,[]);
    rejects(()=>env.matches.resolve('default',page.id,{revision:page.revision,key:first.key,matchId:first.matches[0].id,entityId:ivanka.id,all:false}),409);
    const updated = env.pages.update('default',page.id,{...page,title:'Changed title'});
    assert.equal(env.store.get('SELECT count(*) AS count FROM page_entity_match_cache').count,0);
    rejects(()=>env.matches.get('default',page.id,page.revision),409);
    assert.equal(env.matches.get('default',page.id,updated.revision).revision,updated.revision);
    rejects(()=>env.matches.get('foreign',page.id),404);
    env.pages.delete('default',page.id);
    assert.equal(env.store.get('SELECT count(*) AS count FROM page_entity_match_cache').count,0);
    rejects(()=>env.matches.get('default',page.id),404);
  } finally { env.db.close(); }
});
test('cached reviews validate candidates, resolve individual or all instances, and respect page context', () => {
  const env = setup();
  try {
    const {page,donald,ivanka} = fixture(env), cache = env.matches.get('default',page.id);
    const body = {revision:page.revision,key:cache.key,matchId:cache.matches[0].id,entityId:donald.id,all:false};
    rejects(()=>env.matches.resolve('default',page.id,{...body,entityId:'missing'}),400);
    rejects(()=>env.matches.resolve('default',page.id,{...body,matchId:'missing'}),400);
    const one = env.matches.resolve('default',page.id,body);
    assert.equal(one.blocks[0].content.filter(segment=>segment.entityId).length,1);
    assert.deepEqual(env.pages.get('default',page.id),page,'Resolution patch uses the regular client autosave rather than silently overwriting edits');
    const all = env.matches.resolve('default',page.id,{...body,entityId:ivanka.id,all:true});
    assert.equal(all.blocks[0].content.filter(segment=>segment.entityId===ivanka.id).length,2);
    assert.equal(all.blocks[1].rows[0][0][0].entityId,ivanka.id);
    env.pages.update('default',page.id,{...page,blocks:one.blocks});
    assert.deepEqual(env.matches.get('default',page.id).matches,[],'The sole linked candidate resolves remaining aliases without review');
  } finally { env.db.close(); }
});
