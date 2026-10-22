import {OpenAIResponseSizeError} from './openai-response.js';
import {randomUUID} from 'node:crypto';
import {embeddingModel,embeddingDimensions,embeddingMaxBytes,type EmbeddingSettings,type SuggestedSource,type EmbeddingNote,type EmbeddingJob,type SemanticSearchResult} from '../../shared/embeddings.js';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {CachedVectorSearch} from '../vector-search.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Intelligence,EmbeddingAdmissionError,embeddingBatchMaxInputs,embeddingBatchMaxBytes} from './intelligence.js';
import {Vaults} from './vaults.js';
import {AIActivityLog} from './ai-activity.js';
import {passageReference,type SourcePassage} from './source-passages.js';

type Job={batch_max_inputs:number;id:string;vault_id:string;passage_id:string;file_id:string|null;generation_id:string;source_id:string;content_hash:string;model:string;dimensions:number;reason:string;status:string;attempts:number};
const searchable=`f.vault_id=p.vault_id AND f.admitted=1 AND e.type='source' AND e.inactive=0 AND length(substr(f.text,1,2000))>=coalesce(s.min_characters,20)`;
const eligible=`f.vault_id=p.vault_id AND NOT EXISTS (SELECT 1 FROM source_passage_dirty d WHERE d.file_id=p.file_id) AND f.status='ready' AND f.admitted=1 AND e.inactive=0 AND length(substr(f.text,1,2000))>=coalesce(s.min_characters,20)`;
const joins=`FROM source_passages p JOIN source_files f ON f.id=p.file_id AND f.entity_id=p.source_id JOIN entities e ON e.id=p.source_id AND e.vault_id=p.vault_id LEFT JOIN embedding_settings s ON s.vault_id=p.vault_id`;
const fresh=`b.content_hash=p.content_hash AND b.model=? AND b.dimensions=?`;
export class SourcePassageEmbeddings {
 private closed=false;
 private vectors=new CachedVectorSearch();
 private activityIds=new Set<string>();
 private lastSource:{vault:string;source:string}|undefined;
 constructor(private store:Store,private vaults:Vaults,private intelligence:Intelligence,private settings:(vault:string)=>EmbeddingSettings,private activity?:AIActivityLog,private synchronize?:(vault:string)=>void) {
  store.run("UPDATE source_passage_embedding_jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'interrupted' END,finished_at=?,error='Server stopped during this attempt.' WHERE status='running'",now());
 }
 close(){this.closed=true;this.vectors.clear();for(const id of this.activityIds)this.activity?.finish(id,'interrupted',null);this.activityIds.clear();}
 disable(vault:string){this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Automatic indexing disabled.' WHERE vault_id=? AND reason='save' AND status IN ('queued','running')",now(),vault);}
 notes(vault:string):EmbeddingNote[] {
  const automatic=this.settings(vault).automatic;
  return this.store.all<{id:string;title:string;ready:number;total:number;indexed:number;cached:number;failed:number;file_status:string;passage_status:string|null;dirty:number}>(`SELECT e.id,e.name AS title,
   (f.status='ready' AND f.admitted=1 AND e.inactive=0 AND length(substr(f.text,1,2000))>=coalesce(s.min_characters,20)) AS ready,
   f.status AS file_status,ps.status AS passage_status,EXISTS(SELECT 1 FROM source_passage_dirty d WHERE d.file_id=f.id) AS dirty,
   count(p.id) AS total,sum(CASE WHEN ${fresh} THEN 1 ELSE 0 END) AS indexed,count(b.passage_id) AS cached,
   sum(CASE WHEN p.id IS NOT NULL AND NOT (coalesce(b.content_hash,'')=p.content_hash) AND
    (SELECT j.status FROM source_passage_embedding_jobs j WHERE j.passage_id=p.id AND j.generation_id=p.generation_id
      AND j.content_hash=p.content_hash AND j.model=? AND j.dimensions=? ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) IN ('failed','interrupted') THEN 1 ELSE 0 END) AS failed
   FROM entities e JOIN source_files f ON f.entity_id=e.id AND f.vault_id=e.vault_id
   LEFT JOIN embedding_settings s ON s.vault_id=e.vault_id LEFT JOIN source_passage_state ps ON ps.file_id=f.id
   LEFT JOIN source_passages p ON p.file_id=f.id AND p.vault_id=f.vault_id AND p.source_id=e.id LEFT JOIN source_passage_embeddings b ON b.passage_id=p.id AND b.model=? AND b.dimensions=?
   WHERE e.vault_id=? AND e.type='source' GROUP BY e.id`,embeddingModel,embeddingDimensions,embeddingModel,embeddingDimensions,embeddingModel,embeddingDimensions,vault).map(row=>{
    const indexed=row.indexed??0,failed=row.failed??0,pending=Math.max(0,row.total-indexed-failed);
    const preparing=row.file_status==='queued'||row.file_status==='processing'||!!row.dirty||row.passage_status==='preparing';
    const extractionFailed=row.file_status==='failed'||row.passage_status==='failed';
    const indexingStatus:EmbeddingNote['indexingStatus']=extractionFailed?'failed':preparing?'preparing':!row.ready||row.passage_status==='disabled'||!row.total?'disabled':row.total===indexed?'ready':indexed>0?'partial':failed>0&&pending===0?'failed':!automatic?'disabled':'indexing';
    const reason=extractionFailed?'Source extraction or passage preparation failed. Previous passages may still be available.':preparing?'Preparing source passages.':!row.ready?'Source is not admitted, inactive, or too short.':row.total===0?'Source has no passages to index.':`${indexed} of ${row.total} passages indexed; ${failed} failed; ${pending} pending`;
    return {pageId:row.id,sourceId:row.id,kind:'entity',title:row.title,eligible:!!row.ready&&row.total>0,indexedPassages:indexed,totalPassages:row.total,failedPassages:failed,pendingPassages:pending,indexingStatus,reason,state:!row.ready||!row.total?'ineligible':indexed===row.total?'indexed':indexed>0?'partial':row.cached>0?'stale':'missing'};
   });
 }
 jobs(vault:string):EmbeddingJob[]{return this.store.all<EmbeddingJob>(`SELECT j.id,NULL AS pageId,j.source_id AS sourceId,j.passage_id AS passageId,j.file_id AS fileId,j.generation_id AS generationId,j.content_hash AS contentHash,coalesce(e.name,'Deleted source') AS title,j.status,j.reason,j.attempts,j.created_at AS createdAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.next_attempt_at AS nextAttemptAt,j.error,j.tokens FROM source_passage_embedding_jobs j LEFT JOIN entities e ON e.id=j.source_id WHERE j.vault_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,vault);}
 counts(vault:string){return this.store.all<{status:string;n:number}>('SELECT status,count(*) AS n FROM source_passage_embedding_jobs WHERE vault_id=? GROUP BY status',vault);}
 enqueue(vault:string,reason:string,source?:string,onlyMissing=false,force=false) {
  return this.store.transaction(()=>{
  this.store.run(`UPDATE source_passage_embedding_jobs AS j SET status='skipped',finished_at=?,error='Passage generation was replaced.' WHERE j.vault_id=? AND j.status IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM source_passages p WHERE p.id=j.passage_id AND p.generation_id=j.generation_id)`,now(),vault);
  // Restore retained passage inputs after extraction replaces the passage rows.
  this.store.run(`INSERT OR IGNORE INTO source_passage_embeddings (passage_id,model,dimensions,content_hash,vector,tokens,updated_at)
   SELECT p.id,c.model,c.dimensions,p.content_hash,c.vector,c.tokens,c.updated_at ${joins}
   JOIN source_passage_embedding_cache c ON c.vault_id=p.vault_id AND c.source_id=p.source_id AND c.content_hash=p.content_hash
   WHERE p.vault_id=? AND c.model=? AND c.dimensions=? AND ${eligible}`,vault,embeddingModel,embeddingDimensions);
  // Queue only metadata here; the worker loads one bounded batch at a time.
  const rows=this.store.all<{id:string;file_id:string;generation_id:string;source_id:string;content_hash:string}>(`SELECT p.id,p.file_id,p.generation_id,p.source_id,p.content_hash ${joins} LEFT JOIN source_passage_embeddings b ON b.passage_id=p.id AND b.model=? AND b.dimensions=? WHERE p.vault_id=? AND ${eligible} AND NOT (${fresh.replace('b.content_hash=p.content_hash','coalesce(b.content_hash,\'\')=p.content_hash')}) ${source?'AND p.source_id=?':''} ${onlyMissing?'AND b.passage_id IS NULL':''} AND NOT EXISTS (SELECT 1 FROM source_passage_embedding_jobs j WHERE j.passage_id=p.id AND (j.status IN ('queued','running') ${force?'':"OR (j.generation_id=p.generation_id AND j.content_hash=p.content_hash AND j.model=? AND j.dimensions=? AND j.status IN ('failed','interrupted') AND (coalesce(j.error,'')<>'Embedding service unavailable. Automatic discovery will retry.' OR j.next_attempt_at>?) AND j.rowid=(SELECT latest.rowid FROM source_passage_embedding_jobs latest WHERE latest.passage_id=p.id AND latest.generation_id=p.generation_id AND latest.content_hash=p.content_hash AND latest.model=j.model AND latest.dimensions=j.dimensions ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1))"}))`,embeddingModel,embeddingDimensions,vault,embeddingModel,embeddingDimensions,...(source?[source]:[]),...(force?[]:[embeddingModel,embeddingDimensions,now()]));
  for(const row of rows)this.store.run('INSERT INTO source_passage_embedding_jobs (id,vault_id,passage_id,file_id,generation_id,source_id,content_hash,model,dimensions,status,reason,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),vault,row.id,row.file_id,row.generation_id,row.source_id,row.content_hash,embeddingModel,embeddingDimensions,'queued',reason,now(),now());
  return rows.length;
  });
 }
 discover(){for(const {id} of this.store.all<{id:string}>('SELECT id FROM vaults WHERE locked=0'))if(this.settings(id).automatic)this.enqueue(id,'save');}
 invalidate(vault:string,source:string){this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Source is no longer available.' WHERE vault_id=? AND source_id=? AND status IN ('queued','running')",now(),vault,source);this.store.run('DELETE FROM source_passage_embeddings WHERE passage_id IN (SELECT id FROM source_passages WHERE vault_id=? AND source_id=?)',vault,source);}
 retry(vault:string,id:string):{queued:number}|undefined {
  const job=this.store.get<Job>('SELECT * FROM source_passage_embedding_jobs WHERE id=? AND vault_id=?',id,vault);if(!job)return;
  if(!['failed','interrupted','skipped'].includes(job.status))throw new HttpError(409,'Only failed, interrupted, or skipped jobs can be retried.');
  const row=this.store.get<{content_hash:string;file_id:string;generation_id:string;source_id:string}>(`SELECT p.content_hash,p.file_id,p.generation_id,p.source_id ${joins} WHERE p.id=? AND p.vault_id=? AND ${eligible}`,job.passage_id,vault);
  if(!row||this.store.get("SELECT 1 FROM source_passage_embedding_jobs WHERE passage_id=? AND status IN ('queued','running')",job.passage_id))return {queued:0};
  this.store.run('INSERT INTO source_passage_embedding_jobs (id,vault_id,passage_id,file_id,generation_id,source_id,content_hash,model,dimensions,status,reason,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),vault,job.passage_id,row.file_id,row.generation_id,row.source_id,row.content_hash,embeddingModel,embeddingDimensions,'queued','retry',now(),now());return {queued:1};
 }
 private finish(id:string,status:string,error:string|null=null){this.store.run("UPDATE source_passage_embedding_jobs SET status=?,finished_at=?,error=? WHERE id=? AND status='running'",status,now(),error,id);}
 private passage(job:Job){return this.store.get<SourcePassage>(`SELECT p.* ${joins} WHERE p.id=? AND p.vault_id=? AND p.generation_id=? AND ${eligible}`,job.passage_id,job.vault_id,job.generation_id);}
 async tick():Promise<boolean> {
  if(this.closed)return false;
  // Rotate whole bounded batches between sources, including sources in different vaults.
  const selected=this.store.get<{vault_id:string;source_id:string}>(`SELECT j.vault_id,j.source_id FROM source_passage_embedding_jobs j JOIN vaults v ON v.id=j.vault_id WHERE j.status='queued' AND j.next_attempt_at<=? AND v.locked=0 GROUP BY j.vault_id,j.source_id ORDER BY CASE WHEN j.vault_id>? OR (j.vault_id=? AND j.source_id>?) THEN 0 ELSE 1 END,j.vault_id,j.source_id LIMIT 1`,now(),this.lastSource?.vault??'',this.lastSource?.vault??'',this.lastSource?.source??'');
  if(!selected)return false;
  this.lastSource={vault:selected.vault_id,source:selected.source_id};
  const candidates=this.store.all<Job>(`SELECT * FROM source_passage_embedding_jobs WHERE vault_id=? AND source_id=? AND status='queued' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,rowid LIMIT ?`,selected.vault_id,selected.source_id,now(),embeddingBatchMaxInputs);
  const batch:{job:Job;input:string;bytes:number}[]=[];
  let maxInputs=embeddingBatchMaxInputs;
  let batchBytes=0,activityId:string|undefined;
  for(const job of candidates){
   maxInputs=Math.min(maxInputs,job.batch_max_inputs);
   if(batch.length>=maxInputs)break;
   const passage=this.passage(job);
   let skipped:string|undefined;
   if(!passage||passage.content_hash!==job.content_hash||job.model!==embeddingModel||job.dimensions!==embeddingDimensions)skipped='Passage changed or is unavailable.';
   else if(job.reason==='save'&&!this.settings(job.vault_id).automatic)skipped='Automatic indexing disabled.';
   else if(this.store.get(`SELECT 1 FROM source_passage_embeddings WHERE passage_id=? AND content_hash=? AND model=? AND dimensions=?`,passage.id,passage.content_hash,embeddingModel,embeddingDimensions))skipped='Passage is already indexed.';
   if(skipped){this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error=? WHERE id=? AND status='queued'",now(),skipped,job.id);continue;}
   let heading='',headingBytes=0;
   for(const point of passage!.heading??''){const bytes=Buffer.byteLength(point,'utf8');if(headingBytes+bytes>Math.min(1000,embeddingMaxBytes-Buffer.byteLength(passage!.text,'utf8')-2))break;heading+=point;headingBytes+=bytes;}
   const input=heading?`${heading}\n\n${passage!.text}`:passage!.text,bytes=Buffer.byteLength(input,'utf8');
   if(bytes>embeddingMaxBytes||bytes>embeddingBatchMaxBytes){this.store.run("UPDATE source_passage_embedding_jobs SET status='failed',finished_at=?,error='Passage exceeds embedding input limit.' WHERE id=? AND status='queued'",now(),job.id);continue;}
   if(batchBytes+bytes>embeddingBatchMaxBytes)break;
   this.store.run("UPDATE source_passage_embedding_jobs SET status='running',started_at=?,finished_at=NULL,error=NULL WHERE id=? AND status='queued'",now(),job.id);
   batch.push({job,input,bytes});batchBytes+=bytes;
  }
  if(!batch.length)return true;
  try {
   const result=await this.intelligence.embedBatch(batch.map(item=>item.input),bytes=>{
    // Admission happens before this observer. Local contention never spends attempts.
    this.store.transaction(()=>{for(const {job} of batch){this.store.run("UPDATE source_passage_embedding_jobs SET attempts=attempts+1 WHERE id=? AND status='running'",job.id);job.attempts++;}});
    activityId=this.activity?.start('note_embedding',{model:embeddingModel,reasoningEffort:'none'},selected.vault_id,selected.source_id,'entity');if(activityId)this.activityIds.add(activityId);
    return activityId?this.activity?.request(activityId,bytes,null):undefined;
   },true);
   if(this.closed)return true;
   if(result.embeddings.length!==batch.length||result.embeddings.some(vector=>vector.length!==embeddingDimensions||vector.some(n=>!Number.isFinite(n))||!vector.some(n=>n!==0)))throw new HttpError(502,'Invalid embedding response.');
   this.vaults.requireOpen(selected.vault_id);
   this.synchronize?.(selected.vault_id);
   // Preserve valid immutable results before checking the job or active generation.
   // A deleted source cannot retain a cache, and a locked vault cannot be mutated.
   const sourceExists=this.store.get("SELECT 1 FROM entities WHERE id=? AND vault_id=? AND type='source'",selected.source_id,selected.vault_id);
   let assignedTokens=0;
   const tokens=batch.map(({bytes},index)=>{const count=index===batch.length-1?result.tokens-assignedTokens:Math.floor(result.tokens*bytes/batchBytes);assignedTokens+=count;return count;});
   if(sourceExists)this.store.transaction(()=>{for(const [index,{job}] of batch.entries())this.store.run(`INSERT INTO source_passage_embedding_cache (vault_id,source_id,content_hash,model,dimensions,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(vault_id,source_id,content_hash,model,dimensions) DO UPDATE SET vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,job.vault_id,job.source_id,job.content_hash,embeddingModel,embeddingDimensions,JSON.stringify(result.embeddings[index]),tokens[index]!,now());});
   let attached=false;
   this.store.transaction(()=>{for(const [index,{job}] of batch.entries()){
    const state=this.store.get<{status:string;error:string|null}>('SELECT status,error FROM source_passage_embedding_jobs WHERE id=?',job.id);
    const superseded=state?.status==='skipped'&&(state.error==='Passage generation superseded.'||state.error==='Passage generation was replaced.');
    const allowed=(state?.status==='running'||superseded)&&(job.reason!=='save'||this.settings(job.vault_id).automatic);
    const current=allowed?this.store.all<SourcePassage>(`SELECT p.* ${joins} WHERE p.vault_id=? AND p.source_id=? AND p.content_hash=? AND ${eligible}`,job.vault_id,job.source_id,job.content_hash):[];
    if(!current.length){this.finish(job.id,'skipped','Passage changed or indexing was cancelled.');continue;}
    for(const passage of current){
     this.store.run(`INSERT INTO source_passage_embeddings (passage_id,model,dimensions,content_hash,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(passage_id,model,dimensions) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,passage.id,embeddingModel,embeddingDimensions,job.content_hash,JSON.stringify(result.embeddings[index]),tokens[index]!,now());
     // Replacement discovery may already have queued the matching new passage.
     this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Passage is already indexed.' WHERE passage_id=? AND id<>? AND content_hash=? AND model=? AND dimensions=? AND status='queued'",now(),passage.id,job.id,job.content_hash,embeddingModel,embeddingDimensions);
    }
    this.store.run("UPDATE source_passage_embedding_jobs SET status='completed',finished_at=?,error=NULL,tokens=? WHERE id=?",now(),tokens[index]!,job.id);attached=true;
   }});
   this.endActivity(activityId,attached?'completed':'skipped',attached?200:409);
  }catch(error){
   if(this.closed)return true;
   const code=error instanceof HttpError?error.status:502;this.endActivity(activityId,code===404||code===423?'skipped':'failed',code);
   for(const {job} of batch){
    // Shrinking is bounded by the singleton case and survives worker restarts.
    if(error instanceof OpenAIResponseSizeError&&batch.length>1) {
     this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',started_at=NULL,next_attempt_at=?,batch_max_inputs=?,error='Response size limit reached. Retrying a smaller batch.' WHERE id=? AND status='running'",now(),Math.ceil(batch.length/2),job.id);continue;
    }
    if(error instanceof EmbeddingAdmissionError)this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',started_at=NULL,next_attempt_at=?,error='Waiting for embedding capacity.' WHERE id=? AND status='running'",new Date(Date.now()+Math.max(1,error.retryAfterMs)).toISOString(),job.id);
    else if(code===423)this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',next_attempt_at=?,error='Waiting for vault to unlock.' WHERE id=? AND status='running'",now(),job.id);
    else if((code===429||code>=500)&&job.attempts<3)this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',next_attempt_at=?,error='Embedding service unavailable. Automatic retry scheduled.' WHERE id=? AND status='running'",new Date(Date.now()+30000*2**Math.max(0,job.attempts-1)).toISOString(),job.id);
    else if(code===429||code>=500)this.store.run("UPDATE source_passage_embedding_jobs SET status='failed',finished_at=?,next_attempt_at=?,error='Embedding service unavailable. Automatic discovery will retry.' WHERE id=? AND status='running'",now(),new Date(Date.now()+15*60*1000).toISOString(),job.id);
    else this.finish(job.id,code===404?'skipped':'failed','Passage embedding request failed. Check Intelligence settings and retry.');
   }
  }
  return true;
 }
 private endActivity(id:string|undefined,status:'completed'|'failed'|'skipped',code:number){if(id&&this.activityIds.delete(id))this.activity?.finish(id,status,code);}
 hasSearchable(vault:string){return !!this.store.get(`SELECT 1 ${joins} JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.vault_id=? AND ${searchable} AND ${fresh} LIMIT 1`,vault,embeddingModel,embeddingDimensions);}
 /** Score every saved query segment against one candidate scan; build only winning excerpts. */
 suggested(vault:string,queryVectors:number[][],excludedSourceIds:Set<string>,limit=5):SuggestedSource[] {
  if(!queryVectors.length||limit<=0)return [];
  type Candidate={id:string;source_id:string;content_hash:string;text:string;vector:string};
  const rows=this.store.all<Candidate>(`SELECT p.id,p.source_id,p.content_hash,p.text,b.vector ${joins} JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.vault_id=? AND e.type='source' AND e.archived_at IS NULL AND ${eligible} AND ${fresh}`,vault,embeddingModel,embeddingDimensions);
  const matches=new Map<string,{row:Candidate;score:number}>();
  for(const row of rows) {
   if(excludedSourceIds.has(row.source_id))continue;
   let best:number|undefined;
   for(const query of queryVectors){const score=this.vectors.score(`${vault}:${row.id}:${row.content_hash}`,row.vector,query,embeddingDimensions);if(score!==undefined&&(best===undefined||score>best))best=score;}
   if(best===undefined||best<0.4)continue;
   const previous=matches.get(row.source_id);
   if(!previous||best>previous.score||best===previous.score&&row.id.localeCompare(previous.row.id)<0)matches.set(row.source_id,{row,score:best});
  }
  return [...matches.values()].sort((a,b)=>b.score-a.score||a.row.source_id.localeCompare(b.row.source_id)).slice(0,limit).map(({row,score})=>({sourceId:row.source_id,score,excerpt:makeSearchSnippet(row.text,'')}));
 }
 search(vault:string,query:string,queryVector:number[],_queryMagnitude:number):SemanticSearchResult[]{
  const rows=this.store.all<SourcePassage & {vector:string;name:string;updated_at:string}>(`SELECT p.*,b.vector,e.name,e.updated_at,(f.status<>'ready' OR EXISTS(SELECT 1 FROM source_passage_dirty d WHERE d.file_id=p.file_id)) AS stale ${joins} JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.vault_id=? AND ${searchable} AND ${fresh}`,vault,embeddingModel,embeddingDimensions);
  const results:SemanticSearchResult[]=[];
  for(const row of rows){const score=this.vectors.score(`${vault}:${row.id}:${row.content_hash}`,row.vector,queryVector,embeddingDimensions);if(score!==undefined)results.push({id:row.source_id,kind:'entity',passageId:row.id,title:row.name,snippet:makeSearchSnippet(row.text,query),score,updated_at:row.updated_at,reference:passageReference(row)});}
  return results;
 }
}
