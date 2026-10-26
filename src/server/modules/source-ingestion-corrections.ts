import {createHash,randomUUID} from 'node:crypto';
import {maxSourceTextBytes} from '../../shared/source-input.js';
import type {SourceFile} from '../../shared/domain.js';
import type {SourceDocument} from '../../shared/source-document.js';
import {sourceDocumentEntries} from '../../shared/source-document.js';
import type {SourceIngestionDocument,SourceIngestionOptions} from '../../shared/source-ingestion.js';
import {SOURCE_INGESTION_MAX_CHARACTERS} from '../../shared/source-ingestion.js';
import type {SourceEditorialPatch,SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import {sourceEditorialRevisionLimit} from '../../shared/source-reprocessing.js';
import type {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import type {SourceIngestionAssembly} from './source-ingestion-assembly.js';
import {SourceDocuments} from './source-documents.js';
import {materializeSourceRevision,sourceRevisionBaseHash} from './source-reprocessing.js';
import {evaluateV2Acceptance,editorialRiskValidator} from './source-reprocessing-risk.js';
import {acceptVerifiedFootnoteFormatting,groupApparatusPatches} from './source-reprocessing-apparatus.js';
import {utf16Boundary,wellFormedUnicode} from './source-reprocessing-patches.js';
import {Bibliography} from './bibliography.js';
import {SourceMetadata} from './source-metadata.js';
import {extractSourceMetadata} from './source-metadata-extraction.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const categories=new Set(['ocr','line_breaks','footnote','apparatus','metadata','citation','math','formatting']);
export interface SourceIngestionReconciliationOptions {
 runId:string;documentId:string;reviewPolicy:SourceIngestionOptions['reviewPolicy'];depth:SourceIngestionOptions['depth'];model:string;
}

/** Check before another paid optional request. Publication rechecks capacity transactionally. */
export function preflightSourceIngestionRepairCapacity(store:Store,file:SourceFile):void {
 if(file.status!=='ready'||!file.admitted||!file.text.trim())throw new HttpError(409,'A published admitted transcription is required for optional repair.');
 if(store.get("SELECT 1 FROM source_reprocessing WHERE file_id=? AND vault_id=? AND status IN ('queued','running')",file.id,file.vault_id))throw new HttpError(409,'Wait for the active editorial pass before requesting optional PDF repair.');
 const count=store.get<{count:number}>('SELECT count(*) count FROM source_reprocessing WHERE file_id=? AND vault_id=?',file.id,file.vault_id)!.count;
 if(count>=sourceEditorialRevisionLimit)throw new HttpError(409,'Revision limit reached. Delete an editorial revision before requesting optional PDF repair.');
}

/** A later repair creates a separate, explicitly selectable derivative. It never
 * changes the frozen IR, prior decisions, metadata, citation IDs or preferred reading. */
export function createSourceIngestionRepairDerivative(store:Store,file:SourceFile,publishedIR:SourceIngestionDocument,candidateAssembly:SourceIngestionAssembly,options:SourceIngestionReconciliationOptions&{candidateIdentity:string}):{revision:SourceReprocessingRevision|null;created:boolean;skipped:number} {
 const work=()=>{
  if(!/^[a-f0-9]{64}$/.test(options.candidateIdentity))throw new HttpError(400,'Invalid optional repair identity.');
  const current=store.get<SourceFile>('SELECT * FROM source_files WHERE id=? AND vault_id=?',file.id,file.vault_id);
  const authoritative=store.get<{id:string;document_json:string;assembly_json:string}>('SELECT id,document_json,assembly_json FROM source_ingestion_documents WHERE file_id=? AND vault_id=?',file.id,file.vault_id);
  if(!current||current.text!==file.text||current.text!==candidateAssembly.text||!authoritative||authoritative.id!==options.documentId||authoritative.document_json!==JSON.stringify(publishedIR))throw new HttpError(409,'Optional repair no longer matches the immutable published source.');
  const originalAssembly=JSON.parse(authoritative.assembly_json) as SourceIngestionAssembly;
  if(originalAssembly.text!==candidateAssembly.text||JSON.stringify(originalAssembly.blockRanges)!==JSON.stringify(candidateAssembly.blockRanges))throw new HttpError(409,'Optional repair cannot change canonical block identities or ranges.');
  const rows=store.all<{payload:string}>("SELECT payload FROM source_reprocessing WHERE file_id=? AND vault_id=? AND json_extract(payload,'$.origin.kind')='ingestion' AND json_extract(payload,'$.origin.documentId')=? ORDER BY created_at,id",file.id,file.vault_id,options.documentId);
  const revisions=rows.map(row=>JSON.parse(row.payload) as SourceReprocessingRevision);
  const repeated=revisions.find(revision=>revision.origin?.repairIdentity===options.candidateIdentity);
  if(repeated)return {revision:repeated,created:false,skipped:0};
  const prior=revisions.flatMap(revision=>revision.patches);
  let skipped=0;
  const candidates=candidateAssembly.repairs.filter(candidate=>{
   if(prior.some(patch=>candidate.startOffset<patch.range.endOffset&&candidate.endOffset>patch.range.startOffset)){skipped++;return false;}
   return true;
  });
  if(!candidates.length)return {revision:null,created:false,skipped};
  preflightSourceIngestionRepairCapacity(store,current);
  const document=new SourceDocuments(store).get(current);
  const revision=createSourceIngestionCorrectionRevision(current,document,{...candidateAssembly,repairs:candidates},options)!;
  revision.origin!.repairIdentity=options.candidateIdentity;
  revision.instructions='Optional targeted PDF recovery; canonical extraction and earlier reading decisions remain unchanged.';
  revision.report.diagnostics.push('Later recovery is a separate reading version. Select it explicitly to inspect its suggestions.');
  if(skipped)revision.report.diagnostics.push(`${skipped} candidate(s) overlapped prior decisions and were retained in the recovery response instead of replacing those decisions.`);
  store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',revision.id,current.id,current.vault_id,'completed',revision.createdAt,revision.updatedAt,JSON.stringify(revision));
  const saved=JSON.parse(store.get<{payload:string}>('SELECT payload FROM source_reprocessing WHERE id=?',revision.id)!.payload) as SourceReprocessingRevision;
  return {revision:saved,created:true,skipped};
 };
 return store.db.isTransaction?work():store.transaction(work);
}

/** Only sparse candidates enter editorial review. The baseline itself is never an all-added diff. */
export function createSourceIngestionCorrectionRevision(file:SourceFile,document:SourceDocument,assembly:SourceIngestionAssembly,options:SourceIngestionReconciliationOptions):SourceReprocessingRevision|null {
 if(!assembly.repairs.length)return null;
 if(file.text!==assembly.text||file.text.length>SOURCE_INGESTION_MAX_CHARACTERS||Buffer.byteLength(file.text)>maxSourceTextBytes)throw new HttpError(400,'Ingestion repair baseline does not match the published transcription.');
 const timestamp=now(),original={text:file.text,document:structuredClone(document)},baseHash=sourceRevisionBaseHash(original);
 const policy=options.reviewPolicy==='verified'?'verified':'review_all';
 const nodes=sourceDocumentEntries(document);
 const patches:SourceEditorialPatch[]=assembly.repairs.map((candidate):SourceEditorialPatch=>{
  const {startOffset:start,endOffset:end}=candidate;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>file.text.length||file.text.slice(start,end)!==candidate.original||!utf16Boundary(file.text,start)||!utf16Boundary(file.text,end)||!wellFormedUnicode(candidate.replacement)||candidate.original===candidate.replacement||candidate.original.length>16000||candidate.replacement.length>16000||!categories.has(candidate.category))throw new HttpError(400,'Ingestion correction has invalid exact canonical evidence.');
  if(/<!--\s*Page\s+\d+\s*-->/i.test(candidate.original+candidate.replacement))throw new HttpError(400,'Ingestion corrections cannot change physical page markers.');
  const covering=assembly.blockRanges.find(block=>block.id===candidate.blockId);
  if(!covering||start<covering.range.startOffset||end>covering.range.endOffset)throw new HttpError(400,'Ingestion correction is outside its source block.');
  const category=candidate.category as SourceEditorialPatch['category'];
  // No cloud confidence or agreement is passed as independent native/OCR evidence.
  const evaluation=evaluateV2Acceptance({text:file.text,document,start,end,original:candidate.original,replacement:candidate.replacement,category,policy});
  return {id:randomUUID(),baseHash,nodeIds:nodes.filter(({node})=>node.range.startOffset<end&&node.range.endOffset>start).map(({node})=>node.id),range:{...covering.range,startOffset:start,endOffset:end,startLine:candidate.startLine,endLine:candidate.endLine},original:candidate.original,replacement:candidate.replacement,category,reason:candidate.reason,confidence:0,decision:evaluation.automatic?'accepted':'pending',riskReasons:evaluation.reasons,...(evaluation.automatic?{autoAcceptance:{policy,validator:editorialRiskValidator,checks:evaluation.checks,appliedAt:timestamp},decisionHistory:[{at:timestamp,actor:'automatic' as const,from:'pending' as const,to:'accepted' as const}]}:{})};
 }).sort((a,b)=>a.range.startOffset-b.range.startOffset);
 if(patches.length>6400||patches.some((patch,index)=>index>0&&patch.range.startOffset<patches[index-1]!.range.endOffset))throw new HttpError(400,'Ingestion correction candidates overlap or exceed the review budget.');
 groupApparatusPatches(patches);acceptVerifiedFootnoteFormatting(patches,file.text,document,policy);
 const revision:SourceReprocessingRevision={origin:{kind:'ingestion',documentId:options.documentId,runId:options.runId},pipelineVersion:2,configuration:{depth:options.depth,reviewPolicy:policy,evidence:{originalPages:true,ocr:false,allowExternalTransmission:true}},id:randomUUID(),fileId:file.id,createdAt:timestamp,updatedAt:timestamp,status:'completed',instructions:'Sparse corrections from PDF ingestion; the faithful extraction remains canonical.',baseHash,stale:false,patches,original,reprocessed:structuredClone(original),report:{promptVersion:'source-ingestion-corrections-1',model:options.model,reasoningEffort:'none',startedAt:timestamp,finishedAt:timestamp,durationMs:0,chunksTotal:0,chunksCompleted:0,completedChunkIndexes:[],charactersTotal:file.text.length,charactersReviewed:file.text.length,inputTokens:null,outputTokens:null,reasoningTokens:null,cachedInputTokens:null,diagnostics:['Sparse ingestion corrections; no additional generation request was made. Provider transcription is not independent native or OCR verification.'],error:null}};
 materializeSourceRevision(revision);return revision;
}

/** Called within publication's transaction; metadata uses its existing conflict and manual-authority guards. */
export function reconcileSourceIngestion(store:Store,file:SourceFile,ir:SourceIngestionDocument,assembly:SourceIngestionAssembly,options:SourceIngestionReconciliationOptions) {
 const document=new SourceDocuments(store).get(file);
 const existing=store.get<{payload:string}>("SELECT payload FROM source_reprocessing WHERE file_id=? AND vault_id=? AND json_extract(payload,'$.origin.kind')='ingestion' AND json_extract(payload,'$.origin.documentId')=?",file.id,file.vault_id,options.documentId);
 let revision=existing?JSON.parse(existing.payload) as SourceReprocessingRevision:createSourceIngestionCorrectionRevision(file,document,assembly,options);
 if(revision&&!existing){
  const count=store.get<{count:number}>('SELECT count(*) count FROM source_reprocessing WHERE file_id=? AND vault_id=?',file.id,file.vault_id)!.count;
  if(count>=sourceEditorialRevisionLimit)throw new HttpError(409,'Revision limit reached. Delete an editorial revision before publishing ingestion corrections.');
  store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',revision.id,file.id,file.vault_id,'completed',revision.createdAt,revision.updatedAt,JSON.stringify(revision));
  revision=JSON.parse(store.get<{payload:string}>('SELECT payload FROM source_reprocessing WHERE id=?',revision.id)!.payload) as SourceReprocessingRevision;
 }
 let metadataPending=0;const diagnostics:string[]=[];
 if(file.entity_id){
  const metadata=new SourceMetadata(store),establishedTitle=new Bibliography(store).get(file.vault_id,file.entity_id)?.fields.title;
  const facts=extractSourceMetadata(file.text,establishedTitle??ir.metadata.title??document.source.title).facts;
  const modeled=[...ir.metadata.bibliographic,...ir.metadata.contributors.filter(person=>['author','editor','translator'].includes(person.role.toLowerCase())).map(person=>({field:person.role.toLowerCase(),value:person.name,page:person.page,blockId:person.blockId}))];
  if(ir.metadata.title&&!modeled.some(candidate=>candidate.field==='title')){const block=assembly.blockRanges.find(block=>block.page<=2&&block.text.trim()===ir.metadata.title);if(block)modeled.push({field:'title',value:ir.metadata.title,page:block.page,blockId:block.temporaryId});}
  for(const candidate of modeled){
   const block=assembly.blockRanges.find(block=>block.temporaryId===candidate.blockId&&block.page===candidate.page);
   if(!block||!block.text.includes(candidate.value)||file.text.indexOf(block.text)!==block.range.startOffset||file.text.indexOf(block.text,block.range.startOffset+1)!==-1){diagnostics.push('A metadata candidate lacks unique exact publication evidence and requires separate review.');continue;}
   facts.push({fieldKey:'bibliography:'+candidate.field,value:candidate.value,excerpt:block.text,start:block.range.startOffset,end:block.range.endOffset,validated:false,validationReason:'Provider publication interpretation; compare the credited role and exact PDF evidence.'});
  }
  for(const fact of facts){
   try {const result=metadata.registerCandidate(file.vault_id,file.entity_id,{...fact,fileId:file.id,runId:options.runId,version:'canonical',revision:digest(file.text),evidenceHash:digest(fact.excerpt)});if(result.registrationOutcome==='pending')metadataPending++;}
   catch(error){if(!(error instanceof HttpError)||![400,409].includes(error.status))throw error;diagnostics.push(error.message);metadataPending++;}
  }
 }
 return {revision,metadataPending,diagnostics,pendingRepairs:revision?.patches.filter(patch=>patch.decision==='pending').length??0};
}
