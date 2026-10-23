import {createHash} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {AIActivityLog} from './ai-activity.js';
import {AINotifications} from './ai-notifications.js';
import {Intelligence} from './intelligence.js';
import {saveSourceAuthors} from './source-authors.js';
import {sourceEnrichmentText} from './source-enrichment-prompt.js';

export function recordSourceAuthorsProcessed(store:Store,file:SourceFile) {
 store.run(`INSERT INTO source_author_jobs (file_id,vault_id,status,content_hash,updated_at) VALUES (?,?,'completed',?,?)
  ON CONFLICT(file_id) DO UPDATE SET status='completed',content_hash=excluded.content_hash,error=NULL,updated_at=excluded.updated_at`,file.id,file.vault_id,createHash('sha256').update(file.text).digest('hex'),now());
}

/** One durable author-only pass per extracted source; ordinary enrichment records completion too. */
export class SourceAuthorBackfill {
 private closed=false;
 private activityId?:string;
 constructor(private store:Store,private intelligence:Intelligence,private activity:AIActivityLog) {
  store.run("UPDATE source_author_jobs SET status='pending' WHERE status='running'");
 }
 async tick() {
  if(this.closed)return;
  this.store.run(`INSERT OR IGNORE INTO source_author_jobs (file_id,vault_id,status,updated_at)
   SELECT f.id,f.vault_id,'pending',? FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id
   WHERE f.status='ready' AND NOT EXISTS(SELECT 1 FROM source_automation_pauses pause WHERE pause.file_id=f.id) AND f.admitted=1 AND f.enrichment_status NOT IN ('pending','running') AND e.type='source' AND e.archived_at IS NULL`,now());
  if(!this.intelligence.status().configured)return;
  const file=this.store.get<SourceFile & {attempts:number}>(`SELECT f.*,j.attempts FROM source_author_jobs j
   JOIN source_files f ON f.id=j.file_id JOIN vaults v ON v.id=f.vault_id JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id
   WHERE j.status='pending' AND NOT EXISTS(SELECT 1 FROM source_automation_pauses pause WHERE pause.file_id=f.id) AND j.next_attempt_at<=? AND f.status='ready' AND f.admitted=1
    AND f.enrichment_status NOT IN ('pending','running') AND v.locked=0 AND e.type='source' AND e.archived_at IS NULL ORDER BY j.updated_at,f.id LIMIT 1`,now());
  if(!file)return;
  const hash=createHash('sha256').update(file.text).digest('hex');
  this.store.run("UPDATE source_author_jobs SET status='running',attempts=attempts+1,content_hash=?,error=NULL,updated_at=? WHERE file_id=?",hash,now(),file.id);
  this.activityId=this.activity.start('source_enrichment',this.intelligence.selection(),file.vault_id,file.entity_id,'entity');
  try {
   const authors=await this.intelligence.extractSourceAuthors(sourceEnrichmentText(file.text),bytes=>this.activity.request(this.activityId!,bytes,null));
   if(this.closed)return;
   const saved=this.store.transaction(()=>{
    const current=this.store.get<SourceFile>(`SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE f.id=? AND v.locked=0 AND e.type='source' AND e.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM source_automation_pauses pause WHERE pause.file_id=f.id)`,file.id);
    const active=this.store.get("SELECT 1 FROM source_author_jobs WHERE file_id=? AND status='running' AND content_hash=?",file.id,hash);
    if(!active)return false;
    if(!current||current.status!=='ready'||current.admitted!==1||current.entity_id!==file.entity_id||current.text!==file.text) {
     this.store.run("UPDATE source_author_jobs SET status='pending',updated_at=? WHERE file_id=?",now(),file.id);return false;
    }
    if(saveSourceAuthors(this.store,file.vault_id,file.entity_id!,authors,{file,workflow:'source_author_backfill'}))this.store.run('UPDATE entities SET updated_at=? WHERE id=? AND vault_id=?',now(),file.entity_id!,file.vault_id);
    recordSourceAuthorsProcessed(this.store,current);return true;
   });
   if(saved)new AINotifications(this.store).recordSource(file.vault_id,file.entity_id!,'completed','source_enrichment');
   this.activity.finish(this.activityId,saved?'completed':'skipped',saved?200:409);
  }catch(error) {
   if(this.closed)return;
   const code=error instanceof HttpError?error.status:502;
   const retry=(code===409||code===429||code>=500)&&file.attempts<2;
   this.store.run(`UPDATE source_author_jobs SET status=?,error=?,next_attempt_at=?,updated_at=?
    WHERE file_id=? AND status='running' AND content_hash=?`,retry?'pending':'failed',error instanceof Error?error.message:'Author backfill failed.',new Date(Date.now()+30000*2**file.attempts).toISOString(),now(),file.id,hash);
   this.activity.finish(this.activityId,'failed',code);
  }finally{this.activityId=undefined;}
 }
 close(){this.closed=true;if(this.activityId)this.activity.finish(this.activityId,'interrupted',null);}
}
