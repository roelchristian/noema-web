import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AINotifications} from '../src/server/modules/ai-notifications.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {createApp} from '../src/server/http.ts';
import {notificationMessage,runningMessage} from '../src/shared/ai-notifications.ts';
import {PageEnrichment} from '../src/server/modules/page-enrichment.ts';
import {enrichmentProvider} from './helpers/providers.ts';
const selection={model:'test',reasoningEffort:'low'};
function setup(filename=':memory:') {
  const db=openDatabase(filename),store=new Store(db),pages=new Pages(store,new Knowledge(store));
  return {db,store,pages,notifications:new AINotifications(store),enrichments:new AIEnrichments(store,pages),vaults:new Vaults(store)};
}
test('saved enrichments notify regardless of producer; titles notify only when actually applied',async()=>{
  const {db,store,pages,enrichments,notifications}=setup();
  try {
    const unused=pages.create('default',{title:'Untitled'});
    enrichments.save('default',unused.id,'title',{title:'Unapplied legacy result'},unused.revision,selection);
    assert.equal(notifications.list().unreadCount,0);
    let page=pages.create('default',{title:'Untitled'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',content:[{text:'A useful note with enough content for title generation.'}]}]});
    const coordinator=new PageEnrichment(store,pages,new Knowledge(store),enrichments,enrichmentProvider(async()=>({title:'A generated title'})));
    await coordinator.run('default',page,undefined,{explicit:true,fields:['title']});
    page=pages.get('default',page.id);
    assert.equal(page.title,'A generated title');
    let queue=notifications.list(); assert.equal(queue.unreadCount,1);
    assert.equal(notificationMessage(queue.items[0]),'Added title to A generated title');
    pages.update('default',page.id,{...page}); assert.equal(notifications.list().unreadCount,1);
    page=pages.get('default',page.id);
    enrichments.save('default',page.id,'summary',{summary:'Private generated output'},page.revision,selection);
    enrichments.save('default',page.id,'entity_scan',{scan:{suggestions:[]}},page.revision,selection);
    queue=notifications.list(); assert.equal(queue.unreadCount,3);
    assert.deepEqual(queue.items.map(item=>item.action),['entity_scan','page_summary','page_title']);
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM ai_notifications').all()),/Private generated output|A generated title/);
    assert.throws(()=>enrichments.save('default',page.id,'summary',{summary:'stale'},page.revision-1,selection),error=>error.status===409);
    assert.equal(notifications.list().unreadCount,3);
    const manual=pages.create('default',{title:'Untitled'});
    enrichments.save('default',manual.id,'title',{title:'Unused result'},manual.revision,selection);
    pages.update('default',manual.id,{...manual,title:'My manual title'});
    assert.equal(notifications.list().unreadCount,3);
  } finally {db.close();}
});
test('unread state persists across restart and mark-all does not consume later arrivals',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-notifications-')),filename=path.join(dir,'db.sqlite');
  let state=setup(filename);
  try {
    state.notifications.record('default','welcome','page_summary');
    const snapshot=state.notifications.list(),first=snapshot.items[0].id;
    state.notifications.record('default','welcome','entity_scan');
    let queue=state.notifications.read({through:snapshot.through});
    assert.equal(queue.unreadCount,1);assert.ok(queue.items.find(item=>item.id===first).readAt);
    state.db.close();state=setup(filename);
    queue=state.notifications.list();assert.equal(queue.unreadCount,1);assert.ok(queue.items.find(item=>item.id===first).readAt);
    state.notifications.read({ids:[queue.items.find(item=>!item.readAt).id]});assert.equal(state.notifications.list().unreadCount,0);
    for(const body of [{},{through:-1},{through:1.5},{ids:[]},{ids:[42]},{ids:['id'],through:1}]) assert.throws(()=>state.notifications.read(body),error=>error.status===400);
  } finally {state.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('locked vaults hide notifications and running jobs and cannot be marked read',()=>{
  const {db,pages,vaults,store,notifications}=setup();
  try {
    const vault=vaults.create({name:'Other'}),page=pages.create(vault.id,{title:'Private note'});
    notifications.record(vault.id,page.id,'page_summary');notifications.record('default','welcome','entity_scan');
    const hiddenId=notifications.list().items.find(item=>item.vaultId===vault.id).id;
    const log=new AIActivityLog(store);log.start('page_title',selection,vault.id,page.id);
    vaults.lock(vault.id,{passphrase:'test password'});
    let queue=notifications.list();assert.equal(queue.unreadCount,1);assert.equal(queue.running.length,0);
    notifications.read({ids:[hiddenId]});notifications.read({through:queue.through});
    vaults.unlock(vault.id,{passphrase:'test password'});
    queue=notifications.list();assert.equal(queue.unreadCount,1);assert.equal(queue.running.length,1);
    assert.equal(queue.items.find(item=>item.id===hiddenId).readAt,null);
  } finally {db.close();}
});
test('provider failures and interrupted attempts notify without noisy configuration failures or duplicate finish records',()=>{
  const {db,store,notifications}=setup();
  try {
    let log=new AIActivityLog(store);
    const missing=log.start('page_title',selection,'default','welcome');log.finish(missing,'failed',400);
    assert.equal(notifications.list().unreadCount,0);
    const id=log.start('page_summary',selection,'default','welcome');log.request(id,42,1);
    assert.equal(notifications.list().running.length,1);
    log.finish(id,'failed',502);log.finish(id,'failed',502);assert.equal(notifications.list().unreadCount,1);
    const interrupted=log.start('entity_scan',selection,'default','welcome');log.request(interrupted,42,1);
    log=new AIActivityLog(store);
    const queue=notifications.list();assert.equal(queue.unreadCount,2);assert.equal(queue.running.length,0);
    assert.equal(queue.items[0].status,'interrupted');
    const embedding=log.start('note_embedding',selection,'default','welcome');log.request(embedding,42,1);log.finish(embedding,'completed',200);
    assert.equal(notifications.list().unreadCount,2);
  } finally {db.close();}
});
test('Trash disables note links, restores availability, and permanent deletion removes references',()=>{
  const {db,pages,notifications}=setup();
  try {
    const page=pages.create('default',{title:'Disposable note'});
    notifications.record('default',page.id,'page_summary');
    assert.equal(notifications.list().items[0].available,true);
    pages.delete('default',page.id);assert.equal(notifications.list().items[0].available,false);
    pages.restore('default',page.id);assert.equal(notifications.list().items[0].available,true);
    pages.delete('default',page.id);pages.permanentlyDelete('default',page.id);
    assert.deepEqual(notifications.list().items,[]);assert.equal(notifications.list().unreadCount,0);
  } finally {db.close();}
});
test('notification retention keeps only the latest ten in chronological order, including read items',()=>{
  const {db,notifications}=setup();
  try {
    for(let i=0;i<15;i++)notifications.record('default','welcome','page_summary');
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_notifications').get().count,10);
    const queue=notifications.list();assert.equal(queue.items.length,10);assert.equal(queue.unreadCount,10);
    const expected=db.prepare('SELECT id FROM ai_notifications ORDER BY seq DESC').all().map(row=>row.id);
    assert.deepEqual(queue.items.map(item=>item.id),expected);
    const newest=queue.items[0].id;
    const read=notifications.read({ids:[newest]});
    assert.equal(read.items[0].id,newest);assert.ok(read.items[0].readAt);assert.equal(read.unreadCount,9);
    notifications.record('default','welcome','entity_scan');
    const next=notifications.list();
    assert.equal(next.items.length,10);assert.equal(next.items[0].action,'entity_scan');
    assert.equal(next.items.some(item=>item.id===queue.items.at(-1).id),false);
  } finally {db.close();}
});
test('listing clears notifications saved before the ten-item retention limit',()=>{
  const {db,notifications}=setup();
  try {
    const insert=db.prepare("INSERT INTO ai_notifications (id,vault_id,page_id,action,status,created_at) VALUES (?,'default','welcome','page_summary','completed',?)");
    for(let i=0;i<20;i++)insert.run('legacy-'+i,'2026-10-17T00:00:00.000Z');
    const queue=notifications.list();
    assert.deepEqual(queue.items.map(item=>item.id),Array.from({length:10},(_,i)=>'legacy-'+(19-i)));
    assert.equal(queue.unreadCount,10);
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_notifications').get().count,10);
  } finally {db.close();}
});
test('notification endpoints require the Noema client for writes and block cross-origin access',async()=>{
  const {db,store,notifications}=setup();notifications.record('default','welcome','page_summary');
  const server=createApp(store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port+'/api/intelligence/notifications';
  try {
    let response=await fetch(url);assert.equal(response.status,403);
    response=await fetch(url,{headers:{'X-Noema-Request':'1'}});assert.equal(response.status,200);const queue=await response.json();
    response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({through:queue.through})});assert.equal(response.status,403);
    response=await fetch(url,{headers:{Origin:'https://example.com'}});assert.equal(response.status,403);
    response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','X-Noema-Request':'1'},body:JSON.stringify({through:queue.through})});assert.equal(response.status,200);assert.equal((await response.json()).unreadCount,0);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
test('notification copy distinguishes saved results, failures, and running work',()=>{
  assert.equal(notificationMessage({action:'page_summary',status:'completed',pageTitle:'Earthsea'}),'Added summary to Earthsea');
  assert.equal(notificationMessage({action:'page_title',status:'failed',pageTitle:'Earthsea'}),'Title generation failed for Earthsea');
  assert.equal(runningMessage({action:'entity_scan',pageTitle:'Earthsea'}),'Scanning entities in Earthsea');
});

test('AI explanations appear in running activity and notify on provider failures or interruption',()=>{
 const {db,store,notifications}=setup();try{
  let log=new AIActivityLog(store);
  const id=log.start('block_explanation',selection,'default','welcome');log.request(id,123,1);
  const running=notifications.list().running;assert.equal(running.length,1);assert.equal(running[0].action,'block_explanation');assert.match(runningMessage(running[0]),/^Explaining blocks in /);
  log.finish(id,'failed',502);log.finish(id,'failed',502);
  let queue=notifications.list();assert.equal(queue.running.length,0);assert.equal(queue.items.length,1);assert.equal(queue.items[0].action,'block_explanation');assert.match(notificationMessage(queue.items[0]),/^AI explanation failed for /);
  const interrupted=log.start('block_explanation',selection,'default','welcome');log.request(interrupted,42,1);log=new AIActivityLog(store);
  queue=notifications.list();assert.equal(queue.items.length,2);assert.equal(queue.items[0].status,'interrupted');assert.match(notificationMessage(queue.items[0]),/^AI explanation interrupted for /);
  assert.equal(log.list(null).items[0].action,'block_explanation');assert.equal(log.list(null).items[0].status,'interrupted');
  notifications.record('default','welcome','block_explanation');queue=notifications.list();assert.match(notificationMessage(queue.items[0]),/^Generated AI explanation for /);
 }finally{db.close();}
});
