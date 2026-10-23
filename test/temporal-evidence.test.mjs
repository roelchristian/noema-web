import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePassages} from '../src/server/modules/source-passages.ts';
import {SourceLifecycleService} from '../src/server/modules/source-lifecycle.ts';
import {TemporalIndex} from '../src/server/modules/temporal.ts';
import {currentTemporalSources} from '../src/server/modules/temporal-sources.ts';
import {adaptTemporalProperty} from '../src/shared/temporal-properties.ts';
import {extractTemporal} from '../src/shared/temporal.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SemanticPassageText} from '../src/client/sources/SourceViewer.tsx';
const dateId='gregorian:day:2026-10-23';
function fixture(t) {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-temporal-evidence-')),db=openDatabase(path.join(directory,'test.sqlite')),store=new Store(db),vaults=new Vaults(store),vault=vaults.create({name:'Temporal evidence'}).id,knowledge=new Knowledge(store),index=new TemporalIndex(store),passages=new SourcePassages(store,text=>Math.ceil(text.length/4));
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 const source=text=>{const file=new SourceFiles(store).add(vault,'Synthetic.txt',Buffer.from(text));const entity=knowledge.create(vault,{name:'Synthetic source',type:'source',attachmentIds:[file.id]});store.run("UPDATE source_files SET status='ready',admitted=1,text=? WHERE id=?",text,file.id);store.run('UPDATE entities SET inactive=0 WHERE id=?',entity.id);passages.synchronize(vault);return {file,entity};};
 return {store,vault,vaults,knowledge,index,passages,source};
}
test('bounded source batches deduplicate overlap by absolute span, retain repeated occurrences and reuse parsing',t=>{
 const f=fixture(t),text='Synthetic context '.repeat(105)+'23 October 2026. '+'Research words '.repeat(240)+'23 October 2026. October 2026. in 1848.';
 const {file}=f.source(text),snapshot=f.index.sources.prepare(f.vault,file.id,1),concurrent=f.index.sources.prepare(f.vault,file.id,1);assert.equal(snapshot.passages.length,1);assert.equal(snapshot.hasMore,true);assert.equal(f.index.sources.commit(snapshot),true);assert.equal(f.index.sources.commit(concurrent),false,'older batch cannot replace newer progress');
 assert.equal(f.store.get(`SELECT count(*) n ${currentTemporalSources}`,f.vault,dateId).n,0,'incomplete generation is not presented as final evidence');
 while(f.store.get('SELECT 1 FROM temporal_source_dirty WHERE file_id=?',file.id))f.index.sources.refresh(f.vault,1);
 const rows=f.store.all('SELECT * FROM temporal_source_mentions WHERE file_id=? AND stale=0 ORDER BY start_offset',file.id),expected=extractTemporal(text);
 assert.deepEqual(rows.map(row=>[row.start_offset,row.end_offset,row.original_text]),expected.map(item=>[item.start,item.end,item.text]));
 assert.equal(rows.filter(row=>row.date_id===dateId).length,2);
 for(const row of rows){const evidence=f.index.sources.resolve(f.vault,row.id);assert.equal(evidence.status,'current');assert.equal(text.slice(evidence.sourceReference.startOffset,evidence.sourceReference.endOffset),evidence.sourceReference.excerpt);assert.ok(evidence.sourceReference.generationId);assert.ok(evidence.sourceReference.passageId);}
 const ids=rows.map(row=>row.id);f.store.run('INSERT OR REPLACE INTO temporal_source_dirty VALUES (?,?)',file.id,f.vault);f.index.sources.refresh(f.vault);assert.deepEqual(f.store.all('SELECT id FROM temporal_source_mentions WHERE file_id=? AND stale=0 ORDER BY start_offset',file.id).map(row=>row.id),ids);
 f.store.run('UPDATE source_files SET text=? WHERE id=?',text+' Additional text.',file.id);f.passages.synchronize(f.vault);assert.ok(f.index.sources.prepare(f.vault,file.id).passages.some(item=>item.cached),'unchanged passage content skips extraction');
});
test('source revisions reject old work and retain manually curated stale evidence without redirecting',t=>{
 const f=fixture(t),{file,entity}=f.source('23 October 2026. Another 23 October 2026.');f.index.refresh(f.vault);
 const original=f.index.detail(f.vault,dateId).sources[1];const old=f.index.sources.prepare(f.vault,file.id);
 const event=f.knowledge.create(f.vault,{name:'A research event',type:'event'});f.index.curate(f.vault,'2026-10-23',{label:'Keep independent curation'});f.index.relate(f.vault,dateId,{entityId:event.id,sourceMentionId:original.id,kind:'discusses'});
 f.store.run('UPDATE source_files SET text=? WHERE id=?','A relocated 23 October 2026.',file.id);
 assert.equal(f.index.sources.resolve(f.vault,original.id).status,'stale');assert.equal(f.index.sources.commit(old),false);f.passages.synchronize(f.vault);assert.equal(f.index.sources.commit(old),false);f.index.refresh(f.vault);
 const current=f.index.detail(f.vault,dateId);assert.equal(current.sources.length,1);assert.notEqual(current.sources[0].id,original.id);assert.equal(current.relations[0].evidence.status,'stale');assert.equal(current.curation.label,'Keep independent curation');
 assert.throws(()=>f.index.relate(f.vault,dateId,{entityId:event.id,sourceMentionId:original.id,kind:'deadline'}),error=>error.status===409);
 f.store.run('UPDATE entities SET archived_at=? WHERE id=?',new Date().toISOString(),entity.id);assert.equal(f.index.sources.resolve(f.vault,current.sources[0].id).status,'unavailable');assert.equal(f.index.detail(f.vault,dateId).sources.length,0);
 f.store.run('UPDATE entities SET archived_at=NULL WHERE id=?',entity.id);f.index.refresh(f.vault);assert.equal(f.index.sources.resolve(f.vault,current.sources[0].id).status,'current');
 const lifecycle=new SourceLifecycleService(f.store);lifecycle.archive(f.vault,entity.id);lifecycle.delete(f.vault,entity.id,entity.name);const retained=f.index.detail(f.vault,dateId);assert.equal(retained.sources.length,0);assert.equal(retained.relations.length,1);assert.equal(retained.relations[0].sourceMentionId,null);assert.equal(retained.curation.label,'Keep independent curation');
});
test('typed properties preserve raw text and precision; proposals require explicit versioned review',t=>{
 const f=fixture(t),person=f.knowledge.create(f.vault,{name:'A person',type:'person'});
 f.knowledge.property(f.vault,person.id,{name:'birth date',value:'October 2026'});const property=f.knowledge.detail(f.vault,person.id).properties[0];
 f.index.refresh(f.vault);assert.equal(f.knowledge.detail(f.vault,person.id).properties[0].value,'October 2026');
 let detail=f.index.detail(f.vault,'gregorian:month:2026-10');assert.equal(detail.properties[0].raw,'October 2026');assert.equal(detail.date.precision,'month');assert.equal(detail.relations.length,0);assert.equal(detail.proposals[0].status,'pending');
 assert.equal(f.index.query(f.vault,'2026-10-01','2026-10-31').items.length,0,'recognition does not create an accepted calendar relationship');
 const proposal=detail.proposals[0];f.index.reviewRelation(f.vault,proposal.id,{status:'accepted',version:proposal.version});detail=f.index.detail(f.vault,detail.date.id);assert.equal(detail.relations[0].kind,'born_on');assert.equal(detail.relations[0].evidence.raw,'October 2026');
 f.knowledge.property(f.vault,person.id,{name:'birth date',value:'03/04/2026'},property.id);f.index.refresh(f.vault);
 assert.equal(f.index.detail(f.vault,detail.date.id).relations[0].evidence.status,'stale');assert.equal(f.store.get('SELECT reason FROM temporal_property_values WHERE property_id=?',property.id).reason.length>0,true);
 assert.throws(()=>f.index.reviewRelation(f.vault,proposal.id,{status:'accepted',version:proposal.version}),error=>error.status===409);
 assert.equal(f.knowledge.detail(f.vault,person.id).properties[0].value,'03/04/2026');
 f.knowledge.property(f.vault,person.id,{name:'birth date',value:'2026-10-23'},property.id);f.index.refresh(f.vault);const next=f.index.detail(f.vault,dateId).proposals[0];f.index.reviewRelation(f.vault,next.id,{status:'rejected',version:next.version});f.store.run('INSERT OR REPLACE INTO temporal_property_dirty VALUES (?,?)',property.id,f.vault);f.index.refresh(f.vault);assert.equal(f.index.detail(f.vault,dateId).proposals.length,1);assert.equal(f.index.detail(f.vault,dateId).proposals[0].status,'rejected');
 for(const [type,name,raw,value] of [['event','start date','2026-10','2026-10'],['creativework','release date','23 October 2026','2026-10-23'],['source','publication date','1848','1848']])assert.equal(adaptTemporalProperty(type,name,raw).date.value,value);
 assert.equal(adaptTemporalProperty('event','location','1848'),null);assert.equal(adaptTemporalProperty('person','birth date','Next Thursday').date,null);
});
test('source and property temporal evidence enforces vault locking and cross-vault isolation',t=>{
 const f=fixture(t),{file}=f.source('23 October 2026');f.index.refresh(f.vault);const mention=f.index.detail(f.vault,dateId).sources[0],foreign=f.vaults.create({name:'Foreign'}).id;
 assert.equal(f.index.sources.resolve(foreign,mention.id).status,'unavailable');assert.equal(f.index.sources.prepare(foreign,file.id),null);assert.deepEqual(f.index.query(foreign,'2026-10-01','2026-10-31',true).items,[]);
 f.vaults.lock(f.vault,{passphrase:'synthetic'});for(const work of [()=>f.index.sources.resolve(f.vault,mention.id),()=>f.index.sources.prepare(f.vault,file.id),()=>f.index.properties.refresh(f.vault)])assert.throws(work,error=>error.status===423);
});

test('backup remaps source/property support, retains review decisions and curation, and keeps historical generations stale',async t=>{
 const f=fixture(t),{file}=f.source('23 October 2026.');f.index.refresh(f.vault);const mention=f.index.detail(f.vault,dateId).sources[0],event=f.knowledge.create(f.vault,{name:'A portable event',type:'event'});
 f.knowledge.property(f.vault,event.id,{name:'start date',value:'2026-10-23'});f.index.refresh(f.vault);const proposal=f.index.detail(f.vault,dateId).proposals[0];f.index.reviewRelation(f.vault,proposal.id,{status:'accepted',version:proposal.version});
 f.index.relate(f.vault,dateId,{entityId:event.id,sourceMentionId:mention.id,kind:'discusses'});f.index.curate(f.vault,'2026-10-23',{label:'Retain curation',layer:'historical'});
 const backups=new VaultBackups(f.store),backup=await backups.export(f.vault),restored=await backups.import(backup.bytes,'Restored temporal evidence');
 new SourcePassages(f.store,text=>text.length).synchronize(restored.id);f.index.refresh(restored.id);
 const detail=f.index.detail(restored.id,dateId);assert.equal(detail.curation.label,'Retain curation');assert.equal(detail.curation.layer,'historical');assert.equal(detail.relations.length,2);assert.equal(detail.proposals.length,0);
 const sourceRelation=detail.relations.find(row=>row.sourceMentionId);assert.notEqual(sourceRelation.sourceMentionId,mention.id);assert.equal(sourceRelation.evidence.status,'stale');
 const propertyRelation=detail.relations.find(row=>row.propertyId);assert.equal(propertyRelation.evidence.status,'current');assert.equal(propertyRelation.evidence.raw,'2026-10-23');
 const restoredMention=f.store.get('SELECT * FROM temporal_source_mentions WHERE id=?',sourceRelation.sourceMentionId);assert.notEqual(restoredMention.file_id,file.id);assert.equal(restoredMention.original_text,'23 October 2026');
 const malformed=JSON.parse(gunzipSync(backup.bytes));malformed.tables.temporal_source_mentions[0].source_hash='invalid';const count=f.store.get('SELECT count(*) n FROM vaults').n;
 await assert.rejects(backups.import(gzipSync(JSON.stringify(malformed)),'Malformed'),error=>error.status===400);assert.equal(f.store.get('SELECT count(*) n FROM vaults').n,count);assert.deepEqual(f.store.all('PRAGMA foreign_key_check'),[]);
});

test('strict source rendering highlights the exact repeated occurrence and refuses unrelated-text fallback',()=>{
 const text='23 October 2026 and again 23 October 2026.',start=text.lastIndexOf('23 October'),excerpt='23 October 2026';
 const reference={id:'m',sourceId:'s',fileId:'f',startLine:1,endLine:1,sourceHash:'h',strictTemporal:true,startOffset:100+start,endOffset:100+start+excerpt.length,excerpt};
 const html=renderToStaticMarkup(createElement(SemanticPassageText,{text,reference,cited:true,startOffset:100}));assert.equal(html,'23 October 2026 and again <mark>23 October 2026</mark>.');
 assert.doesNotMatch(renderToStaticMarkup(createElement(SemanticPassageText,{text,reference:{...reference,startOffset:101+start},cited:true,startOffset:100})),/<mark>/);
});
