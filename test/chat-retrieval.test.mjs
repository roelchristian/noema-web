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


function folderFixture(f) {
 for(const [id,vault,name,parent] of [['selected','default','Selected',null],['nested','default','Nested','selected'],['outside','default','Outside',null],['private',f.other,'Private',null]])f.store.run('INSERT INTO folders(id,vault_id,name,parent_id) VALUES(?,?,?,?)',id,vault,name,parent);
 const locate=(kind,id,folder,vault='default')=>f.store.run('INSERT INTO item_locations(vault_id,kind,item_id,folder_id) VALUES(?,?,?,?) ON CONFLICT(vault_id,kind,item_id) DO UPDATE SET folder_id=excluded.folder_id',vault,kind,id,folder);
 locate('page',f.myNote.id,'selected');locate('entity',f.primary.id,'nested');locate('page',f.unrelated.id,'outside');locate('entity',f.opposing.id,'outside');locate('entity',f.augustine.id,'selected');locate('page',f.hidden.id,'private',f.other);
 return {locate,scope:{kind:'folder',id:'selected'}};
}

test('folder context includes notes and sources in descendants without broadening through mentions or connections',async()=>{
 const f=chatCorpus();try {
  const {scope,locate}=folderFixture(f),archived=f.note('Archived grace note','Grace in an archived note.'),inactive=f.source('Inactive grace source','Grace in an inactive source.'),archivedSource=f.source('Archived grace source','Grace in an archived source.');
  locate('page',archived.id,'selected');f.store.run('UPDATE pages SET archived_at=? WHERE id=?',new Date().toISOString(),archived.id);
  locate('entity',inactive.id,'nested');f.store.run('UPDATE entities SET inactive=1 WHERE id=?',inactive.id);
  locate('entity',archivedSource.id,'nested');f.store.run('UPDATE entities SET archived_at=? WHERE id=?',new Date().toISOString(),archivedSource.id);
  for(const deep of [false,true]){
   const result=await f.retrieval.retrieve('default',scope,'What does Aquinas say about grace?',{deep,mentions:[{id:f.aquinas.id,name:'Aquinas'}]});
   assert.ok(result.evidence.some(e=>e.kind==='own_note'&&e.objectId===f.myNote.id));
   assert.ok(result.evidence.some(e=>e.kind==='source'&&e.objectId===f.primary.id));
   assert.ok(result.evidence.every(e=>[f.myNote.id,f.primary.id].includes(e.objectId)));
   assert.ok(result.evidence.every(e=>e.kind==='source'||e.kind==='own_note'),'Folder context does not import connected entity facts');
   assert.doesNotMatch(JSON.stringify(result),/VAULT_SECRET_93|ceremonial|cooperating with human freedom|archived note|inactive source|archived source/);
  }
  assert.throws(()=>f.retrieval.validateScope('default',{kind:'folder',id:'private'}),e=>e.status===404);
  assert.throws(()=>f.retrieval.validateScope(f.other,scope),e=>e.status===404);
  assert.throws(()=>f.retrieval.validateScope('default',{...scope,pageIds:[f.hidden.id]}),e=>e.status===400);
 }finally{f.close();}
});

test('empty and unmatched folder contexts remain empty rather than searching the vault',async()=>{
 const f=chatCorpus();try {
  const {scope}=folderFixture(f);
  f.store.run("INSERT INTO folders(id,vault_id,name) VALUES('empty','default','Empty')");
  assert.deepEqual((await f.retrieval.retrieve('default',{kind:'folder',id:'empty'},'Augustine grace',{deep:true,mentions:[{id:f.augustine.id,name:'Augustine'}]})).evidence,[]);
  assert.deepEqual((await f.retrieval.retrieve('default',scope,'zznonmatchingterm')).evidence,[]);
  f.store.run("DELETE FROM folders WHERE id='empty'");
  await assert.rejects(f.retrieval.retrieve('default',{kind:'folder',id:'empty'},'grace'),e=>e.status===404);
 }finally{f.close();}
});

test('folder context rejects a buggy adapter returning outside passages or forged inside-scope references',async()=>{
 const f=chatCorpus();try {
  const {scope}=folderFixture(f),all=await f.embeddings.retrievePassages('default',{query:'grace',limit:80,matchAny:true});
  const insideNote=all.results.find(row=>row.pageReference?.pageId===f.myNote.id),outsideNote=all.results.find(row=>row.pageReference?.pageId===f.unrelated.id),insideSource=all.results.find(row=>row.reference?.sourceId===f.primary.id),outsideSource=all.results.find(row=>row.reference?.sourceId===f.opposing.id);
  assert.ok(insideNote&&outsideNote&&insideSource&&outsideSource);
  f.embeddings.retrievePassages=async()=>({...all,results:[outsideNote,outsideSource,{...outsideNote,pageReference:insideNote.pageReference},{...outsideSource,reference:insideSource.reference}]});
  const result=await f.retrieval.retrieve('default',scope,'grace',{deep:true});
  assert.deepEqual(result.evidence,[],'Canonical passage IDs must belong to the selected folder, even when adapter labels lie');
 }finally{f.close();}
});

test('folder membership changes while retrieving cancel rather than using a stale scope snapshot',async t=>{
 for(const change of ['note moved','subfolder moved'])await t.test(change,async()=>{
  const f=chatCorpus();try {
   const {scope,locate}=folderFixture(f),original=f.embeddings.retrievePassages.bind(f.embeddings);
   f.embeddings.retrievePassages=async(...args)=>{const result=await original(...args);if(change==='note moved')locate('page',f.myNote.id,'outside');else f.store.run("UPDATE folders SET parent_id='outside' WHERE id='nested'");return result;};
   await assert.rejects(f.retrieval.retrieve('default',scope,'grace'),e=>e.status===409&&/folder contents changed/.test(e.message));
  }finally{f.close();}
 });
});

test('folder evidence revalidation invalidates moved material without changing historical snapshots',async()=>{
 const f=chatCorpus();try {
  const {scope,locate}=folderFixture(f),result=await f.retrieval.retrieve('default',scope,'grace'),snapshot=JSON.stringify(result.evidence);
  locate('page',f.myNote.id,'outside');f.store.run("UPDATE folders SET parent_id='outside' WHERE id='nested'");
  assert.ok(result.evidence.length>0);
  assert.ok(f.retrieval.validate('default',result.evidence).every(item=>item.status==='current'),'The content itself remains current');
  assert.ok(f.retrieval.validate('default',result.evidence,scope).every(item=>item.status==='stale'),'Current folder membership is part of answering authority');
  assert.equal(JSON.stringify(result.evidence),snapshot);
 }finally{f.close();}
});

test('oversized folder contexts fail explicitly instead of truncating the selected scope',async()=>{
 const f=chatCorpus();try {
  const {scope}=folderFixture(f);
  f.store.transaction(()=>{for(let i=0;i<201;i++){
   const id='bounded-source-'+i;f.store.run("INSERT INTO entities(id,vault_id,name,type,description,updated_at) VALUES(?,'default',?,'source','','2026-10-26')",id,id);
   f.store.run("INSERT INTO item_locations(vault_id,kind,item_id,folder_id) VALUES('default','entity',?,'selected')",id);
  }});
  let called=false;f.embeddings.retrievePassages=async()=>{called=true;return {results:[]};};
  await assert.rejects(f.retrieval.retrieve('default',scope,'grace'),e=>e.status===400&&/smaller folder/.test(e.message));assert.equal(called,false);
 }finally{f.close();}
});
