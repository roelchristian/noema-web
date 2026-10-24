import {Store} from '../store.js';

export type EnrichmentField='title'|'domains'|'language'|'summary';
const supportedFields:EnrichmentField[]=['title','domains','language','summary'];
export interface EnrichmentJob {
  pageId:string; vault:string; fields:EnrichmentField[]; explicit:boolean; attempts:number;
}
export interface EnrichmentSnapshot {
  contentHash:string; schemaVersion:string; modelProfile:string;
  requestedFields:EnrichmentField[]; revision?:number; dependencyIdentity?:string;
}
export interface EnrichmentSchedulerCallbacks<T extends EnrichmentSnapshot> {
  /** Re-read field dependencies, manual overrides and freshness. Null drops obsolete work. */
  prepare:(vault:string,pageId:string,job:EnrichmentJob)=>T|null;
  /** Must also revalidate field dependencies, manual overrides and vault lock immediately before committing. */
  execute:(vault:string,pageId:string,snapshot:T,signal:AbortSignal)=>Promise<{classified?:boolean}|void>;
}
interface JobRow {page_id:string;vault_id:string;fields:string;explicit:number;due_at:number;attempts:number;generation:number}
export interface EnrichmentSchedulerOptions {
  clock?:()=>number; pollMs?:number; concurrency?:number; classificationCooldownMs?:number;
  retryDelaysMs?:number[];
}
/** Durable coalescing queue. A crashed in-flight job remains queued and is reassessed after restart. */
export class PageEnrichmentScheduler<T extends EnrichmentSnapshot=EnrichmentSnapshot> {
  private timer?:ReturnType<typeof setInterval>;
  private active=new Map<string,{controller:AbortController;fingerprint?:string;job:EnrichmentJob}>();
  private disposed=false;
  private clock:()=>number;
  private cooldown:number;
  constructor(private store:Store,private callbacks:EnrichmentSchedulerCallbacks<T>,private options:EnrichmentSchedulerOptions={}) {
    this.clock=options.clock??Date.now;
    this.cooldown=options.classificationCooldownMs??30*60_000;
    this.restoreClassificationCooldowns();
  }
  private restoreClassificationCooldowns(pageId?:string) {
    // Completed classifications are portable vault data; rebuild throttling after a restore too.
    if(!this.store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_ai_enrichments'"))return;
    for(const row of this.store.all<{page_id:string;data:string}>("SELECT page_id,data FROM page_ai_enrichments WHERE kind IN ('domain_classification','enrichment_state')"+(pageId?' AND page_id=?':''),...(pageId?[pageId]:[]))) {
      try {
        const data:unknown=JSON.parse(row.data);
        if(!data||typeof data!=='object')continue;
        const classification='classification' in data&&data.classification&&typeof data.classification==='object'?data.classification:data;
        if(!('lastClassifiedAt' in classification)||typeof classification.lastClassifiedAt!=='string')continue;
        const classifiedAt=Date.parse(classification.lastClassifiedAt);
        if(!Number.isFinite(classifiedAt))continue;
        this.store.run(`INSERT INTO page_enrichment_cooldowns(page_id,last_classified_at) VALUES (?,?)
          ON CONFLICT(page_id) DO UPDATE SET last_classified_at=MAX(last_classified_at,excluded.last_classified_at)`,row.page_id,classifiedAt);
      } catch { /* Legacy records with unknown provenance stay eligible for local assessment. */ }
    }
  }
  start() {
    if(this.timer||this.disposed)return;
    this.timer=setInterval(()=>{void this.drain();},this.options.pollMs??1000);
    this.timer.unref?.();
    void this.drain();
  }
  enqueue(vault:string,pageId:string,options:{fields?:EnrichmentField[];explicit?:boolean;delayMs?:number}={}) {
    if(this.disposed)return;
    // Never allow an identifier from another vault to enter its queue.
    if(!this.store.get('SELECT 1 FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL AND archived_at IS NULL',pageId,vault))return;
    const existing=this.store.get<JobRow>('SELECT * FROM page_enrichment_jobs WHERE page_id=?',pageId);
    const fields=[...new Set([...(existing?this.fields(existing):[]),...(options.fields??supportedFields)])];
    if(!fields.length)return;
    const explicit=!!existing?.explicit||!!options.explicit;
    const now=this.clock(),due=now+(options.delayMs??(explicit?0:12_000));
    this.store.run(`INSERT INTO page_enrichment_jobs (page_id,vault_id,fields,explicit,due_at,attempts,generation,updated_at)
      VALUES (?,?,?,?,?,0,1,?) ON CONFLICT(page_id) DO UPDATE SET fields=excluded.fields,explicit=excluded.explicit,
      due_at=excluded.due_at,attempts=0,generation=page_enrichment_jobs.generation+1,updated_at=excluded.updated_at`,
      pageId,vault,JSON.stringify(fields),Number(explicit),explicit?Math.min(existing?.due_at??due,due):due,now);
    // Compare the running request's fields, not the expanded queue: newly requested
    // fields can wait without invalidating compatible work already at the provider.
    this.revalidateActive(pageId);
  }
  private fingerprint(snapshot:T) {
    return JSON.stringify([snapshot.dependencyIdentity??snapshot.contentHash,snapshot.schemaVersion,snapshot.modelProfile,[...snapshot.requestedFields].sort()]);
  }
  private revalidateActive(pageId:string) {
    const active=this.active.get(pageId);
    if(!active?.fingerprint||active.controller.signal.aborted)return;
    if(!this.available(active.job.vault,pageId)){active.controller.abort();return;}
    try {
      const latest=this.callbacks.prepare(active.job.vault,pageId,active.job);
      if(!latest||this.fingerprint(latest)!==active.fingerprint)active.controller.abort();
    } catch {
      // The queued generation remains durable and will reassess availability on
      // dispatch; an inaccessible or invalid snapshot cannot keep running safely.
      active.controller.abort();
    }
  }
  markClassified(pageId:string) {
    this.store.run(`INSERT INTO page_enrichment_cooldowns (page_id,last_classified_at) VALUES (?,?)
      ON CONFLICT(page_id) DO UPDATE SET last_classified_at=excluded.last_classified_at`,pageId,this.clock());
  }
  private fields(row:JobRow):EnrichmentField[] {
    try {const value:unknown=JSON.parse(row.fields);return Array.isArray(value)?supportedFields.filter(field=>value.includes(field)):[];}
    catch{return [];}
  }
  private available(vault:string,pageId:string) {
    return !!this.store.get(`SELECT 1 FROM pages p JOIN vaults v ON p.vault_id=v.id
      WHERE p.id=? AND p.vault_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND v.locked=0
      AND NOT EXISTS (SELECT 1 FROM page_edit_locks l WHERE l.page_id=p.id)`,pageId,vault);
  }
  async drain() {
    if(this.disposed)return;
    for(const [id,active] of this.active) {
      const row=this.store.get<JobRow>('SELECT * FROM page_enrichment_jobs WHERE page_id=?',id);
      if(!row||!this.available(row.vault_id,id))active.controller.abort();
    }
    const capacity=Math.max(0,(this.options.concurrency??2)-this.active.size);
    if(!capacity)return;
    const due=this.store.all<JobRow>(`SELECT j.* FROM page_enrichment_jobs j
      JOIN pages p ON p.id=j.page_id JOIN vaults v ON v.id=j.vault_id
      WHERE j.due_at<=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND v.locked=0
      AND NOT EXISTS (SELECT 1 FROM page_edit_locks l WHERE l.page_id=p.id)
      ORDER BY j.explicit DESC,j.due_at`,this.clock()).filter(row=>!this.active.has(row.page_id)).slice(0,capacity);
    await Promise.all(due.map(row=>this.run(row)));
  }
  private async run(row:JobRow) {
    const controller=new AbortController();
    const active:{controller:AbortController;fingerprint?:string;job:EnrichmentJob}={controller,job:{pageId:row.page_id,vault:row.vault_id,fields:this.fields(row),explicit:!!row.explicit,attempts:row.attempts}};
    this.active.set(row.page_id,active);
    try {
      if(!this.available(row.vault_id,row.page_id))return;
      let fields=this.fields(row);
      // A portable backup can be restored while this process is running. Recover that page's
      // completed timestamp before preparing work, so cooldown changes remain pending.
      this.restoreClassificationCooldowns(row.page_id);
      const cooldown=this.store.get<{last_classified_at:number}>('SELECT last_classified_at FROM page_enrichment_cooldowns WHERE page_id=?',row.page_id);
      const classificationDue=(cooldown?.last_classified_at??-this.cooldown)+this.cooldown;
      const deferred=fields.includes('domains')&&!row.explicit&&classificationDue>this.clock();
      if(deferred)fields=fields.filter(field=>field!=='domains');
      if(!fields.length){this.defer(row,classificationDue);return;}
      active.job.fields=fields;
      const snapshot=this.callbacks.prepare(row.vault_id,row.page_id,active.job);
      if(!snapshot){if(deferred)this.defer(row,classificationDue);else this.remove(row);return;}
      // Keep the dispatch identity explicit. Per-page exclusion also prevents equivalent overlapping calls.
      active.job.fields=snapshot.requestedFields;
      active.fingerprint=this.fingerprint(snapshot);
      if(!this.available(row.vault_id,row.page_id)||controller.signal.aborted)return;
      const result=await this.callbacks.execute(row.vault_id,row.page_id,snapshot,controller.signal);
      if(controller.signal.aborted)return;
      if(result?.classified)this.markClassified(row.page_id);
      if(deferred)this.defer(row,classificationDue);else this.remove(row);
    } catch(error) {
      if(this.disposed||controller.signal.aborted)return;
      const status=error&&typeof error==='object'&&'status' in error?error.status:undefined;
      const permanent=!!error&&typeof error==='object'&&'retryable' in error&&error.retryable===false;
      const retryable=!permanent&&(status===429||status===408||status===502||status===503||status===504||error instanceof TypeError);
      const delays=this.options.retryDelaysMs??[15_000,60_000,240_000];
      if(retryable&&row.attempts<delays.length) {
        this.store.run('UPDATE page_enrichment_jobs SET attempts=attempts+1,due_at=? WHERE page_id=? AND generation=?',this.clock()+delays[row.attempts],row.page_id,row.generation);
      } else this.remove(row);
    } finally {this.active.delete(row.page_id);}
  }
  private defer(row:JobRow,due:number) {
    this.store.run("UPDATE page_enrichment_jobs SET fields='[\"domains\"]',due_at=?,attempts=0 WHERE page_id=? AND generation=?",due,row.page_id,row.generation);
  }
  private remove(row:JobRow) {
    this.store.run('DELETE FROM page_enrichment_jobs WHERE page_id=? AND generation=?',row.page_id,row.generation);
  }
  pauseVault(vault:string) {
    for(const [pageId,operation] of this.active)if(this.store.get('SELECT 1 FROM pages WHERE id=? AND vault_id=?',pageId,vault))operation.controller.abort();
  }
  dispose() {
    this.disposed=true;
    clearInterval(this.timer);
    for(const active of this.active.values())active.controller.abort();
  }
}
