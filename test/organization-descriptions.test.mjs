import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {VaultDeletion} from '../src/server/modules/vault-deletion.ts';
import {semanticFixture,semanticConfig,semanticVector} from './helpers/smart-collection-fixture.mjs';

const fails=(work,status)=>assert.throws(work,error=>error.status===status);
function fixture(t){const directory=mkdtempSync(path.join(tmpdir(),'noema-description-fixture-')),filename=path.join(directory,'fixture.sqlite'),db=openDatabase(filename),store=new Store(db),org=new Organizer(store),vaults=new Vaults(store),vault=vaults.create({name:'Description fixture'}).id;t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});return {directory,filename,db,store,org,vaults,vault};}

test('folder and collection descriptions preserve omitted values, clear explicitly and reject malformed or foreign writes',t=>{
 const f=fixture(t);const folder=f.org.saveFolder(f.vault,{name:'Folder',description:' Folder context '}).folders[0],collection=f.org.saveCollection(f.vault,{name:'Collection',description:' Collection context '}).collections[0];
 assert.equal(folder.description,'Folder context');assert.equal(collection.description,'Collection context');
 f.org.saveFolder(f.vault,{name:'Renamed folder'},folder.id);f.org.saveCollection(f.vault,{name:'Renamed collection'},collection.id);let state=f.org.list(f.vault);assert.equal(state.folders[0].description,'Folder context');assert.equal(state.collections[0].description,'Collection context');
 const revision=f.store.get('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',f.vault).revision;
 for(const description of ['',null,'   ']){f.org.saveFolder(f.vault,{name:'Renamed folder',description:'Context'},folder.id);f.org.saveCollection(f.vault,{name:'Renamed collection',description:'Context'},collection.id);f.org.saveFolder(f.vault,{name:'Renamed folder',description},folder.id);f.org.saveCollection(f.vault,{name:'Renamed collection',description},collection.id);state=f.org.list(f.vault);assert.equal(state.folders[0].description,undefined);assert.equal(state.collections[0].description,undefined);}
 assert.equal(f.store.get('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',f.vault).revision,revision,'description-only edits must not invalidate rule or semantic memberships');
 for(const description of [42,{},[],true,'x'.repeat(2001),'unsafe\u0000text']){fails(()=>f.org.saveFolder(f.vault,{name:'Bad',description},folder.id),400);fails(()=>f.org.saveCollection(f.vault,{name:'Bad',description},collection.id),400);}
 const other=f.vaults.create({name:'Other'}).id;fails(()=>f.org.saveFolder(other,{name:'Foreign',description:'No'},folder.id),404);fails(()=>f.org.saveCollection(other,{name:'Foreign',description:'No'},collection.id),404);
 f.vaults.lock(f.vault,{passphrase:'synthetic'});fails(()=>f.org.saveFolder(f.vault,{name:'Locked',description:'No'},folder.id),423);fails(()=>f.org.saveCollection(f.vault,{name:'Locked',description:'No'},collection.id),423);
});

test('human descriptions are metadata-only for every smart method, including unavailable models and example references',async t=>{
 const f=semanticFixture(t),a=f.page('description-example-a',[1]),b=f.page('description-example-b',[.9]);let providerCalls=0;f.org.smart.setQueryEmbeddingProvider(async()=>{providerCalls++;return {embedding:semanticVector(),tokens:1};});const semantic=semanticConfig(),evaluation=await f.org.smart.evaluateDescription(f.vault,{semantic}),rule={version:1,root:{field:'title',operator:'contains',value:'description'}},examples={version:1,positivePageIds:[a,b],negativePageIds:[],threshold:.55,minCoverage:.5,negativeMargin:.05};
 for(const matching of ['rules','semantic','hybrid','examples'])f.org.saveCollection(f.vault,{name:matching,kind:'smart',matching,...(matching==='rules'||matching==='hybrid'?{rule}:{}),...(matching==='semantic'||matching==='hybrid'?{semantic,evaluationToken:evaluation.evaluationToken}:{}),...(matching==='examples'?{examples}:{})});
 const collections=f.org.list(f.vault).collections;for(const collection of collections){await f.settle(collection.id);f.org.membership(f.vault,{kind:'page',item_id:a,collection_id:collection.id,remove:true});}
 // Persist unavailable historical inputs without modifying the vault's candidate revision.
 f.store.run("UPDATE smart_collection_definitions SET query_model='unavailable-model' WHERE matching IN ('semantic','hybrid') AND vault_id=?",f.vault);f.store.run('UPDATE smart_collection_definitions SET examples_json=? WHERE matching=? AND vault_id=?',JSON.stringify({...examples,positivePageIds:['unavailable-a','unavailable-b']}),'examples',f.vault);
 const snapshot=()=>({definitions:f.store.all('SELECT * FROM smart_collection_definitions WHERE vault_id=? ORDER BY collection_id',f.vault),cache:f.store.all('SELECT * FROM smart_collection_cache WHERE vault_id=? ORDER BY collection_id,item_id',f.vault),overrides:f.store.all('SELECT * FROM smart_collection_overrides WHERE vault_id=? ORDER BY collection_id,item_id',f.vault),revision:f.store.get('SELECT revision FROM smart_collection_revisions WHERE vault_id=?',f.vault)}),before=snapshot();
 for(const collection of collections)f.org.saveCollection(f.vault,{name:collection.name+' renamed',description:'Human purpose'},collection.id);
 // Existing editors may submit the unchanged full definition alongside the human metadata.
 for(const definition of before.definitions)f.org.saveCollection(f.vault,{name:collections.find(collection=>collection.id===definition.collection_id).name+' renamed',description:'Human purpose',kind:'smart',matching:definition.matching,...(definition.matching==='rules'||definition.matching==='hybrid'?{rule:JSON.parse(definition.rule_json)}:{}),...(definition.matching==='semantic'||definition.matching==='hybrid'?{semantic:JSON.parse(definition.semantic_json)}:{}),...(definition.matching==='examples'?{examples:JSON.parse(definition.examples_json)}:{})},definition.collection_id);
 assert.deepEqual(snapshot(),before);assert.equal(providerCalls,1);assert.ok(f.org.list(f.vault).collections.every(collection=>collection.description==='Human purpose'));
});

test('description sidecars survive restart and backups while old inserts and archives retain compatibility',async t=>{
 const f=fixture(t),folder=f.org.saveFolder(f.vault,{name:'Folder',description:'Folder context'}).folders[0],collection=f.org.saveCollection(f.vault,{name:'Collection',description:'Collection context'}).collections[0];
 f.store.run('INSERT INTO folders VALUES(?,?,?,?)','legacy-folder',f.vault,'Legacy folder',null);f.store.run('INSERT INTO collections VALUES(?,?,?)','legacy-collection',f.vault,'Legacy collection');const second=openDatabase(f.filename);try{const state=new Organizer(new Store(second)).list(f.vault);assert.equal(state.folders.find(item=>item.id===folder.id).description,'Folder context');assert.equal(state.collections.find(item=>item.id===collection.id).description,'Collection context');}finally{second.close();}
 const backups=new VaultBackups(f.store),exported=await backups.export(f.vault),archive=JSON.parse(gunzipSync(exported.bytes)),restored=await backups.import(exported.bytes),state=f.org.list(restored.id);assert.equal(state.folders.find(item=>item.name==='Folder').description,'Folder context');assert.notEqual(state.folders.find(item=>item.name==='Folder').id,folder.id);assert.equal(state.collections.find(item=>item.name==='Collection').description,'Collection context');
 delete archive.tables.folder_descriptions;delete archive.tables.collection_descriptions;const legacy=await backups.import(gzipSync(JSON.stringify(archive)));assert.ok(f.org.list(legacy.id).folders.every(item=>item.description===undefined));assert.ok(f.org.list(legacy.id).collections.every(item=>item.description===undefined));assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('description changes invalidate vault deletion confirmation and sidecars clean up with their containers',t=>{
 const f=fixture(t),folder=f.org.saveFolder(f.vault,{name:'Folder',description:'Before'}).folders[0],collection=f.org.saveCollection(f.vault,{name:'Collection',description:'Before'}).collections[0],deletion=new VaultDeletion(f.store),before=deletion.preview(f.vault);
 f.org.saveFolder(f.vault,{name:'Folder',description:'After'},folder.id);const middle=deletion.preview(f.vault);assert.notEqual(middle.fingerprint,before.fingerprint);f.org.saveCollection(f.vault,{name:'Collection',description:'After'},collection.id);assert.notEqual(deletion.preview(f.vault).fingerprint,middle.fingerprint);fails(()=>deletion.remove(f.vault,{name:'Description fixture',acknowledged:true,fingerprint:before.fingerprint}),409);
 f.org.remove(f.vault,'folders',folder.id);f.org.remove(f.vault,'collections',collection.id);assert.equal(f.store.get('SELECT count(*) n FROM folder_descriptions WHERE vault_id=?',f.vault).n,0);assert.equal(f.store.get('SELECT count(*) n FROM collection_descriptions WHERE vault_id=?',f.vault).n,0);
});
