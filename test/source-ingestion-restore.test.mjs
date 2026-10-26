import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceDocuments} from '../src/server/modules/source-documents.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {assembleSourceIngestionDocument} from '../src/server/modules/source-ingestion-assembly.ts';
import {restoreIngestionBackup} from '../src/server/modules/source-ingestion-backup.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
const stamp='2026-10-26T10:00:00.000Z';
function fixture({withRepairs=false,withUnreadablePage=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-ingestion-restore-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),files=new SourceFiles(store);
 const original=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
 const file=files.add('default','synthetic.pdf',original);
 new Knowledge(store).create('default',{name:'Manual source title',type:'source',attachmentIds:[file.id]});
 const doc={schemaVersion:1,metadata:{title:'Proposed title',language:'en',synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'ix',role:'owned',state:'content',unresolved:[]}],blocks:[{id:'table',page:1,order:0,kind:'table',text:'A 😀 table\ncell',headingLevel:null,continues:null,table:{rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'A 😀 table\ncell'}]},uncertainty:null,location:null},{id:'note',page:1,order:1,kind:'footnote',text:'Exact footnote.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[{kind:'footnote-callout',from:'table',to:'note',uncertain:true}],repairs:[]};
 if(withUnreadablePage){doc.pages.push({number:2,printedLabel:'x',role:'owned',state:'unreadable',unresolved:[{description:'Unreadable synthetic scan.',blockId:null}]},{number:3,printedLabel:'xi',role:'owned',state:'content',unresolved:[]});doc.blocks.push({id:'later',page:3,order:0,kind:'paragraph',text:'Unchanged following page.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null});}
 if(withRepairs){doc.blocks[1].text='Exact ﬁrst footnote.';doc.repairs=[{blockId:'note',start:6,end:10,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Synthetic mechanical equivalent.'},{blockId:'table',start:5,end:10,original:'table',replacement:'tables',category:'ocr',reason:'Synthetic uncertain reading.'}];}
 const assembly=assembleSourceIngestionDocument(doc,{extractionId:'retained_version'}),config={route:'openai',model:'gpt-6.1-sol',depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:8,maxOutputTokens:24000,maxCostUsd:10}},fingerprint=sha(JSON.stringify(config));
 const provenance={provider:'openai',requestedModel:'gpt-6.1-sol',returnedModel:'gpt-6.1-sol',schemaVersion:1,promptVersion:'pdf-transcription-1',originalHash:sha(original),admittedHash:sha(original),transmittedHash:sha('transmitted'),responseHash:sha('response'),coverage:'checked',independentEvidence:'not-checked',userReviewed:false};
 const ledger=Object.fromEntries(['transcription','structure','metadata','math','apparatus','synopsis','authors'].map(key=>[key,{state:key==='math'?'not-requested':'completed',fingerprint}]));
 store.run("UPDATE source_files SET text=?,status='ready',enrichment_status='completed',pages=?,page_start_lines=?,structural_nodes=? WHERE id=?",assembly.text,doc.pages.length,JSON.stringify(assembly.pageStartLines),JSON.stringify(assembly.structuralNodes),file.id);
 const rows={source_ingestion_documents:[{id:'document',file_id:'old-file',schema_version:1,assembly_version:assembly.assemblyVersion,content_hash:assembly.contentHash,document_json:JSON.stringify(doc),assembly_json:JSON.stringify(assembly),provenance_json:JSON.stringify(provenance),capabilities_json:JSON.stringify(ledger),created_at:stamp}],source_ingestion_runs:[{id:'run',file_id:'old-file',config_json:JSON.stringify(config),fingerprint,page_count:doc.pages.length,published_document_id:'document',original_hash:provenance.originalHash,admitted_hash:provenance.admittedHash,created_at:stamp,updated_at:stamp}],source_ingestion_windows:[{id:'window',run_id:'run',ordinal:0,plan_json:JSON.stringify({index:0,ownedPages:doc.pages.map(page=>page.number),contextPages:[],estimatedOutputTokens:5000}),state:'completed',result_json:JSON.stringify(doc),transmitted_hash:provenance.transmittedHash}],source_ingestion_attempts:[{window_id:'window',state:'completed',usage_json:JSON.stringify({inputTokens:100,outputTokens:50}),response_hash:provenance.responseHash,error:null,created_at:stamp,updated_at:stamp}]};
 return {dir,db,store,files,file,doc,assembly,rows,cleanup(){files.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('authoritative IR survives cache deletion and full vault backup restore with exact anchors and no original evidence',async()=>{
 const f=fixture();try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const documents=new SourceDocuments(f.store),before=documents.get(f.files.require('default',f.file.id));
  assert.deepEqual(before.semantic.children.map(n=>n.range),f.assembly.blockRanges.map(b=>b.range));
  f.store.run('DELETE FROM source_documents WHERE file_id=?',f.file.id);assert.deepEqual(documents.get(f.files.require('default',f.file.id)),before);
  const backups=new VaultBackups(f.store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored synthetic IR');
  const file=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),after=documents.get(file);
  assert.equal(file.text,f.assembly.text);assert.deepEqual(after.semantic.children,before.semantic.children);assert.deepEqual(after.ingestion.blocks,before.ingestion.blocks);assert.deepEqual(after.ingestion.relations,before.ingestion.relations);assert.deepEqual(after.ingestion.provenance,before.ingestion.provenance);
  assert.equal(f.files.evidence(restored.id,file.id).originalAvailable,false);
  assert.equal(f.store.get('SELECT request_id FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.vault_id=?',restored.id).request_id,null);
 }finally{f.cleanup();}
});
test('restored submitted work is paused with unknown outcome and loses remote request handles',()=>{
 const f=fixture();try{
  f.rows.source_ingestion_documents=[];f.rows.source_ingestion_runs[0].published_document_id=null;f.rows.source_ingestion_windows[0].state='running';f.rows.source_ingestion_windows[0].result_json=null;f.rows.source_ingestion_attempts[0].state='submitted';f.rows.source_ingestion_attempts[0].request_id='remote-sensitive';
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  assert.equal(f.store.get('SELECT state FROM source_ingestion_runs').state,'paused');assert.equal(f.store.get('SELECT state FROM source_ingestion_windows').state,'unknown');
  assert.deepEqual({...f.store.get('SELECT state,request_id FROM source_ingestion_attempts')},{state:'unknown',request_id:null});
 }finally{f.cleanup();}
});
test('restore rejects injected secrets, forged verification, altered exact ranges and completed invalid outputs atomically',()=>{
 for(const mutate of [rows=>{const c=JSON.parse(rows.source_ingestion_runs[0].config_json);c.apiKey='must-not-restore';rows.source_ingestion_runs[0].config_json=JSON.stringify(c);},rows=>{const p=JSON.parse(rows.source_ingestion_documents[0].provenance_json);p.independentEvidence='checked';rows.source_ingestion_documents[0].provenance_json=JSON.stringify(p);},rows=>{const a=JSON.parse(rows.source_ingestion_documents[0].assembly_json);a.blockRanges[0].range.endOffset++;rows.source_ingestion_documents[0].assembly_json=JSON.stringify(a);},rows=>{rows.source_ingestion_windows[0].result_json='{}';},rows=>{rows.source_ingestion_attempts[0].transmitted_hash='not-a-hash';},rows=>{rows.source_ingestion_documents=[];rows.source_ingestion_runs[0].published_document_id=null;rows.source_ingestion_windows[0].repair_state='candidate';rows.source_ingestion_attempts[0].kind='repair';}]){
  const f=fixture();try{mutate(f.rows);assert.throws(()=>f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows)),/Invalid PDF/);assert.equal(f.store.get('SELECT count(*) n FROM source_ingestion_documents').n,0);}finally{f.cleanup();}
 }
});

test('repair recovery preserves extraction output and known invalid usage without restoring a paid request handle',()=>{
 const f=fixture();try{
  f.rows.source_ingestion_documents=[];f.rows.source_ingestion_runs[0].published_document_id=null;f.rows.source_ingestion_windows[0].repair_state='running';f.rows.source_ingestion_attempts[0].kind='repair';f.rows.source_ingestion_attempts[0].state='submitted';f.rows.source_ingestion_attempts[0].returned_model='gpt-6.1-sol';
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const window=f.store.get('SELECT state,repair_state,result_json FROM source_ingestion_windows');assert.equal(window.state,'completed');assert.equal(window.repair_state,'unknown');assert.deepEqual(JSON.parse(window.result_json),f.doc);
  assert.deepEqual({...f.store.get('SELECT kind,state,request_id,returned_model FROM source_ingestion_attempts')},{kind:'repair',state:'unknown',request_id:null,returned_model:'gpt-6.1-sol'});
 }finally{f.cleanup();}
});
test('restore retains superseded truncation history without counting its pages as duplicated ownership',()=>{
 const f=fixture();try{
  f.rows.source_ingestion_windows.unshift({...f.rows.source_ingestion_windows[0],id:'superseded',ordinal:1,plan_json:JSON.stringify({index:1,ownedPages:[1],contextPages:[],estimatedOutputTokens:5000}),state:'superseded',result_json:null});
  f.rows.source_ingestion_attempts.push({...f.rows.source_ingestion_attempts[0],window_id:'superseded',state:'invalid',usage_json:JSON.stringify({inputTokens:200,outputTokens:300})});
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_windows WHERE state='superseded'").n,1);
  assert.equal(f.store.get("SELECT state FROM source_ingestion_attempts WHERE usage_json LIKE '%300%'").state,'invalid');
 }finally{f.cleanup();}
});
test('restored sparse corrections retain automatic and pending decisions, rebind ingestion identity, and remain reviewable',async()=>{
 const {reconcileSourceIngestion}=await import('../src/server/modules/source-ingestion-corrections.ts');
 const {SourceReprocessing}=await import('../src/server/modules/source-reprocessing.ts');
 const f=fixture({withRepairs:true});try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const doc=f.store.get('SELECT id FROM source_ingestion_documents WHERE file_id=?',f.file.id),run=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',f.file.id);
  const reconciled=f.store.transaction(()=>reconcileSourceIngestion(f.store,f.files.require('default',f.file.id),f.doc,f.assembly,{runId:run.id,documentId:doc.id,reviewPolicy:'verified',depth:'balanced',model:'synthetic'}));
  assert.equal(reconciled.revision.patches.filter(patch=>patch.decision==='accepted').length,1);assert.equal(reconciled.pendingRepairs,1);
  const backups=new VaultBackups(f.store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored corrections');
  const file=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),row=f.store.get('SELECT id FROM source_reprocessing WHERE file_id=?',file.id);
  const service=new SourceReprocessing(f.store,f.files,{},()=>{},{}),revision=service.detail(restored.id,file.id,row.id);
  assert.equal(revision.stale,false);assert.notEqual(revision.origin.documentId,reconciled.revision.origin.documentId);assert.equal(revision.original.document.ingestion.documentId,revision.origin.documentId);
  assert.equal(revision.patches.filter(patch=>patch.decision==='accepted').length,1);assert.equal(revision.patches.filter(patch=>patch.decision==='pending').length,1);
  const pending=revision.patches.find(patch=>patch.decision==='pending'),reviewed=service.review(restored.id,file.id,row.id,{updatedAt:revision.updatedAt,decisions:[{patchId:pending.id,decision:'accepted',replacement:'table revised'}]});
  assert.match(reviewed.reprocessed.text,/table revised/);assert.equal(f.files.require(restored.id,file.id).text,f.assembly.text);
  const automatic=reviewed.patches.find(patch=>patch.autoAcceptance);assert.equal(automatic.decisionHistory[0].actor,'automatic');
  const reversed=service.review(restored.id,file.id,row.id,{updatedAt:reviewed.updatedAt,decisions:[{patchId:automatic.id,decision:'rejected'}]});assert.match(reversed.reprocessed.text,/ﬁrst/);
 }finally{f.cleanup();}
});
test('later optional repairs create an idempotent derivative without changing baseline or earlier decisions',async()=>{
 const {reconcileSourceIngestion,createSourceIngestionRepairDerivative,preflightSourceIngestionRepairCapacity}=await import('../src/server/modules/source-ingestion-corrections.ts');
 const f=fixture({withRepairs:true});try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const document=f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',f.file.id),run=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',f.file.id),file=f.files.require('default',f.file.id);
  const options={runId:run.id,documentId:document.id,reviewPolicy:'verified',depth:'balanced',model:'synthetic'};
  const first=reconcileSourceIngestion(f.store,file,f.doc,f.assembly,options).revision,firstPayload=f.store.get('SELECT payload FROM source_reprocessing WHERE id=?',first.id).payload;
  const block=f.assembly.blockRanges[0],startOffset=block.range.startOffset;
  const repair={blockId:block.id,startOffset,endOffset:startOffset+1,startLine:block.range.startLine,endLine:block.range.startLine,original:'A',replacement:'An',category:'ocr',reason:'Synthetic later alternative.'};
  const candidates={...f.assembly,repairs:[...f.assembly.repairs,repair]},identity=sha('recovery-attempt');
  const result=createSourceIngestionRepairDerivative(f.store,file,f.doc,candidates,{...options,candidateIdentity:identity});
  assert.equal(result.created,true);assert.equal(result.skipped,2);assert.equal(result.revision.patches.length,1);assert.equal(result.revision.patches[0].decision,'pending');
  assert.equal(f.store.get('SELECT payload FROM source_reprocessing WHERE id=?',first.id).payload,firstPayload);
  assert.equal(f.files.require('default',file.id).text,f.assembly.text);assert.equal(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE id=?',document.id).document_json,document.document_json);
  const duplicate=createSourceIngestionRepairDerivative(f.store,file,f.doc,candidates,{...options,candidateIdentity:identity});assert.equal(duplicate.created,false);assert.equal(duplicate.revision.id,result.revision.id);
  const overlap=createSourceIngestionRepairDerivative(f.store,file,f.doc,candidates,{...options,candidateIdentity:sha('new-attempt-same-results')});assert.equal(overlap.revision,null);assert.equal(overlap.created,false);
  assert.equal(f.store.get('SELECT count(*) n FROM source_reprocessing WHERE file_id=?',file.id).n,2);
  preflightSourceIngestionRepairCapacity(f.store,file);
  f.store.run("UPDATE source_reprocessing SET status='queued' WHERE id=?",first.id);
  assert.throws(()=>preflightSourceIngestionRepairCapacity(f.store,file),/active editorial pass/);
  f.store.run("UPDATE source_reprocessing SET status='completed' WHERE id=?",first.id);
  const {SourceReprocessing}=await import('../src/server/modules/source-reprocessing.ts');
  f.store.run("UPDATE source_ingestion_runs SET state='paused' WHERE id=?",run.id);
  assert.throws(()=>new SourceReprocessing(f.store,f.files,{},()=>{},{}).start('default',file.id,{pipelineVersion:1,acceptanceMode:'review_all'}),/active PDF ingestion recovery/);
  assert.throws(()=>new SourceReprocessing(f.store,f.files,{},()=>{},{}).resume('default',file.id,first.id),/active PDF ingestion recovery/);
  f.store.run("UPDATE source_ingestion_runs SET state='completed' WHERE id=?",run.id);
  const backups=new VaultBackups(f.store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored recovery');
  const restoredFile=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),restoredDocument=f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',restoredFile.id),restoredRun=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',restoredFile.id);
  const restoredRepeat=createSourceIngestionRepairDerivative(f.store,restoredFile,JSON.parse(restoredDocument.document_json),candidates,{...options,documentId:restoredDocument.id,runId:restoredRun.id,candidateIdentity:identity});
  assert.equal(restoredRepeat.created,false);assert.equal(restoredRepeat.revision.origin.repairIdentity,identity);
 }finally{f.cleanup();}
});
test('optional recovery refuses canonical changes and capacity exhaustion before new work',async()=>{
 const {reconcileSourceIngestion,createSourceIngestionRepairDerivative,preflightSourceIngestionRepairCapacity}=await import('../src/server/modules/source-ingestion-corrections.ts');
 const f=fixture({withRepairs:true});try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const document=f.store.get('SELECT id FROM source_ingestion_documents WHERE file_id=?',f.file.id),run=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',f.file.id),file=f.files.require('default',f.file.id),options={runId:run.id,documentId:document.id,reviewPolicy:'verified',depth:'balanced',model:'synthetic',candidateIdentity:sha('attempt')};
  const revision=reconcileSourceIngestion(f.store,file,f.doc,f.assembly,options).revision;
  assert.throws(()=>createSourceIngestionRepairDerivative(f.store,file,f.doc,{...f.assembly,text:f.assembly.text+'changed'},options),/immutable/);
  const altered=structuredClone(f.assembly);altered.blockRanges[0].id='invented';assert.throws(()=>createSourceIngestionRepairDerivative(f.store,file,f.doc,altered,options),/identities/);
  for(let index=0;index<3;index++){
   const copy={...revision,id:`extra-${index}`,versionNumber:undefined};f.store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',copy.id,file.id,file.vault_id,'completed',copy.createdAt,copy.updatedAt,JSON.stringify(copy));
  }
  assert.throws(()=>preflightSourceIngestionRepairCapacity(f.store,file),error=>error.status===409&&/Revision limit/.test(error.message));
  assert.equal(f.files.require('default',file.id).text,f.assembly.text);
 }finally{f.cleanup();}
});

test('restored retained paid repair candidate publishes locally without replaying provider or PDF work',async()=>{
 const {mergeSourceIngestionWindows}=await import('../src/server/modules/source-ingestion-assembly.ts');
 const {SourceIngestion}=await import('../src/server/modules/source-ingestion.ts');
 const f=fixture();let service;try{
  const merged=mergeSourceIngestionWindows([{index:0,document:f.doc}],1),baseline=assembleSourceIngestionDocument(merged,{extractionId:'retained_version'});
  Object.assign(f.rows.source_ingestion_documents[0],{document_json:JSON.stringify(merged),assembly_json:JSON.stringify(baseline),content_hash:baseline.contentHash});
  const candidate=structuredClone(f.doc);candidate.repairs=[{blockId:'table',start:5,end:10,original:'table',replacement:'tables',category:'ocr',reason:'Retained paid alternative.'}];
  f.rows.source_ingestion_windows[0].repair_state='candidate';f.rows.source_ingestion_windows[0].result_json=JSON.stringify(candidate);f.rows.source_ingestion_attempts[0].kind='repair';
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  assert.equal(f.store.get('SELECT repair_state FROM source_ingestion_windows').repair_state,'candidate');
  const archived=await new VaultBackups(f.store).export('default'),restored=await new VaultBackups(f.store).import(archived.bytes,'Restored paid candidate');
  const file=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),record=f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id);
  let work=0;const forbidden=async()=>{work++;throw new Error('Already paid candidate must not repeat PDF or provider work');};
  service=new SourceIngestion(f.store,{prepare:forbidden,split:forbidden,extract:forbidden,repair:forbidden});
  assert.equal(service.view(restored.id,file.id).canRetryOptional,true);service.retry(restored.id,file.id);await service.tick();
  const view=service.view(restored.id,file.id);assert.equal(view.state,'completed',view.error);assert.equal(work,0);assert.equal(f.files.require(restored.id,file.id).text,baseline.text);
  assert.equal(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id).document_json,record.document_json);
  const revision=JSON.parse(f.store.get('SELECT payload FROM source_reprocessing WHERE file_id=?',file.id).payload);assert.equal(revision.patches.length,1);assert.equal(revision.patches[0].original,'table');assert.equal(revision.patches[0].decision,'pending');
  await service.tick();assert.equal(work,0);assert.equal(f.store.get('SELECT count(*) n FROM source_reprocessing WHERE file_id=?',file.id).n,1);
 }finally{service?.close();f.cleanup();}
});
test('wholly unreadable page recovery stays manual and derivative-only, preserves neighbors, and restores edited acceptance and reversal',async()=>{
 const {createSourceIngestionPageRecoveryDerivative,preflightSourceIngestionPageRecovery}=await import('../src/server/modules/source-ingestion-corrections.ts');
 const {SourceReprocessing}=await import('../src/server/modules/source-reprocessing.ts');
 const f=fixture({withUnreadablePage:true});try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const published=f.store.get('SELECT * FROM source_ingestion_documents WHERE file_id=?',f.file.id),run=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',f.file.id),file=f.files.require('default',f.file.id),baseline=new SourceDocuments(f.store).get(file);
  const ir={schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:2,printedLabel:'x',role:'owned',state:'content',unresolved:[]}],blocks:[{id:'recovered-prose',page:2,order:0,kind:'paragraph',text:'Recovered 😀 page text.',headingLevel:null,continues:null,table:null,uncertainty:'Provider reading needs PDF comparison.',location:{x:0,y:0,width:1,height:1,accuracy:'approximate'}},{id:'recovered-table',page:2,order:1,kind:'table',text:'Column | Value\nA | 1',headingLevel:null,continues:null,table:{rows:2,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Column'},{row:0,column:1,rowSpan:1,columnSpan:1,text:'Value'},{row:1,column:0,rowSpan:1,columnSpan:1,text:'A'},{row:1,column:1,rowSpan:1,columnSpan:1,text:'1'}]},uncertainty:null,location:null}],relations:[],repairs:[]};
  ir.blocks.push({id:'recovered-next',page:2,order:2,kind:'paragraph',text:'Unchanged following page. '+'Synthetic recovery context. '.repeat(20),headingLevel:null,continues:'recovered-prose',table:null,uncertainty:null,location:null});ir.relations.push({kind:'continuation',from:'recovered-prose',to:'recovered-next',uncertain:false});
  const options={runId:run.id,documentId:published.id,reviewPolicy:'verified',depth:'balanced',model:'synthetic',candidateIdentity:sha('page-attempt'),responseHash:sha('page-response'),page:2};
  preflightSourceIngestionPageRecovery(f.store,file,2);
  assert.throws(()=>preflightSourceIngestionPageRecovery(f.store,file,1),/wholly unreadable/);
  const created=createSourceIngestionPageRecoveryDerivative(f.store,file,ir,options),revision=created.revision,patch=revision.patches[0];
  assert.equal(created.created,true);assert.equal(patch.decision,'pending');assert.equal(patch.autoAcceptance,undefined);assert.match(patch.original,/^\n[ \t\n]*$/);assert.equal(revision.reprocessed.text,file.text);assert.equal(revision.configuration.reviewPolicy,'review_all');
  const summary=JSON.parse(f.store.get('SELECT summary_json FROM source_reprocessing WHERE id=?',revision.id).summary_json);assert.equal(summary.origin.pageRecovery,undefined);
  assert.equal(createSourceIngestionPageRecoveryDerivative(f.store,file,ir,options).revision.id,revision.id);
  const service=new SourceReprocessing(f.store,f.files,{},()=>{},{}),accepted=service.review('default',file.id,revision.id,{updatedAt:revision.updatedAt,decisions:[{patchId:patch.id,decision:'accepted'}]});
  assert.match(accepted.reprocessed.text,/Recovered 😀 page text/);assert.equal(f.files.require('default',file.id).text,file.text);assert.equal(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE id=?',published.id).document_json,published.document_json);
  const added=accepted.reprocessed.document.semantic.children.filter(node=>node.id.startsWith('recovery-'));
  assert.equal(added.length,3);assert.deepEqual(added.map(node=>node.range.startPage),[2,2,2]);assert.equal(added[2].ingestion.continues,added[0].id);assert.equal(added[1].ingestion.table.rows,2);
  assert.ok(accepted.reprocessed.document.ingestion.readingMapping.recoveredNodes.every(node=>node.originalId===null));
  const {sourceReadingRevision}=await import('../src/server/modules/source-reading-revision.ts'),view=sourceReadingRevision(f.store,'default',file,accepted.id);
  const duplicate={startOffset:added[2].range.startOffset,endOffset:added[2].range.startOffset+'Unchanged following page.'.length};
  assert.equal(view.reverse(duplicate),null,'Duplicate wording on a different original page must not become recovery evidence.');
  assert.equal(view.forward({startOffset:baseline.semantic.children[0].range.startOffset,endOffset:baseline.semantic.children.at(-1).range.endOffset}),null,'A formerly contiguous range crossing the recovered gap is explicitly unmapped.');
  assert.ok(view.forward(baseline.semantic.children.at(-1).range));

  assert.deepEqual(accepted.reprocessed.document.semantic.children.filter(node=>!node.id.startsWith('recovery-')).map(node=>node.id),baseline.semantic.children.map(node=>node.id));
  const backups=new VaultBackups(f.store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Recovered page restore');
  const restoredFile=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id),restoredRevision=f.store.get('SELECT id FROM source_reprocessing WHERE file_id=?',restoredFile.id),detail=service.detail(restored.id,restoredFile.id,restoredRevision.id);
  assert.equal(detail.stale,false);assert.deepEqual(detail.reprocessed.document.semantic.children.filter(node=>node.id.startsWith('recovery-')).map(node=>node.id),added.map(node=>node.id));
  const edited=service.review(restored.id,restoredFile.id,detail.id,{updatedAt:detail.updatedAt,decisions:[{patchId:patch.id,decision:'accepted',replacement:'\nUser compared page wording.\n\n'}]});
  const manual=edited.reprocessed.document.semantic.children.filter(node=>node.id.startsWith('recovery-'));assert.equal(manual.length,1);assert.equal(manual[0].ingestion.table,null);assert.match(manual[0].text,/User compared/);
  const reversed=service.review(restored.id,restoredFile.id,detail.id,{updatedAt:edited.updatedAt,decisions:[{patchId:patch.id,decision:'rejected'}]});assert.equal(reversed.reprocessed.text,restoredFile.text);assert.ok(!reversed.reprocessed.document.semantic.children.some(node=>node.id.startsWith('recovery-')));
 }finally{f.cleanup();}
});
test('restore validates retained cross-window relations against exact extraction endpoints and excludes relation units from page ownership',async()=>{
 const {mergeSourceIngestionWindows}=await import('../src/server/modules/source-ingestion-assembly.ts');
 const {sourceIngestionBoundaryRelationRequests,reconcileSourceIngestionRelations}=await import('../src/server/modules/source-ingestion-relations.ts');
 const f=fixture();try{
  const second=structuredClone(f.doc);second.pages=[{number:2,printedLabel:'1',role:'owned',state:'content',unresolved:[]}];second.blocks=[{...second.blocks[0],id:'second-table',page:2,text:'Continued table cell',table:{rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Continued table cell'}]}}];second.relations=[];
  const merged=mergeSourceIngestionWindows([{index:0,document:f.doc},{index:1,document:second}],2),request=sourceIngestionBoundaryRelationRequests(merged,[2])[0];
  const response={relations:[{kind:'table-continuation',from:'w0:table',to:'w1:second-table',uncertain:false,reason:'Same visible one-column table continues.'}]};
  const related=reconcileSourceIngestionRelations(response,merged,request).document,assembly=assembleSourceIngestionDocument(related,{extractionId:'retained_version'});
  Object.assign(f.rows.source_ingestion_documents[0],{document_json:JSON.stringify(related),assembly_json:JSON.stringify(assembly),content_hash:assembly.contentHash});
  f.rows.source_ingestion_runs[0].page_count=2;
  const first=f.rows.source_ingestion_windows[0];first.kind='extraction';first.repair_state='skipped';
  f.rows.source_ingestion_windows.push({...first,id:'second-window',ordinal:1,plan_json:JSON.stringify({index:1,ownedPages:[2],contextPages:[1],estimatedOutputTokens:5000}),result_json:JSON.stringify(second)},{...first,id:'relations',kind:'relations',ordinal:2,plan_json:JSON.stringify({index:2,ownedPages:[1,2],contextPages:[],estimatedOutputTokens:4000}),result_json:JSON.stringify(response)});
  f.rows.source_ingestion_attempts.push({...f.rows.source_ingestion_attempts[0],window_id:'relations',kind:'relations'});
  f.store.run('UPDATE source_files SET text=?,pages=2,page_start_lines=? WHERE id=?',assembly.text,JSON.stringify(assembly.pageStartLines),f.file.id);
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const archive=await new VaultBackups(f.store).export('default'),restored=await new VaultBackups(f.store).import(archive.bytes,'Restored boundary links'),file=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id);
  const document=new SourceDocuments(f.store).get(file);assert.equal(document.ingestion.relations.filter(r=>r.kind==='table-continuation').length,1);assert.deepEqual(document.semantic.children.map(node=>node.range),assembly.blockRanges.map(block=>block.range));
  assert.equal(f.store.get("SELECT count(*) n FROM source_ingestion_windows w JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.vault_id=? AND w.kind='relations' AND w.state='completed'",restored.id).n,1);
  const malformed=structuredClone(f.rows);const value=JSON.parse(malformed.source_ingestion_windows[2].result_json);value.relations[0].to='w1:invented';malformed.source_ingestion_windows[2].result_json=JSON.stringify(value);
  const fresh=fixture();try{fresh.store.run('UPDATE source_files SET text=?,pages=2 WHERE id=?',assembly.text,fresh.file.id);assert.throws(()=>fresh.store.transaction(()=>restoreIngestionBackup(fresh.store,'default',new Map([['old-file',fresh.file.id]]),malformed)),/Invalid PDF/);}finally{fresh.cleanup();}
 }finally{f.cleanup();}
});
test('missing-page recovery rejects forged marker spans, model geometry, automatic acceptance, and oversized outputs',async()=>{
 const {createSourceIngestionPageRecoveryDerivative}=await import('../src/server/modules/source-ingestion-corrections.ts');const {restoreSourceRevision}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const f=fixture({withUnreadablePage:true});try{
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const published=f.store.get('SELECT id FROM source_ingestion_documents WHERE file_id=?',f.file.id),run=f.store.get('SELECT id FROM source_ingestion_runs WHERE file_id=?',f.file.id),file=f.files.require('default',f.file.id);
  const ir={schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:2,printedLabel:null,role:'owned',state:'content',unresolved:[]}],blocks:[{id:'p2',page:2,order:0,kind:'paragraph',text:'Recovered passage.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[],repairs:[]};
  const options={runId:run.id,documentId:published.id,reviewPolicy:'verified',depth:'balanced',model:'synthetic',candidateIdentity:sha('page-guard-attempt'),responseHash:sha('page-guard-response'),page:2},revision=createSourceIngestionPageRecoveryDerivative(f.store,file,ir,options).revision;
  for(const mutate of [r=>{r.origin.pageRecovery.insertion.startOffset--;},r=>{r.origin.pageRecovery.insertion.original='<!-- Page 2 -->';},r=>{r.origin.pageRecovery.page=3;},r=>{r.origin.pageRecovery.document.blocks[0].location={x:0,y:0,width:1,height:1,accuracy:'native'};},r=>{r.patches[0].decision='accepted';},r=>{r.patches[0].replacement='Invented alternative.';},r=>{r.patches[0].autoAcceptance={policy:'verified',validator:'fake',checks:[],appliedAt:stamp};}]){
   const copy=structuredClone(revision);mutate(copy);assert.throws(()=>restoreSourceRevision(copy,copy.id,copy.fileId,'restored','restored-file'),/invalid source editorial revision/);
  }
  for(const text of ['<!-- Page 9 -->','x'.repeat(17000),'\u0000unsafe']){const copy=structuredClone(ir);copy.blocks[0].text=text;assert.throws(()=>createSourceIngestionPageRecoveryDerivative(f.store,file,copy,{...options,candidateIdentity:sha(text)}));}
  assert.equal(f.store.get('SELECT count(*) n FROM source_reprocessing WHERE file_id=?',file.id).n,1);assert.equal(f.files.require('default',file.id).text,file.text);
 }finally{f.cleanup();}
});
test('paid missing-page candidate survives restore and publishes only a manual derivative without PDF or provider replay',async()=>{
 const {mergeSourceIngestionWindows}=await import('../src/server/modules/source-ingestion-assembly.ts');
 const {SourceIngestion}=await import('../src/server/modules/source-ingestion.ts');const f=fixture();let service;
 try{
  const raw=structuredClone(f.doc);raw.pages.push({number:2,printedLabel:'1',role:'owned',state:'unreadable',unresolved:[{description:'Unreadable physical page',blockId:null}]});
  const merged=mergeSourceIngestionWindows([{index:0,document:raw}],2),baseline=assembleSourceIngestionDocument(merged,{extractionId:'retained_version'}),recovered=structuredClone(f.doc);
  recovered.pages=[{number:2,printedLabel:'1',role:'owned',state:'content',unresolved:[]}];recovered.blocks=[{...recovered.blocks[0],id:'recovered',page:2,kind:'paragraph',text:'Recovered paragraph 😀.',table:null}];recovered.relations=[];
  Object.assign(f.rows.source_ingestion_documents[0],{document_json:JSON.stringify(merged),assembly_json:JSON.stringify(baseline),content_hash:baseline.contentHash});f.rows.source_ingestion_runs[0].page_count=2;
  const first=f.rows.source_ingestion_windows[0];Object.assign(first,{kind:'extraction',repair_state:'skipped',plan_json:JSON.stringify({index:0,ownedPages:[1,2],contextPages:[],estimatedOutputTokens:5000}),result_json:JSON.stringify(raw)});
  f.rows.source_ingestion_windows.push({...first,id:'page-recovery',kind:'page-recovery',ordinal:1,plan_json:JSON.stringify({index:1,ownedPages:[2],contextPages:[],estimatedOutputTokens:5000}),state:'candidate',result_json:JSON.stringify(recovered)});
  f.rows.source_ingestion_attempts.push({...f.rows.source_ingestion_attempts[0],window_id:'page-recovery',kind:'page-recovery'});
  f.store.run('UPDATE source_files SET text=?,pages=2,page_start_lines=? WHERE id=?',baseline.text,JSON.stringify(baseline.pageStartLines),f.file.id);
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const archive=await new VaultBackups(f.store).export('default'),restored=await new VaultBackups(f.store).import(archive.bytes,'Retained missing-page result'),file=f.store.get('SELECT * FROM source_files WHERE vault_id=?',restored.id);
  let calls=0;const forbidden=async()=>{calls++;throw new Error('Paid missing-page candidate cannot repeat provider or PDF work');};service=new SourceIngestion(f.store,{prepare:forbidden,split:forbidden,extract:forbidden,repair:forbidden});
  assert.equal(service.view(restored.id,file.id).completedPages,2);assert.equal(service.view(restored.id,file.id).canRetryOptional,true);service.retry(restored.id,file.id);await service.tick();assert.equal(service.view(restored.id,file.id).state,'completed',service.view(restored.id,file.id).error);assert.equal(calls,0);
  const revision=JSON.parse(f.store.get('SELECT payload FROM source_reprocessing WHERE file_id=?',file.id).payload);assert.equal(revision.origin.pageRecovery.page,2);assert.equal(revision.patches[0].decision,'pending');assert.equal(revision.patches[0].autoAcceptance,undefined);assert.equal(f.files.require(restored.id,file.id).text,baseline.text);assert.deepEqual(JSON.parse(f.store.get('SELECT document_json FROM source_ingestion_documents WHERE file_id=?',file.id).document_json),merged);
 }finally{service?.close();f.cleanup();}
});
test('valid canonical source below16MiB restores rich assembly larger than32million serialized characters',()=>{
 const f=fixture();try{
  const document=structuredClone(f.doc);document.blocks=[{...document.blocks[0],id:'large-paragraph',kind:'paragraph',text:'x'.repeat(8_100_000),table:null}];document.relations=[];
  const assembly=assembleSourceIngestionDocument(document,{extractionId:'retained_large_version'}),serialized=JSON.stringify(assembly);assert.ok(serialized.length>32_000_000);assert.ok(Buffer.byteLength(assembly.text)<16*1024*1024);
  Object.assign(f.rows.source_ingestion_documents[0],{document_json:JSON.stringify(document),assembly_json:serialized,content_hash:assembly.contentHash});f.rows.source_ingestion_windows[0].result_json=JSON.stringify(document);
  f.store.run('UPDATE source_files SET text=?,page_start_lines=? WHERE id=?',assembly.text,JSON.stringify(assembly.pageStartLines),f.file.id);
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const restored=f.store.get('SELECT content_hash,length(assembly_json) serialized_size FROM source_ingestion_documents WHERE file_id=?',f.file.id);assert.equal(restored.content_hash,assembly.contentHash);assert.equal(restored.serialized_size,serialized.length);assert.equal(f.files.require('default',f.file.id).text,assembly.text);
 }finally{f.cleanup();}
});

test('backup preserves each attempt exact transmitted hash independently from latest window and legacy nulls',async()=>{
 const f=fixture();try{
  const first=sha('first exact PDF window bytes'),later=sha('later exact PDF repair bytes');
  Object.assign(f.rows.source_ingestion_attempts[0],{kind:'extraction',transmitted_hash:first});
  f.rows.source_ingestion_attempts.push({...f.rows.source_ingestion_attempts[0],kind:'repair',transmitted_hash:later,created_at:'2026-10-26T10:00:01.000Z',updated_at:'2026-10-26T10:00:01.000Z'},{...f.rows.source_ingestion_attempts[0],state:'prepared',transmitted_hash:null,created_at:'2026-10-26T10:00:02.000Z',updated_at:'2026-10-26T10:00:02.000Z'});
  f.store.transaction(()=>restoreIngestionBackup(f.store,'default',new Map([['old-file',f.file.id]]),f.rows));
  const archive=await new VaultBackups(f.store).export('default'),restored=await new VaultBackups(f.store).import(archive.bytes,'Restored exact transmission hashes');
  const attempts=f.store.all('SELECT a.kind,a.transmitted_hash,a.state,a.request_id FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.vault_id=? ORDER BY a.created_at',restored.id).map(row=>({...row}));
  assert.deepEqual(attempts,[{kind:'extraction',transmitted_hash:first,state:'completed',request_id:null},{kind:'repair',transmitted_hash:later,state:'completed',request_id:null},{kind:'extraction',transmitted_hash:null,state:'not-submitted',request_id:null}]);
  assert.notEqual(first,f.rows.source_ingestion_windows[0].transmitted_hash);assert.notEqual(later,f.rows.source_ingestion_windows[0].transmitted_hash);
 }finally{f.cleanup();}
});
