import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {passageReference} from '../src/server/modules/source-passages.ts';

function seedOnly(f,seed) {
 f.embeddings.retrievePassages=async()=>({model:'synthetic',results:[{id:seed.source_id,kind:'entity',title:'Seed',snippet:seed.text,passageId:seed.id,reference:passageReference(seed),score:1,updated_at:'2026-10-25'}]});
}
function chapters(f) {
 const text='# Repeated heading\n'+('FIRST_CHAPTER_CONTEXT '.repeat(380))+'\n# Intervening chapter\nOTHER_CHAPTER_SENTINEL\n# Repeated heading\nLATER_SAME_HEADING_SENTINEL';
 const source=f.source('Expansion adversarial chapters',text),rows=f.store.all('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',source.fileId);
 const repeated=rows.filter(row=>row.text.includes('FIRST_CHAPTER_CONTEXT'));
 assert.ok(repeated.length>=3,'fixture must split the first heading into several passages');
 return {source,rows,seed:repeated[1]};
}

test('deep context remains in the contiguous chapter despite a later identical heading',async()=>{
 const f=chatCorpus();try {
  const {source,seed}=chapters(f);seedOnly(f,seed);
  const result=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'context',{deep:true}),passages=result.evidence.filter(item=>item.kind==='source');
  assert.ok(passages.length>1,'deep context must add exact anchored context');
  assert.ok(passages.every(item=>item.objectId===source.id&&item.reference.fileId===source.fileId&&item.reference.generationId===seed.generation_id&&item.status==='current'));
  assert.doesNotMatch(passages.map(item=>item.excerpt).join('\n'),/OTHER_CHAPTER_SENTINEL|LATER_SAME_HEADING_SENTINEL/);
  assert.ok(result.evidence.length<=20);assert.ok(result.evidence.reduce((total,item)=>total+Buffer.byteLength(item.excerpt),0)<=48000);
 }finally{f.close();}
});

test('context expansion excludes neighbors from a stale generation and keeps exact immutable snapshots',async()=>{
 const f=chatCorpus();try {
  const {source,rows,seed}=chapters(f);seedOnly(f,seed);
  const neighbor=rows.find(row=>row.ordinal===seed.ordinal+1);assert.ok(neighbor);f.store.run('UPDATE source_passages SET generation_id=? WHERE id=?','forged-historical-generation',neighbor.id);
  const result=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'context',{deep:true}),passages=result.evidence.filter(item=>item.kind==='source');
  assert.ok(passages.some(item=>item.reference.id===seed.id));assert.ok(!passages.some(item=>item.reference.id===neighbor.id));
  assert.ok(passages.every(item=>item.reference.generationId===seed.generation_id&&item.excerpt===item.reference.excerpt));
  const snapshot=JSON.stringify(result.evidence);f.store.run('UPDATE source_files SET text=? WHERE id=?','A reprocessed different document',source.fileId);
  assert.ok(f.retrieval.validate('default',passages).every(item=>item.status==='stale'));assert.equal(JSON.stringify(result.evidence),snapshot);
 }finally{f.close();}
});

test('adjacent distinct chapters with identical titles cannot be merged into one context window',async()=>{
 const f=chatCorpus();try {
  const source=f.source('Adjacent repeated chapter labels','# Same title\n'+('ORIGINAL_CHAPTER_BODY '.repeat(210))+'\n# Same title\nDISTINCT_CHAPTER_SENTINEL');
  const rows=f.store.all('SELECT * FROM source_passages WHERE file_id=? ORDER BY ordinal',source.fileId),firstChapter=rows.filter(row=>row.text.includes('ORIGINAL_CHAPTER_BODY')),seed=firstChapter.at(-1),next=rows.find(row=>row.ordinal===seed.ordinal+1);
  assert.ok(seed);assert.ok(next);assert.equal(seed.heading,next.heading,'adversarial fixture must have equal heading strings');assert.match(next.text,/DISTINCT_CHAPTER_SENTINEL/);seedOnly(f,seed);
  const result=await f.retrieval.retrieve('default',{kind:'source',id:source.id},'context',{deep:true});
  assert.doesNotMatch(result.evidence.map(item=>item.excerpt).join('\n'),/DISTINCT_CHAPTER_SENTINEL/,'actual heading boundary must stop expansion even when title text repeats');
 }finally{f.close();}
});
