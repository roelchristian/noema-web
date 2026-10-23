import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Organizer} from '../src/server/modules/organization.ts';
import {SmartCollections} from '../src/server/modules/smart-collections.ts';
import {evaluateSmartRule} from '../src/server/modules/smart-rules.ts';
import {parseSmartRule} from '../src/shared/smart-collections.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';

const leaf=(field,operator,value,extra={})=>({field,operator,value,...extra});
const rule=root=>({version:1,root});
const group=(op,...children)=>({op,children});
const title=value=>leaf('title','contains',value);
const fails=(work,status)=>assert.throws(work,error=>error.status===status);
function fixture(t) {
 const directory=mkdtempSync(path.join(tmpdir(),'noema-smart-fixture-')),filename=path.join(directory,'fixture.sqlite'),db=openDatabase(filename),store=new Store(db),org=new Organizer(store),smart=org.smart,vaults=new Vaults(store);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 const vault=vaults.create({name:'Synthetic smart collection vault'}).id;
 const page=(id,name=id,patch={})=>{store.run('INSERT INTO pages(id,title,blocks,updated_at,created_at,vault_id,language) VALUES(?,?,?,?,?,?,?)',id,name,JSON.stringify(patch.blocks??[]),patch.updated_at??'2026-10-23T00:00:00Z',patch.created_at??'2026-01-01T00:00:00Z',vault,patch.language??'en');return id;};
 const entity=(id,name=id)=>{store.run("INSERT INTO entities(id,name,type,description,updated_at,vault_id) VALUES(?,?,'concept','','2026-10-23T00:00:00Z',?)",id,name,vault);return id;};
 const create=(name,definition)=>{org.saveCollection(vault,{name,kind:'smart',rule:definition});return org.list(vault).collections.find(item=>item.name===name).id;};
 const settle=async id=>{for(let index=0;index<100;index++){await new Promise(resolve=>setImmediate(resolve));const state=org.list(vault).collections.find(item=>item.id===id);if(state?.smart?.status==='ready'||state?.smart?.status==='error')return state;}throw Error('Smart collection did not settle');};
 return {directory,filename,db,store,org,smart,vaults,vault,page,entity,create,settle};
}

test('versioned AST rejects malformed, arbitrary SQL, cycles and bounded-complexity violations',()=>{
 const cycle=group('all',title('safe'));cycle.children.push(cycle);
 let deep=title('safe');for(let i=0;i<9;i++)deep=group('all',deep);
 const huge=group('all',...Array.from({length:16},()=>group('any',...Array.from({length:5},()=>title('safe')))));
 const invalid=[null,[],{},rule({}),{version:2,root:title('x')},rule({...title('x'),sql:'DROP TABLE pages'}),rule({field:'sql',operator:'equals',value:'1=1'}),rule(group('all')),rule(group('any',...Array.from({length:17},()=>title('x')))),rule(cycle),rule(deep),rule(huge),rule(leaf('favourite','is','true')),rule(leaf('created_at','after','tomorrow')),rule(leaf('language','equals','bad tag')),rule({...leaf('subject','within','math'),role:'tertiary'}),rule(title('x'.repeat(501)))];
 for(const input of invalid)assert.throws(()=>parseSmartRule(input),/Invalid collection rule/);
 const good=rule(group('all',title("Robert'); DROP TABLE pages;--"),group('none',leaf('reading_note','is',true))));assert.deepEqual(parseSmartRule(good),good);
});

test('nested ALL/ANY/NONE uses actual Subjects, folder ancestry, stable entity references and reading-note metadata',t=>{
 const f=fixture(t),root=f.org.saveFolder(f.vault,{name:'Research'}).folders[0].id,child=f.org.saveFolder(f.vault,{name:'Nested',parent_id:root}).folders.find(item=>item.parent_id===root).id;
 const entity=f.entity('fixture-entity','Original entity name'),page=f.page('matching','Algebra reading note',{blocks:[{id:'p',type:'paragraph',content:[{entityId:entity}]}]});
 f.page('excluded','Algebra draft');f.page('unrelated','History');f.org.locate(f.vault,{kind:'page',item_id:page,folder_id:child});
 const subject=f.store.get('SELECT id,parent_id FROM domains WHERE parent_id IS NOT NULL');assert.ok(subject);
 f.store.run("INSERT INTO page_domains VALUES (?,?,'primary','manual','2026-10-23')",page,subject.id);
 f.store.run("INSERT INTO page_reading_notes(page_id,vault_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at) VALUES(?,?,'hash',0,5,'quote','{}','2026-10-23')",page,f.vault);
 const definition=rule(group('all',leaf('folder','within',root),leaf('subject','within',subject.parent_id,{role:'primary'}),group('any',leaf('entity','mentions',entity),title('never')),group('none',title('draft')),leaf('reading_note','is',true),leaf('created_at','after','2025-12-31'),leaf('language','equals','en')));
 let result=evaluateSmartRule(f.store,f.vault,definition,'',250);assert.deepEqual(result.items.filter(item=>item.matched).map(item=>item.item_id),[page]);assert.ok(result.items.find(item=>item.matched).evidence.some(item=>item.includes('Original entity name')));
 f.store.run('UPDATE entities SET name=? WHERE id=?','Renamed entity',entity);result=evaluateSmartRule(f.store,f.vault,definition,'',250);assert.equal(result.items.filter(item=>item.matched).length,1);assert.ok(result.items.find(item=>item.matched).evidence.some(item=>item.includes('Renamed entity')));
 f.store.run('UPDATE pages SET deleted_at=? WHERE id=?','2026-10-23',page);assert.equal(evaluateSmartRule(f.store,f.vault,definition,'',250).items.some(item=>item.item_id===page),false);
});

test('bounded preview reports its scan boundary and validates references even inside NONE',t=>{
 const f=fixture(t);for(let index=0;index<275;index++)f.page(`page-${String(index).padStart(3,'0')}`,'Match');
 const before=f.store.get('SELECT count(*) n FROM smart_collection_cache').n,preview=f.smart.preview(f.vault,{rule:rule(title('Match'))});
 assert.equal(preview.evaluated,250);assert.equal(preview.matched,250);assert.equal(preview.items.length,20);assert.equal(preview.hasMore,true);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_cache').n,before);
 fails(()=>f.smart.preview(f.vault,{rule:rule(group('none',leaf('folder','within','missing')))}),400);
 fails(()=>f.smart.preview(f.vault,{rule:rule(group('none',leaf('entity','mentions','earthsea')))}),400);
 assert.throws(()=>evaluateSmartRule(f.store,f.vault,rule(title('x')),'',251),error=>error.status===400);
});

test('virtual membership and persistent overrides survive refresh, edits, and definition changes without moving content',async t=>{
 const f=fixture(t),match=f.page('match','Wanted'),other=f.page('other','Other'),id=f.create('Smart',rule(title('Wanted')));
 assert.equal(f.org.list(f.vault).collections.find(item=>item.id===id).smart.status==='ready',false);await f.settle(id);
 assert.equal(f.org.list(f.vault).memberships.some(item=>item.item_id===match&&item.collection_id===id),true);assert.equal(f.store.get('SELECT count(*) n FROM collection_memberships WHERE collection_id=?',id).n,0);
 f.org.membership(f.vault,{kind:'page',item_id:match,collection_id:id,remove:true});f.org.membership(f.vault,{kind:'page',item_id:other,collection_id:id});
 f.store.run('UPDATE pages SET title=? WHERE id=?','Wanted too',other);f.smart.refresh(f.vault,id);await f.settle(id);
 let members=f.org.list(f.vault).memberships.filter(item=>item.collection_id===id);assert.deepEqual(members.map(item=>item.item_id),[other]);assert.equal(members[0].provenance,'include');
 f.org.saveCollection(f.vault,{name:'Smart',kind:'smart',rule:rule(title('Nothing'))},id);await f.settle(id);assert.equal(f.org.list(f.vault).memberships.filter(item=>item.collection_id===id).length,1);
 f.org.membership(f.vault,{kind:'page',item_id:other,collection_id:id,reset:true});assert.equal(f.org.list(f.vault).memberships.filter(item=>item.collection_id===id).length,0);
 assert.equal(f.store.get('SELECT count(*) n FROM item_locations WHERE vault_id=?',f.vault).n,0);assert.equal(f.store.get('SELECT blocks FROM pages WHERE id=?',match).blocks,'[]');assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_overrides WHERE collection_id=?',id).n,1);
});

test('mutation invalidates cached results, archived references fail explicitly, locking and vault isolation hold',async t=>{
 const f=fixture(t),entity=f.entity('stable-entity'),page=f.page('note','Match',{blocks:[{id:'p',type:'paragraph',content:[{entityId:entity}]}]}),id=f.create('References',rule(leaf('entity','mentions',entity)));await f.settle(id);
 f.store.run('UPDATE pages SET title=? WHERE id=?','Edited',page);let organization=f.org.list(f.vault);assert.equal(organization.collections.find(item=>item.id===id).smart.status,'stale');assert.equal(organization.memberships.find(item=>item.collection_id===id).stale,true);await f.settle(id);
 f.store.run('UPDATE entities SET archived_at=? WHERE id=?','2026-10-23',entity);const state=await f.settle(id);assert.equal(state.smart.status,'error');assert.match(state.smart.error,/unavailable/);
 const second=f.vaults.create({name:'Other synthetic vault'}).id;fails(()=>f.smart.preview(second,{rule:rule(leaf('entity','mentions',entity))}),400);fails(()=>f.smart.refresh(second,id),404);
 f.vaults.lock(f.vault,{passphrase:'synthetic passphrase'});fails(()=>f.smart.preview(f.vault,{rule:rule(title('Match'))}),423);fails(()=>f.smart.refresh(f.vault,id),423);
});

test('smart backup restores remapped stable references and overrides; legacy archives remain manual',async t=>{
 const f=fixture(t),entity=f.entity('backup-entity','Backed up entity'),page=f.page('backup-page','Backed up page',{blocks:[{id:'p',type:'paragraph',content:[{entityId:entity}]}]}),folder=f.org.saveFolder(f.vault,{name:'Backed up folder'}).folders[0].id;
 f.org.locate(f.vault,{kind:'page',item_id:page,folder_id:folder});
 const id=f.create('Backed up smart',rule(group('all',leaf('folder','within',folder),leaf('entity','mentions',entity))));await f.settle(id);
 f.org.membership(f.vault,{kind:'page',item_id:page,collection_id:id,remove:true});
 const backups=new VaultBackups(f.store),exported=await backups.export(f.vault),archive=JSON.parse(gunzipSync(exported.bytes));
 assert.equal(archive.tables.smart_collection_definitions.length,1);assert.equal(archive.tables.smart_collection_overrides.length,1);
 const restored=await backups.import(exported.bytes,'Restored synthetic smart vault'),restoredOrg=new Organizer(f.store),organization=restoredOrg.list(restored.id),collection=organization.collections.find(item=>item.name==='Backed up smart'),restoredPage=f.store.get('SELECT id FROM pages WHERE vault_id=? AND title=?',restored.id,'Backed up page'),restoredFolder=organization.folders.find(item=>item.name==='Backed up folder'),restoredEntity=f.store.get('SELECT id FROM entities WHERE vault_id=? AND name=?',restored.id,'Backed up entity');
 assert.equal(collection.kind,'smart');assert.notEqual(collection.id,id);assert.notEqual(restoredPage.id,page);assert.notEqual(restoredFolder.id,folder);assert.notEqual(restoredEntity.id,entity);
 assert.equal(collection.rule.root.children[0].value,restoredFolder.id);assert.equal(collection.rule.root.children[1].value,restoredEntity.id);
 const override=f.store.get('SELECT * FROM smart_collection_overrides WHERE vault_id=?',restored.id);assert.equal(override.item_id,restoredPage.id);assert.equal(override.collection_id,collection.id);assert.equal(override.decision,'exclude');
 const legacy=structuredClone(archive);delete legacy.tables.smart_collection_definitions;delete legacy.tables.smart_collection_overrides;delete legacy.tables.smart_collection_cache;
 const old=await backups.import(gzipSync(JSON.stringify(legacy)),'Legacy synthetic vault');assert.equal(new Organizer(f.store).list(old.id).collections.find(item=>item.name==='Backed up smart').kind??'manual','manual');
 const tombstone=structuredClone(archive);tombstone.tables.smart_collection_definitions[0].rule_json=JSON.stringify(rule(leaf('entity','mentions','earthsea')));
 const orphaned=await backups.import(gzipSync(JSON.stringify(tombstone))),orphanOrganization=new Organizer(f.store).list(orphaned.id),orphan=orphanOrganization.collections.find(item=>item.kind==='smart');
 assert.notEqual(orphan.rule.root.value,'earthsea');fails(()=>new SmartCollections(f.store).preview(orphaned.id,{rule:orphan.rule}),400);
 const bad=structuredClone(archive);bad.tables.smart_collection_definitions[0].rule_json=JSON.stringify({...rule(title('safe')),version:99});const before=f.vaults.list().length;
 await assert.rejects(backups.import(gzipSync(JSON.stringify(bad))),error=>error.status===400);assert.equal(f.vaults.list().length,before);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('smart sidecar migration preserves manual collections, folder links and canonical content across restart',t=>{
 const f=fixture(t),page=f.page('legacy-page'),folder=f.org.saveFolder(f.vault,{name:'Legacy folder'}).folders[0].id;
 f.org.saveCollection(f.vault,{name:'Legacy manual'});const manual=f.org.list(f.vault).collections[0].id;
 f.org.membership(f.vault,{kind:'page',item_id:page,collection_id:manual});f.org.locate(f.vault,{kind:'page',item_id:page,folder_id:folder});f.org.folderMembership(f.vault,{folder_id:folder,collection_id:manual,mode:'linked'});
 const second=openDatabase(f.filename);try {
  const store=new Store(second),organization=new Organizer(store).list(f.vault);assert.equal(organization.collections[0].kind??'manual','manual');assert.equal(organization.locations[0].folder_id,folder);assert.equal(organization.memberships[0].collection_id,manual);assert.equal(organization.folderLinks[0].folder_id,folder);assert.equal(store.get('SELECT blocks FROM pages WHERE id=?',page).blocks,'[]');assert.deepEqual(second.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{second.close();}
});

test('folder cycles in malformed persisted metadata terminate and cannot be extended',t=>{
 const f=fixture(t),parent=f.org.saveFolder(f.vault,{name:'Parent'}).folders[0].id,child=f.org.saveFolder(f.vault,{name:'Child',parent_id:parent}).folders.find(item=>item.parent_id===parent).id,page=f.page('cyclic-page');
 f.org.locate(f.vault,{kind:'page',item_id:page,folder_id:child});f.store.run('UPDATE folders SET parent_id=? WHERE id=?',child,parent);
 assert.equal(evaluateSmartRule(f.store,f.vault,rule(leaf('folder','within',parent)),'',250).items.find(item=>item.item_id===page).matched,true);
 fails(()=>f.org.saveFolder(f.vault,{name:'Cannot extend',parent_id:parent}),400);
});

test('one-page edits refresh only dirty candidates and unchanged polling does no candidate work',async t=>{
 const f=fixture(t);for(let index=0;index<225;index++)f.page(`incremental-${String(index).padStart(3,'0')}`,'Match');
 const id=f.create('Incremental',rule(title('Match')));await f.settle(id);
 const queries=[],all=f.store.all.bind(f.store);t.mock.method(f.store,'all',(sql,...values)=>{if(sql.includes('SELECT id,title,language,created_at,updated_at FROM pages'))queries.push({sql,values});return all(sql,...values);});
 for(let count=0;count<10;count++)f.org.list(f.vault);await new Promise(resolve=>setImmediate(resolve));assert.equal(queries.length,0);
 f.store.run('UPDATE pages SET title=? WHERE id=?','Different title','incremental-100');f.org.list(f.vault);await f.settle(id);
 assert.equal(queries.length,1);assert.match(queries[0].sql,/AND id IN/);assert.ok(queries[0].values.includes('incremental-100'));
 const organization=f.org.list(f.vault);assert.equal(organization.collections.find(item=>item.id===id).smart.evaluated,225);assert.equal(organization.memberships.some(item=>item.collection_id===id&&item.item_id==='incremental-100'),false);
});

test('locking between refresh batches stops work and unlocking resumes without losing explicit decisions',async t=>{
 const f=fixture(t);for(let index=0;index<225;index++)f.page(`lock-${String(index).padStart(3,'0')}`,'Match');
 const id=f.create('Locking',rule(title('Match')));await new Promise(resolve=>setImmediate(resolve));
 const before=f.store.get('SELECT count(*) n FROM smart_collection_cache WHERE collection_id=?',id).n;assert.ok(before>0&&before<225);
 f.vaults.lock(f.vault,{passphrase:'synthetic passphrase'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_cache WHERE collection_id=?',id).n,before);
 assert.equal(f.smart.definition(f.vault,id).status,'stale');f.vaults.unlock(f.vault,{passphrase:'synthetic passphrase'});await f.settle(id);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_cache WHERE collection_id=?',id).n,225);
});

test('definition edits during a multi-batch refresh discard obsolete work and eventually evaluate only the latest rule',async t=>{
 const f=fixture(t);for(let index=0;index<225;index++)f.page(`race-${String(index).padStart(3,'0')}`,'Old title');f.page('race-latest','Latest title');
 const id=f.create('Racing',rule(title('Old')));await new Promise(resolve=>setImmediate(resolve));f.org.saveCollection(f.vault,{name:'Racing',kind:'smart',rule:rule(title('Latest'))},id);
 await f.settle(id);const members=f.org.list(f.vault).memberships.filter(item=>item.collection_id===id);assert.deepEqual(members.map(item=>item.item_id),['race-latest']);assert.ok(members[0].evidence.some(item=>item.includes('Latest')));assert.equal(members[0].stale,false);
});

test('trash hides cached and included items immediately, restoring retains override and permanent deletion cleans it',async t=>{
 const f=fixture(t),page=f.page('trash-fixture','Match'),id=f.create('Trash',rule(title('Match')));await f.settle(id);f.org.membership(f.vault,{kind:'page',item_id:page,collection_id:id});
 f.store.run('UPDATE pages SET deleted_at=? WHERE id=?','2026-10-23',page);assert.equal(f.org.list(f.vault).memberships.some(item=>item.item_id===page),false);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_overrides WHERE item_id=?',page).n,1);
 f.store.run('UPDATE pages SET deleted_at=NULL WHERE id=?',page);assert.equal(f.org.list(f.vault).memberships.find(item=>item.item_id===page).provenance,'include');
 f.store.run('DELETE FROM pages WHERE id=?',page);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_overrides WHERE item_id=?',page).n,0);assert.equal(f.store.get('SELECT count(*) n FROM smart_collection_cache WHERE item_id=?',page).n,0);
});
