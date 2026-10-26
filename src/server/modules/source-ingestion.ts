import {applySourceIngestionEnrichment,SOURCE_INGESTION_ENRICHMENT_PROMPT_VERSION} from './source-ingestion-enrichment.js';
import {resolveSourceIngestionAssembly} from './source-ingestion-document.js';
import {sourceIngestionBoundaryRelationRequests,reconcileSourceIngestionRelations,type SourceIngestionBoundaryRequest} from './source-ingestion-relations.js';
import {validateSourceIngestionTargetedRepairs} from './source-ingestion-targeted-repair.js';
import {maxSourceTextBytes} from '../../shared/source-input.js';
import {documentModel,documentPrice,documentRegistryVersion} from '../../shared/document-models.js';
import {parseSourceIngestionOptions} from './source-ingestion-options.js';
import {createHash,randomUUID} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import type {SourceIngestionOptions,SourceIngestionDocument,SourceIngestionWindowPlan,SourceProcessingRunView,SourceIngestionCompletionLedger} from '../../shared/source-ingestion.js';
import {SOURCE_INGESTION_PROMPT_VERSION} from '../../shared/source-ingestion.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {normalizeSourceIngestionCandidate,sourceIngestionRepairFindings,validateSourceIngestionDocument} from './source-ingestion-validation.js';
import {assembleSourceIngestionDocument,mergeSourceIngestionWindows} from './source-ingestion-assembly.js';
import {planSourceIngestionWindows} from './source-ingestion-planner.js';
import {preflightSourceIngestionPageRecovery,createSourceIngestionPageRecoveryDerivative,preflightSourceIngestionRepairCapacity,createSourceIngestionRepairDerivative,reconcileSourceIngestion} from './source-ingestion-corrections.js';
import {recordSourceAuthorsProcessed} from './source-author-backfill.js';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
type Run={id:string;file_id:string;vault_id:string;config_json:string;context_json:string|null;fingerprint:string;state:SourceProcessingRunView['state'];stage:SourceProcessingRunView['stage'];page_count:number;published_document_id:string|null;original_hash:string;admitted_hash:string;error:string|null;created_at:string;updated_at:string};
type Window={id:string;run_id:string;ordinal:number;kind:'extraction'|'relations'|'page-recovery'|'enrichment';plan_json:string;state:string;repair_state:string;error?:string|null;result_json:string|null;transmitted_hash:string|null};
export interface IngestionDependencies {
 prepare(file:SourceFile,signal:AbortSignal):Promise<{bytes:Uint8Array;originalHash:string;admittedHash:string;pageCount:number;context?:unknown;warnings?:string[]}>;
 split(bytes:Uint8Array,pages:number[]):Promise<{bytes:Uint8Array;pageMap:number[]}>;
 extract(input:{vaultId:string;fileId:string;options:SourceIngestionOptions;pdf:Uint8Array;pageMap:number[];plan:SourceIngestionWindowPlan;context?:unknown;signal:AbortSignal;onSubmitted:(id?:string)=>void}):Promise<{status:string;candidate?:unknown;requestId?:string;usage:unknown;responseHash:string;returnedModel?:string|null}>;
 relate?:(input:Parameters<IngestionDependencies['extract']>[0]&{document:SourceIngestionDocument;request:SourceIngestionBoundaryRequest})=>ReturnType<IngestionDependencies['extract']>;
 enrich?:(input:Parameters<IngestionDependencies['extract']>[0]&{document:SourceIngestionDocument})=>ReturnType<IngestionDependencies['extract']>;
 repair?:(input:Parameters<IngestionDependencies['extract']>[0]&{document:SourceIngestionDocument})=>ReturnType<IngestionDependencies['extract']>;
 reconcile?:(file:SourceFile,document:SourceIngestionDocument,assembly:ReturnType<typeof assembleSourceIngestionDocument>,options:SourceIngestionOptions)=>void;
}
/** Durable paid-work boundary: submitted attempts never become retryable merely because a process died. */
export class SourceIngestion {
 private busy=false;private closed=false;private active=new Map<string,AbortController>();
 constructor(private store:Store,private dependencies:IngestionDependencies){}
 stage(vault:string,fileId:string,options:SourceIngestionOptions) {
  options=parseSourceIngestionOptions(options);
  const file=this.file(vault,fileId);if(file.format!=='pdf')throw new HttpError(400,'PDF processing options apply only to PDF uploads.');
  if(file.status==='processing'||file.enrichment_status==='running'||this.store.get("SELECT 1 FROM source_reprocessing WHERE file_id=? AND status IN ('queued','running')",fileId)||this.store.get("SELECT 1 FROM source_author_jobs WHERE file_id=? AND status='running'",fileId))throw new HttpError(409,'Another source-processing workflow owns this source. Wait for it to finish before selecting PDF ingestion.');
  if(options.route!=='local'&&!options.transmissionConsent)throw new HttpError(400,'Authorize sending this PDF to the selected provider.');
  const config=JSON.stringify(options),fingerprint=hash(JSON.stringify([config,documentRegistryVersion,SOURCE_INGESTION_PROMPT_VERSION])),key=hash(fileId+':'+fingerprint);
  const existing=this.store.get<Run>('SELECT * FROM source_ingestion_runs WHERE vault_id=? AND idempotency_key=?',vault,key);if(existing)return this.view(vault,fileId);
  const previous=this.store.get<Run>('SELECT * FROM source_ingestion_runs WHERE file_id=?',fileId);
  if(file.status==='ready'||file.text.length>0||this.store.get('SELECT 1 FROM source_ingestion_documents WHERE file_id=?',fileId))throw new HttpError(409,'A published extraction is immutable; create a reading revision instead.');
  if(previous){
   const paid=this.store.get("SELECT 1 FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? AND a.state NOT IN ('prepared','not-submitted')",previous.id);
   if(file.entity_id||paid||previous.state==='running')throw new HttpError(409,'This staged attachment already has frozen processing options.');
   this.store.transaction(()=>{this.store.run('DELETE FROM source_ingestion_runs WHERE id=?',previous.id);this.store.run("UPDATE source_files SET ingestion_origin='local',active_ingestion_run=NULL WHERE id=?",fileId);});
  }
  if(options.route==='local'){
   this.store.run('UPDATE source_files SET staging_config_json=?,contains_math=? WHERE id=?',config,options.containsMath?1:0,fileId);return null;
  }
  const runId=randomUUID();
  this.store.transaction(()=>{
   this.store.run('INSERT INTO source_ingestion_runs(id,file_id,vault_id,idempotency_key,config_json,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',runId,fileId,vault,key,config,fingerprint,now(),now());
   this.store.run('UPDATE source_files SET ingestion_origin=?,active_ingestion_run=?,staging_config_json=?,contains_math=? WHERE id=?',options.route,runId,config,options.containsMath?1:0,fileId);
  });
  return this.view(vault,fileId);
 }
 private file(vault:string,id:string) {const file=this.store.get<SourceFile>('SELECT * FROM source_files WHERE id=? AND vault_id=?',id,vault);if(!file)throw new HttpError(404,'Source file not found');return file;}
 private run(vault:string,fileId:string) {if(!this.store.get('SELECT 1 FROM source_files WHERE id=? AND vault_id=?',fileId,vault))throw new HttpError(404,'Source file not found');return this.store.get<Run>('SELECT * FROM source_ingestion_runs WHERE vault_id=? AND file_id=? ORDER BY created_at DESC LIMIT 1',vault,fileId);}
 view(vault:string,fileId:string):SourceProcessingRunView|null {
  const run=this.run(vault,fileId);if(!run)return null;
  const windows=this.store.all<Pick<Window,'id'|'state'|'plan_json'|'repair_state'|'error'|'kind'>&{repair_count:number;attempts:number}>("SELECT w.id,w.kind,w.state,w.repair_state,w.error,w.plan_json,w.pending_review repair_count,(SELECT count(*) FROM source_ingestion_attempts a WHERE a.window_id=w.id) attempts FROM source_ingestion_windows w WHERE w.run_id=? AND w.state!='superseded' ORDER BY w.ordinal",run.id),config=JSON.parse(run.config_json) as SourceIngestionOptions;
  const completed=windows.filter(w=>w.kind==='extraction'&&w.state==='completed'),active=windows.find(w=>w.state==='running'||w.repair_state==='running');
  const pending=this.store.get<{n:number}>("SELECT COALESCE(sum(json_extract(summary_json,'$.pendingCount')),0) n FROM source_reprocessing WHERE file_id=? AND json_extract(summary_json,'$.origin.kind')='ingestion'",fileId)!.n;
  const source=this.store.get<{summary:string|null;entity_id:string|null}>('SELECT summary,entity_id FROM source_files WHERE id=?',fileId);
  const hasSummary=!!source?.summary;
  const pendingMetadata=this.store.get<{n:number}>("SELECT count(*) n FROM source_metadata_candidates c JOIN property_proposals p ON p.id=c.proposal_id JOIN source_files f ON f.entity_id=p.entity_id AND f.vault_id=p.vault_id WHERE f.id=? AND c.status='pending'",fileId)!.n;
  return {sourceId:source?.entity_id??null,pendingMetadata,enrichedWindows:windows.some(w=>w.kind==='enrichment')?windows.filter(w=>w.kind==='enrichment'&&w.state==='completed').length:hasSummary?completed.length:0,totalEnrichmentWindows:this.dependencies.enrich?windows.filter(w=>w.kind==='extraction').length:0,canEnrich:!!this.dependencies.enrich&&!!run.published_document_id&&!hasSummary&&!windows.some(w=>w.kind==='enrichment'),depth:config.depth,reviewPolicy:config.reviewPolicy,windows:windows.map((w,index)=>({id:w.id,number:index+1,kind:w.kind,pages:(JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages,state:w.state,repairState:w.repair_state,attempts:w.attempts,error:w.error??null})),id:run.id,fileId,mode:'ingestion',state:run.state,stage:run.stage,provider:config.route,model:config.model,pageCount:run.page_count,completedPages:completed.reduce((n,w)=>n+(JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages.length,0),completedWindows:completed.length,totalWindows:windows.filter(w=>w.kind==='extraction').length,activePages:active?(JSON.parse(active.plan_json) as SourceIngestionWindowPlan).ownedPages:[],pendingReview:run.published_document_id?pending:completed.reduce((n,w)=>n+w.repair_count,0),startedAt:run.created_at,updatedAt:run.updated_at,error:run.error,warnings:windows.filter(w=>w.error).map(w=>w.error!.slice(0,500)).slice(0,10),canRetryOptional:run.state==='completed'&&windows.some(w=>w.repair_state==='failed'||w.repair_state==='candidate'||['page-recovery','enrichment'].includes(w.kind)&&(w.state==='failed'||w.state==='candidate')),unknownOutcome:run.state==='unknown'||windows.some(w=>w.state==='unknown'||w.repair_state==='unknown'),canResume:['paused','failed','unknown'].includes(run.state)||windows.some(w=>w.state==='unknown'||w.repair_state==='unknown')};
 }
 recover() {
  this.store.run("UPDATE source_ingestion_attempts SET state='unknown',updated_at=? WHERE state='submitted'",now());
  this.store.run("UPDATE source_ingestion_windows SET state=CASE WHEN EXISTS(SELECT 1 FROM source_ingestion_attempts a WHERE a.window_id=source_ingestion_windows.id AND a.state='unknown' AND a.kind!='repair') THEN 'unknown' ELSE 'pending' END WHERE state='running'");
  this.store.run("UPDATE source_ingestion_windows SET repair_state=CASE WHEN EXISTS(SELECT 1 FROM source_ingestion_attempts a WHERE a.window_id=source_ingestion_windows.id AND a.state='unknown' AND a.kind='repair') THEN 'unknown' ELSE 'pending' END WHERE repair_state='running'");
  this.store.run("UPDATE source_ingestion_runs SET state=CASE WHEN EXISTS(SELECT 1 FROM source_ingestion_windows w WHERE w.run_id=source_ingestion_runs.id AND (w.state='unknown' OR w.repair_state='unknown')) THEN 'unknown' ELSE 'paused' END,updated_at=? WHERE state='running'",now());
 }
 stop(vault:string,fileId:string) {const run=this.run(vault,fileId);if(!run)throw new HttpError(404,'Ingestion not found');this.store.run("UPDATE source_ingestion_runs SET state='paused',updated_at=? WHERE id=? AND state IN ('pending','running')",now(),run.id);this.active.get(run.id)?.abort();return this.view(vault,fileId);}
 resume(vault:string,fileId:string,allowUnknown=false) {
  const run=this.run(vault,fileId);if(!run)throw new HttpError(404,'Ingestion not found');
  const unknown=run.state==='unknown'||!!this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (state='unknown' OR repair_state='unknown')",run.id);
  if(unknown&&!allowUnknown)throw new HttpError(409,'The provider may have charged for this request. Explicit duplicate-cost recovery is required.');
  if(run.state==='completed'&&!unknown)return this.view(vault,fileId);
  if(run.state==='running'||run.state==='pending')return this.view(vault,fileId);
  if(allowUnknown){this.store.run("UPDATE source_ingestion_windows SET state='pending' WHERE run_id=? AND state='unknown'",run.id);this.store.run("UPDATE source_ingestion_windows SET repair_state='pending' WHERE run_id=? AND repair_state='unknown'",run.id);}
  this.store.run("UPDATE source_ingestion_windows SET state='pending' WHERE run_id=? AND state='failed'",run.id);
  this.store.run("UPDATE source_ingestion_runs SET state='pending',error=NULL,updated_at=? WHERE id=?",now(),run.id);return this.view(vault,fileId);
 }
 retry(vault:string,fileId:string){
  const run=this.run(vault,fileId);if(!run)throw new HttpError(404,'Ingestion not found');
  if(!run.published_document_id||run.state!=='completed')return this.resume(vault,fileId);
  if(this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (state='unknown' OR repair_state='unknown')",run.id))return this.resume(vault,fileId);
  const unfinished=this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (repair_state='failed' OR repair_state='candidate' OR (kind IN ('page-recovery','enrichment') AND state IN ('failed','candidate')))",run.id);
  if(!unfinished)return this.view(vault,fileId);
  preflightSourceIngestionRepairCapacity(this.store,this.file(vault,fileId));
  this.store.transaction(()=>{
   this.store.run("UPDATE source_ingestion_windows SET repair_state='pending',error=NULL WHERE run_id=? AND kind='extraction' AND repair_state='failed'",run.id);
   this.store.run("UPDATE source_ingestion_windows SET state='pending',error=NULL WHERE run_id=? AND kind='page-recovery' AND state='failed'",run.id);
   this.store.run("UPDATE source_ingestion_windows SET state='pending',error=NULL WHERE run_id=? AND kind='enrichment' AND state='failed'",run.id);
   this.store.run("UPDATE source_ingestion_runs SET state='pending',stage='repair',error=NULL,updated_at=? WHERE id=? AND state='completed'",now(),run.id);
  });return this.view(vault,fileId);
 }
 enrich(vault:string,fileId:string){
  const run=this.run(vault,fileId);if(!run||!run.published_document_id||!this.dependencies.enrich)throw new HttpError(409,'Publish a provider transcription before enriching its structure and metadata.');
  if(run.state==='running'||run.state==='pending')return this.view(vault,fileId);
  if(run.state==='unknown')throw new HttpError(409,'Resolve the unknown paid outcome before enrichment.');
  const extraction=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state='completed' ORDER BY ordinal",run.id);
  for(const window of extraction)this.enrichmentUnit(run,window);
  this.store.run("UPDATE source_ingestion_windows SET state='pending',error=NULL WHERE run_id=? AND kind='enrichment' AND state='failed'",run.id);
  this.store.run("UPDATE source_ingestion_runs SET state='pending',stage='enrichment',error=NULL,updated_at=? WHERE id=?",now(),run.id);
  this.store.run("UPDATE source_files SET enrichment_status='pending',enrichment_error=NULL WHERE id=?",fileId);return this.view(vault,fileId);
 }
 private enrichmentUnit(run:Run,extraction:Window):Window{
  const scope=JSON.parse(extraction.plan_json) as SourceIngestionWindowPlan;
  const existing=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment' ORDER BY ordinal",run.id).find(unit=>JSON.stringify((JSON.parse(unit.plan_json) as SourceIngestionWindowPlan).ownedPages)===JSON.stringify(scope.ownedPages));if(existing)return existing;
  const ordinal=this.store.get<{n:number}>('SELECT COALESCE(max(ordinal),0)+1 n FROM source_ingestion_windows WHERE run_id=?',run.id)!.n;
  const unit:Window={id:randomUUID(),run_id:run.id,ordinal,kind:'enrichment',plan_json:JSON.stringify({...scope,index:ordinal}),state:'pending',repair_state:'skipped',result_json:null,transmitted_hash:null};
  this.store.run("INSERT INTO source_ingestion_windows(id,run_id,ordinal,kind,plan_json,repair_state) VALUES(?,?,?,'enrichment',?,'skipped')",unit.id,run.id,ordinal,unit.plan_json);return unit;
 }
 recoverPage(vault:string,fileId:string,page:number) {
  const run=this.run(vault,fileId);if(!run?.published_document_id)throw new HttpError(409,'Publish the original PDF extraction before recovering a page.');
  const file=this.file(vault,fileId);
  if(this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (state='unknown' OR repair_state='unknown')",run.id))throw new HttpError(409,'Resolve the unknown paid provider outcome before starting page recovery.');
  const existing=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='page-recovery' ORDER BY ordinal",run.id).find(w=>(JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages[0]===page);
  if(existing){
   if(existing.state==='unknown')throw new HttpError(409,'This page request may have been charged. Use explicit unknown-outcome recovery before retrying.');
   if(existing.state==='completed'||run.state==='pending'||run.state==='running')return this.view(vault,fileId);
   preflightSourceIngestionPageRecovery(this.store,file,page);
   this.store.transaction(()=>{this.store.run("UPDATE source_ingestion_windows SET state=CASE WHEN state='candidate' THEN 'candidate' ELSE 'pending' END,error=NULL WHERE id=?",existing.id);this.store.run("UPDATE source_ingestion_runs SET state='pending',stage='repair',error=NULL,updated_at=? WHERE id=?",now(),run.id);});return this.view(vault,fileId);
  }
  if(run.state!=='completed')throw new HttpError(409,'Finish or stop the active source processing request before recovering another page.');
  preflightSourceIngestionPageRecovery(this.store,file,page);
  const next=this.store.get<{n:number}>('SELECT COALESCE(max(ordinal),0)+1 n FROM source_ingestion_windows WHERE run_id=?',run.id)!.n;
  const options=parseSourceIngestionOptions(JSON.parse(run.config_json));
  const plan:SourceIngestionWindowPlan={index:next,ownedPages:[page],contextPages:[],estimatedOutputTokens:Math.min(options.budget.maxOutputTokens,12000)};
  this.store.transaction(()=>{this.store.run("INSERT INTO source_ingestion_windows(id,run_id,ordinal,kind,plan_json,repair_state) VALUES(?,?,?,'page-recovery',?,'skipped')",randomUUID(),run.id,next,JSON.stringify(plan));this.store.run("UPDATE source_ingestion_runs SET state='pending',stage='repair',error=NULL,updated_at=? WHERE id=?",now(),run.id);});return this.view(vault,fileId);
 }
 async tick() {
  if(this.busy||this.closed)return;
  const run=this.store.get<Run>(`SELECT r.* FROM source_ingestion_runs r JOIN source_files f ON f.id=r.file_id JOIN vaults v ON v.id=r.vault_id JOIN entities e ON e.id=f.entity_id WHERE r.state='pending' AND v.locked=0 AND e.archived_at IS NULL ORDER BY r.created_at LIMIT 1`);if(!run)return;
  const claimed=this.store.run("UPDATE source_ingestion_runs SET state='running',updated_at=? WHERE id=? AND state='pending'",now(),run.id).changes;
  if(claimed!==1)return;
  this.busy=true;const controller=new AbortController();this.active.set(run.id,controller);
  let options:SourceIngestionOptions;
  try{options=parseSourceIngestionOptions(JSON.parse(run.config_json));}catch(error){this.store.run("UPDATE source_ingestion_runs SET state='failed',error=?,updated_at=? WHERE id=?",error instanceof Error?error.message:'Invalid frozen PDF processing options.',now(),run.id);this.active.delete(run.id);this.busy=false;return;}
  const assertActive=()=>{if(controller.signal.aborted||this.closed||!this.store.get("SELECT 1 FROM source_ingestion_runs r JOIN vaults v ON v.id=r.vault_id WHERE r.id=? AND r.state='running' AND v.locked=0",run.id))throw new HttpError(499,'PDF ingestion paused.');};
  try {
   if(run.published_document_id){
    const candidates=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND repair_state='candidate' ORDER BY ordinal",run.id);
    for(const candidate of candidates){assertActive();this.publishRepairDerivative(run,candidate,options);}
    const pageCandidates=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='page-recovery' AND state='candidate' ORDER BY ordinal",run.id);
    for(const candidate of pageCandidates){assertActive();this.publishPageRecovery(run,candidate,options);}
    const unfinished=this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND ((kind='extraction' AND repair_state IN ('pending','running','unknown') AND state!='superseded') OR (kind IN ('page-recovery','enrichment') AND state IN ('pending','running','unknown','candidate')))",run.id);
    if(!unfinished){assertActive();this.store.run("UPDATE source_ingestion_runs SET state='completed',stage='publication',error=NULL,updated_at=? WHERE id=?",now(),run.id);return;}
    if(this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND ((kind='extraction' AND repair_state IN ('pending','running','unknown','candidate')) OR kind='page-recovery' AND state!='completed')",run.id))preflightSourceIngestionRepairCapacity(this.store,this.file(run.vault_id,run.file_id));
   }
   const prepared=await this.dependencies.prepare(this.file(run.vault_id,run.file_id),controller.signal);assertActive();
   if(prepared.pageCount>1000)throw new HttpError(413,'PDF ingestion currently supports at most 1,000 physical pages per source. Split this PDF before importing.');
   const context=run.context_json?JSON.parse(run.context_json):prepared.context??null;
   const contextJSON=JSON.stringify(context);
   if(contextJSON.length>100_000)throw new Error('PDF context manifest exceeds its bounded budget.');
   run.fingerprint=hash(JSON.stringify([run.config_json,documentRegistryVersion,SOURCE_INGESTION_PROMPT_VERSION,prepared.originalHash,prepared.admittedHash,contextJSON]));
   this.store.run('UPDATE source_ingestion_runs SET context_json=?,fingerprint=? WHERE id=?',contextJSON,run.fingerprint,run.id);
   if(run.admitted_hash&&run.admitted_hash!==prepared.admittedHash)throw new Error('Admitted PDF changed; ingestion input is immutable.');
   this.store.run("UPDATE source_ingestion_runs SET page_count=?,original_hash=?,admitted_hash=?,stage='extraction',updated_at=? WHERE id=?",prepared.pageCount,prepared.originalHash,prepared.admittedHash,now(),run.id);
   if(run.published_document_id){
    const recoveries=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='page-recovery' AND state='pending' ORDER BY ordinal",run.id);
    for(const recovery of recoveries){
     assertActive();const page=(JSON.parse(recovery.plan_json) as SourceIngestionWindowPlan).ownedPages[0]!;
     preflightSourceIngestionPageRecovery(this.store,this.file(run.vault_id,run.file_id),page);
     const result=await this.executeUnit(run,recovery,options,prepared,controller.signal,input=>this.dependencies.extract(input),candidate=>validateSourceIngestionDocument(normalizeSourceIngestionCandidate(candidate),{ownedPages:[page],pageCount:prepared.pageCount}));
     assertActive();this.publishPageRecovery(run,{...recovery,state:'candidate',result_json:JSON.stringify(result)},options);
    }
   }
   let windows=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state!='superseded' ORDER BY ordinal",run.id);
   if(!windows.length){const plans=planSourceIngestionWindows({pageCount:prepared.pageCount,depth:options.depth,maxOutputTokens:options.budget.maxOutputTokens});this.store.transaction(()=>{for(const plan of plans)this.store.run('INSERT INTO source_ingestion_windows(id,run_id,ordinal,plan_json) VALUES(?,?,?,?)',randomUUID(),run.id,plan.index,JSON.stringify(plan));});windows=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state!='superseded' ORDER BY ordinal",run.id);}
   for(let windowIndex=0;windowIndex<windows.length;windowIndex++) {
    const window=windows[windowIndex]!;
    assertActive();if(window.state==='completed')continue;
    if(run.published_document_id)throw new Error('A published source cannot repeat initial extraction.');if(window.state==='unknown')throw new Error('Unknown provider outcome requires explicit recovery.');
    const retained=this.store.get<{id:string;candidate_json:string}>("SELECT id,candidate_json FROM source_ingestion_attempts WHERE window_id=? AND kind='extraction' AND state IN ('completed','invalid') AND candidate_json IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1",window.id);
    if(retained){
     // A completed paid response is untrusted until normalized and validated.
     // Retry it locally before considering any new paid extraction request.
     try{
      const plan=JSON.parse(window.plan_json) as SourceIngestionWindowPlan;
      const document=validateSourceIngestionDocument(normalizeSourceIngestionCandidate(JSON.parse(retained.candidate_json)),{ownedPages:plan.ownedPages,pageCount:prepared.pageCount});
      assertActive();this.store.transaction(()=>{this.store.run("UPDATE source_ingestion_attempts SET state='completed',error=NULL,updated_at=? WHERE id=?",now(),retained.id);this.store.run("UPDATE source_ingestion_windows SET state='completed',result_json=?,pending_review=?,error=NULL WHERE id=?",JSON.stringify(document),document.repairs.length,window.id);});
     }catch(error){const message=error instanceof Error?error.message:'Retained provider response could not be validated.';this.store.run("UPDATE source_ingestion_attempts SET state='invalid',error=?,updated_at=? WHERE id=?",message,now(),retained.id);this.store.run("UPDATE source_ingestion_windows SET state='failed',error=? WHERE id=?",message,window.id);throw error;}
     continue;
    }
    const attempts=this.store.get<{n:number}>('SELECT count(*) n FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=?',run.id)!.n;
    if(attempts>=options.budget.maxRequests)throw new Error('Document request budget exhausted.');
    const plan=JSON.parse(window.plan_json) as SourceIngestionWindowPlan,pages=[...plan.contextPages,...plan.ownedPages],pdf=await this.dependencies.split(prepared.bytes,pages);assertActive();
    this.checkBudget(run,options,pdf);
    const attempt=randomUUID(),transmittedHash=hash(pdf.bytes);this.store.run("INSERT INTO source_ingestion_attempts(id,window_id,state,transmitted_hash,prompt_version,created_at,updated_at) VALUES(?,?,'prepared',?,?,?,?)",attempt,window.id,transmittedHash,SOURCE_INGESTION_PROMPT_VERSION,now(),now());
    this.store.run("UPDATE source_ingestion_windows SET state='running',transmitted_hash=? WHERE id=?",transmittedHash,window.id);
    try {
     const response=await this.dependencies.extract({vaultId:run.vault_id,fileId:run.file_id,options,pdf:pdf.bytes,pageMap:pdf.pageMap,plan,context,signal:controller.signal,onSubmitted:id=>{this.store.run("UPDATE source_ingestion_attempts SET state='submitted',request_id=?,updated_at=? WHERE id=?",id??null,now(),attempt);}});
     this.store.run("UPDATE source_ingestion_attempts SET state=?,request_id=?,usage_json=?,response_hash=?,returned_model=?,candidate_json=?,updated_at=? WHERE id=?",response.status==='completed'?'completed':'invalid',response.requestId??null,JSON.stringify(response.usage),response.responseHash,response.returnedModel??null,response.status==='completed'&&response.candidate&&typeof response.candidate==='object'&&!Array.isArray(response.candidate)?JSON.stringify(response.candidate):null,now(),attempt);
     if(response.status==='incomplete'&&plan.ownedPages.length>1&&attempts+2<options.budget.maxRequests){
      const midpoint=Math.ceil(plan.ownedPages.length/2),next=this.store.get<{ordinal:number}>('SELECT COALESCE(max(ordinal),0)+1 ordinal FROM source_ingestion_windows WHERE run_id=?',run.id)!.ordinal;
      const replacements=[plan.ownedPages.slice(0,midpoint),plan.ownedPages.slice(midpoint)].map((ownedPages,index)=>({id:randomUUID(),run_id:run.id,ordinal:next+index,plan_json:JSON.stringify({...plan,index:next+index,ownedPages,contextPages:index===0?plan.contextPages:[plan.ownedPages[midpoint-1]!],estimatedOutputTokens:Math.ceil(plan.estimatedOutputTokens/2)}),state:'pending',repair_state:'pending',kind:'extraction' as const,result_json:null,transmitted_hash:null}));
      this.store.transaction(()=>{this.store.run("UPDATE source_ingestion_windows SET state='superseded',error='Truncated response; retried as smaller page windows.' WHERE id=?",window.id);for(const replacement of replacements)this.store.run('INSERT INTO source_ingestion_windows(id,run_id,ordinal,plan_json) VALUES(?,?,?,?)',replacement.id,run.id,replacement.ordinal,replacement.plan_json);});
      windows.splice(windowIndex,1,...replacements);windowIndex--;continue;
     }
     if(response.status!=='completed')throw new Error('Provider returned '+response.status+' output. The incomplete result was not published.');
     const document=validateSourceIngestionDocument(normalizeSourceIngestionCandidate(response.candidate),{ownedPages:plan.ownedPages,pageCount:prepared.pageCount});
     this.store.run("UPDATE source_ingestion_windows SET state='completed',result_json=?,pending_review=?,error=NULL WHERE id=?",JSON.stringify(document),document.repairs.length,window.id);
    } catch(error) {
     const state=this.store.get<{state:string}>('SELECT state FROM source_ingestion_attempts WHERE id=?',attempt)!.state;
     const knownFailure=error instanceof Error&&'outcomeUncertain' in error&&error.outcomeUncertain===false;
     const unknown=state==='submitted'&&!knownFailure;
     this.store.run('UPDATE source_ingestion_attempts SET state=?,error=?,updated_at=? WHERE id=?',unknown?'unknown':state==='completed'?'invalid':'failed',error instanceof Error?error.message:'Provider request failed',now(),attempt);
     this.store.run('UPDATE source_ingestion_windows SET state=?,error=? WHERE id=?',unknown?'unknown':'failed',error instanceof Error?error.message:'Provider request failed',window.id);
     if(unknown)this.store.run("UPDATE source_ingestion_runs SET state='unknown' WHERE id=?",run.id);throw error;
    }
    this.store.run('UPDATE source_ingestion_runs SET updated_at=? WHERE id=?',now(),run.id);
   }
   // Fresh direct ingestion jointly returns transcription, structure, metadata,
   // synopsis and optional proposals. Never automatically resend its PDF for
   // repair. Only explicit published-source recovery (or retained legacy repair
   // attempts resumed by the user) may execute additional repair requests.
   if(!run.published_document_id)this.store.run("UPDATE source_ingestion_windows SET repair_state='skipped' WHERE run_id=? AND kind='extraction' AND state='completed' AND repair_state='pending' AND NOT EXISTS(SELECT 1 FROM source_ingestion_attempts a WHERE a.window_id=source_ingestion_windows.id AND a.kind='repair')",run.id);
   const repairWindows=this.store.all<Window>("SELECT * FROM source_ingestion_windows w WHERE run_id=? AND kind='extraction' AND state='completed' AND (? IS NOT NULL OR EXISTS(SELECT 1 FROM source_ingestion_attempts a WHERE a.window_id=w.id AND a.kind='repair')) ORDER BY ordinal",run.id,run.published_document_id);
   for(const window of repairWindows){
    assertActive();if(['completed','skipped','failed'].includes(window.repair_state))continue;
    if(run.published_document_id&&window.repair_state==='candidate'){this.publishRepairDerivative(run,window,options);continue;}
    if(window.repair_state==='unknown')throw new Error('Unknown targeted repair outcome requires explicit recovery.');
    const document=JSON.parse(window.result_json!) as SourceIngestionDocument;
    const shouldRepair=options.depth!=='light'&&(sourceIngestionRepairFindings(document).length>0||options.depth==='deep'&&document.blocks.some(b=>b.kind==='equation'||b.kind==='table'));
    if(!this.dependencies.repair||!shouldRepair){this.store.run("UPDATE source_ingestion_windows SET repair_state='skipped' WHERE id=?",window.id);continue;}
    if(run.published_document_id)preflightSourceIngestionRepairCapacity(this.store,this.file(run.vault_id,run.file_id));
    const plan=JSON.parse(window.plan_json) as SourceIngestionWindowPlan;
    const pdf=await this.dependencies.split(prepared.bytes,[...plan.contextPages,...plan.ownedPages]);assertActive();
    try{this.checkBudget(run,options,pdf);}catch(error){this.store.run("UPDATE source_ingestion_windows SET repair_state='skipped',error=? WHERE id=?",error instanceof Error?error.message:'Optional repair budget exhausted',window.id);continue;}
    this.store.run("UPDATE source_ingestion_runs SET stage='repair',updated_at=? WHERE id=?",now(),run.id);
    const attempt=randomUUID();this.store.run("INSERT INTO source_ingestion_attempts(id,window_id,state,kind,transmitted_hash,created_at,updated_at) VALUES(?,?,'prepared','repair',?,?,?)",attempt,window.id,hash(pdf.bytes),now(),now());
    this.store.run("UPDATE source_ingestion_windows SET repair_state='running' WHERE id=?",window.id);
    try{
     const response=await this.dependencies.repair({vaultId:run.vault_id,fileId:run.file_id,options,pdf:pdf.bytes,pageMap:pdf.pageMap,plan,context,document,signal:controller.signal,onSubmitted:id=>{this.store.run("UPDATE source_ingestion_attempts SET state='submitted',request_id=?,updated_at=? WHERE id=?",id??null,now(),attempt);}});
     this.store.run("UPDATE source_ingestion_attempts SET state=?,request_id=?,usage_json=?,response_hash=?,returned_model=?,updated_at=? WHERE id=?",response.status==='completed'?'completed':'invalid',response.requestId??null,JSON.stringify(response.usage),response.responseHash,response.returnedModel??null,now(),attempt);
     if(response.status!=='completed')throw new Error('Optional targeted repair returned '+response.status+' output.');
     const repairs=validateSourceIngestionTargetedRepairs(response.candidate,document,{ownedPages:plan.ownedPages,depth:options.depth});
     const candidate={...document,repairs:[...document.repairs,...repairs]};
     this.store.run('UPDATE source_ingestion_windows SET repair_state=?,result_json=?,pending_review=?,error=NULL WHERE id=?',run.published_document_id?'candidate':'completed',JSON.stringify(candidate),candidate.repairs.length,window.id);
     if(run.published_document_id)this.publishRepairDerivative(run,{...window,result_json:JSON.stringify(candidate),repair_state:'candidate'},options);
    }catch(error){
     const retained=this.store.get<{repair_state:string}>('SELECT repair_state FROM source_ingestion_windows WHERE id=?',window.id);
     if(run.published_document_id&&retained?.repair_state==='candidate')throw error;
     const state=this.store.get<{state:string}>('SELECT state FROM source_ingestion_attempts WHERE id=?',attempt)!.state;
     const knownFailure=error instanceof Error&&'outcomeUncertain' in error&&error.outcomeUncertain===false;
     const unknown=state==='submitted'&&!knownFailure;
     this.store.run('UPDATE source_ingestion_attempts SET state=?,error=?,updated_at=? WHERE id=?',unknown?'unknown':state==='completed'?'invalid':'failed',error instanceof Error?error.message:'Optional repair failed',now(),attempt);
     this.store.run('UPDATE source_ingestion_windows SET repair_state=?,error=? WHERE id=?',unknown?'unknown':'failed',error instanceof Error?error.message:'Optional repair failed',window.id);
     if(unknown){this.store.run("UPDATE source_ingestion_runs SET state='unknown' WHERE id=?",run.id);throw error;}
    }
   }
   if(this.dependencies.enrich&&this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment'",run.id)){
    for(const extraction of this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state='completed' ORDER BY ordinal",run.id)){
     assertActive();const unit=this.enrichmentUnit(run,extraction);if(unit.state==='completed')continue;
     if(unit.state==='unknown')throw new HttpError(409,'The enrichment request has an unknown paid outcome; explicit recovery is required.');
     const document=JSON.parse(extraction.result_json!) as SourceIngestionDocument,plan=JSON.parse(extraction.plan_json) as SourceIngestionWindowPlan;
     this.store.run("UPDATE source_ingestion_runs SET stage='enrichment',updated_at=? WHERE id=?",now(),run.id);
     await this.executeUnit(run,unit,options,prepared,controller.signal,input=>this.dependencies.enrich!({...input,document}),candidate=>applySourceIngestionEnrichment(candidate,document,{ownedPages:plan.ownedPages,contextPages:plan.contextPages,pageMap:[...plan.contextPages,...plan.ownedPages],depth:options.depth}));
    }
   }
   if(run.published_document_id){assertActive();this.publishEnrichment(run,options);this.store.run("UPDATE source_ingestion_runs SET state='completed',stage='publication',error=NULL,updated_at=? WHERE id=?",now(),run.id);return;}
   assertActive();this.store.run("UPDATE source_ingestion_runs SET stage='validation',updated_at=? WHERE id=?",now(),run.id);
   const documents=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state!='superseded' ORDER BY ordinal",run.id).map(w=>{const enriched=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment' AND state='completed'",run.id).find(unit=>JSON.stringify((JSON.parse(unit.plan_json) as SourceIngestionWindowPlan).ownedPages)===JSON.stringify((JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages));return JSON.parse(enriched?.result_json??w.result_json!) as SourceIngestionDocument;});
   let validated=mergeSourceIngestionWindows(documents.map((document,index)=>({index,document})),prepared.pageCount);
   // Only retained relation units from an explicitly resumed legacy workflow
   // are eligible. New imports never create a second structural model pass.
   if(this.dependencies.relate&&this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND kind='relations'",run.id)){
    const boundaries=this.store.all<{plan_json:string}>("SELECT plan_json FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state='completed' ORDER BY ordinal",run.id).map(w=>(JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages[0]!).filter(page=>page>1);
    const requests=sourceIngestionBoundaryRelationRequests(validated,boundaries);
    for(const request of requests){
     assertActive();
     let unit=this.store.all<Window>("SELECT * FROM source_ingestion_windows WHERE run_id=? AND kind='relations' ORDER BY ordinal",run.id).find(w=>JSON.stringify((JSON.parse(w.plan_json) as SourceIngestionWindowPlan).ownedPages)===JSON.stringify(request.pages));
     if(!unit)continue;
     if(unit.state==='unknown')throw new HttpError(409,'The boundary relation request has an unknown paid outcome.');
     if(unit.state==='failed')continue;
     try{const relationOutput=unit.state==='completed'?JSON.parse(unit.result_json!):await this.executeUnit(run,unit,options,prepared,controller.signal,input=>this.dependencies.relate!({...input,document:validated,request}),candidate=>{reconcileSourceIngestionRelations(candidate,validated,request);return candidate;});validated=reconcileSourceIngestionRelations(relationOutput,validated,request).document;}
     catch(error){const current=this.store.get<{state:string}>('SELECT state FROM source_ingestion_windows WHERE id=?',unit.id);if(current?.state==='unknown')throw error;/* Optional relation failure preserves the faithful readable baseline and diagnostics. */}
    }
   }
   // Optional extraction/targeted-repair hints share the same publication gate.
   // Revalidate retained windows locally after parser fixes without paid replay.
   validated=validateSourceIngestionDocument(normalizeSourceIngestionCandidate(validated),{ownedPages:Array.from({length:prepared.pageCount},(_,index)=>index+1),pageCount:prepared.pageCount});
   const assembly=assembleSourceIngestionDocument(validated,{extractionId:run.id});
   if(Buffer.byteLength(assembly.text)>maxSourceTextBytes)throw new Error('Ingestion transcription exceeds the source text byte limit.');
   const ledger=Object.fromEntries(['transcription','structure','metadata','math','apparatus','synopsis','authors'].map(key=>[key,{state:key==='math'&&!options.containsMath||!this.dependencies.enrich&&(key==='synopsis'&&!validated.metadata.synopsis||key==='authors'&&!validated.metadata.contributors.length)||key==='apparatus'&&!validated.blocks.some(b=>b.kind==='footnote')?'not-requested':key==='metadata'||key==='synopsis'&&!validated.metadata.synopsis||(key==='transcription'&&validated.pages.some(p=>p.state==='unreadable'||p.state==='image-only'||p.unresolved.length))||(key==='structure'&&(validated.relations.some(r=>r.uncertain)||validated.blocks.some(block=>block.uncertainty)))?'requires-review':'completed',fingerprint:run.fingerprint}])) as SourceIngestionCompletionLedger;
   if(validated.pages.some(p=>p.unresolved.length)){ledger.structure.state='requires-review';if(ledger.apparatus.state==='completed')ledger.apparatus.state='requires-review';}
   if(this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (repair_state='failed' OR repair_state='skipped' AND error IS NOT NULL)",run.id))ledger.structure.state='requires-review';
   assertActive();this.store.transaction(()=>{
    const current=this.file(run.vault_id,run.file_id);if(current.status==='ready'||this.store.get('SELECT 1 FROM source_ingestion_documents WHERE file_id=?',run.file_id))throw new Error('Source baseline already published.');
    this.store.run("UPDATE source_files SET active_ingestion_run=NULL,status='ready',text=?,pages=?,page_start_lines=?,structural_nodes=?,progress=100,error=NULL,enrichment_status='completed',language=?,summary=?,generated_name=? WHERE id=?",assembly.text,prepared.pageCount,JSON.stringify(assembly.pageStartLines),JSON.stringify(assembly.structuralNodes),validated.metadata.language,validated.metadata.synopsis,validated.metadata.title,run.file_id);
    // Manifest order is actual attempt insertion order; earlier retries keep their own exact input hash.
    // Nullable legacy entries remain null rather than borrowing a later window's bytes.
    const outputs=this.store.all<{transmitted_hash:string|null}>('SELECT a.transmitted_hash FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? ORDER BY a.rowid',run.id);
    const responses=this.store.all<{response_hash:string;usage_json:string;returned_model:string|null}>("SELECT a.response_hash,a.usage_json,a.returned_model FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? AND a.state='completed' ORDER BY w.ordinal,a.created_at",run.id);
    const promptVersions=[...new Set(this.store.all<{prompt_version:string|null}>("SELECT a.prompt_version FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=? AND a.kind='extraction' AND a.state='completed' ORDER BY w.ordinal,a.created_at",run.id).map(attempt=>attempt.prompt_version??'pdf-transcription-1'))];
    const provenance={provider:options.route,requestedModel:options.model,returnedModel:responses.at(-1)?.returned_model??null,schemaVersion:1,originalHash:prepared.originalHash,admittedHash:prepared.admittedHash,transmittedHash:hash(JSON.stringify(outputs.map(o=>o.transmitted_hash))),responseHash:hash(JSON.stringify(responses.map(r=>r.response_hash))),promptVersion:promptVersions.join(',')||SOURCE_INGESTION_PROMPT_VERSION,coverage:'checked',independentEvidence:'not-checked',userReviewed:false};
    this.store.run('INSERT INTO source_ingestion_documents(id,file_id,vault_id,schema_version,assembly_version,content_hash,document_json,assembly_json,provenance_json,capabilities_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',run.id,run.file_id,run.vault_id,1,assembly.assemblyVersion,assembly.contentHash,JSON.stringify(validated),JSON.stringify(assembly),JSON.stringify(provenance),JSON.stringify(ledger),now());
    const file=this.file(run.vault_id,run.file_id);recordSourceAuthorsProcessed(this.store,file);
    const reconciled=reconcileSourceIngestion(this.store,file,validated,assembly,{runId:run.id,documentId:run.id,reviewPolicy:options.reviewPolicy,depth:options.depth,model:options.model??''});
    ledger.metadata.state=reconciled.metadataPending?'requires-review':'completed';
    if(reconciled.diagnostics.length)this.store.run("UPDATE source_ingestion_windows SET error=? WHERE id=(SELECT id FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment' ORDER BY ordinal LIMIT 1)",reconciled.diagnostics.join(' ').slice(0,4000),run.id);
    this.store.run('UPDATE source_ingestion_documents SET capabilities_json=? WHERE id=?',JSON.stringify(ledger),run.id);
    this.dependencies.reconcile?.(file,validated,assembly,options);
    this.store.run("UPDATE entities SET inactive=0,updated_at=? WHERE id=? AND vault_id=?",now(),file.entity_id,run.vault_id);
    this.store.run("UPDATE source_ingestion_runs SET state='completed',stage='indexing',published_document_id=?,error=NULL,updated_at=? WHERE id=?",run.id,now(),run.id);
   });
  } catch(error) {
   const state=this.store.get<{state:string}>('SELECT state FROM source_ingestion_runs WHERE id=?',run.id)?.state;
   this.store.run('UPDATE source_ingestion_runs SET state=?,error=?,updated_at=? WHERE id=?',state==='unknown'?'unknown':controller.signal.aborted||state==='paused'?'paused':'failed',error instanceof Error?error.message:'PDF ingestion failed.',now(),run.id);
   if(run.published_document_id)this.store.run("UPDATE source_files SET enrichment_status='failed',enrichment_error=? WHERE id=?",error instanceof Error?error.message:'PDF enrichment needs attention.',run.file_id);
  } finally {this.active.delete(run.id);this.busy=false;}
 }
 private publishEnrichment(run:Run,options:SourceIngestionOptions){
  if(!this.dependencies.enrich||!this.store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment' AND state='completed'",run.id))return;
  this.store.transaction(()=>{
   const file=this.file(run.vault_id,run.file_id),assembly=resolveSourceIngestionAssembly(this.store,file);if(!assembly||assembly.text!==file.text)throw new HttpError(409,'Enrichment cannot change the retained canonical transcription.');
   this.store.run('DELETE FROM source_documents WHERE file_id=?',file.id);
   const document=assembly.document;
   this.store.run("UPDATE source_files SET summary=?,language=?,generated_name=?,enrichment_status='completed',enrichment_error=NULL WHERE id=?",document.metadata.synopsis,document.metadata.language,document.metadata.title,file.id);
   const reconciled=reconcileSourceIngestion(this.store,this.file(file.vault_id,file.id),document,assembly,{runId:run.id,documentId:run.published_document_id!,reviewPolicy:options.reviewPolicy,depth:options.depth,model:options.model??''});
   const row=this.store.get<{capabilities_json:string}>('SELECT capabilities_json FROM source_ingestion_documents WHERE id=?',run.published_document_id!);const ledger=JSON.parse(row!.capabilities_json) as SourceIngestionCompletionLedger;
   ledger.synopsis.state=document.metadata.synopsis?'completed':'requires-review';ledger.authors.state='completed';ledger.metadata.state=reconciled.metadataPending?'requires-review':'completed';ledger.structure.state=document.blocks.some(block=>block.uncertainty)||document.relations.some(relation=>relation.uncertain)?'requires-review':'completed';
   this.store.run('UPDATE source_ingestion_documents SET capabilities_json=? WHERE id=?',JSON.stringify(ledger),run.published_document_id!);
   if(reconciled.diagnostics.length)this.store.run("UPDATE source_ingestion_windows SET error=? WHERE id=(SELECT id FROM source_ingestion_windows WHERE run_id=? AND kind='enrichment' ORDER BY ordinal LIMIT 1)",reconciled.diagnostics.join(' ').slice(0,4000),run.id);
  });
 }
 private async executeUnit(run:Run,window:Window,options:SourceIngestionOptions,prepared:{bytes:Uint8Array;pageCount:number},signal:AbortSignal,execute:IngestionDependencies['extract'],validate:(candidate:unknown)=>unknown) {
  const plan=JSON.parse(window.plan_json) as SourceIngestionWindowPlan;
  if(window.kind==='enrichment'){
   const retained=this.store.get<{id:string;candidate_json:string}>("SELECT id,candidate_json FROM source_ingestion_attempts WHERE window_id=? AND kind='enrichment' AND state IN ('completed','invalid') AND candidate_json IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1",window.id);
   if(retained){try{const candidate=validate(JSON.parse(retained.candidate_json));this.store.transaction(()=>{this.store.run("UPDATE source_ingestion_windows SET state='completed',result_json=?,error=NULL WHERE id=?",JSON.stringify(candidate),window.id);this.store.run("UPDATE source_ingestion_attempts SET state='completed',error=NULL,updated_at=? WHERE id=?",now(),retained.id);});return candidate;}catch(error){this.store.run("UPDATE source_ingestion_windows SET state='failed',error=? WHERE id=?",error instanceof Error?error.message:'Retained enrichment requires review.',window.id);throw error;}}
  }
  let pdf:Awaited<ReturnType<IngestionDependencies['split']>>;
  try{pdf=await this.dependencies.split(prepared.bytes,[...plan.contextPages,...plan.ownedPages]);if(signal.aborted)throw new HttpError(499,'PDF ingestion paused.');this.checkBudget(run,options,pdf);}catch(error){this.store.run("UPDATE source_ingestion_windows SET state='failed',error=? WHERE id=?",error instanceof Error?error.message:'Document recovery preparation failed.',window.id);throw error;}
  const attempt=randomUUID();this.store.run("INSERT INTO source_ingestion_attempts(id,window_id,state,kind,transmitted_hash,prompt_version,created_at,updated_at) VALUES(?,?,'prepared',?,?,?,?,?)",attempt,window.id,window.kind,hash(pdf.bytes),window.kind==='enrichment'?SOURCE_INGESTION_ENRICHMENT_PROMPT_VERSION:null,now(),now());
  this.store.run("UPDATE source_ingestion_windows SET state='running',transmitted_hash=? WHERE id=?",hash(pdf.bytes),window.id);this.store.run("UPDATE source_ingestion_runs SET stage=?,updated_at=? WHERE id=?",window.kind==='enrichment'?'enrichment':'repair',now(),run.id);
  try{
   const response=await execute({vaultId:run.vault_id,fileId:run.file_id,options,pdf:pdf.bytes,pageMap:pdf.pageMap,plan,context:run.context_json?JSON.parse(run.context_json):null,signal,onSubmitted:id=>{this.store.run("UPDATE source_ingestion_attempts SET state='submitted',request_id=?,updated_at=? WHERE id=?",id??null,now(),attempt);}});
   this.store.run("UPDATE source_ingestion_attempts SET state=?,request_id=?,usage_json=?,response_hash=?,returned_model=?,candidate_json=?,updated_at=? WHERE id=?",response.status==='completed'?'completed':'invalid',response.requestId??null,JSON.stringify(response.usage),response.responseHash,response.returnedModel??null,window.kind==='enrichment'&&response.status==='completed'?JSON.stringify(response.candidate):null,now(),attempt);
   if(response.status!=='completed')throw new Error('Document '+window.kind+' returned '+response.status+' output.');
   const candidate=validate(response.candidate);
   this.store.run('UPDATE source_ingestion_windows SET state=?,result_json=?,error=NULL WHERE id=?',window.kind==='page-recovery'?'candidate':'completed',JSON.stringify(candidate),window.id);return candidate;
  }catch(error){
   const state=this.store.get<{state:string}>('SELECT state FROM source_ingestion_attempts WHERE id=?',attempt)!.state;
   const known=error instanceof Error&&'outcomeUncertain' in error&&error.outcomeUncertain===false,unknown=state==='submitted'&&!known;
   this.store.run('UPDATE source_ingestion_attempts SET state=?,error=?,updated_at=? WHERE id=?',unknown?'unknown':state==='completed'?'invalid':'failed',error instanceof Error?error.message:'Document recovery failed',now(),attempt);
   this.store.run('UPDATE source_ingestion_windows SET state=?,error=? WHERE id=?',unknown?'unknown':'failed',error instanceof Error?error.message:'Document recovery failed',window.id);
   if(unknown)this.store.run("UPDATE source_ingestion_runs SET state='unknown' WHERE id=?",run.id);throw error;
  }
 }
 private publishPageRecovery(run:Run,window:Window,options:SourceIngestionOptions) {
  const page=(JSON.parse(window.plan_json) as SourceIngestionWindowPlan).ownedPages[0]!;
  const attempt=this.store.get<{id:string;response_hash:string}>("SELECT id,response_hash FROM source_ingestion_attempts WHERE window_id=? AND kind='page-recovery' AND state='completed' ORDER BY created_at DESC,id DESC LIMIT 1",window.id);
  if(!attempt)throw new Error('Successful page recovery provenance is unavailable.');
  this.store.transaction(()=>{createSourceIngestionPageRecoveryDerivative(this.store,this.file(run.vault_id,run.file_id),JSON.parse(window.result_json!),{runId:run.id,documentId:run.published_document_id!,reviewPolicy:options.reviewPolicy,depth:options.depth,model:options.model??'',candidateIdentity:hash(window.id+':'+attempt.id),responseHash:attempt.response_hash,page});this.store.run("UPDATE source_ingestion_windows SET state='completed',error=NULL WHERE id=?",window.id);});
 }
 private publishRepairDerivative(run:Run,window:Window,options:SourceIngestionOptions) {
  const row=this.store.get<{id:string;document_json:string;assembly_json:string}>('SELECT id,document_json,assembly_json FROM source_ingestion_documents WHERE id=? AND file_id=? AND vault_id=?',run.published_document_id,run.file_id,run.vault_id);
  if(!row)throw new Error('The published ingestion document is unavailable.');
  const assembly=JSON.parse(row.assembly_json) as ReturnType<typeof assembleSourceIngestionDocument>,document=JSON.parse(window.result_json!) as SourceIngestionDocument;
  const index=this.store.all<{id:string}>("SELECT id FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state!='superseded' ORDER BY ordinal",run.id).findIndex(w=>w.id===window.id);
  if(index<0)throw new Error('The repaired window no longer has a canonical mapping.');
  const repairs=document.repairs.map(repair=>{
   const block=assembly.blockRanges.find(b=>b.temporaryId===`w${index}:${repair.blockId}`);
   if(!block)throw new Error('Targeted repair has no exact published block mapping.');
   return {...repair,blockId:block.id,startOffset:block.range.startOffset+repair.start,endOffset:block.range.startOffset+repair.end,startLine:block.range.startLine+(block.text.slice(0,repair.start).match(/\n/g)?.length??0),endLine:block.range.startLine+(block.text.slice(0,Math.max(repair.start,repair.end-1)).match(/\n/g)?.length??0)};
  });
  const attempt=this.store.get<{id:string}>("SELECT id FROM source_ingestion_attempts WHERE window_id=? AND kind='repair' AND state='completed' ORDER BY created_at DESC,id DESC LIMIT 1",window.id);
  if(!attempt)throw new Error('The successful targeted repair attempt is unavailable.');
  this.store.transaction(()=>{
   createSourceIngestionRepairDerivative(this.store,this.file(run.vault_id,run.file_id),JSON.parse(row.document_json),{...assembly,repairs},{runId:run.id,documentId:row.id,reviewPolicy:options.reviewPolicy,depth:options.depth,model:options.model??'',candidateIdentity:hash(window.id+':'+attempt.id)});
   this.store.run("UPDATE source_ingestion_windows SET repair_state='completed',error=NULL WHERE id=?",window.id);
  });
 }
 private checkBudget(run:Run,options:SourceIngestionOptions,pdf:{bytes:Uint8Array;pageMap:number[]}) {
  const attempts=this.store.get<{n:number}>('SELECT count(*) n FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=?',run.id)!.n;
  if(attempts>=options.budget.maxRequests)throw new Error('Document request budget exhausted.');
    if(options.budget.maxCostUsd!==null){
     const price=documentPrice(options.model!,now().slice(0,10)),model=documentModel(options.model!);
     if(!price||!model)throw new Error('Document pricing is unavailable; cannot enforce the configured budget.');
     const usage=this.store.all<{usage_json:string|null;state:string}>('SELECT a.usage_json,a.state FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id WHERE w.run_id=?',run.id);
     const estimate=(input:number,output:number,cached=0)=>((Math.max(0,input-cached)*price.input+cached*price.cachedInput)*(input>(price.longInputThreshold??Infinity)?price.longInputMultiplier??1:1)+output*price.output*(input>(price.longInputThreshold??Infinity)?price.longOutputMultiplier??1:1))/1_000_000;
     // An explicit replay accepts duplicate-cost risk; it does not erase the first uncertain charge.
     // Reserve a conservative model-capacity upper bound without inventing actual token usage.
     const uncertainBound=estimate(Math.max(0,model.contextTokens-options.budget.maxOutputTokens),options.budget.maxOutputTokens);
     const spent=usage.reduce((total,row)=>{if(row.usage_json===null)return total+(['unknown','submitted'].includes(row.state)?uncertainBound:0);const u=JSON.parse(row.usage_json) as {inputTokens?:number;outputTokens?:number;thinkingTokens?:number;cachedInputTokens?:number};return total+estimate(u.inputTokens??0,(u.outputTokens??0)+(u.thinkingTokens??0),u.cachedInputTokens??0);},0);
     const reserve=estimate(Math.ceil(pdf.bytes.length/2)+pdf.pageMap.length*1500+10000,options.budget.maxOutputTokens);
     if(spent+reserve>options.budget.maxCostUsd){const uncertain=usage.filter(row=>row.usage_json===null&&['unknown','submitted'].includes(row.state)).length*uncertainBound;throw new Error('The next document window would exceed the configured cost budget.'+(uncertain?' Unknown paid outcomes retain a conservative $'+uncertain.toFixed(4)+' charge reservation; actual usage remains unavailable.':''));}
    }
 }
 close(){this.closed=true;for(const controller of this.active.values())controller.abort();}
}
