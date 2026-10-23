import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {saveSourceAuthors} from '../src/server/modules/source-authors.ts';
import {syncSourceProvenance} from '../src/server/modules/source-provenance.ts';
import {SourceEnrichments} from '../src/server/modules/source-enrichments.ts';
import {SourceAuthorBackfill} from '../src/server/modules/source-author-backfill.ts';
import {getNameProvenance,getPropertyProvenance,rawSourceHash,recordEntityNameProvenance} from '../src/server/modules/property-provenance.ts';
async function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-source-governance-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db),files=new SourceFiles(store),knowledge=new Knowledge(store);
 t.after(()=>{files.close();db.close();rmSync(dir,{recursive:true,force:true});});
 const file=files.add('default','synthetic.md',Buffer.from('Synthetic author evidence.'));
 const source=knowledge.create('default',{type:'source',name:'Authored source title',attachmentIds:[file.id]});await files.tick();
 store.run("UPDATE source_files SET status='ready',enrichment_status='pending',text='Synthetic author evidence.',contains_math=0 WHERE id=?",file.id);
 return {store,knowledge,files,source,file:files.require('default',file.id)};
}
const activity={start:()=> 'mock-activity',request:()=>{},finish:()=>{}};
function intelligence(run){return {status:()=>({configured:true}),selection:()=>({}),enrichSource:run,extractSourceAuthors:async()=>[]};}
const result={name:'Extracted source title',language:'en',summary:'Synthetic summary',structure:[],authors:[]};

test('extracted credits retain authored IDs and semicolon literals, propose identities without creating them, and remain idempotent',async t=>{
 const f=await fixture(t),{store,source,knowledge,file}=f;
 const person=knowledge.create('default',{type:'person',name:'Known Author'}),archived=knowledge.create('default',{type:'person',name:'Archived Author'});
 store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id=?",archived.id);
 knowledge.create('default',{type:'person',name:'Ambiguous One',aliases:['Shared Author']});knowledge.create('default',{type:'person',name:'Ambiguous Two',aliases:['Shared Author']});
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','authored-credit',source.id,'author','Known Author; Uncertain Author',null);
 const before=store.all('SELECT * FROM properties WHERE entity_id=? ORDER BY id',source.id),count=store.get('SELECT COUNT(*) n FROM entities').n;
 const authors=['Known Author','Archived Author','Shared Author','Unknown Author'].map(name=>({name,type:'person'}));
 assert.equal(saveSourceAuthors(store,'default',source.id,authors,{file,workflow:'synthetic_test'}),true);
 assert.deepEqual(store.all('SELECT * FROM properties WHERE entity_id=? ORDER BY id',source.id),before);assert.equal(store.get('SELECT COUNT(*) n FROM entities').n,count);
 const proposals=store.all('SELECT * FROM property_proposals WHERE entity_id=?',source.id);assert.equal(proposals.length,4);
 assert.equal(proposals.find(row=>row.target_id===person.id).property_id,'authored-credit');
 for(const name of ['Archived Author','Shared Author','Unknown Author'])assert.ok(proposals.some(row=>row.value===name&&row.target_id===null));
 assert.ok(proposals.every(row=>row.source_file_id===file.id&&row.source_hash===rawSourceHash(file.text)));
 store.run("UPDATE property_proposals SET status='rejected' WHERE target_id=?",person.id);
 assert.equal(saveSourceAuthors(store,'default',source.id,authors,{file}),false);assert.equal(store.get('SELECT status FROM property_proposals WHERE target_id=?',person.id).status,'rejected');
});

test('attachment metadata retains stable current and stale imported IDs and protects unknown conflicting values',async t=>{
 const {store,source,file}=await fixture(t);
 store.run("UPDATE source_files SET source_url='https://first.example' WHERE id=?",file.id);syncSourceProvenance(store,'default',source.id);
 const first=store.get("SELECT * FROM properties WHERE entity_id=? AND name='Source URL'",source.id),origin=getPropertyProvenance(store,'default',first.id);
 assert.equal(origin.origin,'imported');assert.equal(origin.source_file_id,file.id);assert.equal(origin.source_hash,null);
 syncSourceProvenance(store,'default',source.id);assert.equal(store.get("SELECT id FROM properties WHERE entity_id=? AND name='Source URL'",source.id).id,first.id);
 store.run("UPDATE source_files SET source_url='https://second.example' WHERE id=?",file.id);syncSourceProvenance(store,'default',source.id);
 assert.equal(store.get('SELECT value FROM properties WHERE id=?',first.id).value,'https://first.example');assert.equal(getPropertyProvenance(store,'default',first.id).stale,true);
 assert.ok(store.get("SELECT 1 FROM properties WHERE entity_id=? AND value='https://second.example'",source.id));
 store.run('INSERT INTO properties VALUES (?,?,?,?,?)','legacy-url',source.id,'Source URL','https://authored.example',null);
 store.run("UPDATE source_files SET source_url='https://third.example' WHERE id=?",file.id);syncSourceProvenance(store,'default',source.id);
 assert.equal(store.get('SELECT value FROM properties WHERE id=?','legacy-url').value,'https://authored.example');
 assert.ok(store.get("SELECT 1 FROM property_proposals WHERE property_id='legacy-url' AND value='https://third.example'"));
});

test('enrichment retains manual and unknown titles, while derived titles use a guarded automatic policy',async t=>{
 for(const origin of ['manual','legacy_unknown','derived']){
  const {store,source,file}=await fixture(t);recordEntityNameProvenance(store,'default',source.id,{origin});
  const pipeline=new SourceEnrichments(store,intelligence(async()=>result),activity);t.after(()=>pipeline.close());await pipeline.tick();
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,origin==='derived'?result.name:source.name);
  assert.equal(store.get('SELECT enrichment_status FROM source_files WHERE id=?',file.id).enrichment_status,'completed');
  if(origin==='derived')assert.equal(getNameProvenance(store,'default',source.id).origin,'ai');
  else assert.ok(store.get("SELECT 1 FROM property_proposals WHERE entity_id=? AND kind='entity_name' AND value=?",source.id,result.name));
 }
});

test('manual title edits, archival and automation pauses during requests win over late enrichment',async t=>{
 for(const mutation of ['manual','archive','pause']){
  const {store,source,file}=await fixture(t);recordEntityNameProvenance(store,'default',source.id,{origin:'derived'});
  const pipeline=new SourceEnrichments(store,intelligence(async()=>{
   if(mutation==='manual'){store.run("UPDATE entities SET name='User revised title',updated_at='later' WHERE id=?",source.id);recordEntityNameProvenance(store,'default',source.id,{origin:'manual'});}
   if(mutation==='archive')store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id=?",source.id);
   if(mutation==='pause')store.run('INSERT INTO source_automation_pauses(file_id,vault_id,reason,created_at) VALUES (?,?,?,?)',file.id,'default','Restore hold','2026-01-01');
   return result;
  }),activity);t.after(()=>pipeline.close());await pipeline.tick();
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,mutation==='manual'?'User revised title':source.name);
  assert.equal(store.get('SELECT enrichment_status FROM source_files WHERE id=?',file.id).enrichment_status,mutation==='manual'?'completed':'pending');
 }
});

test('paused and archived sources never request enrichment or author backfill; deliberate retry clears restore pause',async t=>{
 const {store,source,file}=await fixture(t);let requests=0;
 const ai={...intelligence(async()=>{requests++;return result;}),extractSourceAuthors:async()=>{requests++;return [];}};
 store.run('INSERT INTO source_automation_pauses(file_id,vault_id,reason,created_at) VALUES (?,?,?,?)',file.id,'default','Restore hold','2026-01-01');
 const pipeline=new SourceEnrichments(store,ai,activity),backfill=new SourceAuthorBackfill(store,ai,activity);t.after(()=>{pipeline.close();backfill.close();});
 await pipeline.tick();store.run("UPDATE source_files SET enrichment_status='completed' WHERE id=?",file.id);await backfill.tick();assert.equal(requests,0);
 pipeline.retry('default',file.id);assert.equal(store.get('SELECT 1 FROM source_automation_pauses WHERE file_id=?',file.id),undefined);
 store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id=?",source.id);await pipeline.tick();store.run("UPDATE source_files SET enrichment_status='completed' WHERE id=?",file.id);await backfill.tick();assert.equal(requests,0);
});

test('author backfill does not apply results after archival, pause, or extracted-text change',async t=>{
 for(const mutation of ['archive','pause','text']){
  const {store,source,file}=await fixture(t);store.run("UPDATE source_files SET enrichment_status='completed' WHERE id=?",file.id);
  const ai={...intelligence(async()=>result),extractSourceAuthors:async()=>{
   if(mutation==='archive')store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id=?",source.id);
   if(mutation==='pause')store.run('INSERT INTO source_automation_pauses(file_id,vault_id,reason,created_at) VALUES (?,?,?,?)',file.id,'default','Restore hold','2026-01-01');
   if(mutation==='text')store.run("UPDATE source_files SET text='Changed evidence' WHERE id=?",file.id);
   return [{name:'New extracted author',type:'person'}];
  }};
  const backfill=new SourceAuthorBackfill(store,ai,activity);t.after(()=>backfill.close());await backfill.tick();
  assert.equal(store.get('SELECT COUNT(*) n FROM property_proposals WHERE entity_id=?',source.id).n,0);
  assert.equal(store.get("SELECT 1 FROM entities WHERE name='New extracted author'"),undefined);
 }
});

test('enrichment discards stale extracted evidence without saving metadata or title proposals',async t=>{
 const {store,source,file}=await fixture(t);
 const pipeline=new SourceEnrichments(store,intelligence(async()=>{store.run("UPDATE source_files SET text='Replacement evidence' WHERE id=?",file.id);return result;}),activity);t.after(()=>pipeline.close());await pipeline.tick();
 assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,source.name);
 assert.equal(store.get('SELECT COUNT(*) n FROM property_proposals WHERE entity_id=?',source.id).n,0);
 assert.equal(store.get('SELECT enrichment_status FROM source_files WHERE id=?',file.id).enrichment_status,'pending');
});

test('downloaded filenames preserve manual and unknown matching placeholders and use fresh derived provenance with CAS',async t=>{
 const {syncDownloadedSourceName}=await import('../src/server/modules/source-files.ts');
 for(const mode of ['manual','legacy_unknown','derived','stale','edited','archived']){
  const {store,source,file}=await fixture(t);
  store.run('UPDATE entities SET name=?,updated_at=? WHERE id=?',file.name,'before-download',source.id);
  recordEntityNameProvenance(store,'default',source.id,{origin:mode==='manual'||mode==='legacy_unknown'?mode:'derived',stale:mode==='stale'});
  const expected=store.get('SELECT name,updated_at FROM entities WHERE id=?',source.id);
  if(mode==='edited')store.run("UPDATE entities SET updated_at='edited-during-download' WHERE id=?",source.id);
  if(mode==='archived')store.run("UPDATE entities SET archived_at='2026-01-01' WHERE id=?",source.id);
  store.transaction(()=>syncDownloadedSourceName(store,file,'downloaded.md',expected));
  assert.equal(store.get('SELECT name FROM entities WHERE id=?',source.id).name,mode==='derived'?'downloaded.md':file.name);
  if(mode==='derived'){const origin=getNameProvenance(store,'default',source.id);assert.equal(origin.origin,'derived');assert.equal(origin.source_file_id,file.id);assert.equal(origin.source_hash,null);}
 }
});
