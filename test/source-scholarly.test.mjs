import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourceScholarly,parseSourceScholarly} from '../src/server/modules/source-scholarly.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {PropertyReview} from '../src/server/modules/property-review.ts';
const text='Synthetic monograph. The method compares ideals. It responds to Prior Study.';
async function fixture(work) {
 const dir=mkdtempSync(join(tmpdir(),'noema-scholarly-')),db=openDatabase(join(dir,'synthetic.sqlite')),store=new Store(db),knowledge=new Knowledge(store),files=new SourceFiles(store);
 const file=files.add('default','synthetic.md',Buffer.from(text)),source=knowledge.create('default',{name:'Synthetic monograph',type:'source',attachmentIds:[file.id]});
 store.run("UPDATE source_files SET status='ready',text=?,admitted=1 WHERE id=?",text,file.id);
 const concept=knowledge.create('default',{name:'Ideal',type:'concept'}),prior=knowledge.create('default',{name:'Prior Study',type:'creativework'});
 let calls=0,generate=async()=>JSON.stringify({synopsis:{text:'From the supplied excerpts, this study compares ideals.',method:'Comparison',conclusions:'',quote:'The method compares ideals.'},disciplines:[{domainId:'general',quote:'Synthetic monograph.'}],concepts:[{entityId:concept.id,quote:'ideals'}],relationships:[{entityId:prior.id,kind:'responds_to',quote:'It responds to Prior Study.'}]});
 const service=new SourceScholarly(store,{selection:()=>({model:'synthetic',reasoningEffort:'none'}),generate:async request=>{calls++;return generate(request);}},new AIActivityLog(store));
 try{await work({store,source,file,concept,prior,knowledge,service,review:new PropertyReview(store),calls:()=>calls,setGenerate:value=>{generate=value;}});}finally{service.close();files.close();db.close();rmSync(dir,{recursive:true,force:true});}
}
test('scholarly interpretations require consent and document evidence, stay proposals, and reuse reviewed/rejected results',()=>fixture(async({store,source,service,review,calls})=>{
 await assert.rejects(()=>service.run('default',source.id,{}),error=>error.status===400);assert.equal(calls(),0);
 const before=store.all('SELECT * FROM properties WHERE entity_id=?',source.id).length;
 const result=await service.run('default',source.id,{confirmRemote:true});assert.equal(result.proposals.length,3);assert.equal(result.basis,'document-excerpts');assert.equal(store.all('SELECT * FROM properties WHERE entity_id=?',source.id).length,before);
 const synopsis=review.list('default',source.id).find(item=>item.property_name==='ai scholarly synopsis');assert.match(synopsis.details,/not an author abstract/);review.review('default',source.id,synopsis.id,{action:'reject',fingerprint:synopsis.fingerprint});
 const cached=await service.run('default',source.id,{confirmRemote:true});assert.equal(cached.cached,true);assert.equal(calls(),1);assert.equal(cached.proposals.find(item=>item.id===synopsis.id).status,'rejected');
 const link=review.list('default',source.id).find(item=>item.property_name==='discusses concept');review.review('default',source.id,link.id,{action:'accept',fingerprint:link.fingerprint});assert.equal(store.all('SELECT * FROM properties WHERE entity_id=?',source.id).length,before+1);assert.equal((await service.run('default',source.id,{confirmRemote:true})).cached,true);
}));
test('scholarly requests reject stale document responses and cancellation without saving proposals',()=>fixture(async({store,source,file,prior,service,setGenerate})=>{
 let finish;setGenerate(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController(),pending=service.run('default',source.id,{confirmRemote:true},controller.signal);controller.abort();finish('{}');await assert.rejects(()=>pending,error=>error.status===499);assert.equal(store.all('SELECT * FROM property_proposals').length,0);
 setGenerate(async()=>{store.run('UPDATE source_files SET text=? WHERE id=?','Changed synthetic content',file.id);return JSON.stringify({synopsis:{text:'Only excerpts.',method:'',conclusions:'',quote:'Synthetic monograph.'},disciplines:[],concepts:[],relationships:[]});});await assert.rejects(()=>service.run('default',source.id,{confirmRemote:true}),error=>error.status===409);assert.equal(store.all('SELECT * FROM property_proposals').length,0);
 store.run('UPDATE source_files SET text=? WHERE id=?',text,file.id);
 setGenerate(async()=>{store.run("UPDATE entities SET archived_at='2026-10-24T00:00:00Z' WHERE id=?",prior.id);return JSON.stringify({synopsis:{text:'Only excerpts.',method:'',conclusions:'',quote:'Synthetic monograph.'},disciplines:[],concepts:[],relationships:[{entityId:prior.id,kind:'responds_to',quote:'It responds to Prior Study.'}]});});
 await assert.rejects(()=>service.run('default',source.id,{confirmRemote:true}),error=>error.status===409);assert.equal(store.all('SELECT * FROM property_proposals').length,0);
}));
test('scholarly parser rejects fabricated evidence/targets and metadata-only sources need a document',()=>fixture(async({source,service,setGenerate,store,file})=>{
 const valid={synopsis:{text:'Only excerpts.',method:'',conclusions:'',quote:'Invented supporting quote'},disciplines:[],concepts:[],relationships:[]};assert.throws(()=>parseSourceScholarly(JSON.stringify(valid),text,[]),error=>error.status===502);
 valid.synopsis.quote='Synthetic monograph.';valid.relationships=[{entityId:'invented',kind:'influenced_by',quote:'Synthetic monograph.'}];assert.throws(()=>parseSourceScholarly(JSON.stringify(valid),text,[]),error=>error.status===502);
 store.run("UPDATE source_files SET status='failed' WHERE id=?",file.id);await assert.rejects(()=>service.run('default',source.id,{confirmRemote:true}),error=>error.status===409);
}));
