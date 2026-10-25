import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatCorpus} from './helpers/chat-corpus.mjs';
import {ChatKnowledge} from '../src/server/modules/chat-knowledge.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {Embeddings} from '../src/server/modules/embeddings.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';

const vector=(x=1,y=0)=>Array.from({length:1536},(_,index)=>index===0?x:index===1?y:0);
test('resolved entity IDs suppress implicit namesakes while bare names preserve ambiguity',()=>{
 const f=chatCorpus();try{
  const knowledge=new ChatKnowledge(f.store);
  assert.deepEqual(new Set(knowledge.resolveEntities('default','Augustine').map(e=>e.id)),new Set([f.augustine.id,f.ambiguous.id]));
  const resolved=knowledge.resolveEntities('default','Augustine', [{id:f.ambiguous.id,name:'Untrusted invented display label'}]);
  assert.deepEqual(resolved.map(e=>e.id),[f.ambiguous.id]);assert.equal(resolved[0].name,'Augustine');
  assert.deepEqual(new Set(knowledge.resolveEntities('default','Augustine',[{id:f.augustine.id,name:'Augustine'},{id:f.ambiguous.id,name:'Augustine'}]).map(e=>e.id)),new Set([f.augustine.id,f.ambiguous.id]));
 }finally{f.close();}
});

test('exact page evidence preserves long excerpts and distinguishes generated and mixed notes',async()=>{
 const f=chatCorpus();try{
  const text='grace '+ ' '.repeat(4500)+'TAIL_UNTRUNCATED';
  const page=f.note('A long exact note',text),result=await f.retrieval.retrieve('default',{kind:'page',id:page.id},'grace');
  const evidence=result.evidence.find(e=>e.kind==='own_note');assert.ok(evidence);assert.ok(evidence.excerpt.length>4000);assert.ok(evidence.excerpt.endsWith('TAIL_UNTRUNCATED'));assert.equal(evidence.pageReference.excerpt,evidence.excerpt);assert.equal(evidence.origin,'authored');
  f.store.run("UPDATE pages SET creation_method='ai_generated' WHERE id=?",page.id);
  assert.equal(f.retrieval.validate('default',[evidence])[0].status,'stale');
  const generated=(await f.retrieval.retrieve('default',{kind:'page',id:page.id},'grace')).evidence[0];assert.equal(generated.origin,'ai_generated');assert.match(generated.locator,/AI-generated secondary/);
  const mixed=f.note('Mixed note','grace human text');
  f.pages.update('default',mixed.id,{...mixed,blocks:[...mixed.blocks,{id:'generated',type:'paragraph',semantic:'ai-explanation',content:[{text:'grace generated text'}]}]});
  const secondary=(await f.retrieval.retrieve('default',{kind:'page',id:mixed.id},'grace')).evidence[0];assert.equal(secondary.origin,'mixed');assert.match(secondary.locator,/AI-generated secondary/);
  const legacy=f.note('Legacy generated','grace generated legacy content');f.store.run("UPDATE pages SET generation_metadata='{}' WHERE id=?",legacy.id);assert.equal((await f.retrieval.retrieve('default',{kind:'page',id:legacy.id},'grace')).evidence[0].origin,'ai_generated');
  const assisted=f.note('AI assisted','grace accepted writing edits');f.store.run("UPDATE pages SET ai_review_accepted=1 WHERE id=?",assisted.id);assert.equal((await f.retrieval.retrieve('default',{kind:'page',id:assisted.id},'grace')).evidence[0].origin,'mixed');
 }finally{f.close();}
});

test('semantic passage scope filters before truncation even with 120 stronger irrelevant candidates',async()=>{
 const f=chatCorpus();let embeddings;
 try{
  const selected=f.note('Selected scope','Selected unrelated text'),outside=f.note('Outside scope','Outside unrelated text');new PageSegments(f.store).synchronize('default');
  const selectedSegment=f.store.get('SELECT * FROM page_segments WHERE page_id=?',selected.id),outsideSegment=f.store.get('SELECT * FROM page_segments WHERE page_id=?',outside.id);
  for(let index=1;index<=120;index++)f.store.run(`INSERT INTO page_segments (id,page_id,vault_id,revision,projection_hash,ordinal,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count) SELECT ?,page_id,vault_id,revision,projection_hash,?,heading,text,input,content_hash,block_ids,start_offset,end_offset,token_count FROM page_segments WHERE id=?`,'outside-'+index,index,outsideSegment.id);
  const rows=f.store.all('SELECT id,content_hash FROM page_segments WHERE page_id IN (?,?)',selected.id,outside.id);
  for(const row of rows)f.store.run("INSERT INTO page_segment_embeddings (segment_id,model,dimensions,content_hash,vector,tokens,updated_at) VALUES (?,'text-embedding-3-small',1536,?,?,1,'2026-10-25')",row.id,row.content_hash,JSON.stringify(row.id===selectedSegment.id?vector(.8,.6):vector()));
  embeddings=new Embeddings(f.store,f.pages,f.knowledge,f.vaults,{status:()=>({configured:true}),embed:async()=>({embedding:vector(),tokens:1})});
  const result=await embeddings.retrievePassages('default',{query:'zzlexicalabsent',limit:1,passageScope:{pageIds:[selected.id],sourceIds:[]},private:true,matchAny:true});
  assert.equal(result.results.length,1);assert.equal(result.results[0].pageReference.pageId,selected.id);
  const empty=await embeddings.retrievePassages('default',{query:'zzlexicalabsent',limit:1,passageScope:{pageIds:[],sourceIds:[]},private:true,matchAny:true});assert.deepEqual(empty.results,[]);
 }finally{embeddings?.close();f.close();}
});

test('private embedding cancellation reaches transport and does not read fake credentials when preaborted',async()=>{
 let reads=0,transportSignal,entered;
 const fake={value:null,read(){reads++;return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 const ai=new Intelligence(fake,async(_url,options)=>{transportSignal=options.signal;entered?.();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('synthetic abort')),{once:true}));});
 ai.save({apiKey:'sk-synthetic-embedding-cancel-never-real'});reads=0;
 const blocked=new AbortController();blocked.abort();await assert.rejects(ai.embed('bounded query',undefined,false,blocked.signal));assert.equal(reads,0);assert.equal(transportSignal,undefined);
 const controller=new AbortController(),ready=new Promise(resolve=>entered=resolve),pending=ai.embed('bounded query',undefined,false,controller.signal);await ready;assert.equal(transportSignal.aborted,false);controller.abort();await assert.rejects(pending);assert.equal(transportSignal.aborted,true);
});

test('copied evidence fingerprints cannot verify forged excerpts, titles, locators or exact coordinates',async()=>{
 const f=chatCorpus();try{
  const result=await f.retrieval.retrieve('default',{kind:'vault'},'Augustine grace');
  for(const kind of ['own_note','source','entity_fact','entity_overview']){
   const original=result.evidence.find(e=>e.kind===kind);assert.ok(original,`fixture must include ${kind}`);assert.equal(f.retrieval.validate('default',[original])[0].status,'current');
   for(const change of [{excerpt:'FORGED_QUOTE'}, {title:'FORGED_TITLE'}, {locator:'FORGED_COORDINATE'}]){
    assert.equal(f.retrieval.validate('default',[{...original,...change}])[0].status,'stale',`${kind}: ${Object.keys(change)[0]}`);
   }
   const forged=structuredClone(original);
   if(forged.pageReference)forged.pageReference.startOffset+=1;
   else if(forged.reference)forged.reference.startLine+=1;
   else forged.pageReference={pageId:f.myNote.id,segmentId:'unrelated',revision:1,projectionHash:'forged',blockIds:['wrong'],startOffset:0,endOffset:1,excerpt:'f'};
   assert.equal(f.retrieval.validate('default',[forged])[0].status,'stale',`${kind}: altered reference`);
  }
 }finally{f.close();}
});


test('structured fact fingerprints include changes beyond the bounded displayed excerpt',()=>{
 const f=chatCorpus();try{
  const knowledge=new ChatKnowledge(f.store),prefix='A'.repeat(6500);
  f.store.run('UPDATE properties SET value=? WHERE id=?',prefix+' original tail','period');
  const evidence=knowledge.get('default',[f.augustine.id]).evidence.find(e=>e.factId==='property:period');
  assert.ok(evidence);assert.equal(evidence.excerpt.length,6000);assert.equal(knowledge.validate('default',evidence),'current');
  f.store.run('UPDATE properties SET value=? WHERE id=?',prefix+' revised tail','period');
  assert.equal(knowledge.validate('default',evidence),'stale');
 }finally{f.close();}
});
