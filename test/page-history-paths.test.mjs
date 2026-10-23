import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePages,SourcePageDraft} from '../src/server/modules/source-pages.ts';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import {PageHistory} from '../src/server/modules/page-history.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {EntityScans} from '../src/server/modules/entity-scan.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {defaultSourcePageOptions} from '../src/shared/source-page.ts';
async function fixture(run){
 const dir=mkdtempSync(join(tmpdir(),'noema-history-paths-')),db=openDatabase(join(dir,'fixture.sqlite')),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),files=new SourceFiles(store),history=new PageHistory(store);
 try{const file=files.add('default','synthetic.txt',Buffer.from('An identity preserves each element.'));const source=knowledge.create('default',{name:'Synthetic source',type:'source',attachmentIds:[file.id]});await files.tick();await run({db,store,knowledge,pages,files,history,source,file:files.require('default',file.id)});}finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
}
const failHistory=db=>db.exec("CREATE TRIGGER synthetic_history_write_failure BEFORE INSERT ON page_versions BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END");

test('AI source acceptance records only its final generated state and rolls back acceptance on history failure',async()=>fixture(async env=>{
 const {store,pages,knowledge,source,history,db}=env,sources=new SourcePages(store,knowledge,pages),options={...defaultSourcePageOptions,language:'English'};
 const prepared=sources.prepare('default',source.id,{requestId:randomUUID(),focus:'Explain identity.',options}),draft=new SourcePageDraft(()=>{},prepared.file.text,prepared.file,options.language);
 draft.feed(JSON.stringify({type:'title',title:'Identity explanation',language:'en'})+'\n');draft.feed(JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'The identity preserves each element.',citations:[{startLine:1,endLine:1}]})+'\n');draft.finish();
 const staged=sources.stage('default',prepared,draft,'missing-activity'),before=store.get('SELECT count(*) AS n FROM pages').n;failHistory(db);
 assert.throws(()=>sources.accept('default',source.id,staged.id),/synthetic history failure/);assert.equal(store.get('SELECT count(*) AS n FROM pages').n,before);assert.equal(store.get('SELECT status FROM source_page_drafts WHERE request_id=?',staged.id).status,'pending');assert.equal(store.get('SELECT 1 FROM source_page_creations WHERE request_id=?',staged.id),undefined);
 db.exec('DROP TRIGGER synthetic_history_write_failure');const {page}=sources.accept('default',source.id,staged.id),versions=history.list('default',page.id);assert.equal(versions.length,1);assert.equal(versions[0].kind,'ai_acceptance');const snapshot=history.get('default',page.id,versions[0].id).snapshot;assert.equal(snapshot.creationMethod,'ai_generated');assert.deepEqual(snapshot.generationMetadata,page.generationMetadata);assert.deepEqual(snapshot.sourceIds,[source.id]);assert.deepEqual(snapshot.blocks,page.blocks);assert.ok(snapshot.blocks.length>0);
}));

test('reading-note creation and copy preserve source anchors through history backup, with atomic failure',async()=>fixture(async({db,store,pages,history,source,file})=>{
 const reading=new SourceReading(store),selection={sourceId:source.id,fileId:file.id,sourceHash:createHash('sha256').update(file.text).digest('hex'),startOffset:0,endOffset:file.text.length,excerpt:file.text,requestId:randomUUID(),text:'My synthetic reading note.'};failHistory(db);
 assert.throws(()=>reading.createReadingNote('default',file.id,selection),/synthetic history failure/);assert.equal(store.get('SELECT 1 FROM pages WHERE id=?',selection.requestId),undefined);assert.equal(store.get('SELECT 1 FROM page_reading_notes WHERE page_id=?',selection.requestId),undefined);
 db.exec('DROP TRIGGER synthetic_history_write_failure');const note=reading.createReadingNote('default',file.id,selection),version=history.list('default',note.id)[0],snapshot=history.get('default',note.id,version.id).snapshot;assert.equal(snapshot.readingNote.sourceId,source.id);
 const copy=history.copy('default',note.id,version.id,{revision:note.revision},pages);assert.deepEqual(copy.readingNote,note.readingNote);assert.equal(copy.creationMethod,'manual_creation');
 const backups=new VaultBackups(store),archive=await backups.export('default'),vault=await backups.import(archive.bytes,'Synthetic restored history');
 const copied=pages.list(vault.id).filter(item=>item.title===note.title);assert.equal(copied.length,2);for(const item of copied){const archived=history.get(vault.id,item.id,history.list(vault.id,item.id)[0].id).snapshot;assert.ok(archived.readingNote);assert.notEqual(archived.readingNote.sourceId,source.id);assert.notEqual(archived.readingNote.fileId,file.id);assert.equal(archived.readingNote.reference.sourceId,archived.readingNote.sourceId);}
}));

test('entity acceptance cannot commit its page, new entities, or scan decisions without history',async()=>fixture(async({db,store,knowledge,pages,history})=>{
 let page=pages.create('default',{title:'Synthetic names'});page=pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',checked:false,content:[{text:'Luma observed a star.'}]}]});
 const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages)),scan=scans.save('default',page,JSON.stringify({suggestions:[{name:'Luma',type:'person',subtypes:[],description:'A synthetic observer.',evidence:'Luma',reason:'A named person.',existingId:null}]}),{model:'synthetic',reasoningEffort:'none'}),request={revision:page.revision,scanId:scan.id,suggestionId:scan.suggestions[0].id,decision:'accepted'},before=store.get('SELECT * FROM pages WHERE id=?',page.id),count=history.list('default',page.id).length;
 failHistory(db);assert.throws(()=>scans.review('default',page.id,request),/synthetic history failure/);assert.deepEqual(store.get('SELECT * FROM pages WHERE id=?',page.id),before);assert.equal(knowledge.list('default').some(entity=>entity.name==='Luma'),false);assert.equal(history.list('default',page.id).length,count);
 db.exec('DROP TRIGGER synthetic_history_write_failure');const result=scans.review('default',page.id,request);assert.ok(result.page.blocks[0].content.some(segment=>segment.entityId));assert.equal(history.list('default',page.id).length,count+1);assert.deepEqual(history.get('default',page.id,history.list('default',page.id)[0].id).snapshot.blocks,result.page.blocks);
}));

test('inferred language and field origins alone do not manufacture a durable edit',async()=>fixture(async({store,pages,history})=>{
 let page=pages.create('default',{title:'Authored title'}),count=history.list('default',page.id).length;store.run('UPDATE pages SET language=? WHERE id=?','fr',page.id);const state=new PageEnrichmentState(store);state.setField(page.id,'language',{origin:'inferred'});state.setField(page.id,'domains',{origin:'inferred'});page=pages.get('default',page.id);pages.update('default',page.id,page);assert.equal(history.list('default',page.id).length,count);
}));


test('restore preserves unknown creation provenance and restores manual classifications without derived caches',async()=>fixture(async({store,pages,history})=>{
 let page=pages.create('default',{title:'Legacy origin',language:'en'});store.run('UPDATE pages SET creation_method=NULL WHERE id=?',page.id);
 const unknown=history.checkpoint('default',page.id,{revision:page.revision,name:'Unknown origin'}),domainId=store.get('SELECT id FROM domains ORDER BY id LIMIT 1').id;
 new Domains(store).setManual('default',page.id,{primaryDomainId:domainId,secondaryDomainIds:[]},page.revision);page=pages.get('default',page.id);const classified=history.list('default',page.id)[0];
 new PageEnrichmentState(store).suppressSummary(page.id);page=history.restore('default',page.id,unknown.id,{revision:page.revision},pages);assert.equal(page.creationMethod,null);assert.equal(page.pageDomains.primaryDomainId,null);assert.equal(page.enrichmentFields.summary.suppressed,true);
 page=history.restore('default',page.id,classified.id,{revision:page.revision},pages);assert.equal(page.creationMethod,null);assert.equal(page.pageDomains.primaryDomainId,domainId);assert.equal(page.pageDomains.origin,'manual');assert.equal(page.language,'en');assert.equal(page.enrichmentFields.language.origin,'manual');
}));
