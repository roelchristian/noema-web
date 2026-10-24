import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {TextSearch} from '../src/server/modules/text-search.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {embeddingModel,embeddingDimensions} from '../src/shared/embeddings.ts';
import {createApp} from '../src/server/http.ts';

const fails=(work,status)=>assert.throws(work,error=>error.status===status);
test('manual archive preserves knowledge and organization; active retrieval and stale writes reject it',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),org=new Organizer(store),search=new TextSearch(store,new Vaults(store));
  let page=pages.create('default',{title:'Synthetic archival calculus'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'synthetic',type:'paragraph',checked:false,content:[{text:'Durable synthetic calculus evidence for historical reference and retained embeddings.'}]}]});
  const entity=knowledge.create('default',{name:'Synthetic thinker',type:'person'});
  knowledge.associatePage('default',entity.id,page.id,{pinned:true,annotation:'Synthetic association'});
  const folder=org.saveFolder('default',{name:'Synthetic folder'}).folders[0];
  const collection=org.saveCollection('default',{name:'Synthetic collection'}).collections[0];
  org.locate('default',{kind:'page',item_id:page.id,folder_id:folder.id});org.membership('default',{kind:'page',item_id:page.id,collection_id:collection.id});org.favourite('default',{kind:'page',item_id:page.id,favourite:true});
  const link=pages.create('default',{title:'Synthetic linking note'});
  pages.update('default',link.id,{...link,blocks:[{id:'link',type:'paragraph',checked:false,content:[{text:'[[Synthetic archival calculus]]'}]}]});
  new PageSegments(store).synchronize('default');
  const segment=store.get('SELECT * FROM page_segments WHERE page_id=?',page.id),vector=Array(embeddingDimensions).fill(0);vector[0]=1;
  new PageSegmentIndex(store).save(segment,vector,1);
  const vectorsBefore=store.all('SELECT * FROM page_segment_embeddings');
  const versionsBefore=store.all('SELECT * FROM page_versions WHERE page_id=?',page.id);
  assert.ok(search.search('default','calculus').results.some(item=>item.id===page.id));
  fails(()=>pages.setArchived('default',page.id,true,{revision:page.revision-1}),409);
  const archived=pages.setArchived('default',page.id,true,{revision:page.revision});
  assert.ok(archived.archived_at);assert.equal(archived.updated_at,page.updated_at);assert.equal(archived.revision,page.revision+1);assert.deepEqual(archived.blocks,page.blocks);
  assert.equal(pages.setArchived('default',page.id,true,{revision:page.revision}).revision,archived.revision);
  assert.ok(!pages.list('default').some(item=>item.id===page.id));
  assert.equal(pages.archiveList('default')[0].folderId,folder.id);assert.deepEqual(pages.archiveList('default')[0].collectionIds,[collection.id]);
  assert.deepEqual(org.list('default').favourites,[]);assert.deepEqual(org.list('default').locations,[]);assert.deepEqual(org.list('default').memberships,[]);
  fails(()=>pages.update('default',page.id,page),409);fails(()=>pages.delete('default',page.id),409);
  assert.ok(!search.search('default','calculus').results.some(item=>item.id===page.id));
  assert.ok(search.search('default','calculus',100,{all:true,includeArchived:true}).results.some(item=>item.id===page.id&&item.archived_at));
  assert.ok(!search.searchPassages('default','calculus').some(item=>item.id===page.id));
  assert.equal(pages.backlinks('default',page.id)[0].id,link.id);
  assert.deepEqual(store.all('SELECT * FROM page_versions WHERE page_id=?',page.id),versionsBefore);
  assert.deepEqual(store.all('SELECT * FROM page_segment_embeddings'),vectorsBefore);
  org.remove('default','folders',folder.id);
  fails(()=>pages.setArchived('default',page.id,false,{revision:page.revision}),409);
  const restored=pages.setArchived('default',page.id,false,{revision:archived.revision});
  assert.equal(restored.archived_at,null);assert.equal(restored.updated_at,page.updated_at);
  fails(()=>pages.update('default',page.id,page),409);
  assert.equal(org.list('default').locations[0].folder_id,null);assert.equal(org.list('default').memberships[0].collection_id,collection.id);assert.equal(org.list('default').favourites[0].item_id,page.id);
  new PageSegments(store).synchronize('default');
  assert.equal(store.get('SELECT count(*) AS n FROM page_segment_embeddings WHERE model=?',embeddingModel).n,vectorsBefore.length);
 }finally{db.close();}
});

test('archive HTTP route is guarded, idempotent and direct links stay readable',async()=>{
 const db=openDatabase(':memory:'),store=new Store(db);
 const {Intelligence}=await import('../src/server/modules/intelligence.ts');
 const ai=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls forbidden in archive fixture');});
 const app=createApp(store,'/tmp',ai);
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}/api`;
 async function request(path,method='GET',body){const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-noema-request':'1','x-vault-id':'default'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 try {
  const created=await request('/pages','POST',{title:'Synthetic HTTP archive'});assert.equal(created.status,201);
  const page=created.body;
  const archived=await request(`/pages/${page.id}/archive`,'PUT',{revision:page.revision});assert.equal(archived.status,200);
  assert.equal((await request(`/pages/${page.id}`)).body.archived_at,archived.body.archived_at);
  assert.equal((await request(`/pages/${page.id}`,'PUT',page)).status,409);
  assert.equal((await request(`/pages/${page.id}`,'DELETE')).status,409);
  assert.equal((await request('/pages/archive')).body.length,1);
  assert.equal((await request(`/pages/${page.id}/archive`,'DELETE',{revision:archived.body.revision})).status,200);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));db.close();}
});
