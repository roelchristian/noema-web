import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {SourcePassageEmbeddings} from '../src/server/modules/source-passage-embeddings.ts';
import {CachedVectorSearch} from '../src/server/vector-search.ts';
import {SemanticShortlist,compareSemanticCandidates} from '../src/server/semantic-candidates.ts';
import {embeddingModel,embeddingDimensions} from '../src/shared/embeddings.ts';
const vector=Array.from({length:embeddingDimensions},(_,i)=>i===0?1:0);
function setup(t,embed=async()=>({embedding:vector,tokens:4})) {
 const f=chatCorpus();let requests=0;
 const ai={status:()=>({configured:true}),embed:async()=>{requests++;return embed();}};
 const worker=new Embeddings(f.store,f.pages,f.knowledge,f.vaults,ai);
 new PageSegments(f.store).synchronize('default');new PageSegments(f.store).synchronize(f.other);
 const index=new PageSegmentIndex(f.store);
 for(const row of f.store.all('SELECT * FROM page_segments'))index.save(row,vector,1);
 for(const row of f.store.all('SELECT id,content_hash FROM source_passages'))f.store.run('INSERT INTO source_passage_embeddings VALUES (?,?,?,?,?,?,?)',row.id,embeddingModel,embeddingDimensions,row.content_hash,JSON.stringify(vector),1,new Date().toISOString());
 t.after(()=>{worker.close();index.close();f.close();});
 return {...f,worker,index,requests:()=>requests};
}
test('semantic scopes restrict SQL scoring and vector availability before embedding',async t=>{
 const f=setup(t),score=CachedVectorSearch.prototype.score;let scored=0;
 t.mock.method(CachedVectorSearch.prototype,'score',function(...args){scored++;return score.apply(this,args);});
 const expected=f.store.get('SELECT count(*) AS n FROM page_segments WHERE page_id=?',f.myNote.id).n;
 const scoped=await f.worker.retrievePassages('default',{query:'semanticonlyunmatched',passageScope:{pageIds:[f.myNote.id],sourceIds:[]}});
 assert.equal(scored,expected);assert.ok(scoped.results.length);assert.ok(scoped.results.every(row=>row.pageReference?.pageId===f.myNote.id));assert.equal(f.requests(),1);
 scored=0;
 const sourceRows=f.store.get('SELECT count(*) AS n FROM source_passages WHERE source_id=?',f.primary.id).n;
 const sourceResult=await f.worker.retrievePassages('default',{query:'anothersemanticonly',passageScope:{pageIds:[],sourceIds:[f.primary.id]}});
 assert.equal(scored,sourceRows);assert.ok(sourceResult.results.length);assert.ok(sourceResult.results.every(row=>row.reference?.sourceId===f.primary.id));
 const before=f.requests();scored=0;
 for(const passageScope of [{pageIds:[],sourceIds:[]},{pageIds:[f.hidden.id],sourceIds:[]},{pageIds:['unknown'],sourceIds:['unknown']}]){
  assert.deepEqual((await f.worker.retrievePassages('default',{query:'grace',passageScope})).results,[]);
 }
 assert.equal(f.requests(),before);assert.equal(scored,0);
 t.diagnostic(`SQL scopes score page=${expected}, source=${sourceRows}; empty/cross-vault/unknown scope scores=0 and extra provider requests=0.`);
 for(const passageScope of [null,[],{pageIds:'bad',sourceIds:[]},{pageIds:[''],sourceIds:[]},{pageIds:[],sourceIds:[1]}])await assert.rejects(f.worker.retrievePassages('default',{query:'grace',passageScope}),{status:400});
 assert.equal(f.requests(),before);
});
test('semantic top-k materializes only winners and navigation keeps distinct owners',async t=>{
 const f=setup(t);
 for(let i=0;i<110;i++){
  const page=f.note('Synthetic '+i,'A synthetic semantic candidate that cannot lexically match the question.');
  new PageSegments(f.store).synchronize('default',page.id);
  for(const row of f.store.all('SELECT * FROM page_segments WHERE page_id=?',page.id))f.index.save(row,vector,1);
 }
 let materialized=0,scored=0;
 for(const Type of [PageSegmentIndex,SourcePassageEmbeddings]){
  const materialize=Type.prototype.materialize;
  t.mock.method(Type.prototype,'materialize',function(...args){const result=materialize.apply(this,args);materialized+=result.length;return result;});
 }
 const score=CachedVectorSearch.prototype.score;t.mock.method(CachedVectorSearch.prototype,'score',function(...args){scored++;return score.apply(this,args);});
 const result=await f.worker.retrievePassages('default',{query:'unfindablelexicaltoken',limit:1});
 assert.equal(result.results.length,1);assert.ok(scored>100);assert.equal(materialized,1,'Only the final semantic winner receives text and reference materialization');
 t.diagnostic(`Hybrid: candidate/scoring rows=${scored}; prior materializations=${scored}; current materializations=${materialized}; returned=1.`);
 materialized=0;scored=0;
 const navigation=await f.worker.search('default',{query:'unfindablelexicaltoken',limit:3});
 assert.equal(navigation.results.length,3);assert.equal(materialized,3);assert.ok(scored>100);
 t.diagnostic(`Navigation: candidate/scoring rows=${scored}; prior materializations=${scored}; current materializations=${materialized}; returned=3.`);
 assert.equal(new Set(navigation.results.map(row=>`${row.kind}:${row.id}`)).size,3);
 assert.ok(navigation.results.every(row=>row.pageReference||row.reference));
 materialized=0;
 const overlap=await f.worker.retrievePassages('default',{query:'grace',limit:1,passageScope:{pageIds:[f.myNote.id],sourceIds:[f.primary.id]}});
 assert.equal(overlap.results.length,1);assert.ok(overlap.results[0].lexicalRank);assert.ok(overlap.results[0].semanticRank);
 assert.equal(overlap.results[0].score,1/(60+overlap.results[0].lexicalRank)+1/(60+overlap.results[0].semanticRank));
 assert.ok(overlap.results[0].pageReference||overlap.results[0].reference);assert.equal(materialized,0,'Lexical evidence retains its existing snippet and anchors on overlap');
});
test('semantic availability and scoped results preserve stale, archive, deletion and vault boundaries',async t=>{
 const f=setup(t);
 const scope={pageIds:[f.myNote.id],sourceIds:[]};
 f.store.run('UPDATE pages SET archived_at=? WHERE id=?',new Date().toISOString(),f.myNote.id);
 assert.equal(f.index.hasSearchable('default',[f.myNote.id]),false);
 assert.deepEqual((await f.worker.retrievePassages('default',{query:'grace',passageScope:scope})).results,[]);
 f.store.run('UPDATE pages SET archived_at=NULL WHERE id=?',f.myNote.id);
 f.pages.delete('default',f.myNote.id);
 assert.equal(f.index.hasSearchable('default',[f.myNote.id]),false);
 assert.deepEqual((await f.worker.retrievePassages('default',{query:'grace',passageScope:scope})).results,[]);
 f.store.run("UPDATE source_passage_embeddings SET content_hash='incorrect' WHERE passage_id IN (SELECT id FROM source_passages WHERE source_id=?)",f.primary.id);
 assert.deepEqual((await f.worker.retrievePassages('default',{query:'unfindablelexicaltoken',passageScope:{pageIds:[],sourceIds:[f.primary.id]}})).results,[]);
 assert.equal(f.requests(),0);
 f.store.run("UPDATE vaults SET locked=1 WHERE id='default'");
 await assert.rejects(f.worker.retrievePassages('default',{query:'grace'}),{status:423});
});
test('bounded shortlist matches exhaustive sort with ties, duplicates and distinct owners',()=>{
 const all=Array.from({length:1001},(_,i)=>({id:`passage-${i}`,ownerId:`owner-${i%71}`,kind:i%2?'page':'entity',score:((i*37)%101)/100}));
 for(const distinct of [false,true]){
  const shortlist=new SemanticShortlist(17,distinct);for(const row of all)shortlist.add(row);
  const sorted=[...all].sort((a,b)=>compareSemanticCandidates(a,b,distinct));
  const seen=new Set(),expected=sorted.filter(row=>{if(!distinct)return true;const key=`${row.kind}:${row.ownerId}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,17);
  assert.deepEqual(shortlist.values(),expected);
 }
});

test('hybrid lexical evidence reflects deletion, archiving and vault moves during query embedding',async t=>{
 for(const change of ['delete','archive','move'])await t.test(change,async t=>{
  let release;
  const f=setup(t,()=>new Promise(resolve=>{release=()=>resolve({embedding:vector,tokens:4});}));
  const pending=f.worker.retrievePassages('default',{query:'grace',passageScope:{pageIds:[f.myNote.id],sourceIds:[]}});
  assert.equal(f.requests(),1);assert.ok(release);
  if(change==='delete')f.pages.delete('default',f.myNote.id);
  if(change==='archive')f.store.run('UPDATE pages SET archived_at=?,revision=revision+1 WHERE id=?',new Date().toISOString(),f.myNote.id);
  if(change==='move')f.store.run('UPDATE pages SET vault_id=? WHERE id=?',f.other,f.myNote.id);
  release();
  assert.deepEqual((await pending).results,[]);
 });
});
