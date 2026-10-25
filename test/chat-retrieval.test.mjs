import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatCorpus} from './helpers/chat-corpus.mjs';

test('Chat lexical fallback recalls conflicting source and own-note evidence without embeddings',async()=>{
 const f=chatCorpus();try {
  const result=await f.retrieval.retrieve('default',{kind:'vault'},'How does Augustine understand grace and where do my notes disagree?',{deep:true});
  assert.ok(result.evidence.some(e=>e.kind==='source'&&e.objectId===f.primary.id));
  assert.ok(result.evidence.some(e=>e.kind==='own_note'&&e.objectId===f.myNote.id));
  assert.ok(result.evidence.some(e=>e.kind==='source'&&e.objectId===f.opposing.id));
  assert.ok(result.evidence.length<=24);assert.ok(result.passes<=4);assert.equal(result.depth,'deep');
  assert.doesNotMatch(JSON.stringify(result),/VAULT_SECRET_93/);
  assert.equal(new Set(result.evidence.map(e=>e.id)).size,result.evidence.length);
  for(const evidence of result.evidence){assert.ok(evidence.fingerprint);assert.ok(evidence.locator);assert.equal(evidence.status,'current');}
 }finally{f.close();}
});

test('page and source scopes cannot silently broaden despite unmatched questions or mentions',async()=>{
 const f=chatCorpus();try {
  for(const scope of [{kind:'page',id:f.myNote.id},{kind:'source',id:f.primary.id}]) {
   const result=await f.retrieval.retrieve('default',scope,'What does Aquinas say about grace?',{deep:true,mentions:[{id:f.aquinas.id,name:'Aquinas'}]});
   assert.ok(result.evidence.every(e=>e.objectId===scope.id));
  }
  const none=await f.retrieval.retrieve('default',{kind:'page',id:f.myNote.id},'zqxunfindablevocabulary',{});
  assert.ok(none.evidence.every(e=>e.objectId===f.myNote.id));
  assert.throws(()=>f.retrieval.validateScope('default',{kind:'page',id:f.hidden.id}),e=>e.status===404);
  await assert.rejects(f.retrieval.retrieve('default',{kind:'vault'},'grace',{mentions:[{id:f.hidden.id,name:'Private'}]}));
 }finally{f.close();}
});

test('entity scope retrieves bounded recorded facts and directly connected material, preserving ambiguous IDs',async()=>{
 const f=chatCorpus();try {
  const result=await f.retrieval.retrieve('default',{kind:'entity',id:f.augustine.id},'What is recorded about Augustine and grace?',{});
  assert.ok(result.evidence.some(e=>e.kind==='entity_fact'));
  assert.ok(result.evidence.some(e=>e.kind==='entity_overview'&&e.objectId===f.augustine.id));
  assert.ok(result.evidence.some(e=>e.kind==='own_note'&&e.objectId===f.myNote.id));
  assert.ok(!result.evidence.some(e=>e.objectId===f.unrelated.id||e.objectId===f.opposing.id||e.objectId===f.ambiguous.id));
  const explicit=await f.retrieval.retrieve('default',{kind:'vault'},'What is Augustine?',{mentions:[{id:f.ambiguous.id,name:'Augustine'}]});
  assert.ok(explicit.evidence.some(e=>e.objectId===f.ambiguous.id));
 }finally{f.close();}
});

test('recorded locators are immutable and revisions, deletion and reprocessing visibly invalidate evidence',async()=>{
 const f=chatCorpus();try {
  const result=await f.retrieval.retrieve('default',{kind:'vault'},'Augustine grace',{}),snapshot=JSON.stringify(result.evidence);
  const page=result.evidence.find(e=>e.kind==='own_note'&&e.objectId===f.myNote.id),source=result.evidence.find(e=>e.kind==='source'&&e.objectId===f.primary.id),fact=result.evidence.find(e=>e.factId==='property:period');
  assert.ok(fact,'The recorded Period property must be retrieved');assert.ok(page?.pageReference);assert.ok(source?.reference);assert.ok(source.reference.generationId);assert.ok(source.reference.passageId);
  f.pages.update('default',f.myNote.id,{...f.myNote,blocks:[{id:'changed',type:'paragraph',content:[{text:'Revised grace reflection.'}]}]});
  f.store.run('UPDATE source_files SET text=? WHERE id=?','Reprocessed source text about grace.',f.primary.fileId);
  f.store.run('UPDATE properties SET value=? WHERE id=?','Changed fact','period');
  const validated=f.retrieval.validate('default',result.evidence);
  assert.equal(validated.find(e=>e.id===page.id).status,'stale');
  assert.equal(validated.find(e=>e.id===source.id).status,'stale');
  assert.equal(validated.find(e=>e.id===fact.id).status,'stale');
  assert.equal(JSON.stringify(result.evidence),snapshot);
  f.pages.delete('default',f.myNote.id);
  assert.equal(f.retrieval.validate('default',[page])[0].status,'deleted');
  assert.equal(f.retrieval.validate(f.other,[source])[0].status,'deleted');
 }finally{f.close();}
});

test('vault locks and cancellation are checked again after asynchronous retrieval',async()=>{
 const f=chatCorpus();try {
  let resolve,started;const entered=new Promise(r=>started=r);
  const original=f.embeddings.retrievePassages.bind(f.embeddings);
  f.embeddings.retrievePassages=async(...args)=>{const data=await original(...args);started();await new Promise(r=>resolve=r);return data;};
  const pending=f.retrieval.retrieve('default',{kind:'vault'},'grace',{});await entered;
  f.store.run("UPDATE vaults SET locked=1 WHERE id='default'");resolve();await assert.rejects(pending,e=>e.status===423);
  f.store.run("UPDATE vaults SET locked=0 WHERE id='default'");
  const controller=new AbortController();controller.abort();
  await assert.rejects(f.retrieval.retrieve('default',{kind:'vault'},'grace',{signal:controller.signal}));
 }finally{f.close();}
});
