import {SourcePassageEmbeddings} from './source-passage-embeddings.js';
import {SourcePassages} from './source-passages.js';
import {AIActivityLog} from './ai-activity.js';
import type {AIActivity} from '../../shared/intelligence.js';
import {createHash, randomUUID} from 'node:crypto';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {pageBodyText} from './search-snippets.js';
import {embeddingModel, embeddingDimensions, embeddingMaxBytes, type EmbeddingSettings, type EmbeddingStatus, type EmbeddingJob, type EmbeddingNote, type SemanticSearchResults} from '../../shared/embeddings.js';
import {Store} from '../store.js';
import {HttpError, now} from '../validation.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {Vaults} from './vaults.js';
import {Intelligence} from './intelligence.js';
interface VectorRow {content_hash: string; model: string; dimensions: number; vector: string}
interface JobRow {id: string; vault_id: string; page_id: string | null; source_id: string | null; content_hash: string; status: string; attempts: number}
interface Target {id:string;kind:'page'|'entity';title:string;body:string;updated_at:string;revision:number|null;ready:boolean;summary?:string}
export class Embeddings {
 private busy=false;
 private closed=false;
 private sourceTurn=false;
 private nextSourceDiscovery=0;
 private sourcePassages:SourcePassages;
 private sourceEmbeddings:SourcePassageEmbeddings;
 private activeActivity=new Set<string>();
 constructor(private store: Store, private pages: Pages, private knowledge: Knowledge, private vaults: Vaults, private intelligence: Intelligence, private activity?: AIActivityLog) {
  this.sourcePassages=new SourcePassages(store);
  this.sourceEmbeddings=new SourcePassageEmbeddings(store,vaults,intelligence,vault=>this.settings(vault),activity,vault=>this.sourcePassages.synchronize(vault));
  this.store.transaction(()=>{
   const interrupted=this.store.all<JobRow & {reason:string}>("SELECT * FROM embedding_jobs WHERE status='running'");
   this.store.run("UPDATE embedding_jobs SET status='interrupted',finished_at=?,error='Server stopped during this attempt.' WHERE status='running'",now());
   for(const job of interrupted) {
    if((!job.page_id&&!job.source_id)||job.attempts>=3||(job.reason==='save'&&!this.settings(job.vault_id).automatic))continue;
    // Retain the interrupted attempt in history while its replacement waits for
    // an unlocked vault. The worker rechecks current content before any API call.
    this.store.run("INSERT OR IGNORE INTO embedding_jobs (id,vault_id,page_id,source_id,content_hash,status,reason,attempts,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?)",randomUUID(),job.vault_id,job.page_id,job.source_id,job.content_hash,'queued',job.reason,job.attempts,now(),now());
   }
  });
 }
 close() {
  this.closed=true;
  this.sourceEmbeddings.close();
  for(const id of this.activeActivity)this.finishActivity(id,'interrupted',null);
 }
 private startActivity(action: 'note_embedding' | 'search_embedding',vault: string,target?: Target) {
  const id=this.activity?.start(action,{model:embeddingModel,reasoningEffort:'none'},vault,target?.id,target?.kind ?? 'page');
  if(id)this.activeActivity.add(id);
  return id;
 }
 private finishActivity(id: string | undefined,status: Exclude<AIActivity['status'],'running'>,code: number | null) {
  if(id&&this.activeActivity.delete(id))this.activity?.finish(id,status,code);
 }
 private settings(vault: string): EmbeddingSettings {
  const row=this.store.get<{automatic:number;min_characters:number}>('SELECT automatic,min_characters FROM embedding_settings WHERE vault_id=?',vault);
  return {automatic:row?!!row.automatic:true,minCharacters:row?.min_characters ?? 20};
 }
 saveSettings(vault: string, body: Record<string,unknown>) {
  this.vaults.requireOpen(vault);
  const current=this.settings(vault),automatic=body.automatic ?? current.automatic,min=body.minCharacters ?? current.minCharacters;
  if(typeof automatic!=='boolean'||typeof min!=='number'||!Number.isInteger(min)||min<20||min>2000)throw new HttpError(400,'Choose automatic indexing and a minimum length between 20 and 2000 characters.');
  this.store.run('INSERT INTO embedding_settings (vault_id,automatic,min_characters) VALUES (?,?,?) ON CONFLICT(vault_id) DO UPDATE SET automatic=excluded.automatic,min_characters=excluded.min_characters',vault,automatic?1:0,min);
  if(!automatic)this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Automatic indexing disabled.' WHERE vault_id=? AND reason='save' AND status IN ('queued','running')",now(),vault);
  if(!automatic)this.sourceEmbeddings.disable(vault);
  return this.status(vault);
 }
 private target(vault:string,id:string,kind:'page'|'entity'='page'):Target {
  const page=this.pages.get(vault,id);return {id,kind:'page',title:page.title,body:pageBodyText(vault,page,this.knowledge),updated_at:page.updated_at,revision:page.revision,ready:true};
 }
 private targets(vault:string):Target[] {
  return this.pages.list(vault).map(page=>this.target(vault,page.id));
 }
 private snapshot(vault: string,target: Target) {
  const body=target.body,fullInput=`${target.title.trim()}\n\n${target.summary?target.summary+'\n\n':''}${body}`;
  const input=fullInput;
  const label=target.kind==='entity'?'Source':'Note';
  const eligible=target.ready&&body.length>=this.settings(vault).minCharacters&&Buffer.byteLength(input,'utf8')<=embeddingMaxBytes;
  const reason=!target.ready?'Source is not ready.':body.length<this.settings(vault).minCharacters?`${label} body is too short.`:Buffer.byteLength(input,'utf8')>embeddingMaxBytes?`${label} exceeds the 8,000 byte input limit.`:'Eligible';
  return {input,body,hash:createHash('sha256').update(fullInput).digest('hex'),eligible,reason};
 }
 private vector(id: string,kind:'page'|'entity'='page') {return kind==='page'?this.store.get<VectorRow>('SELECT content_hash,model,dimensions,vector FROM note_embeddings WHERE page_id=?',id):undefined;}
 private fresh(vector: VectorRow | undefined,hash: string) {return !!vector && vector.content_hash===hash && vector.model===embeddingModel && vector.dimensions===embeddingDimensions;}
 status(vault: string): EmbeddingStatus {
  this.vaults.requireOpen(vault);
  this.sourcePassages.synchronize(vault);
  const notes: EmbeddingNote[]=[...this.targets(vault).map((target):EmbeddingNote=>{
   const snapshot=this.snapshot(vault,target),vector=this.vector(target.id,target.kind);
   return {pageId:target.id,kind:target.kind,sourceId:target.kind==='entity'?target.id:null,title:target.title,eligible:snapshot.eligible,reason:snapshot.reason,state:!snapshot.eligible?'ineligible':this.fresh(vector,snapshot.hash)?'indexed':vector?'stale':'missing'};
  }),...this.sourceEmbeddings.notes(vault)];
  const counts={eligible:notes.filter(n=>n.eligible).length,indexed:0,missing:0,stale:0,ineligible:0,partial:0,queued:0,running:0,failed:0};
  for(const note of notes)counts[note.state]++;
  for(const row of this.store.all<{status:string;n:number}>('SELECT status,count(*) AS n FROM embedding_jobs WHERE vault_id=? GROUP BY status',vault))if(row.status==='queued'||row.status==='running'||row.status==='failed')counts[row.status]+=row.n;
  for(const row of this.sourceEmbeddings.counts(vault))if(row.status==='queued'||row.status==='running'||row.status==='failed')counts[row.status]+=row.n;
  const jobs=this.store.all<EmbeddingJob>(`SELECT j.id,j.page_id AS pageId,j.source_id AS sourceId,coalesce(p.title,e.name,'Unavailable content') AS title,j.status,j.reason,j.attempts,j.created_at AS createdAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.next_attempt_at AS nextAttemptAt,j.error,j.tokens FROM embedding_jobs j LEFT JOIN pages p ON p.id=j.page_id AND p.deleted_at IS NULL LEFT JOIN entities e ON e.id=j.source_id WHERE j.vault_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,vault);
  return {settings:this.settings(vault),model:embeddingModel,dimensions:embeddingDimensions,maxBytes:embeddingMaxBytes,configured:this.intelligence.status().configured,counts,jobs:[...jobs,...this.sourceEmbeddings.jobs(vault)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,100),notes};
 }
 private enqueue(vault: string,id: string,reason: string,delay=0,kind:'page'|'entity'='page') {
  const target=this.target(vault,id,kind),snapshot=this.snapshot(vault,target);
  if(!snapshot.eligible||this.fresh(this.vector(id,kind),snapshot.hash))return false;
  if(this.store.get("SELECT id FROM embedding_jobs WHERE (page_id=? OR source_id=?) AND status IN ('queued','running')",id,id))return false;
  this.store.run('INSERT INTO embedding_jobs (id,vault_id,page_id,source_id,content_hash,status,reason,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),vault,kind==='page'?id:null,kind==='entity'?id:null,snapshot.hash,'queued',reason,now(),new Date(Date.now()+delay).toISOString());return true;
 }
 enqueueExisting(vault: string,body: Record<string,unknown>) {
  this.vaults.requireOpen(vault);
  if(body.mode!=='missing'&&body.mode!=='eligible')throw new HttpError(400,'Choose missing or eligible notes.');
  this.sourcePassages.synchronize(vault);
  let queued=this.sourceEmbeddings.enqueue(vault,'backfill',undefined,body.mode==='missing',true),skipped=0;
  for(const page of this.targets(vault)) {
   if(body.mode==='missing'&&this.vector(page.id,page.kind)){skipped++;continue;}
   if(this.enqueue(vault,page.id,'backfill',0,page.kind))queued++;else skipped++;
  }
  return {queued,skipped};
 }
 onSave(vault: string,id: string) {
  this.vaults.requireOpen(vault);
  this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Note changed before indexing completed.' WHERE page_id=? AND status IN ('queued','running')",now(),id);
  if(this.settings(vault).automatic)this.enqueue(vault,id,'save',5000);
 }
 invalidate(vault: string,id: string) {
  this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Note is no longer available.' WHERE vault_id=? AND page_id=? AND status IN ('queued','running')",now(),vault,id);
  this.store.run('DELETE FROM note_embeddings WHERE page_id=? AND page_id IN (SELECT id FROM pages WHERE vault_id=?)',id,vault);
 }
 onSourceSave(vault:string,id:string) {
  this.vaults.requireOpen(vault);
  this.sourcePassages.synchronize(vault);
  if(this.settings(vault).automatic)this.sourceEmbeddings.enqueue(vault,'save',id);
 }
 invalidateSource(vault:string,id:string) {this.sourceEmbeddings.invalidate(vault,id);}
 private discoverSources() {
  this.sourcePassages.tick();
  if(Date.now()<this.nextSourceDiscovery)return;
  this.nextSourceDiscovery=Date.now()+5000;
  this.sourceEmbeddings.discover();
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
  return {queued:this.enqueue(vault,job.page_id!,'retry')?1:0};
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
    const kind=job.source_id?'entity':'page',page=this.target(job.vault_id,job.page_id??job.source_id!,kind),snapshot=this.snapshot(job.vault_id,page);
    if(!snapshot.eligible||snapshot.hash!==job.content_hash||this.fresh(this.vector(page.id,page.kind),snapshot.hash)){this.finish(job.id,'skipped','Note changed, is ineligible, or already indexed.');return;}
    activityId=this.startActivity('note_embedding',job.vault_id,page);
    const result=await this.intelligence.embed(snapshot.input,bytes=>activityId?this.activity?.request(activityId,bytes,page.revision):undefined,true);
    if(this.closed)return;
    const persisted=this.store.transaction(()=>{
     this.vaults.requireOpen(job.vault_id);
     const current=this.target(job.vault_id,page.id,page.kind),fresh=this.snapshot(job.vault_id,current);
     if(!fresh.eligible||fresh.hash!==snapshot.hash||this.store.get<JobRow>('SELECT status FROM embedding_jobs WHERE id=?',job.id)?.status!=='running'){this.finish(job.id,'skipped','Note changed or indexing was cancelled.');return false;}
     if(result.embedding.length!==embeddingDimensions||result.embedding.some(n=>!Number.isFinite(n))||!result.embedding.some(n=>n!==0))throw new HttpError(502,'Invalid embedding response.');
     this.store.run(`INSERT INTO note_embeddings (page_id,model,dimensions,content_hash,revision,vector,tokens,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET model=excluded.model,dimensions=excluded.dimensions,content_hash=excluded.content_hash,revision=excluded.revision,vector=excluded.vector,tokens=excluded.tokens,updated_at=excluded.updated_at`,page.id,embeddingModel,embeddingDimensions,fresh.hash,current.revision,JSON.stringify(result.embedding),result.tokens,now());
     this.store.run("UPDATE embedding_jobs SET status='completed',finished_at=?,tokens=? WHERE id=?",now(),result.tokens,job.id);
     return true;
    });
    this.finishActivity(activityId,persisted?'completed':'skipped',persisted?200:409);
   }catch(error) {
    if(this.closed)return;
    const code=error instanceof HttpError?error.status:502;
    this.finishActivity(activityId,code===404||code===423?'skipped':'failed',code);
    if(code===404||code===423){this.finish(job.id,'skipped',code===423?'Vault locked during indexing.':'Note is unavailable.');return;}
    const retryable=code===429||code>=500,attempts=job.attempts+1;
    if(retryable&&attempts<3)this.store.run("UPDATE embedding_jobs SET status='queued',next_attempt_at=?,error='Embedding service unavailable. Automatic retry scheduled.' WHERE id=? AND status='running'",new Date(Date.now()+30000*2**(attempts-1)).toISOString(),job.id);
    else this.finish(job.id,'failed',code===409?'Configure an OpenAI key in Intelligence settings.':'Embedding request failed. Check Intelligence settings and retry.');
   }
  }finally{this.busy=false;}
 }
 async search(vault: string,body: Record<string,unknown>): Promise<SemanticSearchResults> {
  this.vaults.requireOpen(vault);
  if(typeof body.query!=='string'||!body.query.trim()||Buffer.byteLength(body.query,'utf8')>embeddingMaxBytes)throw new HttpError(400,'Enter a search query up to 8,000 bytes.');
  const limit=body.limit ?? 20;
  if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Choose a result limit between 1 and 100.');
  this.sourcePassages.synchronize(vault);
  const searchable=this.sourceEmbeddings.hasSearchable(vault)||this.targets(vault).some(target=>{
   const snapshot=this.snapshot(vault,target);
   return snapshot.eligible&&this.fresh(this.vector(target.id,target.kind),snapshot.hash);
  });
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
   for(const page of this.targets(vault)) {
    const snapshot=this.snapshot(vault,page),row=this.vector(page.id,page.kind);
    if(!snapshot.eligible||!this.fresh(row,snapshot.hash))continue;
    const vector=JSON.parse(row!.vector) as number[],norm=magnitude(vector);
    if(vector.length!==embeddingDimensions||!norm||!Number.isFinite(norm))continue;
    const score=vector.reduce((sum,n,i)=>sum+n*result.embedding[i],0)/(norm*qMagnitude);
    if(Number.isFinite(score))results.push({id:page.id,kind:page.kind,title:page.title,snippet:makeSearchSnippet(snapshot.body,body.query),updated_at:page.updated_at,score:Math.max(-1,Math.min(1,score))});
   }
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
