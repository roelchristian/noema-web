import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {PageHistory,planHistoryRetention} from '../src/server/modules/page-history.ts';
import {Pages} from '../src/server/modules/pages.ts';
const block=(text,id='stable-block')=>({id,type:'paragraph',checked:false,content:[{text}]});
function fixture(run){const dir=mkdtempSync(join(tmpdir(),'noema-durable-history-'));const db=openDatabase(join(dir,'fixture.sqlite'));const store=new Store(db),pages=new Pages(store,new Knowledge(store));try{return run({db,store,pages,dir});}finally{db.close();rmSync(dir,{recursive:true,force:true});}}
const versions=(store,id)=>store.all('SELECT * FROM page_versions WHERE page_id=? ORDER BY rowid',id);

test('durable history captures canonical committed states and deduplicates revision-only saves',()=>fixture(({pages,store})=>{
 let page=pages.create('default',{title:'Synthetic initial',language:'en'});
 const first=versions(store,page.id);assert.equal(first.length,1);assert.equal(first[0].kind,'created');
 const initial=JSON.parse(first[0].snapshot_json);assert.equal(initial.title,'Synthetic initial');assert.equal(initial.language,'en');assert.equal(initial.creationMethod,'manual_creation');assert.equal('summaryContentHash' in initial,false);assert.equal('enrichmentPending' in initial,false);
 page=pages.update('default',page.id,{...page,blocks:[block('First authored paragraph')]});
 assert.equal(versions(store,page.id).length,2);
 const revision=page.revision;page=pages.update('default',page.id,page);assert.ok(page.revision>revision);assert.equal(versions(store,page.id).length,2,'save counter is independent of durable history');
 assert.throws(()=>pages.update('default',page.id,{...page,revision,blocks:[block('stale')]}),error=>error.status===409);
 assert.equal(versions(store,page.id).length,2);
 const last=JSON.parse(versions(store,page.id).at(-1).snapshot_json);assert.deepEqual(last.blocks,[block('First authored paragraph')]);
}));

test('required history failure rolls back the entire authored page transaction',()=>fixture(({pages,store,db})=>{
 let page=pages.create('default',{title:'Before failure'});page=pages.update('default',page.id,{...page,blocks:[block('Committed')]});
 const before=store.get('SELECT * FROM pages WHERE id=?',page.id),count=versions(store,page.id).length;
 db.exec("CREATE TRIGGER synthetic_history_failure BEFORE INSERT ON page_versions BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END");
 assert.throws(()=>pages.update('default',page.id,{...page,title:'Must rollback',language:'fr',blocks:[block('Must rollback')]}),/synthetic history failure/);
 assert.deepEqual(store.get('SELECT * FROM pages WHERE id=?',page.id),before);assert.equal(versions(store,page.id).length,count);
 assert.equal(pages.get('default',page.id).enrichmentFields.language?.origin,undefined,'manual language provenance rolled back');
}));

test('migration never invents historical revisions for preexisting pages',()=>fixture(({pages,store})=>{
 const id='synthetic-preexisting';store.run('INSERT INTO pages (id,title,blocks,updated_at,created_at,vault_id,revision) VALUES (?,?,?,?,?,?,?)',id,'Legacy',JSON.stringify([block('Already existed')]),'2020-01-01','2020-01-01','default',87);
 assert.equal(versions(store,id).length,0);const page=pages.get('default',id);assert.equal(versions(store,id).length,0);
 pages.update('default',id,{...page,blocks:[block('First tracked change')]});
 const history=versions(store,id);assert.equal(history.length,2);assert.equal(history[0].kind,'baseline');assert.equal(history[0].page_revision,87);assert.ok(Date.parse(history[0].created_at)>Date.parse('2026-01-01'));assert.equal(history[1].page_revision,88);
}));


test('restore appends evidence, preserves future states, rejects stale writes and is reversible',()=>fixture(({pages,store})=>{
 const history=new PageHistory(store);let page=pages.create('default',{title:'Initial'});
 page=pages.update('default',page.id,{...page,blocks:[block('State A')]});const a=history.list('default',page.id)[0];
 page=pages.update('default',page.id,{...page,title:'State B',blocks:[block('State B')]});const b=history.list('default',page.id)[0],before=page.revision;
 assert.throws(()=>history.restore('default',page.id,a.id,{revision:before-1},pages),error=>error.status===409);
 const checkpoint=history.checkpoint('default',page.id,{revision:before,name:'Preserve B'});assert.equal(checkpoint.pinned,true);
 page=history.restore('default',page.id,a.id,{revision:before},pages);assert.ok(page.revision>before);assert.equal(page.blocks[0].content[0].text,'State A');
 const event=history.list('default',page.id)[0];assert.equal(event.kind,'restore');assert.equal(event.pinned,true);assert.equal(event.restoredFromVersionId,a.id);assert.ok(history.list('default',page.id).some(v=>v.id===b.id));
 page=history.restore('default',page.id,b.id,{revision:page.revision},pages);assert.equal(page.title,'State B');assert.equal(page.blocks[0].content[0].text,'State B');
 const clone=history.copy('default',page.id,a.id,{revision:page.revision},pages);assert.notEqual(clone.id,page.id);assert.equal(clone.blocks[0].id,'stable-block');assert.equal(clone.creationMethod,page.creationMethod);
}));

test('history reads are side effect free and vault/page/version scope and locks are enforced',()=>fixture(({pages,store})=>{
 const history=new PageHistory(store);let page=pages.create('default',{title:'Scope'}),other=pages.create('default',{title:'Other'});const version=history.list('default',page.id)[0];
 const before=store.db.prepare('SELECT total_changes() AS count').get().count;history.list('default',page.id);history.get('default',page.id,version.id);assert.equal(store.db.prepare('SELECT total_changes() AS count').get().count,before);
 assert.throws(()=>history.get('other-vault',page.id,version.id),e=>e.status===404);assert.throws(()=>history.get('default',other.id,version.id),e=>e.status===404);
 page=pages.setEditLock('default',page.id,{revision:page.revision,locked:true});assert.equal(history.get('default',page.id,version.id).id,version.id);assert.throws(()=>history.restore('default',page.id,version.id,{revision:page.revision},pages),e=>e.status===423);
 page=pages.setEditLock('default',page.id,{revision:page.revision,locked:false});pages.delete('default',page.id);assert.ok(history.list('default',page.id).length);assert.throws(()=>history.restore('default',page.id,version.id,{revision:page.revision+1},pages),e=>e.status===409);
}));

test('failed restoration capture leaves pre-restore state and history intact',()=>fixture(({pages,store,db})=>{
 const history=new PageHistory(store);let page=pages.create('default',{title:'Earlier'});const earlier=history.list('default',page.id)[0];page=pages.update('default',page.id,{...page,title:'Present',blocks:[block('Present')]});
 const before=store.get('SELECT * FROM pages WHERE id=?',page.id),count=history.list('default',page.id).length;
 db.exec("CREATE TRIGGER synthetic_restore_failure BEFORE INSERT ON page_versions WHEN NEW.kind='restore' BEGIN SELECT RAISE(ABORT,'synthetic restore capture failure'); END");
 assert.throws(()=>history.restore('default',page.id,earlier.id,{revision:page.revision},pages),/synthetic restore capture failure/);assert.deepEqual(store.get('SELECT * FROM pages WHERE id=?',page.id),before);assert.equal(history.list('default',page.id).length,count);
}));


test('retention is a disabled pure preview retaining latest buckets and permanent restoration evidence',()=>{
 const clock=Date.parse('2026-10-23T12:00:00Z');const make=(id,at,extra={})=>({id,pageId:'synthetic',pageRevision:Number(id.replace(/\D/g,''))||1,createdAt:at,kind:'edit',name:null,pinned:false,contentHash:id,restoredFromVersionId:null,...extra});
 const input=[make('recent','2026-10-22T12:00:00Z'),make('old1','2026-10-01T10:01:00Z'),make('old2','2026-10-01T10:10:00Z'),make('daily1','2026-09-01T01:00:00Z'),make('daily2','2026-09-01T20:00:00Z'),make('weekly1','2026-01-06T01:00:00Z'),make('weekly2','2026-01-07T20:00:00Z'),make('checkpoint','2025-01-01T00:00:00Z',{kind:'checkpoint',name:'Keep'}),make('source','2025-02-01T00:00:00Z'),make('source-newer','2025-02-01T01:00:00Z'),make('before','2025-03-01T01:00:00Z'),make('restore','2025-03-01T02:00:00Z',{kind:'restore',restoredFromVersionId:'source'}),make('pinned','2025-04-01T01:00:00Z',{pinned:true})];
 const original=structuredClone(input),plan=planHistoryRetention(input,clock);assert.equal(plan.enabled,false);assert.deepEqual(input,original);
 for(const id of ['recent','old2','daily2','weekly2','checkpoint','source','before','restore','pinned'])assert.ok(plan.keepIds.includes(id),id);
 for(const id of ['old1','daily1','weekly1'])assert.ok(plan.candidateIds.includes(id),id);
});
