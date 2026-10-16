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
const selection={model:'test',reasoningEffort:'low'};
function setup(filename=':memory:') {
  const db=openDatabase(filename),store=new Store(db),pages=new Pages(store,new Knowledge(store));
  return {db,store,pages,notifications:new AINotifications(store),enrichments:new AIEnrichments(store,pages),vaults:new Vaults(store)};
}
test('saved enrichments notify regardless of producer; titles notify only when actually applied',()=>{
  const {db,pages,enrichments,notifications}=setup();
  try {
    let page=pages.create('default',{title:'Untitled'});
    enrichments.save('default',page.id,'title',{title:'A generated title'},page.revision,selection);
    assert.equal(notifications.list().unreadCount,0);
    page=pages.update('default',page.id,{...page,title:'A generated title'});
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
test('notification retention is bounded and returns latest unread items first',()=>{
  const {db,notifications}=setup();
  try {
    for(let i=0;i<1005;i++)notifications.record('default','welcome','page_summary');
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_notifications').get().count,1000);
    const queue=notifications.list();assert.equal(queue.items.length,100);assert.equal(queue.unreadCount,1000);
    const id=queue.items[0].id;notifications.read({ids:[id]});
    assert.equal(notifications.list().items.every(item=>item.readAt===null),true);
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
