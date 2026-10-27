import {createHash} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {sourceProgress} from './source-progress.js';
const bounded=(value:string|null|undefined,limit:number)=>value==null?null:value.slice(0,limit);
function processingDetail(id:string){
 const detail=sourceProgress.get(id);
 if(!detail||detail.phase!=='math'||![detail.completed,detail.total,detail.startedAt,detail.updatedAt].every(value=>Number.isFinite(value)&&value>=0))return undefined;
 return {phase:detail.phase,completed:detail.completed,total:detail.total,startedAt:detail.startedAt,updatedAt:detail.updatedAt,
  ...(Number.isFinite(detail.estimatedRemainingSeconds)&&(detail.estimatedRemainingSeconds??-1)>=0?{estimatedRemainingSeconds:detail.estimatedRemainingSeconds}:{})};
}
/** Explicit public scalar projection: internal admission/configuration columns and
 * future database fields must never become part of this response accidentally. */
export function sourceFileStatus(file:SourceFile){
 const contentVersion=createHash('sha256').update(JSON.stringify([file.text,file.structural_nodes,file.page_start_lines,file.generated_name,file.language,file.name,file.enrichment_status,file.status,file.admitted])).digest('hex');
 return {
  id:file.id,vault_id:file.vault_id,entity_id:file.entity_id,
  name:file.name.slice(0,200),original_filename:file.original_filename.slice(0,200),generated_name:bounded(file.generated_name,200),
  language:bounded(file.language,80),format:file.format,size:file.size,status:file.status,admitted:file.admitted,
  progress:file.progress,pages:file.pages,ocr_pages:file.ocr_pages,error:bounded(file.error,2000),
  enrichment_status:file.enrichment_status,enrichment_error:bounded(file.enrichment_error,2000),enrichment_attempts:file.enrichment_attempts,
  enrichment_next_attempt_at:file.enrichment_next_attempt_at.slice(0,80),created_at:file.created_at.slice(0,80),
  contains_math:file.contains_math,pdf_flattened:file.pdf_flattened,import_method:file.import_method,source_url:bounded(file.source_url,4096),
  ingestion_origin:file.ingestion_origin,active_ingestion_run:file.active_ingestion_run,
  processing_detail:processingDetail(file.id),
  text:'',summary:null,contentVersion,
 };
}
/** Attachment inventory for reading/status: never transfer document text or structures. */
export function sourceFileStatuses(store:Store,vault:string,entityId:string){
 if(!store.get("SELECT id FROM entities WHERE id=? AND vault_id=? AND type='source' AND archived_at IS NULL",entityId,vault))throw new HttpError(404,'Source not found.');
 return store.all<SourceFile>(`SELECT id,vault_id,entity_id,name,original_filename,generated_name,language,format,size,status,admitted,
  progress,pages,ocr_pages,error,enrichment_status,enrichment_error,enrichment_attempts,enrichment_next_attempt_at,created_at,
  contains_math,pdf_flattened,import_method,source_url,ingestion_origin,active_ingestion_run,text,structural_nodes,page_start_lines
  FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at DESC,id`,vault,entityId).map(sourceFileStatus);
}
