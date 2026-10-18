import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {DOMAINS,validateDomainRegistry,TAXONOMY_VERSION} from '../src/shared/domains.ts';
function fixture(){const directory=mkdtempSync(path.join(tmpdir(),'noema-domains-'));const filename=path.join(directory,'db.sqlite');const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),domains=new Domains(store);return {directory,filename,db,store,knowledge,pages,domains,close(){db.close();rmSync(directory,{recursive:true,force:true});}};}
test('taxonomy seed restarts idempotently and validates cycles and parents',()=>{
 const state=fixture();try{
 assert.equal(DOMAINS.length,162);assert.equal(state.store.get('SELECT count(*) AS n FROM domains').n,162);
 const second=openDatabase(state.filename);assert.equal(second.prepare('SELECT count(*) AS n FROM domains').get().n,162);second.close();
 assert.throws(()=>validateDomainRegistry([{id:'a',parent_id:'missing',label:'A',sort_order:0}]));
 assert.throws(()=>validateDomainRegistry([{id:'a',parent_id:'a',label:'A',sort_order:0}]));
 }finally{state.close();}
});
test('manual domains survive inference, invalidate scans, reject stale revisions and foreign vaults',()=>{
 const s=fixture();try{
 const page=s.pages.create('default',{title:'Algebra'}),other=new Vaults(s.store).create({name:'Other'});
 const inferred=s.domains.setInferred('default',page.id,{primaryDomainId:'mathematics.algebra.abstract',secondaryDomainIds:[]},page.conceptContentHash);
 assert.equal(inferred.status,'inferred');assert.equal(s.pages.get('default',page.id).revision,page.revision);
 assert.equal(s.domains.get(page.id,'changed').status,'needs_refresh');
 s.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'entity_scan','{}',?,'test','low',datetime('now'))",page.id,page.revision);
 s.domains.setManual('default',page.id,{primaryDomainId:'psychology',secondaryDomainIds:['philosophy']},page.revision);
 const manual=s.pages.get('default',page.id);assert.equal(manual.revision,page.revision+1);assert.equal(manual.pageDomains.status,'manual');assert.equal(manual.pageDomains.taxonomyVersion,TAXONOMY_VERSION);
 assert.equal(s.store.get("SELECT 1 FROM page_ai_enrichments WHERE page_id=? AND kind='entity_scan'",page.id),undefined);
 s.domains.setInferred('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},'changed');assert.equal(s.domains.get(page.id).primaryDomainId,'psychology');
 assert.throws(()=>s.domains.setManual('default',page.id,{primaryDomainId:null},page.revision),{status:409});
 assert.throws(()=>s.domains.setManual(other.id,page.id,{primaryDomainId:null},manual.revision),{status:404});
 assert.throws(()=>s.domains.setInferred(other.id,page.id,{primaryDomainId:null},'hash'),{status:404});
 assert.throws(()=>s.domains.setManual('default',page.id,{primaryDomainId:'invented'},manual.revision),{status:400});
 }finally{s.close();}
});
test('Concept domain memberships are independent from subtypes and backup round trips manual assignments',async()=>{
 const s=fixture();try{
 const concept=s.knowledge.create('default',{name:'Field',type:'concept',subtypes:['concept:mathematics'],domainIds:['mathematics.algebra.abstract']});
 assert.deepEqual(concept.domainIds,['mathematics.algebra.abstract']);assert.deepEqual(concept.subtypes,['concept:mathematics']);
 assert.throws(()=>s.knowledge.create('default',{name:'Ada',type:'person',domainIds:['mathematics']}),{status:400});
 assert.throws(()=>s.knowledge.update('other',concept.id,{name:'Field',type:'concept',domainIds:[]}),{status:404});
 const page=s.pages.create('default',{title:'Manual'});s.domains.setManual('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:['philosophy']},page.revision);
 const backups=new VaultBackups(s.store),exported=await backups.export('default'),vault=await backups.import(exported.bytes);
 const restored=s.pages.get(vault.id,s.pages.list(vault.id).find(p=>p.title==='Manual').id);assert.equal(restored.pageDomains.status,'manual');assert.equal(restored.pageDomains.primaryDomainId,'mathematics');assert.deepEqual(restored.pageDomains.secondaryDomainIds,['philosophy']);
 assert.deepEqual(s.knowledge.list(vault.id).find(e=>e.name==='Field').domainIds,concept.domainIds);
 }finally{s.close();}
});
test('domain HTTP API returns the registry and revision-checked pages without AI activity',async()=>{
 const s=fixture();const {createApp}=await import('../src/server/http.ts');const {once}=await import('node:events');
 const server=createApp(s.store,path.resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const base=`http://127.0.0.1:${server.address().port}/api`,page=s.pages.create('default',{title:'Subject selection'});
 let response=await fetch(base+'/domains');assert.equal(response.status,200);const registry=await response.json();assert.equal(registry.domains.length,162);assert.equal(registry.taxonomyVersion,TAXONOMY_VERSION);
 const update=(revision,primaryDomainId)=>fetch(base+'/pages/'+page.id+'/domains',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,primaryDomainId,secondaryDomainIds:[]})});
 response=await update(page.revision,'mathematics');assert.equal(response.status,200);const updated=await response.json();assert.equal(updated.revision,page.revision+1);assert.equal(updated.pageDomains.status,'manual');
 response=await update(page.revision,'psychology');assert.equal(response.status,409);
 response=await update(updated.revision,'invented');assert.equal(response.status,400);
 assert.equal(s.store.get('SELECT count(*) AS n FROM ai_activity').n,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));s.close();}
});
test('backup import rejects foreign assignment references and invalid origins atomically',async()=>{
 const s=fixture();try{
 const {gzipSync,gunzipSync}=await import('node:zlib');
 const page=s.pages.create('default',{title:'Archived'});
 s.domains.setManual('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},page.revision);
 const entity=s.knowledge.create('default',{name:'Ring',type:'concept',domainIds:['mathematics']});
 const foreign=new Vaults(s.store).create({name:'Foreign'});
 const foreignPage=s.pages.create(foreign.id,{title:'Foreign page'}),foreignEntity=s.knowledge.create(foreign.id,{name:'Foreign entity',type:'concept'});
 const backups=new VaultBackups(s.store),bytes=(await backups.export('default')).bytes;
 const before=new Vaults(s.store).list().length;
 const changes=[
   archive=>{archive.tables.page_domains[0].page_id=foreignPage.id;},
   archive=>{archive.tables.entity_domains[0].entity_id=foreignEntity.id;},
   archive=>{archive.tables.page_domains[0].origin='inferred';},
   archive=>{archive.tables.entity_domains[0].origin='invented';},
   archive=>{archive.tables.page_domain_state[0].origin='invented';},
   archive=>{archive.tables.page_domains[0].domain_id='invented';},
 ];
 for(const change of changes){const archive=JSON.parse(gunzipSync(bytes));change(archive);await assert.rejects(backups.import(gzipSync(JSON.stringify(archive))),{status:400});assert.equal(new Vaults(s.store).list().length,before);}
 assert.deepEqual(s.knowledge.find('default',entity.id).domainIds,['mathematics']);assert.equal(s.domains.get(page.id).origin,'manual');
 }finally{s.close();}
});
