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
function fixture({withRepairs=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'noema-ingestion-restore-')),db=openDatabase(path.join(dir,'db.sqlite')),store=new Store(db),files=new SourceFiles(store);
 const original=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
 const file=files.add('default','synthetic.pdf',original);
 new Knowledge(store).create('default',{name:'Manual source title',type:'source',attachmentIds:[file.id]});
 const doc={schemaVersion:1,metadata:{title:'Proposed title',language:'en',synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'ix',role:'owned',state:'content',unresolved:[]}],blocks:[{id:'table',page:1,order:0,kind:'table',text:'A 😀 table\ncell',headingLevel:null,continues:null,table:{rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'A 😀 table\ncell'}]},uncertainty:null,location:null},{id:'note',page:1,order:1,kind:'footnote',text:'Exact footnote.',headingLevel:null,continues:null,table:null,uncertainty:null,location:null}],relations:[{kind:'footnote-callout',from:'table',to:'note',uncertain:true}],repairs:[]};
 if(withRepairs){doc.blocks[1].text='Exact ﬁrst footnote.';doc.repairs=[{blockId:'note',start:6,end:10,original:'ﬁrst',replacement:'first',category:'ocr',reason:'Synthetic mechanical equivalent.'},{blockId:'table',start:5,end:10,original:'table',replacement:'tables',category:'ocr',reason:'Synthetic uncertain reading.'}];}
 const assembly=assembleSourceIngestionDocument(doc,{extractionId:'retained_version'}),config={route:'openai',model:'gpt-6.1-sol',depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:true,budget:{maxRequests:8,maxOutputTokens:24000,maxCostUsd:10}},fingerprint=sha(JSON.stringify(config));
 const provenance={provider:'openai',requestedModel:'gpt-6.1-sol',returnedModel:'gpt-6.1-sol',schemaVersion:1,promptVersion:'pdf-transcription-1',originalHash:sha(original),admittedHash:sha(original),transmittedHash:sha('transmitted'),responseHash:sha('response'),coverage:'checked',independentEvidence:'not-checked',userReviewed:false};
 const ledger=Object.fromEntries(['transcription','structure','metadata','math','apparatus','synopsis','authors'].map(key=>[key,{state:key==='math'?'not-requested':'completed',fingerprint}]));
 store.run("UPDATE source_files SET text=?,status='ready',enrichment_status='completed',pages=1,page_start_lines=?,structural_nodes=? WHERE id=?",assembly.text,JSON.stringify(assembly.pageStartLines),JSON.stringify(assembly.structuralNodes),file.id);
 const rows={source_ingestion_documents:[{id:'document',file_id:'old-file',schema_version:1,assembly_version:assembly.assemblyVersion,content_hash:assembly.contentHash,document_json:JSON.stringify(doc),assembly_json:JSON.stringify(assembly),provenance_json:JSON.stringify(provenance),capabilities_json:JSON.stringify(ledger),created_at:stamp}],source_ingestion_runs:[{id:'run',file_id:'old-file',config_json:JSON.stringify(config),fingerprint,page_count:1,published_document_id:'document',original_hash:provenance.originalHash,admitted_hash:provenance.admittedHash,created_at:stamp,updated_at:stamp}],source_ingestion_windows:[{id:'window',run_id:'run',ordinal:0,plan_json:JSON.stringify({index:0,ownedPages:[1],contextPages:[],estimatedOutputTokens:5000}),state:'completed',result_json:JSON.stringify(doc),transmitted_hash:provenance.transmittedHash}],source_ingestion_attempts:[{window_id:'window',state:'completed',usage_json:JSON.stringify({inputTokens:100,outputTokens:50}),response_hash:provenance.responseHash,error:null,created_at:stamp,updated_at:stamp}]};
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
 for(const mutate of [rows=>{const c=JSON.parse(rows.source_ingestion_runs[0].config_json);c.apiKey='must-not-restore';rows.source_ingestion_runs[0].config_json=JSON.stringify(c);},rows=>{const p=JSON.parse(rows.source_ingestion_documents[0].provenance_json);p.independentEvidence='checked';rows.source_ingestion_documents[0].provenance_json=JSON.stringify(p);},rows=>{const a=JSON.parse(rows.source_ingestion_documents[0].assembly_json);a.blockRanges[0].range.endOffset++;rows.source_ingestion_documents[0].assembly_json=JSON.stringify(a);},rows=>{rows.source_ingestion_windows[0].result_json='{}';},rows=>{rows.source_ingestion_documents=[];rows.source_ingestion_runs[0].published_document_id=null;rows.source_ingestion_windows[0].repair_state='candidate';rows.source_ingestion_attempts[0].kind='repair';}]){
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
