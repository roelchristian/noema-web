import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {SemanticCollections,semanticVector} from '../src/server/modules/semantic-collections.ts';
import {evaluateSemanticBatch} from '../src/server/modules/smart-semantic-scoring.ts';
import {parseSemanticCollection} from '../src/shared/smart-collections.ts';
import {embeddingModel,embeddingDimensions} from '../src/shared/embeddings.ts';

const config=patch=>({version:1,description:'Substantial discussion of algebra',threshold:.55,minCoverage:.5,...patch});
const vector=(score=1)=>Array.from({length:embeddingDimensions},(_,index)=>index===0?score:index===1?Math.sqrt(1-score*score):0);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const fails=(work,status)=>assert.throws(work,error=>error.status===status);
function fixture(t){
 const db=openDatabase(':memory:'),store=new Store(db),org=new Organizer(store),vaults=new Vaults(store),vault=vaults.create({name:'Synthetic semantic vault'}).id,semantic=new SemanticCollections(store);
 t.after(()=>db.close());
 function page(id,scores=[1],options={}){
  store.run("INSERT INTO pages(id,title,blocks,updated_at,created_at,vault_id,revision) VALUES(?,?,'[]','2026-10-23','2026-10-23',?,1)",id,id,vault);
  const projection='projection-'+id;
  store.run("INSERT INTO page_index_state(page_id,vault_id,revision,projection_hash,strategy,policy_hash,token_count,updated_at,body_characters) VALUES(?,?,1,?,'passages','synthetic-policy',?,'2026-10-23',?)",id,vault,projection,scores.length*100,scores.length*100);
  store.run('DELETE FROM page_index_dirty WHERE page_id=?',id);
  for(const [index,score] of scores.entries()){
   const segment=id+'-segment-'+index,hash='hash-'+segment,start=options.overlap?index*10:index*100,end=start+100;
   store.run("INSERT INTO page_segments VALUES(?,?,?,1,?,?,?,'Synthetic passage evidence','Synthetic input',?,'[]',?,?,100)",segment,id,vault,projection,index,'Section '+index,hash,start,end);
   if(score!==null)store.run('INSERT INTO page_segment_embeddings VALUES(?,?,?,?,?,100,?)',segment,embeddingModel,embeddingDimensions,hash,JSON.stringify(vector(score)),'2026-10-23');
  }
  return id;
 }
 const score=(id,patch={},collection)=>evaluateSemanticBatch(store,vault,config(patch),vector(),'',100,[id],collection).items[0];
 const settle=async id=>{for(let index=0;index<100;index++){org.list(vault);await new Promise(resolve=>setTimeout(resolve,10));const collection=org.list(vault).collections.find(item=>item.id===id);if(['ready','partial','error'].includes(collection?.smart?.status))return collection;}throw Error('Semantic collection did not settle');};
 return {db,store,org,vaults,vault,semantic,page,score,settle};
}

test('semantic definitions and vectors reject malformed models, nonfinite values, oversized inputs and unsafe thresholds',()=>{
 for(const value of [null,{},config({version:2}),config({description:''}),config({description:'x'.repeat(2001)}),config({threshold:NaN}),config({threshold:.99}),config({minCoverage:0}),{...config(),sql:'SELECT *'}])assert.throws(()=>parseSemanticCollection(value));
 for(const value of [[],[1,0],vector().map(()=>0),vector().map(()=>Infinity),[...vector().slice(0,-1),null]])fails(()=>semanticVector(value),400);
 assert.deepEqual(parseSemanticCollection({version:1,description:' scope '}),config({description:'scope'}));assert.equal(semanticVector(vector()).length,embeddingDimensions);
});

test('document relevance and multiple supporting passages reject incidental matches; overlapping text is counted once',t=>{
 const f=fixture(t),substantial=f.page('substantial',[.8,.9,.7]),incidental=f.page('incidental',[1,0,0,0]),single=f.page('short',[.9]),overlap=f.page('overlap',[.9,0,0],{overlap:true});
 assert.equal(f.score(substantial).matched,true);assert.equal(f.score(incidental).matched,false);assert.equal(f.score(single).matched,true);assert.equal(f.score(overlap).matched,false);
 const result=f.score(substantial);assert.equal(result.state,'evaluated');assert.ok(result.evidence.some(item=>item.includes('3 of 3')));assert.ok(result.evidence.some(item=>item.includes('Synthetic passage evidence')));assert.ok(result.score>.7);
});

test('indexing gaps, partial embeddings, stale revisions, invalid vectors, model/dimension mismatches and failures stay distinct',t=>{
 const f=fixture(t),missing=f.page('missing',[null]),partial=f.page('partial',[.9,null]),dirty=f.page('dirty',[.9]),revision=f.page('revision',[.9]),invalid=f.page('invalid',[.9]),model=f.page('model',[.9]),dimensions=f.page('dimensions',[.9]),failed=f.page('failed',[.9]);
 f.store.run("INSERT INTO page_index_dirty(page_id,vault_id) VALUES(?,?)",dirty,f.vault);f.store.run('UPDATE page_index_state SET revision=0 WHERE page_id=?',revision);f.store.run("UPDATE page_segment_embeddings SET vector='[1,2]' WHERE segment_id=?",invalid+'-segment-0');f.store.run('UPDATE page_segment_embeddings SET model=? WHERE segment_id=?','obsolete-model',model+'-segment-0');f.store.run('UPDATE page_segment_embeddings SET dimensions=2 WHERE segment_id=?',dimensions+'-segment-0');f.store.run("UPDATE page_index_state SET error='Synthetic failure' WHERE page_id=?",failed);
 for(const id of [missing,partial,model,dimensions])assert.equal(f.score(id).state,'missing');for(const id of [dirty,revision])assert.equal(f.score(id).state,'stale');for(const id of [invalid,failed])assert.equal(f.score(id).state,'error');
 assert.ok(f.score(partial).evidence.some(item=>item.includes('1 of 2')));for(const id of [missing,partial,dirty,revision,invalid,model,dimensions,failed])assert.equal(f.score(id).matched,false);
});

test('semantic fingerprints change with saved vector content, index revision and query criteria; cache cannot hide vector changes',t=>{
 const f=fixture(t),page=f.page('fingerprint',[.9]),first=f.score(page);f.store.run('UPDATE page_segment_embeddings SET vector=? WHERE segment_id=?',JSON.stringify(vector(.1)),page+'-segment-0');const second=f.score(page);assert.notEqual(first.fingerprint,second.fingerprint);assert.equal(second.matched,false);assert.notEqual(second.fingerprint,f.score(page,{threshold:.6}).fingerprint);
});

test('description embedding evaluation is explicit, deduplicated and vault-bound; previews never call providers',async t=>{
 const f=fixture(t);f.page('local',[.9]);let calls=0;f.semantic.setProvider(async(vault,description)=>{calls++;assert.equal(vault,f.vault);assert.equal(description,config().description);return {embedding:vector(),tokens:2};});
 fails(()=>f.semantic.preview(f.vault,{semantic:config()}),409);assert.equal(calls,0);const [first,second]=await Promise.all([f.semantic.evaluateDescription(f.vault,{semantic:config()}),f.semantic.evaluateDescription(f.vault,{semantic:config()})]);assert.equal(calls,1);assert.equal(first.preview.matched,1);
 const preview=f.semantic.preview(f.vault,{semantic:config({threshold:.6}),evaluationToken:first.evaluationToken});assert.equal(preview.matched,1);assert.equal(calls,1);await f.semantic.evaluateDescription(f.vault,{semantic:config()});assert.equal(calls,1);
 const other=f.vaults.create({name:'Other synthetic vault'}).id;fails(()=>f.semantic.preview(other,{semantic:config(),evaluationToken:first.evaluationToken}),409);fails(()=>f.semantic.preview(f.vault,{semantic:config({description:'Different'}),evaluationToken:second.evaluationToken}),409);
});

test('a provider response after locking is discarded and does not persist a reusable evaluation token',async t=>{
 const f=fixture(t),wait=deferred();f.semantic.setProvider(()=>wait.promise);const pending=f.semantic.evaluateDescription(f.vault,{semantic:config()});f.vaults.lock(f.vault,{passphrase:'synthetic'});wait.resolve({embedding:vector(),tokens:1});await assert.rejects(pending,error=>error.status===423);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_queries WHERE vault_id=?',f.vault).n,0);
});

test('hysteresis retains a prior semantic match near the entry threshold and later removes a clear nonmatch',t=>{
 const f=fixture(t),page=f.page('hysteresis',[.53]);f.store.run('INSERT INTO collections VALUES(?,?,?)','hysteresis-collection',f.vault,'Synthetic hysteresis');
 assert.equal(f.score(page).matched,false);
 f.store.run("INSERT INTO smart_collection_cache(vault_id,collection_id,item_id,matched,evidence_json,revision,state,score,fingerprint) VALUES(?,?,?,1,'[]',0,'evaluated',.7,'old-fingerprint')",f.vault,'hysteresis-collection',page);
 const retained=f.score(page,{},'hysteresis-collection');assert.equal(retained.matched,true);assert.ok(retained.evidence.some(item=>item.includes('avoid membership flicker')));
 f.store.run('UPDATE page_segment_embeddings SET vector=? WHERE segment_id=?',JSON.stringify(vector(.4)),page+'-segment-0');assert.equal(f.score(page,{},'hysteresis-collection').matched,false);
});

test('saved semantic membership uses local refresh, preserves overrides and labels missing indexing as partial rather than empty',async t=>{
 const f=fixture(t),match=f.page('saved-match',[.9]),gap=f.page('saved-gap',[null]);let calls=0;f.org.smart.setQueryEmbeddingProvider(async()=>{calls++;return {embedding:vector(),tokens:1};});
 const evaluated=await f.org.smart.evaluateDescription(f.vault,{semantic:config()});f.org.saveCollection(f.vault,{name:'Saved semantic',kind:'smart',matching:'semantic',semantic:config(),evaluationToken:evaluated.evaluationToken});
 const id=f.org.list(f.vault).collections.find(item=>item.name==='Saved semantic').id,state=await f.settle(id);assert.equal(state.smart.status,'partial');assert.equal(state.smart.unevaluated,1);assert.equal(state.smart.matched,1);
 assert.equal(f.org.list(f.vault).memberships.find(item=>item.item_id===match).provenance,'semantic');
 f.org.membership(f.vault,{collection_id:id,kind:'page',item_id:match,remove:true});f.org.membership(f.vault,{collection_id:id,kind:'page',item_id:gap});
 f.org.smart.refresh(f.vault,id);await f.settle(id);let members=f.org.list(f.vault).memberships.filter(item=>item.collection_id===id);assert.deepEqual(members.map(item=>item.item_id),[gap]);assert.equal(members[0].provenance,'include');assert.equal(calls,1);
 f.org.saveCollection(f.vault,{name:'Renamed semantic',kind:'smart',matching:'semantic',semantic:config({threshold:.6})},id);await f.settle(id);assert.equal(calls,1);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_overrides WHERE collection_id=?',id).n,2);
});

test('semantic query expiry and incompatible model require explicit evaluation instead of silently issuing provider work',async t=>{
 const f=fixture(t);let calls=0;f.semantic.setProvider(async()=>{calls++;return {embedding:vector(),tokens:1};});const result=await f.semantic.evaluateDescription(f.vault,{semantic:config()});
 f.store.run('UPDATE smart_collection_queries SET expires_at=? WHERE token=?',Date.now()-1,result.evaluationToken);fails(()=>f.semantic.preview(f.vault,{semantic:config(),evaluationToken:result.evaluationToken}),409);assert.equal(calls,1);
 const next=await f.semantic.evaluateDescription(f.vault,{semantic:config()});f.store.run('UPDATE smart_collection_queries SET model=? WHERE token=?','obsolete',next.evaluationToken);fails(()=>f.semantic.preview(f.vault,{semantic:config(),evaluationToken:next.evaluationToken}),409);assert.equal(calls,2);
});

test('semantic scoring excludes foreign and trashed records and enforces bounded candidate/passage evaluation',t=>{
 const f=fixture(t),page=f.page('local',[.9]),trash=f.page('trashed',[.9]);f.store.run('UPDATE pages SET deleted_at=? WHERE id=?','2026-10-23',trash);
 const other=f.vaults.create({name:'Other'}).id;assert.equal(evaluateSemanticBatch(f.store,other,config(),vector(),'',100,[page]).items.length,0);assert.equal(evaluateSemanticBatch(f.store,f.vault,config(),vector(),'',100,[trash]).items.length,0);
 fails(()=>evaluateSemanticBatch(f.store,f.vault,config(),vector(),'',101),400);fails(()=>evaluateSemanticBatch(f.store,f.vault,config(),[1,0],'',100),400);
 const huge=f.page('too-many-passages',Array(513).fill(.9));assert.equal(f.score(huge).state,'error');assert.ok(f.score(huge).evidence.some(item=>item.includes('512')));
 f.vaults.lock(f.vault,{passphrase:'synthetic'});fails(()=>f.score(page),423);
});

test('lock then unlock invalidates pending description requests and previously issued draft tokens',async t=>{
 const f=fixture(t),wait=deferred();f.semantic.setProvider(()=>wait.promise);const pending=f.semantic.evaluateDescription(f.vault,{semantic:config()});f.vaults.lock(f.vault,{passphrase:'synthetic'});f.vaults.unlock(f.vault,{passphrase:'synthetic'});wait.resolve({embedding:vector(),tokens:1});await assert.rejects(pending,error=>error.status===409);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_queries WHERE vault_id=?',f.vault).n,0);
 f.semantic.setProvider(async()=>({embedding:vector(),tokens:1}));const response=await f.semantic.evaluateDescription(f.vault,{semantic:config()});f.vaults.lock(f.vault,{passphrase:'synthetic'});f.vaults.unlock(f.vault,{passphrase:'synthetic'});fails(()=>f.semantic.preview(f.vault,{semantic:config(),evaluationToken:response.evaluationToken}),409);
});

test('semantic backup restores definitions, saved query vector and overrides; caches rebuild and malformed input rolls back',async t=>{
 const f=fixture(t),page=f.page('backup-page',[.9]);f.org.smart.setQueryEmbeddingProvider(async()=>({embedding:vector(),tokens:1}));const response=await f.org.smart.evaluateDescription(f.vault,{semantic:config()});f.org.saveCollection(f.vault,{name:'Semantic backup',kind:'smart',matching:'semantic',semantic:config(),evaluationToken:response.evaluationToken});
 const id=f.org.list(f.vault).collections.find(item=>item.name==='Semantic backup').id;await f.settle(id);f.org.membership(f.vault,{kind:'page',item_id:page,collection_id:id,remove:true});
 const backups=new VaultBackups(f.store),exported=await backups.export(f.vault),archive=JSON.parse(gunzipSync(exported.bytes));assert.equal(archive.tables.smart_collection_queries,undefined);assert.equal(archive.tables.smart_collection_cache,undefined);
 const restored=await backups.import(exported.bytes,'Restored semantic fixture'),definition=f.store.get('SELECT * FROM smart_collection_definitions WHERE vault_id=?',restored.id),restoredPage=f.store.get('SELECT id FROM pages WHERE vault_id=?',restored.id),override=f.store.get('SELECT * FROM smart_collection_overrides WHERE vault_id=?',restored.id);
 assert.equal(definition.matching,'semantic');assert.deepEqual(JSON.parse(definition.semantic_json),config());assert.deepEqual(JSON.parse(definition.query_vector),vector());assert.equal(definition.query_model,embeddingModel);assert.equal(definition.query_dimensions,embeddingDimensions);assert.equal(definition.status,'unevaluated');assert.notEqual(definition.collection_id,id);assert.equal(override.item_id,restoredPage.id);assert.equal(override.collection_id,definition.collection_id);assert.equal(override.decision,'exclude');
 for(const change of [row=>row.query_vector='[0,0]',row=>row.semantic_json=JSON.stringify(config({threshold:4})),row=>row.matching='unsupported']){
  const bad=structuredClone(archive);change(bad.tables.smart_collection_definitions[0]);const before=f.vaults.list().length;await assert.rejects(backups.import(gzipSync(JSON.stringify(bad))),error=>error.status===400);assert.equal(f.vaults.list().length,before);
 }
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('semantic refresh preserves stale matched evidence through an indexing gap, then uses newly indexed vectors locally',async t=>{
 const f=fixture(t),page=f.page('refresh-page',[.9]);let calls=0;f.org.smart.setQueryEmbeddingProvider(async()=>{calls++;return {embedding:vector(),tokens:1};});const response=await f.org.smart.evaluateDescription(f.vault,{semantic:config()});f.org.saveCollection(f.vault,{name:'Refresh semantic',kind:'smart',matching:'semantic',semantic:config(),evaluationToken:response.evaluationToken});const id=f.org.list(f.vault).collections.find(item=>item.name==='Refresh semantic').id;await f.settle(id);
 f.store.run('DELETE FROM page_segment_embeddings WHERE segment_id=?',page+'-segment-0');await f.settle(id);const membership=f.org.list(f.vault).memberships.find(item=>item.item_id===page);assert.equal(membership.stale,true);assert.equal(membership.evaluationState,'missing');assert.ok(membership.evidence.some(item=>item.includes('indexing completes')));
 f.store.run('INSERT INTO page_segment_embeddings VALUES(?,?,?,?,?,100,?)',page+'-segment-0',embeddingModel,embeddingDimensions,'hash-'+page+'-segment-0',JSON.stringify(vector(.1)),'2026-10-23');await f.settle(id);assert.equal(f.org.list(f.vault).memberships.some(item=>item.item_id===page&&item.collection_id===id),false);assert.equal(calls,1);
});
