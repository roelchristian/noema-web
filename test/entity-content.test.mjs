import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server/http.ts';
import {gunzipSync,gzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {EntityLifecycle} from '../src/server/modules/entity-lifecycle.ts';
const fail=(fn,status)=>assert.throws(fn,error=>error.status===status);
function fixture(t){
 const directory=mkdtempSync(path.join(tmpdir(),'noema-entity-content-')),filename=path.join(directory,'noema.sqlite');
 const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),vaults=new Vaults(store),backups=new VaultBackups(store);
 const vault=vaults.create({name:'Entity curation'}),entity=knowledge.create(vault.id,{name:'Ada',type:'person'}),page=pages.create(vault.id,{title:'Research'});
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 return {db,store,knowledge,pages,vaults,backups,vault,entity,page,filename};
}
test('entity curation persists independently of mentions and survives archive, trash and database reopen',async t=>{
 const f=fixture(t),{vault,entity,page,knowledge,pages,store}=f;
 assert.deepEqual(knowledge.detail(vault.id,entity.id).overview,{content:'',revision:0});
 const initialTimestamp=knowledge.detail(vault.id,entity.id).updated_at;
 const overview=knowledge.saveOverview(vault.id,entity.id,{content:'# Ada\n\nAuthored synthesis.',revision:0});
 assert.equal(overview.overview.revision,1);assert.ok(overview.updated_at>initialTimestamp);
 assert.deepEqual(knowledge.saveOverview(vault.id,entity.id,{content:overview.overview.content,revision:1}).overview,overview.overview);
 fail(()=>knowledge.saveOverview(vault.id,entity.id,{content:'stale',revision:0}),409);
 knowledge.associatePage(vault.id,entity.id,page.id,{pinned:true,annotation:'Start here'});
 const created=knowledge.detail(vault.id,entity.id).linkedPages[0].created_at;
 knowledge.associatePage(vault.id,entity.id,page.id,{pinned:false});
 const unchanged=knowledge.detail(vault.id,entity.id).updated_at;
 knowledge.associatePage(vault.id,entity.id,page.id,{});
 assert.equal(knowledge.detail(vault.id,entity.id).updated_at,unchanged);
 let detail=knowledge.detail(vault.id,entity.id);
 assert.equal(detail.pageMentions.length,0);assert.equal(detail.linkedPages.length,1);
 assert.equal(detail.linkedPages[0].annotation,'Start here');assert.equal(detail.linkedPages[0].pinned,false);assert.equal(detail.linkedPages[0].created_at,created);
 assert.deepEqual(knowledge.pageAssociations(vault.id,page.id),[{entityId:entity.id,pinned:false,annotation:'Start here'}]);
 const lifecycle=new EntityLifecycle(store),before=lifecycle.preview(vault.id,entity.id);
 assert.equal(before.counts.activePages,1);assert.equal(before.counts.blockReferences,0);
 knowledge.associatePage(vault.id,entity.id,page.id,{annotation:'Updated'});
 fail(()=>lifecycle.change(vault.id,entity.id,false,before.version),409);
 const fresh=lifecycle.preview(vault.id,entity.id);lifecycle.change(vault.id,entity.id,false,fresh.version);
 assert.equal(knowledge.detail(vault.id,entity.id).linkedPages.length,1);
 pages.delete(vault.id,page.id);assert.equal(knowledge.detail(vault.id,entity.id).linkedPages.length,0);
 assert.equal(lifecycle.preview(vault.id,entity.id).counts.trashedPages,1);
 pages.restore(vault.id,page.id);assert.equal(knowledge.detail(vault.id,entity.id).linkedPages[0].annotation,'Updated');
 const reopened=openDatabase(f.filename);try{const saved=new Knowledge(new Store(reopened)).detail(vault.id,entity.id);assert.equal(saved.overview.content,overview.overview.content);assert.equal(saved.linkedPages.length,1);}finally{reopened.close();}
 pages.delete(vault.id,page.id);pages.permanentlyDelete(vault.id,page.id);
 assert.equal(store.all('SELECT * FROM entity_page_associations WHERE entity_id=?',entity.id).length,0);
 store.run('DELETE FROM entities WHERE id=?',entity.id);assert.equal(store.get('SELECT 1 FROM entity_overviews WHERE entity_id=?',entity.id),undefined);
});
test('curation validates vault, live pages, source type, fields and atomic page creation',t=>{
 const {knowledge,pages,vaults,store,vault,entity,page}=fixture(t),other=vaults.create({name:'Other'}),foreign=pages.create(other.id,{title:'Elsewhere'});
 fail(()=>knowledge.associatePage(vault.id,entity.id,foreign.id,{}),404);
 fail(()=>knowledge.associatePage(other.id,entity.id,foreign.id,{}),404);
 fail(()=>knowledge.associatePage(vault.id,entity.id,page.id,{pinned:1}),400);
 fail(()=>knowledge.associatePage(vault.id,entity.id,page.id,{annotation:'x'.repeat(2001)}),400);
 fail(()=>knowledge.saveOverview(vault.id,entity.id,{revision:0}),400);
 fail(()=>knowledge.saveOverview(vault.id,entity.id,{content:'x'.repeat(100001),revision:0}),400);
 fail(()=>knowledge.saveOverview(vault.id,entity.id,{content:'ok',revision:-1}),400);
 store.run("UPDATE entities SET type='source' WHERE id=?",entity.id);
 fail(()=>knowledge.associatePage(vault.id,entity.id,page.id,{}),400);
 fail(()=>knowledge.saveOverview(vault.id,entity.id,{content:'ok',revision:0}),400);
 store.run("UPDATE entities SET type='person' WHERE id=?",entity.id);
 vaults.lock(vault.id,{passphrase:'test-only'});
 fail(()=>knowledge.pageAssociations(vault.id,page.id),423);fail(()=>knowledge.saveOverview(vault.id,entity.id,{content:'ok',revision:0}),423);
 vaults.unlock(vault.id,{passphrase:'test-only'});
 const created=knowledge.createPage(vault.id,entity.id,{},pages);assert.equal(created.title,'Untitled');assert.equal(knowledge.pageAssociations(vault.id,created.id)[0].entityId,entity.id);
 const count=pages.list(vault.id).length;
 store.db.exec("CREATE TRIGGER reject_curated_page BEFORE INSERT ON entity_page_associations BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>knowledge.createPage(vault.id,entity.id,{title:'Rollback'},pages));assert.equal(pages.list(vault.id).length,count);
 store.db.exec('DROP TRIGGER reject_curated_page');
 pages.delete(vault.id,page.id);fail(()=>knowledge.associatePage(vault.id,entity.id,page.id,{}),404);
});
test('backup remaps overview and page associations including trash, accepts older backups and rejects invalid references',async t=>{
 const {knowledge,pages,vaults,backups,vault,entity,page,store}=fixture(t);
 knowledge.saveOverview(vault.id,entity.id,{content:'**Curated** overview',revision:0});
 knowledge.associatePage(vault.id,entity.id,page.id,{pinned:true,annotation:'Primary note'});
 pages.delete(vault.id,page.id);
 const {bytes}=await backups.export(vault.id),restored=await backups.import(bytes);
 const restoredEntity=knowledge.list(restored.id)[0],restoredPage=store.get('SELECT id FROM pages WHERE vault_id=?',restored.id);
 assert.notEqual(restoredEntity.id,entity.id);assert.notEqual(restoredPage.id,page.id);
 assert.equal(knowledge.detail(restored.id,restoredEntity.id).overview.content,'**Curated** overview');
 assert.equal(knowledge.detail(restored.id,restoredEntity.id).linkedPages.length,0);
 pages.restore(restored.id,restoredPage.id);assert.equal(knowledge.detail(restored.id,restoredEntity.id).linkedPages[0].pinned,true);
 const older=JSON.parse(gunzipSync(bytes));delete older.tables.entity_overviews;delete older.tables.entity_page_associations;
 const oldVault=await backups.import(gzipSync(JSON.stringify(older)));assert.deepEqual(knowledge.detail(oldVault.id,knowledge.list(oldVault.id)[0].id).overview,{content:'',revision:0});
 const corrupt=JSON.parse(gunzipSync(bytes));corrupt.tables.entity_page_associations[0].page_id='foreign';
 const count=vaults.list().length;await assert.rejects(backups.import(gzipSync(JSON.stringify(corrupt))),error=>error.status===400);assert.equal(vaults.list().length,count);
});

test('HTTP entity curation routes persist content, create pages atomically and reject stale or cross-vault requests',async t=>{
 const f=fixture(t),{vault,entity,page,knowledge,vaults}=f,server=createApp(f.store,path.resolve('dist/client'));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port+'/api/';
 async function request(route,method='GET',body,status=200,vaultId=vault.id){
  const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-Id':vaultId},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }
 const route='entities/'+entity.id;
 const denied=await fetch(base+route+'/overview',{method:'PUT',headers:{'Content-Type':'application/json','X-Vault-Id':vault.id,Origin:'https://other.example'},body:JSON.stringify({content:'Blocked',revision:0})});assert.equal(denied.status,403);
 const saved=await request(route+'/overview','PUT',{content:'## Curated',revision:0});assert.equal(saved.overview.revision,1);assert.deepEqual((await request(route)).overview,saved.overview);
 await request(route+'/overview','PUT',{content:'Old',revision:0},409);
 const linked=await request(route+'/pages/'+page.id,'PUT',{pinned:true,annotation:'Read first'});assert.equal(linked.linkedPages[0].pinned,true);
 assert.deepEqual(await request('pages/'+page.id+'/entities'),[{entityId:entity.id,pinned:true,annotation:'Read first'}]);
 const other=vaults.create({name:'Other'});await request(route+'/pages/'+page.id,'PUT',{},404,other.id);
 const made=await request(route+'/pages','POST',{},201);assert.equal(made.title,'Untitled');assert.equal(knowledge.pageAssociations(vault.id,made.id)[0].entityId,entity.id);
 await request(route+'/pages/'+page.id,'DELETE');assert.deepEqual(await request('pages/'+page.id+'/entities'),[]);
 vaults.lock(vault.id,{passphrase:'synthetic'});await request(route+'/overview','PUT',{content:'Blocked',revision:1},423);
});

test('homepage detail preview bounds server projections and gives builtin properties priority',t=>{
 const {knowledge,pages,store,vault,entity}=fixture(t);
 for(let i=0;i<20;i++) {
  const page=pages.create(vault.id,{title:'Synthetic '+i});pages.update(vault.id,page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{entityId:entity.id},{text:' and '},{entityId:entity.id}]}]});
  knowledge.associatePage(vault.id,entity.id,page.id,{});
  store.run('INSERT INTO entity_type_properties (vault_id,type,name) VALUES (?,?,?)',vault.id,'person','AAA custom '+i);
  knowledge.property(vault.id,entity.id,{name:'AAA custom '+i,value:'Synthetic value'});
  const peer=knowledge.create(vault.id,{type:'concept',name:'Synthetic peer '+i});knowledge.relationship(vault.id,entity.id,{target_id:peer.id,label:'knows'});
 }
 knowledge.property(vault.id,entity.id,{name:'birth date',value:'1843-01-01'});
 const before=store.get('SELECT total_changes() AS n').n;
 const preview=knowledge.detail(vault.id,entity.id,true),full=knowledge.detail(vault.id,entity.id);
 assert.equal(preview.previewLimited,true);assert.equal(preview.properties[0].name,'birth date');assert.equal(preview.properties.length,12);assert.equal(preview.relationships.length,12);assert.equal(preview.linkedPages.length,12);assert.equal(preview.pageMentions.length,6);
 assert.equal(preview.pageMentions[0].contexts[0].occurrences.length,1);assert.equal(full.pageMentions.length,20);assert.equal(full.pageMentions[0].contexts[0].occurrences.length,2);assert.equal(full.properties.length,21);
 assert.equal(store.get('SELECT total_changes() AS n').n,before);
});
