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
   execute:(vault,id,snapshot,signal)=>s.coordinator.run(vault,snapshot.page,undefined,{fields:snapshot.requestedFields,signal}),
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
   gate.resolve({summary:'Obsolete summary'});await work;
   assert.equal(s.store.get('SELECT generation FROM page_enrichment_jobs WHERE page_id=?',page.id).generation,3);
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
