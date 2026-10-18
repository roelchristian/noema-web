import {randomUUID} from 'node:crypto';
import {embeddingModel,embeddingDimensions,embeddingMaxBytes,type EmbeddingSettings,type EmbeddingNote,type EmbeddingJob,type SemanticSearchResult} from '../../shared/embeddings.js';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Intelligence} from './intelligence.js';
import {Vaults} from './vaults.js';
import {AIActivityLog} from './ai-activity.js';
import {passageReference,type SourcePassage} from './source-passages.js';

type Job={id:string;vault_id:string;passage_id:string;source_id:string;content_hash:string;model:string;dimensions:number;reason:string;status:string;attempts:number};
const eligible=`f.status='ready' AND f.admitted=1 AND e.inactive=0 AND length(substr(f.text,1,2000))>=coalesce(s.min_characters,20)`;
const joins=`FROM source_passages p JOIN source_files f ON f.id=p.file_id AND f.entity_id=p.source_id JOIN entities e ON e.id=p.source_id AND e.vault_id=p.vault_id LEFT JOIN embedding_settings s ON s.vault_id=p.vault_id`;
const fresh=`b.content_hash=p.content_hash AND b.model=? AND b.dimensions=?`;
export class SourcePassageEmbeddings {
 private closed=false;
 private activityIds=new Set<string>();
 constructor(private store:Store,private vaults:Vaults,private intelligence:Intelligence,private settings:(vault:string)=>EmbeddingSettings,private activity?:AIActivityLog,private synchronize?:(vault:string)=>void) {
  store.run("UPDATE source_passage_embedding_jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'interrupted' END,finished_at=?,error='Server stopped during this attempt.' WHERE status='running'",now());
 }
 close(){this.closed=true;for(const id of this.activityIds)this.activity?.finish(id,'interrupted',null);this.activityIds.clear();}
 disable(vault:string){this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Automatic indexing disabled.' WHERE vault_id=? AND reason='save' AND status IN ('queued','running')",now(),vault);}
 notes(vault:string):EmbeddingNote[] {
  return this.store.all<{id:string;title:string;ready:number;total:number;indexed:number;cached:number}>(`SELECT e.id,e.name AS title,(${eligible}) AS ready,count(p.id) AS total,sum(CASE WHEN ${fresh} THEN 1 ELSE 0 END) AS indexed,count(b.passage_id) AS cached FROM entities e JOIN source_files f ON f.entity_id=e.id AND f.vault_id=e.vault_id LEFT JOIN embedding_settings s ON s.vault_id=e.vault_id LEFT JOIN source_passages p ON p.file_id=f.id LEFT JOIN source_passage_embeddings b ON b.passage_id=p.id AND b.model=? AND b.dimensions=? WHERE e.vault_id=? AND e.type='source' GROUP BY e.id`,embeddingModel,embeddingDimensions,embeddingModel,embeddingDimensions,vault).map(row=>({pageId:row.id,sourceId:row.id,kind:'entity',title:row.title,eligible:!!row.ready&&row.total>0,indexedPassages:row.indexed,totalPassages:row.total,reason:!row.ready?'Source is not ready or is too short.':!row.total?'Preparing source passages.':`${row.indexed} of ${row.total} passages indexed`,state:!row.ready||!row.total?'ineligible':row.indexed===row.total?'indexed':row.indexed>0?'partial':row.cached>0?'stale':'missing'}));
 }
 jobs(vault:string):EmbeddingJob[]{return this.store.all<EmbeddingJob>(`SELECT j.id,NULL AS pageId,j.source_id AS sourceId,j.passage_id AS passageId,e.name AS title,j.status,j.reason,j.attempts,j.created_at AS createdAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.next_attempt_at AS nextAttemptAt,j.error,j.tokens FROM source_passage_embedding_jobs j JOIN entities e ON e.id=j.source_id WHERE j.vault_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,vault);}
 counts(vault:string){return this.store.all<{status:string;n:number}>('SELECT status,count(*) AS n FROM source_passage_embedding_jobs WHERE vault_id=? GROUP BY status',vault);}
 enqueue(vault:string,reason:string,source?:string,onlyMissing=false,force=false) {
  return this.store.transaction(()=>{
  // Restore retained passage inputs after extraction replaces the passage rows.
  this.store.run(`INSERT OR IGNORE INTO source_passage_embeddings (passage_id,model,dimensions,content_hash,vector,tokens,updated_at)
   SELECT p.id,c.model,c.dimensions,p.content_hash,c.vector,c.tokens,c.updated_at ${joins}
   JOIN source_passage_embedding_cache c ON c.vault_id=p.vault_id AND c.source_id=p.source_id AND c.content_hash=p.content_hash
   WHERE p.vault_id=? AND c.model=? AND c.dimensions=? AND ${eligible}`,vault,embeddingModel,embeddingDimensions);
  // Queue only metadata here: a book's text is loaded one passage at a time by the worker.
  const rows=this.store.all<{id:string;source_id:string;content_hash:string}>(`SELECT p.id,p.source_id,p.content_hash ${joins} LEFT JOIN source_passage_embeddings b ON b.passage_id=p.id AND b.model=? AND b.dimensions=? WHERE p.vault_id=? AND ${eligible} AND NOT (${fresh.replace('b.content_hash=p.content_hash','coalesce(b.content_hash,\'\')=p.content_hash')}) ${source?'AND p.source_id=?':''} ${onlyMissing?'AND b.passage_id IS NULL':''} AND NOT EXISTS (SELECT 1 FROM source_passage_embedding_jobs j WHERE j.passage_id=p.id AND (j.status IN ('queued','running') ${force?'':"OR (j.content_hash=p.content_hash AND j.model=? AND j.dimensions=? AND j.status IN ('failed','interrupted'))"}))`,embeddingModel,embeddingDimensions,vault,embeddingModel,embeddingDimensions,...(source?[source]:[]),...(force?[]:[embeddingModel,embeddingDimensions]));
  for(const row of rows)this.store.run('INSERT INTO source_passage_embedding_jobs (id,vault_id,passage_id,source_id,content_hash,model,dimensions,status,reason,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),vault,row.id,row.source_id,row.content_hash,embeddingModel,embeddingDimensions,'queued',reason,now(),now());
  return rows.length;
  });
 }
 discover(){for(const {id} of this.store.all<{id:string}>('SELECT id FROM vaults WHERE locked=0'))if(this.settings(id).automatic)this.enqueue(id,'save');}
 invalidate(vault:string,source:string){this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Source is no longer available.' WHERE vault_id=? AND source_id=? AND status IN ('queued','running')",now(),vault,source);this.store.run('DELETE FROM source_passage_embeddings WHERE passage_id IN (SELECT id FROM source_passages WHERE vault_id=? AND source_id=?)',vault,source);}
 retry(vault:string,id:string):{queued:number}|undefined {
  const job=this.store.get<Job>('SELECT * FROM source_passage_embedding_jobs WHERE id=? AND vault_id=?',id,vault);if(!job)return;
  if(!['failed','interrupted','skipped'].includes(job.status))throw new HttpError(409,'Only failed, interrupted, or skipped jobs can be retried.');
  const row=this.store.get<{content_hash:string}>(`SELECT p.content_hash ${joins} WHERE p.id=? AND p.vault_id=? AND ${eligible}`,job.passage_id,vault);
  if(!row||this.store.get("SELECT 1 FROM source_passage_embedding_jobs WHERE passage_id=? AND status IN ('queued','running')",job.passage_id))return {queued:0};
  this.store.run('INSERT INTO source_passage_embedding_jobs (id,vault_id,passage_id,source_id,content_hash,model,dimensions,status,reason,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),vault,job.passage_id,job.source_id,row.content_hash,embeddingModel,embeddingDimensions,'queued','retry',now(),now());return {queued:1};
 }
 private finish(id:string,status:string,error:string|null=null){this.store.run("UPDATE source_passage_embedding_jobs SET status=?,finished_at=?,error=? WHERE id=? AND status='running'",status,now(),error,id);}
 private passage(job:Job){return this.store.get<SourcePassage>(`SELECT p.* ${joins} WHERE p.id=? AND p.vault_id=? AND ${eligible}`,job.passage_id,job.vault_id);}
 async tick():Promise<boolean> {
  const job=this.store.get<Job>(`SELECT j.* FROM source_passage_embedding_jobs j JOIN vaults v ON v.id=j.vault_id WHERE j.status='queued' AND j.next_attempt_at<=? AND v.locked=0 ORDER BY j.next_attempt_at,j.created_at LIMIT 1`,now());
  if(!job)return false;
  this.store.run("UPDATE source_passage_embedding_jobs SET status='running',attempts=attempts+1,started_at=?,finished_at=NULL,error=NULL WHERE id=? AND status='queued'",now(),job.id);
  let activityId:string|undefined;
  try {
   const passage=this.passage(job);
   if(!passage||passage.content_hash!==job.content_hash||job.model!==embeddingModel||job.dimensions!==embeddingDimensions){this.finish(job.id,'skipped','Passage changed or is unavailable.');return true;}
   if(this.store.get(`SELECT 1 FROM source_passage_embeddings WHERE passage_id=? AND content_hash=? AND model=? AND dimensions=?`,passage.id,passage.content_hash,embeddingModel,embeddingDimensions)){this.finish(job.id,'skipped','Passage is already indexed.');return true;}
   let heading='',headingBytes=0;
   for(const point of passage.heading??''){const bytes=Buffer.byteLength(point,'utf8');if(headingBytes+bytes>Math.min(1000,embeddingMaxBytes-Buffer.byteLength(passage.text,'utf8')-2))break;heading+=point;headingBytes+=bytes;}
   const input=heading?`${heading}\n\n${passage.text}`:passage.text;
   if(Buffer.byteLength(input,'utf8')>embeddingMaxBytes)throw new HttpError(400,'Passage exceeds embedding input limit.');
   activityId=this.activity?.start('note_embedding',{model:embeddingModel,reasoningEffort:'none'},job.vault_id,job.source_id,'entity');if(activityId)this.activityIds.add(activityId);
   const result=await this.intelligence.embed(input,bytes=>activityId?this.activity?.request(activityId,bytes,null):undefined,true);
   if(this.closed)return true;
   this.vaults.requireOpen(job.vault_id);
   this.synchronize?.(job.vault_id);
   const current=this.passage(job);
   if(!current||current.content_hash!==job.content_hash||this.store.get<Job>('SELECT status FROM source_passage_embedding_jobs WHERE id=?',job.id)?.status!=='running'){this.finish(job.id,'skipped','Passage changed or indexing was cancelled.');this.endActivity(activityId,'skipped',409);return true;}
   if(result.embedding.length!==embeddingDimensions||result.embedding.some(n=>!Number.isFinite(n))||!result.embedding.some(n=>n!==0))throw new HttpError(502,'Invalid embedding response.');
   this.store.transaction(()=>{this.store.run(`INSERT INTO source_passage_embedding_cache (vault_id,source_id,content_hash,model,dimensions,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(vault_id,source_id,content_hash,model,dimensions) DO UPDATE SET vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,job.vault_id,job.source_id,passage.content_hash,embeddingModel,embeddingDimensions,JSON.stringify(result.embedding),result.tokens,now());this.store.run(`INSERT INTO source_passage_embeddings (passage_id,model,dimensions,content_hash,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(passage_id,model,dimensions) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,passage.id,embeddingModel,embeddingDimensions,passage.content_hash,JSON.stringify(result.embedding),result.tokens,now());this.store.run("UPDATE source_passage_embedding_jobs SET status='completed',finished_at=?,tokens=? WHERE id=?",now(),result.tokens,job.id);});
   this.endActivity(activityId,'completed',200);
  }catch(error){
   if(this.closed)return true;
   const code=error instanceof HttpError?error.status:502;this.endActivity(activityId,code===404||code===423?'skipped':'failed',code);
   if(code===423){this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',next_attempt_at=?,error='Waiting for vault to unlock.' WHERE id=? AND status='running'",now(),job.id);}
   else if((code===429||code>=500)&&job.attempts+1<3)this.store.run("UPDATE source_passage_embedding_jobs SET status='queued',next_attempt_at=?,error='Embedding service unavailable. Automatic retry scheduled.' WHERE id=? AND status='running'",new Date(Date.now()+30000*2**job.attempts).toISOString(),job.id);
   else this.finish(job.id,code===404?'skipped':'failed','Passage embedding request failed. Check Intelligence settings and retry.');
  }
  return true;
 }
 private endActivity(id:string|undefined,status:'completed'|'failed'|'skipped',code:number){if(id&&this.activityIds.delete(id))this.activity?.finish(id,status,code);}
 hasSearchable(vault:string){return !!this.store.get(`SELECT 1 ${joins} JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.vault_id=? AND ${eligible} AND ${fresh} LIMIT 1`,vault,embeddingModel,embeddingDimensions);}
 search(vault:string,query:string,queryVector:number[],queryMagnitude:number):SemanticSearchResult[]{
  const rows=this.store.all<SourcePassage & {vector:string;name:string;updated_at:string}>(`SELECT p.*,b.vector,e.name,e.updated_at ${joins} JOIN source_passage_embeddings b ON b.passage_id=p.id WHERE p.vault_id=? AND ${eligible} AND ${fresh}`,vault,embeddingModel,embeddingDimensions);
  const results:SemanticSearchResult[]=[];
  for(const row of rows){let vector:number[];try{vector=JSON.parse(row.vector) as number[];}catch{continue;}if(!Array.isArray(vector)||vector.length!==embeddingDimensions||vector.some(n=>!Number.isFinite(n)))continue;const norm=Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0));if(!norm)continue;const score=vector.reduce((sum,n,i)=>sum+n*queryVector[i],0)/(norm*queryMagnitude);if(Number.isFinite(score))results.push({id:row.source_id,kind:'entity',passageId:row.id,title:row.name,snippet:makeSearchSnippet(row.text,query),score:Math.max(-1,Math.min(1,score)),updated_at:row.updated_at,reference:passageReference(row)});}
  return results;
 }
}
