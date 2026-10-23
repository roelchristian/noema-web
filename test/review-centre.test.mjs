import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {ReviewCentre} from '../src/server/modules/review-centre.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
function fixture(t){const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),centre=new ReviewCentre(store);t.after(()=>db.close());store.run('DELETE FROM pages');store.run('DELETE FROM entities');return {store,knowledge,pages,centre};}
function scan(f,page,status='pending'){f.store.run("INSERT OR REPLACE INTO page_ai_enrichments(page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'entity_scan',?,?,'fixture','low','2026-10-23T12:00:00Z')",page.id,JSON.stringify({scan:{id:'scan-'+page.id,suggestions:[{id:'one',status}],subtypeSuggestions:[{id:'sub',status}]}}),page.revision);}
function discovery(f,entity,id,status='pending',at='2026-10-23T12:00:00Z'){f.store.run('INSERT INTO entity_discoveries VALUES (?,?,?,?,?)',id,entity.id,at,'fixture',JSON.stringify({id,suggestions:[{id:'proposal',status}]}));}
test('queue uses saved pending identities, groups subtypes and excludes successful or reviewed work',t=>{
 const f=fixture(t),page=f.pages.create('default',{title:'Origin'});scan(f,page);
 const entity=f.knowledge.create('default',{name:'Subject',type:'concept'});discovery(f,entity,'draft');
 let q=f.centre.list('default');assert.deepEqual(q.errors,[]);assert.equal(q.items.length,2);assert.equal(q.items.find(i=>i.category==='scan').count,2);assert.equal(new Set(q.items.map(i=>i.id)).size,2);
 scan(f,page,'accepted');discovery(f,entity,'resolved','rejected','2026-10-24');
 assert.deepEqual(f.centre.list('default').items,[]);assert.equal(f.centre.resolve('default','discovery:'+entity.id),null);
});
test('revision changes become operational stale items and lifecycle/access changes remove destinations',t=>{
 const f=fixture(t),page=f.pages.create('default',{title:'Origin'});scan(f,page);
 f.store.run('UPDATE pages SET revision=revision+1 WHERE id=?',page.id);
 const item=f.centre.resolve('default','scan:'+page.id);assert.equal(item.state,'stale');assert.equal(item.group,'operations');
 scan(f,page,'rejected');assert.equal(f.centre.resolve('default',item.id),null);scan(f,page);
 f.store.run("UPDATE pages SET deleted_at='2026-10-23' WHERE id=?",page.id);assert.equal(f.centre.resolve('default',item.id),null);
 const entity=f.knowledge.create('default',{name:'Subject',type:'concept'});discovery(f,entity,'draft');
 f.store.run("UPDATE entities SET archived_at='2026-10-23' WHERE id=?",entity.id);assert.deepEqual(f.centre.list('default').items,[]);
 const other=new Vaults(f.store).create({name:'Other'});assert.equal(f.centre.resolve(other.id,'discovery:'+entity.id),null);
 f.store.run('UPDATE vaults SET locked=1 WHERE id=?',other.id);assert.throws(()=>f.centre.list(other.id));
});
test('source current failures and latest editorial status suppress old failed retries',t=>{
 const f=fixture(t),file=new SourceFiles(f.store).add('default','Fixture.txt',Buffer.from('Synthetic text'));
 const entity=f.knowledge.create('default',{name:'Source',type:'source',attachmentIds:[file.id]});
 f.store.run("UPDATE entities SET inactive=0 WHERE id=?",entity.id);f.store.run("UPDATE source_files SET status='ready',admitted=1,enrichment_status='completed' WHERE id=?",file.id);
 const add=(id,status,at,patches=[])=>f.store.run('INSERT INTO source_reprocessing VALUES (?,?,?,?,?,?,?)',id,file.id,'default',status,at,at,JSON.stringify({patches}));
 add('old','failed','2026-10-21');assert.equal(f.centre.list('default').items[0].group,'operations');
 add('new','completed','2026-10-22');assert.deepEqual(f.centre.list('default').items,[]);
 add('pending','completed','2026-10-23',[{decision:'pending'},{decision:'accepted'}]);let item=f.centre.list('default').items[0];assert.equal(item.runId,'pending');assert.equal(item.count,1);assert.equal(item.group,'decisions');
 add('running','running','2026-10-24',[{decision:'pending'}]);item=f.centre.list('default').items[0];assert.equal(item.group,'activity');
 f.store.run("UPDATE source_files SET enrichment_status='failed' WHERE id=?",file.id);assert.equal(f.centre.resolve('default','source:'+file.id).group,'operations');
 f.store.run("UPDATE source_files SET status='failed' WHERE id=?",file.id);f.store.run('UPDATE entities SET inactive=1 WHERE id=?',entity.id);assert.equal(f.centre.resolve('default','source:'+file.id).group,'operations');
 f.store.run("UPDATE source_files SET status='ready',enrichment_status='completed' WHERE id=?",file.id);assert.equal(f.centre.resolve('default','source:'+file.id),null);
});
test('category errors are isolated and queries have stable bounded continuation',t=>{
 const f=fixture(t);for(let i=0;i<53;i++)scan(f,f.pages.create('default',{title:'Note '+i}));
 const first=f.centre.list('default'),next=f.centre.list('default',50);assert.equal(first.items.length,50);assert.deepEqual(first.more,['scan']);assert.equal(next.items.length,3);assert.equal(new Set([...first.items,...next.items].map(i=>i.id)).size,53);
 f.store.run("UPDATE page_ai_enrichments SET data='invalid'");const entity=f.knowledge.create('default',{name:'Subject',type:'concept'});discovery(f,entity,'draft');
 const partial=f.centre.list('default');assert.equal(partial.errors.length,1);assert.equal(partial.items[0].category,'discovery');
});
test('pending property and name proposals use exact identities and stay independent of page filing',async t=>{
 const {proposeValue}=await import('../src/server/modules/property-provenance.ts');
 const f=fixture(t),entity=f.knowledge.create('default',{name:'Subject',type:'concept'}),page=f.pages.create('default',{title:'Unfiled'});scan(f,page);
 const proposal=proposeValue(f.store,'default',{entity_id:entity.id,property_name:'Meaning',value:'Synthetic value',origin:'ai'});
 const name=proposeValue(f.store,'default',{entity_id:entity.id,kind:'entity_name',value:'Proposed subject',origin:'ai'});
 const first=f.centre.resolve('default','property:'+proposal.id);assert.equal(first.originId,entity.id);assert.equal(first.proposalId,proposal.id);assert.equal(first.count,1);assert.equal(first.group,'decisions');assert.ok(first.runId);
 assert.equal(f.centre.resolve('default','property:'+name.id).decision,'Review proposed name');
 f.store.run("UPDATE property_proposals SET details='Changed saved evidence' WHERE id=?",proposal.id);
 assert.notEqual(f.centre.resolve('default',first.id).runId,first.runId);
 f.store.run("UPDATE property_proposals SET status='accepted' WHERE id=?",proposal.id);assert.equal(f.centre.resolve('default',first.id),null);
 assert.equal(f.centre.resolve('default','scan:'+page.id).count,2);
 const other=new Vaults(f.store).create({name:'Other'});assert.equal(f.centre.resolve(other.id,'property:'+name.id),null);
 f.store.run("UPDATE entities SET archived_at='2026-10-23' WHERE id=?",entity.id);assert.equal(f.centre.resolve('default','property:'+name.id),null);
});
test('property proposal continuation is bounded and identity resolution bypasses paging',async t=>{
 const {proposeValue}=await import('../src/server/modules/property-provenance.ts');
 const f=fixture(t),entity=f.knowledge.create('default',{name:'Subject',type:'concept'});let last;
 for(let index=0;index<53;index++)last=proposeValue(f.store,'default',{entity_id:entity.id,property_name:'Field '+index,value:'Synthetic',origin:'ai'});
 const first=f.centre.list('default'),next=f.centre.list('default',50);
 assert.equal(first.items.length,50);assert.deepEqual(first.more,['property']);assert.equal(next.items.length,3);
 assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,53);
 assert.equal(f.centre.resolve('default','property:'+last.id).proposalId,last.id);
});
test('field-derived pending date relationships disappear when decided, dirty, superseded or archived',async t=>{
 const {TemporalProperties}=await import('../src/server/modules/temporal-properties.ts');
 const f=fixture(t),entity=f.knowledge.create('default',{name:'Person',type:'person'});
 const {properties}=f.knowledge.property('default',entity.id,{name:'birth date',value:'March 1905 (Julian)'});
 // Built-in adapters are deliberately exercised rather than fabricating relation evidence.
 const property=properties.find(item=>item.name==='birth date');new TemporalProperties(f.store).refresh('default',100);
 const relation=f.store.get('SELECT * FROM temporal_relations WHERE property_id=?',property.id);assert.ok(relation);
 const item=f.centre.resolve('default','temporal:'+relation.id);assert.equal(item.dateId,'julian:month:1905-03');assert.equal(item.proposalId,relation.id);assert.equal(item.originId,entity.id);
 const other=new Vaults(f.store).create({name:'Other'});assert.equal(f.centre.resolve(other.id,item.id),null);
 f.store.run("UPDATE temporal_relations SET status='rejected' WHERE id=?",relation.id);assert.equal(f.centre.resolve('default',item.id),null);
 f.store.run("UPDATE temporal_relations SET status='pending' WHERE id=?",relation.id);
 f.store.run("UPDATE properties SET value='April 1906' WHERE id=?",property.id);assert.equal(f.centre.resolve('default',item.id),null);
 new TemporalProperties(f.store).refresh('default',100);assert.equal(f.centre.resolve('default',item.id),null);
 const current=f.centre.list('default').items.find(value=>value.category==='temporal');assert.equal(current.dateId,'gregorian:month:1906-04');
 f.store.run("UPDATE entities SET archived_at='2026-10-23' WHERE id=?",entity.id);assert.equal(f.centre.resolve('default',current.id),null);
});
