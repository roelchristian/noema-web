import {OpenAIResponseSizeError} from './openai-response.js';
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
import {Intelligence,EmbeddingAdmissionError,embeddingBatchMaxInputs,embeddingBatchMaxBytes} from './intelligence.js';
import type {PageSegment} from './page-segments.js';
interface JobRow {batch_max_inputs:number;id: string; vault_id: string; page_id: string | null; source_id: string | null; content_hash: string; status: string; attempts: number; segment_id:string|null;model:string|null;dimensions:number|null}
type SuggestionResults={sources:import('../../shared/embeddings.js').SuggestedSource[];notes:import('../../shared/embeddings.js').RelatedNote[]};
export class Embeddings {
 private suggestionCache=new Map<string,{version:string;results:Partial<SuggestionResults>}>();
 private queryVectors=new Map<string,{vault:string;expiresAt:number;work:Promise<{embedding:number[];tokens:number}>}>();
 private pageSegments:PageSegments;
 private pageIndex:PageSegmentIndex;
 private busy=false;
 private closed=false;
 private sourceTurn=false;
 private lastPageKey='';
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
    this.store.run("INSERT OR IGNORE INTO embedding_jobs (id,vault_id,page_id,source_id,segment_id,content_hash,status,reason,attempts,created_at,next_attempt_at,model,dimensions,batch_max_inputs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",randomUUID(),job.vault_id,job.page_id,job.source_id,job.segment_id,job.content_hash,'queued',job.reason,job.attempts,now(),now(),job.model,job.dimensions,job.batch_max_inputs);
   }
  });
 }
 close() {
  this.closed=true;
  this.suggestionCache.clear();
  this.clearQueryCache();
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
 clearQueryCache(vault?:string) {
  for(const key of this.suggestionCache.keys())if(vault===undefined||JSON.parse(key)[0]===vault)this.suggestionCache.delete(key);
  for(const [key,entry] of this.queryVectors)if(vault===undefined||entry.vault===vault)this.queryVectors.delete(key);
 }
 /** Cache vectors, never result lists: current indexes are searched on every call. */
 private async queryEmbedding(vault:string,query:string) {
  this.vaults.requireOpen(vault);
  if(this.closed)throw new HttpError(503,'Search stopped.');
  if(!this.intelligence.status().configured)throw new HttpError(409,'Add an API key in Settings → Intelligence. It may have expired.');
  const key=JSON.stringify([vault,embeddingModel,embeddingDimensions,query.trim()]),time=Date.now();
  for(const [key,entry] of this.queryVectors)if(entry.expiresAt<=time)this.queryVectors.delete(key);
  let entry=this.queryVectors.get(key);
  if(entry){this.queryVectors.delete(key);this.queryVectors.set(key,entry);}
  else {
   const work=this.generateQueryEmbedding(vault,query.trim());
   entry={vault,expiresAt:time+5*60_000,work};
   this.queryVectors.set(key,entry);
   while(this.queryVectors.size>128)this.queryVectors.delete(this.queryVectors.keys().next().value!);
   void work.catch(()=>{if(this.queryVectors.get(key)?.work===work)this.queryVectors.delete(key);});
  }
  const result=await entry.work;
  if(this.closed)throw new HttpError(503,'Search stopped.');
  this.vaults.requireOpen(vault);
  return result;
 }
 private async generateQueryEmbedding(vault:string,query:string) {
  const activityId=this.startActivity('search_embedding',vault);
  try {
   const result=await this.intelligence.embed(query,bytes=>activityId?this.activity?.request(activityId,bytes,null):undefined,false);
   if(this.closed)throw new HttpError(503,'Search stopped.');
   this.vaults.requireOpen(vault);
   const magnitude=Math.sqrt(result.embedding.reduce((sum,n)=>sum+n*n,0));
   if(result.embedding.length!==embeddingDimensions||result.embedding.some(n=>!Number.isFinite(n))||!magnitude||!Number.isFinite(magnitude))throw new HttpError(502,'Invalid embedding response.');
   this.finishActivity(activityId,'completed',200);
   return result;
  }catch(error){this.finishActivity(activityId,'failed',error instanceof HttpError?error.status:502);throw error;}
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
  // Keep in-flight work until its exact segment hash can be checked after saving.
  try {this.store.run('INSERT OR IGNORE INTO page_index_dirty(page_id,vault_id) SELECT id,vault_id FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,vault);}catch{/* Durable Page triggers retain indexing work. */}
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
   const groups=this.store.all<{vault_id:string;page_id:string|null}>(`SELECT DISTINCT j.vault_id,j.page_id FROM embedding_jobs j JOIN vaults v ON v.id=j.vault_id WHERE j.status='queued' AND j.next_attempt_at<=? AND v.locked=0 ORDER BY j.vault_id,j.page_id`,now());
   const key=(group:{vault_id:string;page_id:string|null})=>JSON.stringify([group.vault_id,group.page_id]);
   const group=groups.find(row=>key(row)>this.lastPageKey)??groups[0];
   if(!group){await this.sourceEmbeddings.tick();return;}
   this.lastPageKey=key(group);
   this.sourceTurn=true;
   await this.embedPageBatch(this.store.all<JobRow>(`SELECT * FROM embedding_jobs WHERE vault_id=? AND page_id IS ? AND status='queued' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,rowid LIMIT ?`,group.vault_id,group.page_id,now(),embeddingBatchMaxInputs));
  }finally{this.busy=false;}
 }
 private async embedPageBatch(jobs:JobRow[]) {
  const batch:{job:JobRow;segment:PageSegment}[]=[];
  let maxInputs=embeddingBatchMaxInputs;
  let bytes=0,activityId:string|undefined,admitted=false;
  for(const job of jobs) {
   maxInputs=Math.min(maxInputs,job.batch_max_inputs);
   if(batch.length>=maxInputs)break;
   const segment=job.segment_id?this.pageIndex.get(job.vault_id,job.segment_id):undefined;
   if(segment&&bytes+Buffer.byteLength(segment.input,'utf8')>embeddingBatchMaxBytes)break;
   this.store.run("UPDATE embedding_jobs SET status='running',started_at=?,finished_at=NULL,error=NULL WHERE id=? AND status='queued'",now(),job.id);
   if(!job.segment_id){this.finish(job.id,'skipped','Replaced by adaptive Page segments.');this.pageSegments.synchronize(job.vault_id);this.pageIndex.enqueue(job.vault_id,job.page_id??undefined,'retry');continue;}
   if(!segment||segment.content_hash!==job.content_hash||job.model!==embeddingModel||job.dimensions!==embeddingDimensions||this.pageIndex.fresh(segment)){this.finish(job.id,'skipped','Page segment changed, is ineligible, or already indexed.');continue;}
   batch.push({job,segment});bytes+=Buffer.byteLength(segment.input,'utf8');
  }
  if(!batch.length)return;
  const vault=batch[0]!.job.vault_id;
  try {
   this.vaults.requireOpen(vault);
   const result=await this.intelligence.embedBatch(batch.map(({segment})=>segment.input),requestBytes=>{
    admitted=true;
    this.store.transaction(()=>{for(const {job} of batch)this.store.run("UPDATE embedding_jobs SET attempts=attempts+1 WHERE id=? AND status='running'",job.id);});
    activityId=this.startActivity('note_embedding',vault,{id:batch[0]!.segment.page_id,kind:'page'});
    return activityId?this.activity?.request(activityId,requestBytes,null):undefined;
   },true);
   if(this.closed)return;
   this.vaults.requireOpen(vault);
   this.pageSegments.synchronize(vault);
   if(result.embeddings.length!==batch.length||result.embeddings.some(vector=>vector.length!==embeddingDimensions||vector.some(n=>!Number.isFinite(n))||!vector.some(n=>n!==0)))throw new HttpError(502,'Invalid embedding response.');
   let persisted=0;
   this.store.transaction(()=>{
    batch.forEach(({job,segment},index)=>{
     const current=this.pageIndex.get(vault,segment.id);
     if(!current||current.content_hash!==segment.content_hash||this.store.get<JobRow>('SELECT status FROM embedding_jobs WHERE id=?',job.id)?.status!=='running'){this.finish(job.id,'skipped','Page changed or indexing was cancelled.');return;}
     // Provider usage is request-wide; distribute it once across the batch.
     const tokens=Math.floor(result.tokens/batch.length)+(index<result.tokens%batch.length?1:0);
     this.pageIndex.save(current,result.embeddings[index]!,tokens);
     this.store.run("UPDATE embedding_jobs SET status='completed',finished_at=?,tokens=? WHERE id=?",now(),tokens,job.id);persisted++;
    });
   });
   this.finishActivity(activityId,persisted?'completed':'skipped',persisted?200:409);
  }catch(error) {
   if(this.closed)return;
   const code=error instanceof HttpError?error.status:502;
   this.finishActivity(activityId,code===404||code===423?'skipped':'failed',code);
   for(const {job} of batch) {
    // Shrinking is bounded by the singleton case and survives worker restarts.
    if(error instanceof OpenAIResponseSizeError&&batch.length>1) {
     this.store.run("UPDATE embedding_jobs SET status='queued',started_at=NULL,next_attempt_at=?,batch_max_inputs=?,error='Response size limit reached. Retrying a smaller batch.' WHERE id=? AND status='running'",now(),Math.ceil(batch.length/2),job.id);continue;
    }
    if(error instanceof EmbeddingAdmissionError) {
     this.store.run("UPDATE embedding_jobs SET status='queued',started_at=NULL,next_attempt_at=?,error='Waiting for embedding capacity.' WHERE id=? AND status='running'",new Date(Date.now()+error.retryAfterMs).toISOString(),job.id);continue;
    }
    if(code===423){this.store.run("UPDATE embedding_jobs SET status='queued',next_attempt_at=?,error='Waiting for vault to unlock.' WHERE id=? AND status='running'",now(),job.id);continue;}
    if(code===404){this.finish(job.id,'skipped','Page is unavailable.');continue;}
    const attempts=job.attempts+(admitted?1:0);
    if((code===429||code>=500)&&attempts<3)this.store.run("UPDATE embedding_jobs SET status='queued',next_attempt_at=?,error='Embedding service unavailable. Automatic retry scheduled.' WHERE id=? AND status='running'",new Date(Date.now()+30000*2**Math.max(0,attempts-1)).toISOString(),job.id);
    else this.finish(job.id,'failed',code===409?'Configure an OpenAI key in Intelligence settings.':'Embedding request failed. Check Intelligence settings and retry.');
   }
  }
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
   const embedded=await this.queryEmbedding(vault,body.query);
   const magnitude=Math.sqrt(embedded.embedding.reduce((sum,n)=>sum+n*n,0));
   semantic.push(...[...this.sourceEmbeddings.search(vault,body.query,embedded.embedding,magnitude),...this.pageIndex.search(vault,body.query,embedded.embedding)].sort((a,b)=>b.score-a.score||(a.passageId??'').localeCompare(b.passageId??'')).slice(0,candidateLimit));
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
 /** This check never projects pages, loads vectors, or scores the corpus. */
 suggestionVersion(vault:string,pageId:string):{version:string} {
  this.vaults.requireOpen(vault);
  const page=this.store.get<{revision:number}>('SELECT revision FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',pageId,vault);
  if(!page)throw new HttpError(404,'Page is unavailable.');
  const revision=this.store.get<{version:number}>('SELECT version FROM suggestion_versions WHERE vault_id=?',vault)?.version??0;
  return {version:JSON.stringify([page.revision,revision])};
 }
 private cachedSuggestions<K extends keyof SuggestionResults>(vault:string,pageId:string,kind:K,compute:()=>SuggestionResults[K]):SuggestionResults[K] {
  const {version}=this.suggestionVersion(vault,pageId),key=JSON.stringify([vault,pageId]);
  let entry=this.suggestionCache.get(key);
  if(!entry||entry.version!==version)entry={version,results:{}};
  const result=entry.results[kind]??compute();
  entry.results[kind]=result;
  this.suggestionCache.delete(key);this.suggestionCache.set(key,entry);
  while(this.suggestionCache.size>128)this.suggestionCache.delete(this.suggestionCache.keys().next().value!);
  return result;
 }
 /** Page-to-source retrieval uses existing vectors exclusively, without query embedding. */
 suggestedSources(vault:string,pageId:string):SuggestionResults['sources'] {
  this.vaults.requireOpen(vault);
  this.pageSegments.synchronize(vault,pageId);
  return this.cachedSuggestions(vault,pageId,'sources',()=>{
   const page=this.pages.get(vault,pageId);
   const excluded=new Set([...page.sourceIds,...this.store.all<{source_id:string}>('SELECT source_id FROM page_source_dismissals WHERE page_id=?',pageId).map(row=>row.source_id)]);
   return this.sourceEmbeddings.suggested(vault,this.pageIndex.savedVectors(vault,pageId),excluded);
  });
 }
 /** Rank other notes locally by their strongest matching saved segment pair. */
 relatedNotes(vault:string,pageId:string):SuggestionResults['notes'] {
  this.vaults.requireOpen(vault);
  this.pageSegments.synchronize(vault,pageId);
  return this.rankedRelatedNotes(vault,pageId);
 }
 private rankedRelatedNotes(vault:string,pageId:string) {
  return this.cachedSuggestions(vault,pageId,'notes',()=>this.pageIndex.related(vault,this.pageIndex.savedVectors(vault,pageId),pageId));
 }
 relatedNotesState(vault:string,pageId:string,previous:unknown):import('../../shared/embeddings.js').RelatedNotesState {
  if(!Array.isArray(previous)||previous.length>5||previous.some(id=>typeof id!=='string'||id.length>128))throw new HttpError(400,'Choose up to five previous related notes.');
  this.vaults.requireOpen(vault);
  this.pageSegments.synchronize(vault,pageId);
  const pending=this.pageIndex.pending(vault,pageId);
  // The client retains its list during a gap; do not score partial rankings it
  // cannot display. Initial readers can still receive available partial matches.
  const notes=pending&&previous.length?[]:this.rankedRelatedNotes(vault,pageId);
  return {notes,pending,retainedPageIds:this.pageIndex.retainable(vault,pageId,previous)};
 }
 dismissSource(vault:string,pageId:string,sourceId:unknown) {
  this.pages.requireEditable(vault,pageId);
  if(typeof sourceId!=='string'||this.knowledge.find(vault,sourceId)?.type!=='source')throw new HttpError(400,'Choose a source in this vault.');
  this.store.run('INSERT OR IGNORE INTO page_source_dismissals (page_id,source_id) VALUES (?,?)',pageId,sourceId);
  return {dismissed:true};
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
  const result=await this.queryEmbedding(vault,body.query);
  const magnitude=(v: number[])=>Math.sqrt(v.reduce((sum,n)=>sum+n*n,0));
  const qMagnitude=magnitude(result.embedding);
  const results=this.sourceEmbeddings.search(vault,body.query,result.embedding,qMagnitude);
  this.pageSegments.synchronize(vault);
  results.push(...this.pageIndex.search(vault,body.query,result.embedding));
  const seen=new Set<string>();
  const ranked=results.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {results:ranked.filter(row=>{const key=`${row.kind??'page'}:${row.id}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit),model:embeddingModel};
 }
}
