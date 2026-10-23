import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {semanticFixture as fixture,semanticConfig as semantic,semanticVector as vector} from './helpers/smart-collection-fixture.mjs';
import {evaluateHybridBatch} from '../src/server/modules/hybrid-collections.ts';
import {prepareExampleQuery,evaluateExampleBatch} from '../src/server/modules/example-collections.ts';
import {parseExampleCollection} from '../src/shared/example-collections.ts';
import {CollectionRuleGeneration,buildCollectionRulePrompt} from '../src/server/modules/collection-rule-generation.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {embeddingModel} from '../src/shared/embeddings.ts';

const rule=(value='eligible')=>({version:1,root:{field:'title',operator:'contains',value}});
const examples=(positivePageIds,negativePageIds=[])=>({version:1,positivePageIds,negativePageIds,threshold:.55,minCoverage:.5,negativeMargin:.05});
const fails=(work,status)=>assert.throws(work,error=>error.status===status);

test('hybrid rules exclude candidates before any candidate passage/vector read and explain both stages',t=>{
 const f=fixture(t),eligible=f.page('eligible-page',[.9,.9]),excluded=f.page('outside-scope',[null]),readIds=[],all=f.store.all.bind(f.store);
 t.mock.method(f.store,'all',(sql,...args)=>{if(sql.includes('FROM page_segments s LEFT JOIN page_segment_embeddings'))readIds.push(args[3]);return all(sql,...args);});
 const result=evaluateHybridBatch(f.store,f.vault,rule(),semantic(),vector(),'',8);assert.deepEqual(readIds,[eligible]);assert.equal(result.items.find(item=>item.item_id===excluded).state,'evaluated');assert.equal(result.items.find(item=>item.item_id===excluded).matched,false);
 const match=result.items.find(item=>item.item_id===eligible);assert.equal(match.matched,true);assert.ok(match.evidence.some(item=>item.startsWith('Rule:')));assert.ok(match.evidence.some(item=>item.startsWith('Semantic:')));
});

test('examples validate identities, coherence, conflicting negatives and fully current local embeddings',t=>{
 const f=fixture(t),a=f.page('example-a',[1]),b=f.page('example-b',[.9]),unrelated=f.page('unrelated',[0]),missing=f.page('missing',[null]);
 for(const config of [examples([a]),examples([a,a]),examples([a,b],[a]),examples([a,b],['missing-id']),examples([a,unrelated]),examples([a,b],[b])]){
  if(config.positivePageIds.length<2||new Set(config.positivePageIds).size<config.positivePageIds.length||config.negativePageIds.some(id=>config.positivePageIds.includes(id)))assert.throws(()=>parseExampleCollection(config));else fails(()=>prepareExampleQuery(f.store,f.vault,config),409);
 }
 fails(()=>prepareExampleQuery(f.store,f.vault,examples([a,missing])),409);f.store.run('UPDATE page_segment_embeddings SET model=? WHERE segment_id=?','obsolete',b+'-segment-0');fails(()=>prepareExampleQuery(f.store,f.vault,examples([a,b])),409);
 const other=f.vaults.create({name:'Other fixture'}).id;fails(()=>prepareExampleQuery(f.store,other,examples([a,b])),409);
});

test('positive and negative examples use document-level contrast and refresh their fingerprint when example vectors change',t=>{
 const f=fixture(t),a=f.page('positive-a',[1]),b=f.page('positive-b',[.95]),negative=f.page('negative',[0]),match=f.page('like-positive',[.9]),ambiguous=f.page('like-negative',[.6]),config=examples([a,b],[negative]);
 const query=prepareExampleQuery(f.store,f.vault,config);assert.equal(query.negativeVectors.length,1);assert.ok(query.evidence.some(item=>item.includes('Negative example')));
 const results=evaluateExampleBatch(f.store,f.vault,config,'',8,[match,ambiguous]).items;assert.equal(results.find(item=>item.item_id===match).matched,true);assert.equal(results.find(item=>item.item_id===ambiguous).matched,false);assert.ok(results.find(item=>item.item_id===ambiguous).evidence.some(item=>item.includes('negative example')));
 f.store.run('UPDATE page_segment_embeddings SET vector=? WHERE segment_id=?',JSON.stringify(vector(.7)),b+'-segment-0');assert.notEqual(prepareExampleQuery(f.store,f.vault,config).fingerprint,query.fingerprint);
});

test('generated rule proposals use only bounded vault metadata, require confirmation and never mutate saved state',async t=>{
 const f=fixture(t),page=f.page('eligible-page',[.9]),generation=new CollectionRuleGeneration(f.store);let input;
 generation.setProvider(async(vault,request)=>{assert.equal(vault,f.vault);input=request;return JSON.stringify(rule());});const before=f.store.get('SELECT count(*) n FROM collections WHERE vault_id=?',f.vault).n;
 const result=await generation.generate(f.vault,{description:'Recent eligible notes',context:{entities:[{id:'earthsea'}]}});assert.equal(result.requiresConfirmation,true);assert.deepEqual(result.rule,rule());assert.equal(result.preview.items[0].item_id,page);assert.ok(result.warnings.some(item=>item.includes('UTC')));assert.ok(input.context.entities.every(item=>item.id!=='earthsea'));assert.match(input.today,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal(f.store.get('SELECT count(*) n FROM collections WHERE vault_id=?',f.vault).n,before);const prompt=buildCollectionRulePrompt(input);assert.match(prompt.instructions,/untrusted/);assert.deepEqual(JSON.parse(prompt.input).untrusted_request.description,'Recent eligible notes');
});

test('generated arbitrary SQL, invented IDs, unsupported predicates and oversized/cyclic ASTs are rejected as untrusted output',async t=>{
 const f=fixture(t),generation=new CollectionRuleGeneration(f.store),cycle={op:'all',children:[]};cycle.children.push(cycle);
 for(const output of [{sql:'DELETE FROM pages'}, {version:1,root:{field:'entity',operator:'mentions',value:'earthsea'}},{version:1,root:{field:'contains',operator:'is',value:'semantic theme'}},{version:1,root:cycle},{error:'unsupported_criteria'},'x'.repeat(33000)]){
  generation.setProvider(async()=>output);await assert.rejects(generation.generate(f.vault,{description:'A synthetic request'}),error=>error.status===502);
 }
 await assert.rejects(generation.generate(f.vault,{description:''}),error=>error.status===400);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_definitions WHERE vault_id=?',f.vault).n,0);
});

test('rule-generation lock/unlock races cannot return proposals from a previous vault session',async t=>{
 const f=fixture(t),generation=new CollectionRuleGeneration(f.store);let resolve;generation.setProvider(()=>new Promise(done=>resolve=done));const request=generation.generate(f.vault,{description:'Eligible notes'});f.vaults.lock(f.vault,{passphrase:'synthetic'});f.vaults.unlock(f.vault,{passphrase:'synthetic'});resolve(rule());await assert.rejects(request,error=>error.status===409);
});

test('editing an example triggers complete membership re-evaluation while explicit inclusion and exclusion survive',async t=>{
 const f=fixture(t),a=f.page('example-a',[1]),b=f.page('example-b',[1]),candidate=f.page('candidate',[.6]),included=f.page('manual-include',[0]),config=examples([a,b]);
 f.org.saveCollection(f.vault,{name:'Example collection',kind:'smart',matching:'examples',examples:config});const id=f.org.list(f.vault).collections.find(item=>item.name==='Example collection').id;await f.settle(id);assert.ok(f.org.list(f.vault).memberships.some(item=>item.collection_id===id&&item.item_id===candidate));
 f.org.membership(f.vault,{kind:'page',item_id:included,collection_id:id});f.org.membership(f.vault,{kind:'page',item_id:a,collection_id:id,remove:true});
 // Change only the representative pages: the unchanged candidate must still be reconsidered.
 f.store.run('UPDATE page_segment_embeddings SET vector=? WHERE segment_id IN (?,?)',JSON.stringify(Array.from({length:1536},(_,index)=>index===0?.6:index===1?-.8:0)),a+'-segment-0',b+'-segment-0');await f.settle(id);
 const members=f.org.list(f.vault).memberships.filter(item=>item.collection_id===id);assert.equal(members.some(item=>item.item_id===candidate),false);assert.equal(members.some(item=>item.item_id===a),false);assert.equal(members.find(item=>item.item_id===included).provenance,'include');
});

test('hybrid and example backups remap every saved identity and rebuild membership without provider calls',async t=>{
 const f=fixture(t),a=f.page('backup-example-a',[1]),b=f.page('backup-example-b',[.9]),candidate=f.page('eligible-backup-candidate',[0]),folder=f.org.saveFolder(f.vault,{name:'Eligibility folder'}).folders[0].id;f.org.locate(f.vault,{kind:'page',item_id:candidate,folder_id:folder});
 f.org.smart.setQueryEmbeddingProvider(async()=>({embedding:vector(),tokens:1}));const evaluated=await f.org.smart.evaluateDescription(f.vault,{semantic:semantic()});const hybridRule={version:1,root:{field:'folder',operator:'within',value:folder}};
 f.org.saveCollection(f.vault,{name:'Backed hybrid',kind:'smart',matching:'hybrid',rule:hybridRule,semantic:semantic(),evaluationToken:evaluated.evaluationToken});f.org.saveCollection(f.vault,{name:'Backed examples',kind:'smart',matching:'examples',examples:examples([a,b],[candidate])});
 const backups=new VaultBackups(f.store),exported=await backups.export(f.vault),archive=JSON.parse(gunzipSync(exported.bytes)),restored=await backups.import(exported.bytes,'Restored phase3'),rows=f.store.all('SELECT d.*,c.name FROM smart_collection_definitions d JOIN collections c ON c.id=d.collection_id WHERE d.vault_id=?',restored.id),pages=new Map(f.store.all('SELECT id,title FROM pages WHERE vault_id=?',restored.id).map(item=>[item.title,item.id])),restoredFolder=f.store.get('SELECT id FROM folders WHERE vault_id=? AND name=?',restored.id,'Eligibility folder');
 const hybrid=rows.find(item=>item.matching==='hybrid'),example=rows.find(item=>item.matching==='examples');assert.equal(JSON.parse(hybrid.rule_json).root.value,restoredFolder.id);assert.deepEqual(JSON.parse(hybrid.query_vector),vector());assert.deepEqual(JSON.parse(example.examples_json).positivePageIds,[pages.get(a),pages.get(b)]);assert.deepEqual(JSON.parse(example.examples_json).negativePageIds,[pages.get(candidate)]);assert.ok(rows.every(item=>item.status==='unevaluated'));
 const malformed=structuredClone(archive);malformed.tables.smart_collection_definitions.find(item=>item.matching==='examples').examples_json=JSON.stringify(examples(['outside-backup','outside-backup']));const before=f.vaults.list().length;await assert.rejects(backups.import(gzipSync(JSON.stringify(malformed))),error=>error.status===400);assert.equal(f.vaults.list().length,before);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
