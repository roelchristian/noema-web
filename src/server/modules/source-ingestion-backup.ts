import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SourceFiles} from './source-files.js';
import {SourceDocuments} from './source-documents.js';
import {sourceIngestionPageRecoveryInsertion,sourceIngestionPageRecoveryContent} from './source-ingestion-page-recovery.js';
import type {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {assembleSourceIngestionDocument,mergeSourceIngestionWindows} from './source-ingestion-assembly.js';
import {parseSourceIngestionOptions} from './source-ingestion-options.js';
import {validateSourceIngestionDocument} from './source-ingestion-validation.js';
import {sourceIngestionBoundaryRelationRequests,reconcileSourceIngestionRelations} from './source-ingestion-relations.js';
import type {SourceIngestionDocument} from '../../shared/source-ingestion.js';
import type {SourceIngestionWindowPlan} from '../../shared/source-ingestion.js';
type Row=Record<string,unknown>;
const invalid=()=>new HttpError(400,'Invalid PDF ingestion backup.');
// The archive importer bounds the complete expanded payload to 256 MiB. Rich
// assembly repeats canonical text, so a smaller field cap rejects valid sources.
function text(row:Row,key:string,max=256*1024*1024):string {const value=row[key];if(typeof value!=='string'||value.length>max)throw invalid();return value;}
function parsed(row:Row,key:string):unknown {try{return JSON.parse(text(row,key));}catch{throw invalid();}}
function object(value:unknown):Row {if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Row;}
function hash(row:Row,key:string):string {const value=text(row,key,64);if(!/^[a-f0-9]{64}$/.test(value))throw invalid();return value;}
function date(row:Row,key:string):string {const value=text(row,key,64);if(!Number.isFinite(Date.parse(value)))throw invalid();return value;}
function unique(map:Map<string,string>,row:Row,id:string):void {const old=text(row,'id',128);if(!old||map.has(old))throw invalid();map.set(old,id);}
function plan(value:unknown,pageCount:number):SourceIngestionWindowPlan {
 const v=object(value);
 if(Object.keys(v).some(k=>!['index','ownedPages','contextPages','estimatedOutputTokens'].includes(k))||!Number.isSafeInteger(v.index)||(v.index as number)<0||!Number.isSafeInteger(v.estimatedOutputTokens)||(v.estimatedOutputTokens as number)<1)throw invalid();
 const owned=v.ownedPages,context=v.contextPages;
 if(!Array.isArray(owned)||!owned.length||!Array.isArray(context)||context.length>1)throw invalid();
 const all=[...owned,...context];if(new Set(all).size!==all.length||all.some(p=>!Number.isSafeInteger(p)||p<1||p>pageCount)||owned.some((p,i)=>i>0&&p!==owned[i-1]+1))throw invalid();
 return v as unknown as SourceIngestionWindowPlan;
}
/** Remote handles and request IDs are excluded. Validation happens inside the caller's restore transaction. */
export function restoreIngestionBackup(store:Store,vault:string,files:Map<string,string>,rows:Record<string,Row[]>):void {
 const documents=new Map<string,string>(),documentFiles=new Map<string,string>(),documentProviders=new Map<string,{provider:string;model:string}>(),runs=new Map<string,string>(),runDetails=new Map<string,{pageCount:number;file:string;published:boolean}>(),windows=new Map<string,string>();
 for(const row of rows.source_ingestion_documents??[]){
  const file=files.get(text(row,'file_id',128));if(!file)throw invalid();
  const assembly=object(parsed(row,'assembly_json')) as {blockRanges?:{id:string}[];text?:string;contentHash?:string};
  const identity=assembly.blockRanges?.[0]?.id?.match(/^ingestion-(.+)-1$/)?.[1];if(!identity)throw invalid();
  const document=parsed(row,'document_json');
  let rebuilt;try{rebuilt=assembleSourceIngestionDocument(document as Parameters<typeof assembleSourceIngestionDocument>[0],{extractionId:identity});}catch{throw invalid();}
  if(JSON.stringify(rebuilt)!==JSON.stringify(assembly)||rebuilt.contentHash!==hash(row,'content_hash')||row.schema_version!==1||row.assembly_version!==rebuilt.assemblyVersion)throw invalid();
  const source=store.get<{text:string;format:string}>('SELECT text,format FROM source_files WHERE id=? AND vault_id=?',file,vault);if(!source||source.format!=='pdf'||source.text!==rebuilt.text)throw invalid();
  const provenance=object(parsed(row,'provenance_json'));
  if(!['openai','gemini'].includes(String(provenance.provider))||typeof provenance.requestedModel!=='string'||!provenance.requestedModel||provenance.returnedModel!==null&&typeof provenance.returnedModel!=='string'||provenance.schemaVersion!==1||typeof provenance.promptVersion!=='string'||!provenance.promptVersion||provenance.coverage!=='checked'||provenance.independentEvidence!=='not-checked'||typeof provenance.userReviewed!=='boolean')throw invalid();
  for(const key of ['originalHash','admittedHash','transmittedHash','responseHash'])hash(provenance,key);
  const assets=new SourceFiles(store),manifest=assets.evidence(vault,file);
  if(createHash('sha256').update(readFileSync(assets.assetFilename(vault,file))).digest('hex')!==provenance.admittedHash||typeof manifest.originalHash==='string'&&manifest.originalHash!==provenance.originalHash||typeof manifest.canonicalHash==='string'&&manifest.canonicalHash!==createHash('sha256').update(source.text).digest('hex'))throw invalid();
  if(Object.keys(provenance).some(k=>!['provider','requestedModel','returnedModel','schemaVersion','promptVersion','originalHash','admittedHash','transmittedHash','responseHash','coverage','independentEvidence','userReviewed'].includes(k)))throw invalid();
  const capabilities=object(parsed(row,'capabilities_json'));
  const keys=['transcription','structure','metadata','math','apparatus','synopsis','authors'];
  if(Object.keys(capabilities).some(k=>!keys.includes(k)))throw invalid();
  for(const key of keys){const capability=object(capabilities[key]);if(!['completed','pending','failed','not-requested','requires-review'].includes(String(capability.state))||Object.keys(capability).some(k=>!['state','fingerprint'].includes(k)))throw invalid();hash(capability,'fingerprint');}
  const id=randomUUID();unique(documents,row,id);documentFiles.set(text(row,'id',128),file);documentProviders.set(text(row,'id',128),{provider:String(provenance.provider),model:String(provenance.requestedModel)});
  store.run('INSERT INTO source_ingestion_documents(id,file_id,vault_id,schema_version,assembly_version,content_hash,document_json,assembly_json,provenance_json,capabilities_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,file,vault,1,rebuilt.assemblyVersion,rebuilt.contentHash,JSON.stringify(document),JSON.stringify(rebuilt),JSON.stringify(provenance),JSON.stringify(capabilities),date(row,'created_at'));
  store.run('UPDATE source_files SET ingestion_origin=?,active_ingestion_run=NULL WHERE id=? AND vault_id=?',String(provenance.provider),file,vault);
 }
 for(const row of rows.source_ingestion_runs??[]){
  const file=files.get(text(row,'file_id',128));if(!file)throw invalid();
  const id=randomUUID();unique(runs,row,id);
  let options;try{options=parseSourceIngestionOptions(parsed(row,'config_json'));}catch{throw invalid();}if(options.route==='local')throw invalid();
  const config=JSON.stringify(options),fingerprint=hash(row,'fingerprint');
  let context:string|null=null;
  if(row.context_json!=null){
   const value=parsed(row,'context_json');
   if(value!==null){const manifest=object(value);if(Object.keys(manifest).some(k=>!['version','provisional','evidenceBound','title','language','sections','conventions'].includes(k))||manifest.version!==1||manifest.provisional!==true||manifest.evidenceBound!==true||manifest.title!==null&&(typeof manifest.title!=='string'||manifest.title.length>512)||manifest.language!==null&&(typeof manifest.language!=='string'||manifest.language.length>64)||!Array.isArray(manifest.sections)||manifest.sections.length>64||manifest.sections.some(item=>{const section=object(item);return Object.keys(section).some(k=>!['page','title'].includes(k))||!Number.isSafeInteger(section.page)||(section.page as number)<1||typeof section.title!=='string'||section.title.length>256;})||!Array.isArray(manifest.conventions)||manifest.conventions.length>12||manifest.conventions.some(c=>typeof c!=='string'||c.length>256))throw invalid();}
   context=text(row,'context_json',100_000);
  }
  const count=row.page_count;if(!Number.isSafeInteger(count)||(count as number)<0||(count as number)>1000)throw invalid();
  const published=row.published_document_id==null?null:documents.get(text(row,'published_document_id',128));if(row.published_document_id!=null&&(!published||documentFiles.get(text(row,'published_document_id',128))!==file))throw invalid();
  if(published){const selection=documentProviders.get(text(row,'published_document_id',128))!;if(selection.provider!==options.route||selection.model!==options.model)throw invalid();}
  const state=published?'completed':'paused';runDetails.set(id,{pageCount:count as number,file,published:!!published});
  store.run('INSERT INTO source_ingestion_runs(id,file_id,vault_id,idempotency_key,config_json,context_json,fingerprint,state,stage,page_count,original_hash,admitted_hash,published_document_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,file,vault,createHash('sha256').update(`${vault}:${id}`).digest('hex'),config,context,fingerprint,state,published?'publication':'preparation',count as number,row.original_hash==null?null:hash(row,'original_hash'),row.admitted_hash==null?null:hash(row,'admitted_hash'),published??null,published?null:'Restored ingestion is paused. Resume explicitly; submitted requests may have an unknown paid outcome.',date(row,'created_at'),date(row,'updated_at'));
  store.run('UPDATE source_files SET ingestion_origin=?,active_ingestion_run=? WHERE id=? AND vault_id=?',options.route,published?null:id,file,vault);
 }
 const candidateWindows=new Map<string,string>(),windowKinds=new Map<string,string>(),relationResults:{id:string;run:string;value:unknown;plan:SourceIngestionWindowPlan}[]=[],ownedByRun=new Map<string,Set<number>>();
 for(const row of rows.source_ingestion_windows??[]){
  const run=runs.get(text(row,'run_id',128));if(!run||!Number.isSafeInteger(row.ordinal)||(row.ordinal as number)<0)throw invalid();
  const id=randomUUID();unique(windows,row,id);const kind=row.kind===undefined?'extraction':text(row,'kind',20);if(!['extraction','relations','page-recovery'].includes(kind))throw invalid();windowKinds.set(id,kind);const windowPlan=plan(parsed(row,'plan_json'),runDetails.get(run)!.pageCount);if(windowPlan.index!==row.ordinal)throw invalid();
  const owned=ownedByRun.get(run)??new Set<number>();if(kind==='extraction'&&row.state!=='superseded')for(const page of windowPlan.ownedPages){if(owned.has(page))throw invalid();owned.add(page);}ownedByRun.set(run,owned);
  let result:string|null=null;if(row.result_json!=null){try{const value=parsed(row,'result_json');if(kind==='relations'){relationResults.push({id,run,value,plan:windowPlan});result=JSON.stringify(value);}else result=JSON.stringify(validateSourceIngestionDocument(value,{ownedPages:windowPlan.ownedPages,pageCount:runDetails.get(run)!.pageCount}));}catch{throw invalid();}}
  if(kind==='page-recovery'&&(windowPlan.ownedPages.length!==1||!runDetails.get(run)!.published)||kind==='relations'&&(windowPlan.ownedPages.length!==2||windowPlan.ownedPages[1]!==windowPlan.ownedPages[0]!+1))throw invalid();
  if(kind==='page-recovery'){try{const source=new SourceFiles(store).require(vault,runDetails.get(run)!.file);sourceIngestionPageRecoveryInsertion({text:source.text,document:new SourceDocuments(store).get(source)},windowPlan.ownedPages[0]!);if(result!==null)sourceIngestionPageRecoveryContent(JSON.parse(result) as SourceIngestionDocument,windowPlan.ownedPages[0]!,runDetails.get(run)!.pageCount);}catch{throw invalid();}}
  if((row.state==='completed'||row.state==='candidate'||row.repair_state==='candidate')&&result===null)throw invalid();
  if(row.state==='candidate'){if(kind!=='page-recovery')throw invalid();candidateWindows.set(id,'page-recovery');}
  const state=['completed','pending','failed','superseded','candidate'].includes(String(row.state))?String(row.state):'unknown';
  if(row.repair_state==='candidate'){if(row.state!=='completed'||!runDetails.get(run)!.published)throw invalid();candidateWindows.set(id,'repair');}
  const repairState=row.repair_state===undefined?'pending':['pending','completed','skipped','failed','candidate'].includes(String(row.repair_state))?String(row.repair_state):'unknown';
  store.run('INSERT INTO source_ingestion_windows(id,run_id,ordinal,kind,plan_json,state,repair_state,result_json,pending_review,transmitted_hash,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,run,row.ordinal as number,kind,JSON.stringify(windowPlan),state,repairState,result,result===null||kind==='relations'?0:(JSON.parse(result) as {repairs:unknown[]}).repairs.length,row.transmitted_hash==null?null:hash(row,'transmitted_hash'),null);
 }
 for(const row of rows.source_ingestion_attempts??[]){
  const window=windows.get(text(row,'window_id',128));if(!window)throw invalid();
  const state=['completed','failed','invalid','not-submitted'].includes(String(row.state))?String(row.state):row.state==='prepared'?'not-submitted':'unknown';
  const kind=row.kind===undefined?'extraction':text(row,'kind',20);if(!['extraction','repair','relations','page-recovery'].includes(kind)||(windowKinds.get(window)==='extraction'?!['extraction','repair'].includes(kind):windowKinds.get(window)!==kind))throw invalid();
  const returned=row.returned_model==null?null:text(row,'returned_model',256);
  if(row.usage_json!=null){const usage=object(parsed(row,'usage_json'));if(Object.entries(usage).some(([key,value])=>!['inputTokens','outputTokens','thinkingTokens','cachedInputTokens','cacheWriteTokens'].includes(key)||!Number.isSafeInteger(value)||(value as number)<0))throw invalid();}
  store.run('INSERT INTO source_ingestion_attempts(id,window_id,state,kind,transmitted_hash,request_id,usage_json,response_hash,returned_model,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),window,state,kind,row.transmitted_hash==null?null:hash(row,'transmitted_hash'),null,row.usage_json==null?null:text(row,'usage_json',100_000),row.response_hash==null?null:hash(row,'response_hash'),returned,row.error==null?null:text(row,'error',20_000),date(row,'created_at'),date(row,'updated_at'));
 }
 const mergedByRun=new Map<string,SourceIngestionDocument>();
 for(const relation of relationResults.sort((a,b)=>a.plan.index-b.plan.index)){
  try{
   let document=mergedByRun.get(relation.run);
   if(!document){const extraction=store.all<{result_json:string}> ("SELECT result_json FROM source_ingestion_windows WHERE run_id=? AND kind='extraction' AND state!='superseded' ORDER BY ordinal",relation.run);if(extraction.some(window=>!window.result_json))throw invalid();document=mergeSourceIngestionWindows(extraction.map((window,index)=>({index,document:JSON.parse(window.result_json) as SourceIngestionDocument})),runDetails.get(relation.run)!.pageCount);}
   const request=sourceIngestionBoundaryRelationRequests(document,[relation.plan.ownedPages[1]!])[0];
   if(!request||JSON.stringify(request.pages)!==JSON.stringify(relation.plan.ownedPages))throw invalid();
   mergedByRun.set(relation.run,reconcileSourceIngestionRelations(relation.value,document,request).document);
  }catch{throw invalid();}
 }
 for(const [id,kind] of candidateWindows)if(!store.get("SELECT 1 FROM source_ingestion_attempts WHERE window_id=? AND state='completed' AND kind=?",id,kind))throw invalid();
 for(const id of runs.values())if(store.get("SELECT 1 FROM source_ingestion_windows WHERE run_id=? AND (state='unknown' OR repair_state='unknown' OR kind!='extraction' AND state IN ('pending','failed'))",id))store.run("UPDATE source_ingestion_runs SET state='paused',error='Restored optional work is paused. Resolve unknown paid outcomes explicitly before resuming.' WHERE id=?",id);
}
