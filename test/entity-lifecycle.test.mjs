import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {lifecycleFixture} from './helpers/entity-lifecycle-fixture.mjs';
import {createApp} from '../src/server/http.ts';
import {SourceLifecycleService} from '../src/server/modules/source-lifecycle.ts';
import {identifyEntityMentions} from '../src/shared/auto-entities.ts';
import {mentionMatches} from '../src/client/editor/mention-picker.ts';
import {EntityMatches} from '../src/server/modules/entity-matches.ts';
const fail=(fn,status)=>assert.throws(fn,error=>error.status===status);
const paragraph=text=>({id:'new-text',type:'paragraph',content:[{text}]});
function preserved(f){return Object.fromEntries(['pages','properties','relationships','source_files','note_source_references','note_source_files','page_sources','highlights','page_reading_notes','source_reading_locations','source_documents','source_passages','favourites','collection_memberships'].map(table=>[table,f.store.all(`SELECT * FROM ${table} ORDER BY rowid`)]));}

test('entity inventory finds nested/table mentions, active and trashed pages, properties and relationships; lifecycle preserves all reference rows',async t=>{
 const f=await lifecycleFixture();t.after(()=>f.close());
 // Raw JSON, rather than the derived index, must drive the inventory.
 f.store.run('DELETE FROM page_mentioned_entities WHERE entity_id=?',f.person.id);
 const state=f.lifecycle.preview('default',f.person.id),before=preserved(f);
 assert.deepEqual([state.counts.activePages,state.counts.trashedPages,state.counts.blockReferences,state.counts.properties,state.counts.incomingProperties,state.counts.relationships],[1,1,4,1,1,1]);
 assert.equal(state.pages.find(page=>page.id===f.trashed.id).trashed,true);
 const matching=new EntityMatches(f.store,f.pages,f.knowledge);matching.get('default',f.active.id);
 const archived=f.lifecycle.change('default',f.person.id,false,state.version);
 assert.ok(archived.archivedAt);assert.equal(f.store.get('SELECT 1 FROM page_entity_match_cache WHERE page_id=?',f.active.id),undefined);
 assert.deepEqual(f.lifecycle.change('default',f.person.id,false,state.version),archived);
 assert.equal(f.knowledge.detail('default',f.person.id).incomingProperties.length,1);
 assert.equal(identifyEntityMentions([paragraph(f.person.name)],f.knowledge.list('default'),'default').count,0);
 assert.deepEqual(mentionMatches(f.knowledge.list('default'),f.person.name),[]);
 const restored=f.lifecycle.change('default',f.person.id,true,archived.version);assert.equal(restored.archivedAt,null);
 assert.deepEqual(f.lifecycle.change('default',f.person.id,true,archived.version),restored);
 assert.equal(identifyEntityMentions([paragraph(f.person.name)],f.knowledge.list('default'),'default').count,1);
 assert.ok(mentionMatches(f.knowledge.list('default'),f.person.name).some(entity=>entity.id===f.person.id));
 assert.deepEqual(preserved(f),before);
});

test('linked source archive retains citations, original evidence, highlights, reading notes and bookmarks, and keeps permanent deletion guards',async t=>{
 const f=await lifecycleFixture();t.after(()=>f.close());
 const state=f.lifecycle.preview('default',f.source.id),before=preserved(f),continuity=f.reading.continuity('default',f.file.id);
 assert.deepEqual([state.counts.activePages,state.counts.trashedPages,state.counts.attachments,state.counts.citations,state.counts.highlights,state.counts.readingNotes,state.counts.bookmarks],[2,1,1,2,1,1,1]);
 const archived=f.lifecycle.change('default',f.source.id,false,state.version);
 assert.ok(archived.archivedAt);assert.ok(archived.deleteBlockedReason);
 assert.equal(f.knowledge.detail('default',f.source.id).attachments[0].id,f.file.id);
 assert.deepEqual(f.reading.continuity('default',f.file.id),continuity);
 assert.equal(f.reading.list('default',f.file.id)[0].excerpt,f.highlight.excerpt);
 assert.equal(f.pages.get('default',f.note.id).readingNote.fileId,f.file.id);
 assert.equal(f.pages.get('default',f.active.id).blocks[0].content[1].sourceReference.fileId,f.file.id);
 fail(()=>new SourceLifecycleService(f.store).delete('default',f.source.id,f.source.name),409);
 assert.deepEqual(preserved(f),before);
 f.lifecycle.change('default',f.source.id,true,archived.version);assert.deepEqual(preserved(f),before);
});

test('stale preview, wrong/locked vault and failed transaction leave lifecycle untouched; stale explicit browser drafts may save valid archived references',async t=>{
 const f=await lifecycleFixture();t.after(()=>f.close());
 const state=f.lifecycle.preview('default',f.person.id);
 // Same reference count, changed stored page: preview must still become stale.
 f.pages.update('default',f.active.id,{...f.active,title:'Synthetic changed title'});
 fail(()=>f.lifecycle.change('default',f.person.id,false,state.version),409);
 fail(()=>f.lifecycle.change('default',f.person.id,false,undefined),409);
 const other=f.vaults.create({name:'Other synthetic vault'});
 fail(()=>f.lifecycle.preview(other.id,f.person.id),404);
 fail(()=>f.lifecycle.change(other.id,f.person.id,false,state.version),404);
 f.vaults.lock('default',{passphrase:'synthetic-only'});
 fail(()=>f.lifecycle.preview('default',f.person.id),423);fail(()=>f.lifecycle.change('default',f.person.id,false,state.version),423);
 f.vaults.unlock('default',{passphrase:'synthetic-only'});
 const fresh=f.lifecycle.preview('default',f.person.id),cache=new EntityMatches(f.store,f.pages,f.knowledge).get('default',f.active.id);
 f.store.db.exec("CREATE TEMP TRIGGER fail_archive BEFORE DELETE ON page_entity_match_cache BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(()=>f.lifecycle.change('default',f.person.id,false,fresh.version),/synthetic failure/);
 assert.equal(f.knowledge.require('default',f.person.id).archived_at,null);
 assert.equal(f.store.get('SELECT cache_key FROM page_entity_match_cache WHERE page_id=?',f.active.id).cache_key,cache.key);
 f.store.db.exec('DROP TRIGGER fail_archive');
 f.lifecycle.change('default',f.person.id,false,fresh.version);
 const sourceState=f.lifecycle.preview('default',f.source.id);f.lifecycle.change('default',f.source.id,false,sourceState.version);
 const draft=f.pages.get('default',f.active.id),saved=f.pages.update('default',draft.id,{...draft,title:'Draft saved after archival'});
 assert.equal(saved.blocks[0].content[0].entityId,f.person.id);assert.ok(saved.sourceIds.includes(f.source.id));
 fail(()=>f.pages.update(other.id,draft.id,draft),404);
 fail(()=>f.pages.update('default',draft.id,{...saved,blocks:[{...paragraph(''),content:[{entityId:'missing-entity'}]}]}),400);
 const archived=f.lifecycle.preview('default',f.person.id);f.lifecycle.change('default',f.person.id,true,archived.version);
 fail(()=>f.lifecycle.change('default',f.person.id,false,fresh.version),409); // ABA cannot reuse the pre-archive token.
});

test('HTTP lifecycle enforces preview versions, idempotency, vault access, and preserves linked source deletion protections',async t=>{
 const f=await lifecycleFixture(),server=createApp(f.store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));f.close();});
 const base='http://127.0.0.1:'+server.address().port;
 async function request(id,method='GET',body,vault='default',status=200){const response=await fetch(base+'/api/entities/'+id+'/lifecycle',{method,headers:{'Content-Type':'application/json','X-Noema-Request':'1','X-Vault-Id':vault},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;}
 for(const entity of [f.person,f.source]){
  const preview=await request(entity.id);
  await request(entity.id,'POST',{action:'archive',version:'stale'},'default',409);
  const archived=await request(entity.id,'POST',{action:'archive',version:preview.version});
  assert.ok(archived.archivedAt);assert.deepEqual(await request(entity.id,'POST',{action:'archive',version:preview.version}),archived);
  const restored=await request(entity.id,'POST',{action:'restore',version:archived.version});assert.equal(restored.archivedAt,null);
 }
 const other=f.vaults.create({name:'Wrong HTTP vault'});await request(f.person.id,'GET',undefined,other.id,404);
 await request(f.person.id,'POST',{action:'archive',version:'stale'},other.id,404);
 f.vaults.lock('default',{passphrase:'synthetic-only'});await request(f.source.id,'GET',undefined,'default',423);await request(f.source.id,'POST',{action:'archive'},'default',423);f.vaults.unlock('default',{passphrase:'synthetic-only'});
 const preview=await request(f.source.id);await request(f.source.id,'POST',{action:'archive',version:preview.version});await request(f.source.id,'POST',{action:'delete',confirmation:f.source.name},'default',409);
});

test('archived identities cannot be accepted from legacy scans or silently recreated by fresh discovery and author matching',async t=>{
 const {EntityScans}=await import('../src/server/modules/entity-scan.ts'),{saveSourceAuthors}=await import('../src/server/modules/source-authors.ts');
 const f=await lifecycleFixture();t.after(()=>f.close());
 let page=f.pages.create('default',{title:'Synthetic discovery'});page=f.pages.update('default',page.id,{...page,blocks:[paragraph(f.person.name+' spoke.')]});
 const scanner=new EntityScans(f.store,f.pages,f.knowledge,undefined),candidate={name:f.person.name,type:'person',subtypes:[],description:'',evidence:f.person.name,reason:'Named',existingId:f.person.id};
 const scan=scanner.save('default',page,JSON.stringify({suggestions:[candidate]}),{},false);
 // Legacy saved scans lack contextKey; acceptance must still check current eligibility.
 delete scan.contextKey;
 f.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'entity_scan',?,?,'synthetic','none',?)",page.id,JSON.stringify({scan}),page.revision,new Date().toISOString());
 const state=f.lifecycle.preview('default',f.person.id);f.lifecycle.change('default',f.person.id,false,state.version);
 fail(()=>scanner.review('default',page.id,{scanId:scan.id,suggestionId:scan.suggestions[0].id,revision:page.revision,decision:'accepted'}),409);
 assert.deepEqual(scanner.save('default',page,JSON.stringify({suggestions:[{...candidate,existingId:null}]}),{},false).suggestions,[]);
 assert.equal(JSON.parse(scanner.input('default',page)).existingEntities.some(entity=>entity.id===f.person.id),false);
 const count=f.knowledge.list('default').length;saveSourceAuthors(f.store,'default',f.source.id,[{name:f.person.name,type:'person'}]);
 assert.equal(f.knowledge.list('default').length,count);assert.ok(f.store.get("SELECT 1 FROM property_proposals WHERE entity_id=? AND property_name='author' AND value=? AND target_id IS NULL AND status='pending'",f.source.id,f.person.name));
});

test('archive integration preserves occurrence-only links and excluded text through saves, restoration and vault import',async t=>{
 const {linkedEntityIds}=await import('../src/shared/auto-entities.ts'),{VaultBackups}=await import('../src/server/modules/vault-backups.ts');
 const f=await lifecycleFixture();t.after(()=>f.close());
 f.knowledge.addAlias('default',f.peer.id,{alias:f.person.name});
 let page=f.pages.create('default',{title:'Synthetic historical occurrence'});
 page=f.pages.update('default',page.id,{...page,blocks:[{id:'occurrence-body',type:'paragraph',content:[{entityId:f.person.id,mentionText:'Archivist',skipAutoTag:true},{text:' Synthetic Archivist listened. '},{text:'Synthetic Archivist',skipAutoTag:true}]}]});
 const original=page.blocks,match=new EntityMatches(f.store,f.pages,f.knowledge),before=match.get('default',page.id);
 assert.equal(linkedEntityIds(page.blocks).has(f.person.id),false);assert.equal(before.matches.length,1);
 const state=f.lifecycle.preview('default',f.person.id),archived=f.lifecycle.change('default',f.person.id,false,state.version);
 const during=match.get('default',page.id);assert.notEqual(during.key,before.key);assert.ok(during.matches.every(item=>!item.entityIds.includes(f.person.id)));
 const tagged=identifyEntityMentions(page.blocks,f.knowledge.list('default'),'default');assert.deepEqual(tagged.blocks[0].content[0],original[0].content[0]);assert.deepEqual(tagged.blocks[0].content.at(-1),original[0].content.at(-1));
 assert.equal(mentionMatches(f.knowledge.list('default'),f.person.name).some(entity=>entity.id===f.person.id),false);
 page=f.pages.update('default',page.id,{...page,title:page.title+' saved while archived'});assert.deepEqual(page.blocks,original);
 const fresh=f.lifecycle.preview('default',f.person.id);f.lifecycle.change('default',f.person.id,true,fresh.version);
 assert.deepEqual(f.pages.get('default',page.id).blocks,original);assert.equal(match.get('default',page.id).matches.length,1);assert.equal(linkedEntityIds(page.blocks).has(f.person.id),false);
 const backups=new VaultBackups(f.store),backup=await backups.export('default'),restored=await backups.import(backup.bytes,'Synthetic occurrence import');
 const imported=f.pages.list(restored.id).find(item=>item.title===page.title),blocks=f.pages.get(restored.id,imported.id).blocks;
 assert.equal(blocks[0].content[0].skipAutoTag,true);assert.equal(blocks[0].content[2].skipAutoTag,true);assert.equal(blocks[0].content[0].mentionText,'Archivist');assert.equal(linkedEntityIds(blocks).size,0);
 assert.equal(identifyEntityMentions(blocks,f.knowledge.list(restored.id),restored.id).ambiguous.length,1);
});
