import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {passageReference,SourcePassages} from '../src/server/modules/source-passages.ts';
import {pageSegmentReference,PageSegments} from '../src/server/modules/page-segments.ts';

function sourceSeed(f,seed){f.embeddings.retrievePassages=async()=>({results:[{id:seed.source_id,kind:'entity',title:'Seed',snippet:seed.text,passageId:seed.id,reference:passageReference(seed),score:1,updated_at:'2026-10-25'}],model:'synthetic'});}
function pageSeed(f,seed){f.embeddings.retrievePassages=async()=>({results:[{id:seed.page_id,kind:'page',title:'Seed',snippet:seed.text,passageId:seed.id,pageReference:pageSegmentReference(seed),score:1,updated_at:'2026-10-25'}],model:'synthetic'});}
const refs=result=>result.evidence.filter(e=>e.kind==='source');

test('standard adjacency adds a nonmatching qualifier; deep reaches a bounded second neighbor with exact own anchors',async()=>{
 const f=chatCorpus();try{
  const text='# Chapter 1\nNEEDLE_ASSERTION grace is unconditional.\n'+('Qualification: exceptions remain possible despite the preceding assertion. '.repeat(140));
  const source=f.source('Qualified assertion',text),rows=f.store.all('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',source.fileId);assert.ok(rows.length>=4);sourceSeed(f,rows[0]);
  const standard=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'NEEDLE_ASSERTION'),deep=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'NEEDLE_ASSERTION',{deep:true});
  assert.ok(refs(standard).some(e=>e.reference.id===rows[1].id&&e.excerpt.includes('Qualification:')));
  assert.ok(!refs(standard).some(e=>e.reference.id===rows[2].id));assert.ok(refs(deep).some(e=>e.reference.id===rows[2].id));
  for(const item of refs(deep)){const row=rows.find(row=>row.id===item.reference.id);assert.equal(item.excerpt,row.text);assert.equal(item.reference.startOffset,row.start_offset);assert.equal(item.reference.endOffset,row.end_offset);assert.equal(item.reference.startLine,row.start_line);assert.equal(item.status,'current');}
  assert.equal(new Set(deep.evidence.map(item=>item.fingerprint)).size,deep.evidence.length);assert.ok(refs(standard).length<=3);assert.ok(refs(deep).length<=5);
 }finally{f.close();}
});

test('deep expands sibling sections inside the actual chapter while standard stays in its section',async()=>{
 const f=chatCorpus();try{
  const source=f.source('Chapter spans','# Chapter 1\n## First section\nNEEDLE_SUPPORT claim.\n## Second section\nNONMATCHING_LIMITATION: the claim holds only conditionally.\n# Chapter 1\nOTHER_DISTINCT_CHAPTER must be excluded.');
  const rows=f.store.all('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',source.fileId),seed=rows.find(row=>row.text.includes('NEEDLE_SUPPORT'));assert.ok(seed);sourceSeed(f,seed);
  const standard=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'NEEDLE_SUPPORT'),deep=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'NEEDLE_SUPPORT',{deep:true});
  assert.doesNotMatch(refs(standard).map(e=>e.excerpt).join('\n'),/NONMATCHING_LIMITATION|OTHER_DISTINCT_CHAPTER/);
  assert.match(refs(deep).map(e=>e.excerpt).join('\n'),/NONMATCHING_LIMITATION/);assert.doesNotMatch(refs(deep).map(e=>e.excerpt).join('\n'),/OTHER_DISTINCT_CHAPTER/);
  assert.ok(deep.evidence.every(e=>e.objectId===source.id));
 }finally{f.close();}
});

function pageSections(f){
 let page=f.pages.create('default',{title:'Page structural context'});
 const blocks=[{id:'chapter-a',type:'heading1',content:[{text:'Repeated title'}]},{id:'first',type:'heading2',content:[{text:'Section A'}]},{id:'claim',type:'paragraph',content:[{text:'NEEDLE_PAGE original assertion'}]},{id:'second',type:'heading2',content:[{text:'Section B'}]},{id:'qualifier',type:'paragraph',content:[{text:'NONMATCHING_PAGE_QUALIFIER: the assertion is disputed.'}]},{id:'chapter-b',type:'heading1',content:[{text:'Repeated title'}]},{id:'other',type:'paragraph',content:[{text:'WRONG_DISTINCT_PAGE_CHAPTER'}]}];
 page=f.pages.update('default',page.id,{...page,blocks});new PageSegments(f.store).synchronize('default',page.id);
 const original=f.store.get('SELECT * FROM page_segments WHERE page_id=?',page.id);f.store.run('DELETE FROM page_segments WHERE page_id=?',page.id);
 let offset=0;
 const groups=[blocks.slice(0,3),blocks.slice(3,5),blocks.slice(5)];
 for(let ordinal=0;ordinal<groups.length;ordinal++){
  const group=groups[ordinal],text=group.map(block=>block.content[0].text).join('\n'),heading=ordinal===0?'Repeated title / Section A':ordinal===1?'Repeated title / Section B':'Repeated title';
  f.store.run(`INSERT INTO page_segments (id,page_id,vault_id,revision,projection_hash,ordinal,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count) VALUES (?,?,'default',?,?,?,?,?,?,?,?,?,?,10)`,page.id+'-'+ordinal,page.id,page.revision,original.projection_hash,ordinal,heading,text,text,createHash('sha256').update(text).digest('hex'),JSON.stringify(group.map(block=>block.id)),offset,offset+text.length);offset+=text.length+1;
 }
 return {page,rows:f.store.all('SELECT * FROM page_segments WHERE page_id=? ORDER BY ordinal',page.id)};
}
test('page expansion preserves own block offsets and provenance, and never crosses a repeated chapter boundary',async()=>{
 const f=chatCorpus();try{
  const {page,rows}=pageSections(f);pageSeed(f,rows[0]);
  const standard=await f.retrieval.retrieve('default',{kind:'page',id:page.id},'NEEDLE_PAGE'),deep=await f.retrieval.retrieve('default',{kind:'page',id:page.id},'NEEDLE_PAGE',{deep:true});
  assert.equal(standard.evidence.length,1);assert.ok(deep.evidence.some(e=>e.pageReference.segmentId===rows[1].id));assert.ok(!deep.evidence.some(e=>e.pageReference.segmentId===rows[2].id));
  const neighbor=deep.evidence.find(e=>e.pageReference.segmentId===rows[1].id);assert.deepEqual(neighbor.pageReference.blockIds,['second','qualifier']);assert.equal(neighbor.pageReference.startOffset,rows[1].start_offset);assert.equal(neighbor.origin,'authored');
  f.store.run('UPDATE page_segments SET projection_hash=? WHERE id=?','wrong-projection',rows[1].id);
  const wrongVersion=await f.retrieval.retrieve('default',{kind:'page',id:page.id},'NEEDLE_PAGE',{deep:true});assert.ok(!wrongVersion.evidence.some(e=>e.pageReference.segmentId===rows[1].id));
 }finally{f.close();}
});

test('expansion receives a reserved bounded provider evidence budget and stale/cancelled contexts fail closed',async()=>{
 const f=chatCorpus();try{
  const sources=[];
  for(let index=0;index<4;index++)sources.push(f.source('Budget source '+index,'# Chapter 1\nNEEDLE_BUDGET\n'+('A nonmatching conditional qualification remains relevant. '.repeat(200))));
  const seeds=sources.map(source=>f.store.get('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal LIMIT 1',source.fileId));
  f.embeddings.retrievePassages=async()=>({results:seeds.map((seed,index)=>({id:seed.source_id,kind:'entity',title:'Seed',snippet:seed.text,passageId:seed.id,reference:passageReference(seed),score:1-index/10,updated_at:'2026-10-25'})),model:'synthetic'});
  const result=await f.retrieval.retrieve('default',{kind:'vault'},'NEEDLE_BUDGET',{deep:true}),expanded=refs(result).filter(item=>!seeds.some(seed=>seed.id===item.reference.id));
  assert.ok(expanded.length>0);assert.ok(expanded.length<=6);assert.ok(result.evidence.length<=20);assert.ok(result.evidence.reduce((n,item)=>n+Buffer.byteLength(item.excerpt),0)<=48000);assert.equal(new Set(result.evidence.map(item=>item.fingerprint)).size,result.evidence.length);
  assert.ok(expanded.every(item=>sources.slice(0,3).some(source=>source.id===item.objectId)));
  f.store.run("UPDATE source_files SET status='failed' WHERE id=?",sources[0].fileId);assert.ok(f.retrieval.validate('default',result.evidence.filter(item=>item.objectId===sources[0].id)).every(item=>item.status==='stale'));
  const controller=new AbortController();controller.abort();await assert.rejects(f.retrieval.retrieve('default',{kind:'vault'},'NEEDLE_BUDGET',{deep:true,signal:controller.signal}),e=>e.status===409);
 }finally{f.close();}
});

test('math-normalized source generations validate and expand against canonical cleaned text',async()=>{
 const f=chatCorpus();try{
  const raw='# Chapter 1\n## Assertion\nMATH_NEEDLE x * x.\n## Qualification\nBOUNDING_QUALIFIER applies.',source=f.source('Math cleaned source',raw),cleaned=raw.replace('x * x','x^{2}');
  f.store.run('INSERT INTO source_math_documents (file_id,raw_hash,algorithm_version,cleaned_text,uncertainty_json,updated_at) VALUES (?,?,2,?,\'[]\',?)',source.fileId,createHash('sha256').update(raw).digest('hex'),cleaned,'2026-10-25');
  f.store.run('INSERT OR REPLACE INTO source_passage_dirty(file_id,vault_id) VALUES (?,?)',source.fileId,'default');new SourcePassages(f.store).synchronize('default');
  const seed=f.store.all('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',source.fileId).find(row=>row.text.includes('MATH_NEEDLE'));assert.ok(seed);sourceSeed(f,seed);
  const result=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'MATH_NEEDLE',{deep:true});assert.match(refs(result).map(item=>item.excerpt).join('\n'),/x\^\{2\}|BOUNDING_QUALIFIER/);assert.ok(refs(result).some(item=>item.excerpt.includes('BOUNDING_QUALIFIER')));assert.ok(result.evidence.every(item=>item.status==='current'));
 }finally{f.close();}
});

test('malformed adapter identities cannot seed context outside the canonical selected object',async()=>{
 const f=chatCorpus();try{
  const other=f.store.get('SELECT * FROM source_passages WHERE file_id=?',f.opposing.fileId),selected=f.store.get('SELECT * FROM source_passages WHERE file_id=?',f.primary.fileId);
  f.embeddings.retrievePassages=async()=>({results:[{id:f.primary.id,kind:'entity',title:'Mislabelled',snippet:other.text,passageId:other.id,reference:passageReference(selected),score:1,updated_at:'2026-10-25'}],model:'synthetic'});
  const result=await f.retrieval.retrieve('default',{kind:'source',id:f.primary.id},'grace',{deep:true});assert.ok(result.evidence.every(item=>item.objectId===f.primary.id));assert.ok(!result.evidence.some(item=>item.reference?.fileId===f.opposing.fileId));
 }finally{f.close();}
});
