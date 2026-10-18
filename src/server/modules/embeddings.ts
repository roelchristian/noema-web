import {PageSegments,pageIndexPolicy} from './page-segments.js';
import {PageSegmentIndex} from './page-segment-index.js';
import {defaultPageIndexPolicy,isPageIndexPolicy,type PageIndexPolicy} from '../../shared/embeddings.js';
import {TextSearch} from './text-search.js';
import type {PassageRetrievalResult} from '../../shared/passage-retrieval.js';
import {SourcePassageEmbeddings} from './source-passage-embeddings.js';
import {SourcePassages} from './source-passages.js';
import {AIActivityLog} from './ai-activity.js';
import type {AIActivity} from '../../shared/intelligence.js';
import {randomUUID} from 'node:crypto';
import {embeddingModel, embeddingDimensions, embeddingMaxBytes, type EmbeddingSettings, type EmbeddingStatus, type EmbeddingJob, type EmbeddingNote, type SemanticSearchResults} from '../../shared/embeddings.js';
import {Store} from '../store.js';
import {HttpError, now} from '../validation.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {Vaults} from './vaults.js';
import {Intelligence} from './intelligence.js';
interface JobRow {id: string; vault_id: string; page_id: string | null; source_id: string | null; content_hash: string; status: string; attempts: number; segment_id:string|null;model:string|null;dimensions:number|null}
export class Embeddings {
 private pageSegments:PageSegments;
 private pageIndex:PageSegmentIndex;
 private busy=false;
 private closed=false;
 private sourceTurn=false;
 private nextSourceDiscovery=0;
 private sourcePassages:SourcePassages;
 private sourceEmbeddings:SourcePassageEmbeddings;
 private activeActivity=new Set<string>();
 constructor(private store: Store, private pages: Pages, private knowledge: Knowledge, private vaults: Vaults, private intelligence: Intelligence, private activity?: AIActivityLog) {
  this.pageSegments=new PageSegments(store);
  this.pageIndex=new PageSegmentIndex(store);
  this.sourcePassages=new SourcePassages(store);
  this.sourceEmbeddings=new SourcePassageEmbeddings(store,vaults,intelligence,vault=>this.settings(vault),activity,vault=>this.sourcePassages.synchronize(vault));
  this.store.transaction(()=>{
   const interrupted=this.store.all<JobRow & {reason:string}>("SELECT * FROM embedding_jobs WHERE status='running'");
   this.store.run("UPDATE embedding_jobs SET status='interrupted',finished_at=?,error='Server stopped during this attempt.' WHERE status='running'",now());
   for(const job of interrupted) {
    if((!job.page_id&&!job.source_id)||job.attempts>=3||(job.reason==='save'&&!this.settings(job.vault_id).automatic))continue;
    // Retain the interrupted attempt in history while its replacement waits for
    // an unlocked vault. The worker rechecks current content before any API call.
    this.store.run("INSERT OR IGNORE INTO embedding_jobs (id,vault_id,page_id,source_id,segment_id,content_hash,status,reason,attempts,created_at,next_attempt_at,model,dimensions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",randomUUID(),job.vault_id,job.page_id,job.source_id,job.segment_id,job.content_hash,'queued',job.reason,job.attempts,now(),now(),job.model,job.dimensions);
   }
  });
 }
 close() {
  this.closed=true;
  this.pageIndex.close();
  this.sourceEmbeddings.close();
  for(const id of this.activeActivity)this.finishActivity(id,'interrupted',null);
 }
 private startActivity(action: 'note_embedding' | 'search_embedding',vault: string,target?: {id:string;kind:'page'|'entity'}) {
  const id=this.activity?.start(action,{model:embeddingModel,reasoningEffort:'none'},vault,target?.id,target?.kind ?? 'page');
  if(id)this.activeActivity.add(id);
  return id;
 }
 private finishActivity(id: string | undefined,status: Exclude<AIActivity['status'],'running'>,code: number | null) {
  if(id&&this.activeActivity.delete(id))this.activity?.finish(id,status,code);
 }
 private settings(vault: string): EmbeddingSettings {
  const row=this.store.get<{automatic:number;min_characters:number}>('SELECT automatic,min_characters FROM embedding_settings WHERE vault_id=?',vault);
  return {automatic:row?!!row.automatic:true,minCharacters:row?.min_characters ?? 20,pagePolicy:pageIndexPolicy(this.store,vault)};
 }
 saveSettings(vault: string, body: Record<string,unknown>) {
  this.vaults.requireOpen(vault);
  const current=this.settings(vault),automatic=body.automatic ?? current.automatic,min=body.minCharacters ?? current.minCharacters;
  if(typeof automatic!=='boolean'||typeof min!=='number'||!Number.isInteger(min)||min<20||min>2000)throw new HttpError(400,'Choose automatic indexing and a minimum length between 20 and 2000 characters.');
  if(body.pagePolicy!==undefined&&(!body.pagePolicy||typeof body.pagePolicy!=='object'||Array.isArray(body.pagePolicy)||Object.keys(body.pagePolicy).some(key=>!(key in defaultPageIndexPolicy))))throw new HttpError(400,'Choose a valid Page indexing policy.');
  const policy={...defaultPageIndexPolicy,...current.pagePolicy,...(body.pagePolicy as Partial<PageIndexPolicy>|undefined)};
  if(!isPageIndexPolicy(policy))throw new HttpError(400,'Choose valid Page token thresholds, overlap below half the passage size, and a debounce of 5–15 seconds.');
  this.store.run('INSERT INTO embedding_settings (vault_id,automatic,min_characters,page_policy) VALUES (?,?,?,?) ON CONFLICT(vault_id) DO UPDATE SET automatic=excluded.automatic,min_characters=excluded.min_characters,page_policy=excluded.page_policy',vault,automatic?1:0,min,JSON.stringify(policy));
  if(JSON.stringify(policy)!==JSON.stringify(current.pagePolicy)) {
   this.store.run('INSERT OR REPLACE INTO page_index_dirty(page_id,vault_id) SELECT id,vault_id FROM pages WHERE vault_id=? AND deleted_at IS NULL',vault);
   this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Page indexing policy changed.' WHERE vault_id=? AND status IN ('queued','running')",now(),vault);
  }
  if(!automatic)this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Automatic indexing disabled.' WHERE vault_id=? AND reason='save' AND status IN ('queued','running')",now(),vault);
  if(!automatic)this.sourceEmbeddings.disable(vault);
  return this.status(vault);
 }
 status(vault: string): EmbeddingStatus {
  this.vaults.requireOpen(vault);
  this.sourcePassages.synchronize(vault);
  this.pageSegments.synchronize(vault);
  const notes: EmbeddingNote[]=[...this.pageIndex.notes(vault),...this.sourceEmbeddings.notes(vault)];
  const counts={eligible:notes.filter(n=>n.eligible).length,indexed:0,missing:0,stale:0,ineligible:0,partial:0,queued:0,running:0,failed:0};
  for(const note of notes)counts[note.state]++;
  for(const row of this.store.all<{status:string;n:number}>('SELECT status,count(*) AS n FROM embedding_jobs WHERE vault_id=? GROUP BY status',vault))if(row.status==='queued'||row.status==='running'||row.status==='failed')counts[row.status]+=row.n;
  for(const row of this.sourceEmbeddings.counts(vault))if(row.status==='queued'||row.status==='running'||row.status==='failed')counts[row.status]+=row.n;
  const jobs=this.store.all<EmbeddingJob>(`SELECT j.id,j.page_id AS pageId,j.segment_id AS segmentId,j.source_id AS sourceId,coalesce(p.title,e.name,'Unavailable content') AS title,j.status,j.reason,j.attempts,j.created_at AS createdAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.next_attempt_at AS nextAttemptAt,j.error,j.tokens FROM embedding_jobs j LEFT JOIN pages p ON p.id=j.page_id AND p.deleted_at IS NULL LEFT JOIN entities e ON e.id=j.source_id WHERE j.vault_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,vault);
  return {settings:this.settings(vault),model:embeddingModel,dimensions:embeddingDimensions,maxBytes:embeddingMaxBytes,configured:this.intelligence.status().configured,counts,jobs:[...jobs,...this.sourceEmbeddings.jobs(vault)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,100),notes};
 }
 enqueueExisting(vault: string,body: Record<string,unknown>) {
  this.vaults.requireOpen(vault);
  if(body.mode!=='missing'&&body.mode!=='eligible')throw new HttpError(400,'Choose missing or eligible notes.');
  this.sourcePassages.synchronize(vault);
  this.pageSegments.synchronize(vault);
  const queued=this.sourceEmbeddings.enqueue(vault,'backfill',undefined,body.mode==='missing',true)+this.pageIndex.enqueue(vault,undefined,'backfill',0,true),skipped=0;
  return {queued,skipped};
 }
 onSave(vault:string,id:string) {
  // Indexing failures cannot turn a successful Page save into an API failure.
  try {this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Page changed before indexing completed.' WHERE page_id=? AND status IN ('queued','running')",now(),id);}catch{/* Durable Page triggers retain indexing work. */}
 }
 invalidate(vault:string,id:string) {
  this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Page unavailable.' WHERE vault_id=? AND page_id=? AND status IN ('queued','running')",now(),vault,id);
  this.store.run('DELETE FROM page_segments WHERE page_id=? AND vault_id=?',id,vault);
  this.store.run('DELETE FROM page_segment_cache WHERE page_id=?',id);
  this.store.run('DELETE FROM note_embeddings WHERE page_id=?',id);
 }
 onSourceSave(vault:string,id:string) {
  this.vaults.requireOpen(vault);
  this.sourcePassages.synchronize(vault);
  if(this.settings(vault).automatic)this.sourceEmbeddings.enqueue(vault,'save',id);
 }
 invalidateSource(vault:string,id:string) {this.sourceEmbeddings.invalidate(vault,id);}
 private discoverSources() {
  this.sourcePassages.tick();
  this.pageSegments.tick();
  if(Date.now()<this.nextSourceDiscovery)return;
  this.nextSourceDiscovery=Date.now()+5000;
  this.sourceEmbeddings.discover();
  for(const row of this.store.all<{id:string}>('SELECT id FROM vaults WHERE locked=0'))if(this.settings(row.id).automatic)this.pageIndex.enqueue(row.id,undefined,'save',pageIndexPolicy(this.store,row.id).debounceMs);
 }
 retry(vault: string,id: string) {
  this.vaults.requireOpen(vault);
  this.sourcePassages.synchronize(vault);
  const passageRetry=this.sourceEmbeddings.retry(vault,id);
  if(passageRetry)return passageRetry;
  const job=this.store.get<JobRow>('SELECT * FROM embedding_jobs WHERE id=? AND vault_id=?',id,vault);
  if(!job||(!job.page_id&&!job.source_id))throw new HttpError(404,'Job or note is unavailable.');
  if(!['failed','interrupted','skipped'].includes(job.status))throw new HttpError(409,'Only failed, interrupted, or skipped jobs can be retried.');
  if(job.source_id)return {queued:this.sourceEmbeddings.enqueue(vault,'retry',job.source_id,false,true)};
  this.pageSegments.synchronize(vault);
  return {queued:this.pageIndex.enqueue(vault,job.page_id!,'retry',0,true)};
 }
 private finish(id: string,status: string,error: string | null=null) {this.store.run("UPDATE embedding_jobs SET status=?,finished_at=?,error=? WHERE id=? AND status='running'",status,now(),error,id);}
 async tick() {
  if(this.busy||this.closed)return;
  this.busy=true;
  try {
   this.discoverSources();
   if(!this.intelligence.status().configured)return;
   if(this.sourceTurn){this.sourceTurn=false;if(await this.sourceEmbeddings.tick())return;}
   const job=this.store.get<JobRow>(`SELECT j.* FROM embedding_jobs j JOIN vaults v ON v.id=j.vault_id WHERE j.status='queued' AND j.next_attempt_at<=? AND v.locked=0 ORDER BY j.next_attempt_at,j.created_at LIMIT 1`,now());
   if(!job){await this.sourceEmbeddings.tick();return;}
   this.sourceTurn=true;
   this.store.run("UPDATE embedding_jobs SET status='running',attempts=attempts+1,started_at=?,finished_at=NULL,error=NULL WHERE id=? AND status='queued'",now(),job.id);
   let activityId: string | undefined;
   try {
    this.vaults.requireOpen(job.vault_id);
    if(!job.page_id&&!job.source_id){this.finish(job.id,'skipped','Content is unavailable.');return;}
    if(!job.segment_id){this.finish(job.id,'skipped','Replaced by adaptive Page segments.');this.pageSegments.synchronize(job.vault_id);this.pageIndex.enqueue(job.vault_id,job.page_id??undefined,'retry');return;}
    const segment=this.pageIndex.get(job.vault_id,job.segment_id);
    if(!segment||segment.content_hash!==job.content_hash||job.model!==embeddingModel||job.dimensions!==embeddingDimensions||this.pageIndex.fresh(segment)){this.finish(job.id,'skipped','Page segment changed, is ineligible, or already indexed.');return;}
    activityId=this.startActivity('note_embedding',job.vault_id,{id:segment.page_id,kind:'page'});
    const result=await this.intelligence.embed(segment.input,bytes=>activityId?this.activity?.request(activityId,bytes,segment.revision):undefined,true);
    if(this.closed)return;
    this.vaults.requireOpen(job.vault_id);
    this.pageSegments.synchronize(job.vault_id);
    const persisted=this.store.transaction(()=>{
     const current=this.pageIndex.get(job.vault_id,segment.id);
     if(!current||current.revision!==segment.revision||current.content_hash!==segment.content_hash||this.store.get<JobRow>('SELECT status FROM embedding_jobs WHERE id=?',job.id)?.status!=='running'){this.finish(job.id,'skipped','Page changed or indexing was cancelled.');return false;}
     if(result.embedding.length!==embeddingDimensions||result.embedding.some(n=>!Number.isFinite(n))||!result.embedding.some(n=>n!==0))throw new HttpError(502,'Invalid embedding response.');
     this.pageIndex.save(current,result.embedding,result.tokens);
     this.store.run("UPDATE embedding_jobs SET status='completed',finished_at=?,tokens=? WHERE id=?",now(),result.tokens,job.id);
     return true;
    });
    this.finishActivity(activityId,persisted?'completed':'skipped',persisted?200:409);
   }catch(error) {
    if(this.closed)return;
    const code=error instanceof HttpError?error.status:502;
    this.finishActivity(activityId,code===404||code===423?'skipped':'failed',code);
    if(code===423){this.store.run("UPDATE embedding_jobs SET status='queued',next_attempt_at=?,error='Waiting for vault to unlock.' WHERE id=? AND status='running'",now(),job.id);return;}
    if(code===404){this.finish(job.id,'skipped','Page is unavailable.');return;}
    const retryable=code===429||code>=500,attempts=job.attempts+1;
    if(retryable&&attempts<3)this.store.run("UPDATE embedding_jobs SET status='queued',next_attempt_at=?,error='Embedding service unavailable. Automatic retry scheduled.' WHERE id=? AND status='running'",new Date(Date.now()+30000*2**(attempts-1)).toISOString(),job.id);
    else this.finish(job.id,'failed',code===409?'Configure an OpenAI key in Intelligence settings.':'Embedding request failed. Check Intelligence settings and retry.');
   }
  }finally{this.busy=false;}
 }
 /** Internal hybrid evidence API. Unlike navigation search this preserves
  * multiple passages from one source, using equal-weight RRF (k=60). */
 async retrievePassages(vault:string,body:Record<string,unknown>):Promise<{results:PassageRetrievalResult[];model:string}> {
  this.vaults.requireOpen(vault);
  if(typeof body.query!=='string'||!body.query.trim()||body.query.length>2000||Buffer.byteLength(body.query,'utf8')>embeddingMaxBytes)throw new HttpError(400,'Enter a search query up to 2,000 characters and 8,000 bytes.');
  const limit=body.limit??20;
  if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Choose a result limit between 1 and 100.');
  const candidateLimit=Math.min(1000,Math.max(100,limit*5));
  this.pageSegments.synchronize(vault);
  const lexical=new TextSearch(this.store,this.vaults,this.sourcePassages).searchPassages(vault,body.query,candidateLimit);
  const semantic:ReturnType<SourcePassageEmbeddings['search']>=[];
  // Lexical evidence remains available when embeddings are not configured.
  if(this.intelligence.status().configured&&(this.sourceEmbeddings.hasSearchable(vault)||this.pageIndex.hasSearchable(vault))) {
   const activityId=this.startActivity('search_embedding',vault);
   try {
    const embedded=await this.intelligence.embed(body.query.trim(),bytes=>activityId?this.activity?.request(activityId,bytes,null):undefined,false);
    if(this.closed)throw new HttpError(503,'Search stopped.');
    this.vaults.requireOpen(vault);
    const magnitude=Math.sqrt(embedded.embedding.reduce((sum,n)=>sum+n*n,0));
    if(embedded.embedding.length!==embeddingDimensions||embedded.embedding.some(n=>!Number.isFinite(n))||!magnitude||!Number.isFinite(magnitude))throw new HttpError(502,'Invalid embedding response.');
    semantic.push(...[...this.sourceEmbeddings.search(vault,body.query,embedded.embedding,magnitude),...this.pageIndex.search(vault,body.query,embedded.embedding)].sort((a,b)=>b.score-a.score||(a.passageId??'').localeCompare(b.passageId??'')).slice(0,candidateLimit));
    this.finishActivity(activityId,'completed',200);
   }catch(error){this.finishActivity(activityId,'failed',error instanceof HttpError?error.status:502);throw error;}
  }
  const fused=new Map<string,PassageRetrievalResult>();
  for(const [kind,rows] of [['lexicalRank',lexical],['semanticRank',semantic]] as const)rows.forEach((row,index)=>{
   if(!row.passageId)return;
   const current=fused.get(row.passageId)??{...row,passageId:row.passageId,score:0};
   if(current[kind]!==undefined)return;
   current[kind]=index+1;current.score+=1/(60+index+1);fused.set(row.passageId,current);
  });
  return {results:[...fused.values()].sort((a,b)=>b.score-a.score||a.passageId.localeCompare(b.passageId)).slice(0,limit),model:embeddingModel};
 }
 async search(vault: string,body: Record<string,unknown>): Promise<SemanticSearchResults> {
  this.vaults.requireOpen(vault);
  if(typeof body.query!=='string'||!body.query.trim()||Buffer.byteLength(body.query,'utf8')>embeddingMaxBytes)throw new HttpError(400,'Enter a search query up to 8,000 bytes.');
  const limit=body.limit ?? 20;
  if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Choose a result limit between 1 and 100.');
  this.sourcePassages.synchronize(vault);
  this.pageSegments.synchronize(vault);
  const searchable=this.sourceEmbeddings.hasSearchable(vault)||this.pageIndex.hasSearchable(vault);
  if(!searchable)return {results:[],model:embeddingModel};
  const activityId=this.startActivity('search_embedding',vault);
  try {
   const result=await this.intelligence.embed(body.query.trim(),bytes=>activityId?this.activity?.request(activityId,bytes,null):undefined,false);
   if(this.closed)throw new HttpError(503,'Search stopped.');
   this.vaults.requireOpen(vault);
   const magnitude=(v: number[])=>Math.sqrt(v.reduce((sum,n)=>sum+n*n,0));
   const qMagnitude=magnitude(result.embedding);
   if(result.embedding.length!==embeddingDimensions||!qMagnitude||!Number.isFinite(qMagnitude))throw new HttpError(502,'Invalid embedding response.');
   const results=this.sourceEmbeddings.search(vault,body.query,result.embedding,qMagnitude);
   this.pageSegments.synchronize(vault);
   results.push(...this.pageIndex.search(vault,body.query,result.embedding));
   this.finishActivity(activityId,'completed',200);
   const seen=new Set<string>();
   const ranked=results.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
   return {results:ranked.filter(row=>{const key=`${row.kind??'page'}:${row.id}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit),model:embeddingModel};
  } catch(error) {
   this.finishActivity(activityId,'failed',error instanceof HttpError?error.status:502);
   throw error;
  }
 }
}
