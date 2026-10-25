import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {PageEnrichment} from '../src/server/modules/page-enrichment.ts';
import {PageEnrichmentScheduler} from '../src/server/modules/page-enrichment-scheduler.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {summaryContentHash} from '../src/server/modules/summary-content.ts';
import {enrichmentProvider} from './helpers/providers.ts';
const selection={model:'test-metadata',reasoningEffort:'none'};
const output={title:'Polynomial proofs',primaryDomainId:'mathematics',secondaryDomainIds:[],language:'en',summary:'A note about algebra, polynomial equations and proofs.'};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(provider=async()=>output) {
  const directory=mkdtempSync(path.join(tmpdir(),'noema-enrichment-')),filename=path.join(directory,'db.sqlite');
  const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages);
  let calls=0;const requests=[];
  const intelligence=enrichmentProvider(async(input,options)=>{calls++;requests.push({input,options});return provider(input,options);},selection);
  const coordinator=new PageEnrichment(store,pages,knowledge,enrichments,intelligence);
  const initial=pages.create('default',{title:'Untitled'});
  const blocks=[{id:'algebra',type:'paragraph',checked:false,content:[{text:'Algebra studies polynomial equations. Every theorem requires a mathematical proof.'}]}];
  store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(blocks),initial.id);
  return {directory,filename,db,store,pages,enrichments,coordinator,knowledge,page:pages.get('default',initial.id),requests,get calls(){return calls;},close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
test('one combined request persists fields and summary freshness against the effective generated title',async()=>{
 const s=fixture();try {
   const result=await s.coordinator.run('default',s.page,undefined,{explicit:true,refreshFields:['summary']});
   assert.equal(s.calls,1);assert.deepEqual(new Set(s.requests[0].options.requestedFields),new Set(['title','domains','language','summary']));
   const current=s.pages.get('default',s.page.id),summary=s.enrichments.list('default',s.page.id).find(item=>item.kind==='summary');
   assert.equal(current.title,output.title);assert.equal(result.contentHash,current.summaryContentHash);
   assert.equal(summary.contentHash,summaryContentHash(current,()=>undefined));
   assert.equal(current.pageDomains.status,'inferred');
 }finally{s.close();}
});
test('manual title, language and subject decisions survive background work',async()=>{
 const s=fixture();try {
   s.coordinator.configure('default',{automaticSummaries:false});
   s.store.run('UPDATE pages SET title=?,language=? WHERE id=?','My own title','fr',s.page.id);
   const state=new PageEnrichmentState(s.store);state.markManual(s.page.id,'title');state.markManual(s.page.id,'language');
   const current=s.pages.get('default',s.page.id);
   new Domains(s.store).setManual('default',s.page.id,{primaryDomainId:'psychology',secondaryDomainIds:[]},current.revision);
   const manual=s.pages.get('default',s.page.id);
   await s.coordinator.run('default',manual,undefined,{background:true});
   assert.equal(s.calls,0);assert.equal(s.pages.get('default',s.page.id).title,'My own title');
   assert.equal(s.pages.get('default',s.page.id).language,'fr');assert.equal(s.pages.get('default',s.page.id).pageDomains.primaryDomainId,'psychology');
 }finally{s.close();}
});
test('obsolete provider results never commit after a new saved revision',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{explicit:true,refreshFields:['summary']});
   s.store.run('UPDATE pages SET revision=revision+1,title=? WHERE id=?','New authored title',s.page.id);
   gate.resolve(output);await assert.rejects(work,{status:409});
   assert.equal(s.store.get("SELECT 1 FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",s.page.id),undefined);
   assert.equal(s.pages.get('default',s.page.id).title,'New authored title');
 }finally{s.close();}
});
test('equivalent concurrent work makes exactly one provider request',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const first=s.coordinator.run('default',s.page,undefined,{explicit:true,fields:['summary']});
   const second=s.coordinator.run('default',s.page,undefined,{explicit:true,fields:['summary']});
   assert.equal(s.calls,1);gate.resolve({summary:output.summary});
   const results=await Promise.all([first,second]);assert.equal(results[0].summary,results[1].summary);assert.equal(s.calls,1);
 }finally{s.close();}
});
test('manual metadata assigned during inference blocks stale commits',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['domains'],explicit:true});
   new Domains(s.store).setManual('default',s.page.id,{primaryDomainId:'psychology',secondaryDomainIds:[]},s.page.revision);
   gate.resolve(output);await assert.rejects(work,{status:409});
   assert.equal(s.pages.get('default',s.page.id).pageDomains.primaryDomainId,'psychology');
 }finally{s.close();}
});
test('deleted summaries remain suppressed, including while a result is in flight',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   s.enrichments.removeSummary('default',s.page.id);gate.resolve({summary:output.summary});await work;
   assert.equal(s.store.get("SELECT 1 FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",s.page.id),undefined);
   assert.equal(s.coordinator.settings('default').automaticSummaries,true);
   assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
 }finally{s.close();}
});
test('summary-only operations omit taxonomy and ignore unrequested fields',async()=>{
 const s=fixture();try {
   await s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   assert.deepEqual(s.requests[0].options.requestedFields,['summary']);assert.equal(s.requests[0].options.domains,undefined);
   assert.equal(s.pages.get('default',s.page.id).title,'Untitled');assert.equal(s.pages.get('default',s.page.id).language,null);
   assert.equal(s.pages.get('default',s.page.id).pageDomains.primaryDomainId,null);
 }finally{s.close();}
});
test('completed enrichment survives service recreation without another provider request',async()=>{
 const s=fixture();try {
   await s.coordinator.run('default',s.page,undefined,{explicit:true,refreshFields:['summary']});
   const db=openDatabase(s.filename);try {
     const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages);
     const coordinator=new PageEnrichment(store,pages,knowledge,enrichments,{enrichmentSelection:()=>selection,generatePageEnrichment:()=>{throw new Error('Unexpected provider request after restart');}});
     const current=pages.get('default',s.page.id);await coordinator.run('default',current);
     assert.equal(current.title,output.title);assert.equal(current.pageDomains.status,'inferred');
     assert.ok(new PageEnrichmentState(store).get(current.id).classification.lastClassifiedAt);
   }finally{db.close();}
 }finally{s.close();}
});
test('manual summary state blocks automatic regeneration when vault summaries are enabled',()=>{
 const s=fixture();try {
   s.coordinator.configure('default',{automaticSummaries:true});new PageEnrichmentState(s.store).markManual(s.page.id,'summary');
   assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
 }finally{s.close();}
});

test('presentation saves reuse active enrichment and commit against the latest persistence revision',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   const blocks=s.page.blocks.map(block=>({...block,content:block.content.map(segment=>({...segment,bold:true}))}));
   const current=s.pages.update('default',s.page.id,{title:s.page.title,blocks,revision:s.page.revision});
   s.coordinator.cancelObsolete('default',s.page.id);
   assert.equal(s.requests[0].options.signal.aborted,false);
   const shared=s.coordinator.run('default',current,undefined,{fields:['summary'],explicit:true});
   assert.equal(s.calls,1);
   gate.resolve({summary:output.summary});
   const results=await Promise.all([work,shared]);
   assert.equal(results[0].revision,current.revision);
   assert.equal(results[1].summary,output.summary);
   assert.equal(s.enrichments.list('default',s.page.id).find(item=>item.kind==='summary').revision,current.revision);
 }finally{s.close();}
});

test('substantive saves promptly abort active requests even when classification hashes are unchanged',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   const blocks=s.page.blocks.map(block=>({...block,content:block.content.map(segment=>({...segment,text:segment.text.toUpperCase()}))}));
   const current=s.pages.update('default',s.page.id,{title:s.page.title,blocks,revision:s.page.revision});
   assert.equal(current.conceptContentHash,s.page.conceptContentHash);
   s.coordinator.cancelObsolete('default',s.page.id);
   assert.equal(s.requests[0].options.signal.aborted,true);
   gate.resolve({summary:output.summary});
   await assert.rejects(work,{status:409});
   assert.equal(s.enrichments.list('default',s.page.id).some(item=>item.kind==='summary'),false);
 }finally{s.close();}
});


test('scheduler uses real field dependencies to reuse presentation saves and dispatch the latest content',async()=>{
 const gate=deferred(),s=fixture((_input,_options)=>s.calls===1?gate.promise:{summary:output.summary});
 const scheduler=new PageEnrichmentScheduler(s.store,{
   prepare:(vault,id,job)=>s.coordinator.prepare(vault,id,{fields:job.fields}),
   execute:(vault,id,snapshot,signal)=>s.coordinator.runPrepared(vault,snapshot,undefined,{fields:snapshot.requestedFields,signal}),
 },{clock:()=>100});
 try {
   scheduler.enqueue('default',s.page.id,{fields:['summary'],delayMs:0});
   const work=scheduler.drain();
   let page=s.pages.update('default',s.page.id,{title:s.page.title,blocks:s.page.blocks,revision:s.page.revision});
   scheduler.enqueue('default',page.id,{fields:['summary'],delayMs:0});
   assert.equal(s.requests[0].options.signal.aborted,false);
   page=s.pages.update('default',page.id,{title:page.title,blocks:page.blocks.map(block=>({...block,content:[{text:'New substantive content about psychology, attention and memory formation.'}]})),revision:page.revision});
   scheduler.enqueue('default',page.id,{fields:['summary'],delayMs:0});
   assert.equal(s.requests[0].options.signal.aborted,true);
   const latestGeneration=s.store.get('SELECT generation FROM page_enrichment_jobs WHERE page_id=?',page.id).generation;
   gate.resolve({summary:'Obsolete summary'});await work;
   assert.equal(s.store.get('SELECT generation FROM page_enrichment_jobs WHERE page_id=?',page.id).generation,latestGeneration);
   await scheduler.drain();
   assert.equal(s.calls,2);
   assert.match(s.requests[1].input,/New substantive content/);
   assert.equal(s.store.get('SELECT 1 FROM page_enrichment_jobs WHERE page_id=?',page.id),undefined);
   assert.equal(s.enrichments.list('default',page.id).find(item=>item.kind==='summary').data.summary,output.summary);
 }finally{scheduler.dispose();s.close();}
});

test('a stale placeholder autosave preserves the generated title and edited body',async()=>{
 const s=fixture();try {
   const stale=structuredClone(s.page);
   await s.coordinator.run('default',s.page);
   const blocks=[...stale.blocks,{id:'later',type:'paragraph',checked:false,content:[{text:'A later body edit saved before the client received enrichment.'}]}];
   let saved=s.pages.update('default',stale.id,{...stale,blocks});
   assert.equal(saved.title,output.title);
   assert.deepEqual(saved.blocks,blocks);
   assert.equal(saved.revision,stale.revision+1);
   assert.equal(saved.enrichmentFields.title.origin,'inferred');
   assert.equal(s.pages.list('default').find(page=>page.id===saved.id).title,output.title);
   saved=s.pages.update('default',saved.id,{...saved,blocks:[...blocks,{id:'next',type:'paragraph',checked:false,content:[{text:'Another edit.'}]}]});
   assert.equal(saved.title,output.title);
   assert.equal(saved.enrichmentFields.title.origin,'inferred');
 }finally{s.close();}
});

test('explicit renames including Untitled survive enrichment and later autosaves',async()=>{
 for(const title of ['My authored title','Untitled','']) {
   const s=fixture();try {
     await s.coordinator.run('default',s.page);
     const saved=s.pages.update('default',s.page.id,{...s.page,title,titleEdited:true});
     assert.equal(saved.title,title);
     assert.equal(saved.enrichmentFields.title.origin,'manual');
     const next=s.pages.update('default',saved.id,{...saved});
     assert.equal(next.title,title);
     assert.equal(s.coordinator.prepare('default',saved.id,{fields:['title']}),null);
   }finally{s.close();}
 }
});

test('same-vocabulary reversal retains generating provenance and requests a refresh',async()=>{
 const s=fixture();try {
   const blocks=[{id:'claim',type:'paragraph',content:[{text:'The larger dogs chase the smaller cats. This note records the direction of the chase.'}]}];
   let current=s.pages.update('default',s.page.id,{...s.page,title:'Chase observations',blocks});
   await s.coordinator.run('default',current,undefined,{fields:['summary'],explicit:true});
   const before=storedSummary(s,current.id);
   current=s.pages.update('default',current.id,{...current,blocks:[{...blocks[0],content:[{text:'The smaller cats chase the larger dogs. This note records the direction of the chase.'}]}]});
   assert.deepEqual(s.coordinator.prepare('default',current.id,{fields:['summary']}).requestedFields,['summary']);
   const saved=storedSummary(s,current.id);
   assert.equal(saved.data.generatedContentHash,before.data.generatedContentHash);
   assert.notEqual(saved.contentHash,current.summaryContentHash);
   assert.equal(saved.data.freshness.status,'refresh_needed');
   assert.equal(saved.data.summary,before.data.summary);
 }finally{s.close();}
});

test('summary-only refresh selects edits since summary generation independently of classification',async()=>{
 const s=fixture();try {
   await s.coordinator.run('default',s.page,undefined,{fields:['domains','summary'],explicit:true});
   const old=s.pages.get('default',s.page.id);
   const current=s.pages.update('default',old.id,{...old,blocks:[{...old.blocks[0],content:[{text:'Distinctive changed summary evidence: the equation is no longer valid after reversing its inequality.'}]}]});
   await s.coordinator.run('default',current,undefined,{fields:['domains'],explicit:true});
   await s.coordinator.run('default',current,undefined,{fields:['summary'],explicit:true});
   const request=s.requests.at(-1);
   assert.equal(request.options.changedEvidence.counts.modified,1);
   assert.match(request.options.changedEvidence.passages[0].text,/Distinctive changed summary evidence/);
   const summary=storedSummary(s,current.id);
   assert.equal(summary.data.coverage.changedBlocks,1);
   assert.equal(summary.data.baseline.blockEvidence.blocks.length,1);
 }finally{s.close();}
});

test('legacy locally advanced hash is rolled back when generating evidence is stale',async()=>{
 const s=fixture();try {
   await s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   const before=storedSummary(s,s.page.id);
   const current=s.pages.update('default',s.page.id,{...s.page,blocks:[{...s.page.blocks[0],content:[{text:'The assertion is not true; its direction has reversed from 20 to 10.'}]}]});
   const legacy={...before.data,baseline:{...before.data.baseline}};delete legacy.baseline.orderedContentHash;delete legacy.baseline.semanticVersion;
   s.store.run("UPDATE page_ai_enrichments SET content_hash=?,data=? WHERE page_id=? AND kind='summary'",current.summaryContentHash,JSON.stringify(legacy),current.id);
   s.coordinator.configure('default',{automaticSummaries:false});
   assert.equal(s.coordinator.prepare('default',current.id,{fields:['summary']}),null);
   const saved=storedSummary(s,current.id);
   assert.equal(saved.contentHash,before.data.generatedContentHash);
   assert.notEqual(saved.contentHash,current.summaryContentHash);
   assert.equal(saved.data.freshness.status,'refresh_needed');
 }finally{s.close();}
});

test('summary snapshot avoids catalogue and entity-name queries without unresolved mentions',async()=>{
 const s=fixture();try {
   s.knowledge.list=()=>{throw new Error('Full catalogue must not be loaded');};
   let nameReads=0;const all=s.store.all.bind(s.store);
   s.store.all=(sql,...args)=>{if(/SELECT id,name,mention_case FROM entities/u.test(sql))nameReads++;return all(sql,...args);};
   await s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   assert.equal(nameReads,0);assert.equal(s.calls,1);
   assert.match(s.requests[0].input,/Algebra studies polynomial equations/u);
 }finally{s.close();}
});

for(const change of ['rename','delete','unrelated'])test(`prepared mention snapshot rejects only relevant ${change} changes`,async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const entity=s.knowledge.create('default',{name:'Original algebra',type:'concept'});
   const unrelated=s.knowledge.create('default',{name:'Unrelated concept',type:'concept'});
   const blocks=[{id:'mention',type:'paragraph',checked:false,content:[{entityId:entity.id},{text:' explains polynomial equations and their mathematical proofs.'}]}];
   s.store.run('UPDATE pages SET blocks=?,summary_content_hash=NULL WHERE id=?',JSON.stringify(blocks),s.page.id);
   const page=s.pages.get('default',s.page.id);
   s.knowledge.list=()=>{throw new Error('Full catalogue must not be loaded');};
   const projections=[];const all=s.store.all.bind(s.store);
   s.store.all=(sql,...args)=>{if(/SELECT id,name,mention_case FROM entities/u.test(sql))projections.push(args);return all(sql,...args);};
   const work=s.coordinator.run('default',page,undefined,{fields:['summary'],explicit:true});
   assert.match(s.requests[0].input,/Original algebra/u);
   if(change==='delete')s.store.run('DELETE FROM entities WHERE id=?',entity.id);
   else s.store.run('UPDATE entities SET name=? WHERE id=?','Changed name',change==='rename'?entity.id:unrelated.id);
   gate.resolve({summary:'The immutable original projection.'});
   if(change==='unrelated')assert.equal((await work).summary,'The immutable original projection.');
   else await assert.rejects(work,{status:409});
   assert.ok(projections.length>=2&&projections.length<=4,'Bounded targeted projection at prepare and dependency check');
   for(const parameters of projections)assert.deepEqual(JSON.parse(parameters[1]),[entity.id]);
 }finally{s.close();}
});

test('failed and cancelled snapshots leave no results and release in-flight identity',async()=>{
 let mode='fail';const gate=deferred(),s=fixture(()=>mode==='fail'?Promise.reject(new Error('Synthetic provider failure')):mode==='cancel'?gate.promise:{summary:output.summary});try {
   await assert.rejects(s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true}),/Synthetic provider failure/u);
   mode='cancel';const controller=new AbortController();
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true,signal:controller.signal});
   controller.abort();gate.resolve({summary:'Cancelled result'});await assert.rejects(work,{status:409});
   assert.equal(s.store.get("SELECT 1 FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",s.page.id),undefined);
   mode='success';assert.equal((await s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true})).summary,output.summary);
 }finally{s.close();}
});

test('queued execution consumes the immutable prepared projection without preparing twice',async()=>{
 const s=fixture();try {
   const snapshot=s.coordinator.prepare('default',s.page.id,{fields:['summary'],explicit:true});
   assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.page.blocks));assert.ok(Object.isFrozen(snapshot.requestedFields));
   assert.throws(()=>{snapshot.page.title='Mutated snapshot';},TypeError);
   s.coordinator.prepare=()=>{throw new Error('Queue must reuse prepared snapshot');};
   const result=await s.coordinator.runPrepared('default',snapshot,undefined,{explicit:true});
   assert.equal(result.summary,output.summary);assert.equal(s.calls,1);
 }finally{s.close();}
});

test('fixed occurrence text needs no entity-name projection',async()=>{
 const s=fixture();try {
   const entity=s.knowledge.create('default',{name:'Canonical',type:'concept'});
   const page={...s.page,blocks:[{id:'fixed',type:'paragraph',checked:false,content:[{entityId:entity.id,mentionText:'Fixed occurrence'},{text:' explains polynomial equations and proofs.'}]}]};
   s.store.run('UPDATE pages SET blocks=?,summary_content_hash=NULL WHERE id=?',JSON.stringify(page.blocks),page.id);
   let reads=0;const all=s.store.all.bind(s.store);
   s.store.all=(sql,...args)=>{if(/SELECT id,name,mention_case FROM entities/u.test(sql))reads++;return all(sql,...args);};
   await s.coordinator.run('default',s.pages.get('default',page.id),undefined,{fields:['summary'],explicit:true});
   assert.equal(reads,0);assert.match(s.requests[0].input,/Fixed occurrence/u);
 }finally{s.close();}
});

test('an independent classification refresh preserves the summary generating snapshot',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   const domains=new Domains(s.store);
   domains.setInferred('default',s.page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},s.page.conceptContentHash,s.page);
   gate.resolve({summary:'Generated from independent summary evidence.'});
   assert.equal((await work).summary,'Generated from independent summary evidence.'); }finally{s.close();}
});

function storedSummary(s,id) {const row=s.store.get("SELECT data,content_hash AS contentHash FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",id);return {...row,data:JSON.parse(row.data)};}

test('replacing the summary generating baseline rejects an obsolete summary snapshot',async()=>{
 const gate=deferred(),s=fixture(()=>gate.promise);try {
   const work=s.coordinator.run('default',s.page,undefined,{fields:['summary'],explicit:true});
   s.enrichments.save('default',s.page.id,'summary',{summary:'A concurrent summary',generatedContentHash:s.page.summaryContentHash},s.page.revision,selection);
   gate.resolve({summary:'Obsolete generated result'});await assert.rejects(work,{status:409});
   assert.equal(storedSummary(s,s.page.id).data.summary,'A concurrent summary');
 }finally{s.close();}
});
