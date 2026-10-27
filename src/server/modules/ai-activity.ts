import {publishedModelPricing} from '../../shared/ai-pricing.js';
import {estimateActivityCost,type CostUsage} from './ai-cost.js';
import { AINotifications } from './ai-notifications.js';
import {pageTitleResolver} from './page-title.js';
import { randomUUID } from 'node:crypto';
import type { AIActivity, AIActivityDebug, IntelligencePreferences, AIModelPricing, PageEnrichmentMetrics } from '../../shared/intelligence.js';
import type { AIDebugTrace } from './ai-debug.js';
import { Store } from '../store.js';
import { compactRequest, compactResponse, withoutVectors } from './ai-debug-summary.js';
import { HttpError } from '../validation.js';

// Summary rows stay lightweight; opt-in payload traces live in cascading child tables.
export class AIActivityLog {
  constructor(private store: Store, options:{recoverRunning?:boolean}={}) {
    this.recoverDebugUsage();
    this.backfillCosts();
    if(options.recoverRunning!==false) {
    for(const row of store.all<{action:string;vault_id:string|null;object_id:string|null}>("SELECT action,vault_id,object_id FROM ai_activity WHERE status='running' AND prompt_bytes IS NOT NULL")) new AINotifications(store).outcome(row.action,row.vault_id,row.object_id,'interrupted');
    store.run("UPDATE ai_activity SET status='interrupted',finished_at=? WHERE status='running'",new Date().toISOString());
    }
    this.prune();
  }
  private recoverDebugUsage() {
    // Recover provider-reported counts from older debug snapshots without retaining payloads.
    for(const row of this.store.all<{id:string;usage:string|null}>(`SELECT a.id,json_extract(CASE WHEN json_valid(d.response) THEN d.response ELSE '{}' END,'$.usage') AS usage
      FROM ai_activity a JOIN ai_activity_debug d ON d.activity_id=a.id WHERE a.input_tokens IS NULL OR a.output_tokens IS NULL OR a.cached_input_tokens IS NULL OR a.cache_write_tokens IS NULL OR a.reasoning_tokens IS NULL`)) {
      if(!row.usage)continue;
      let usage:unknown;try{usage=JSON.parse(row.usage);}catch{continue;}
      this.usage(row.id,usage,true);
    }
  }
  private pruneDebug(reserveBytes=0) {
    // Every capture expires by request completion time, independent of mode and viewer reads.
    this.store.run(`DELETE FROM ai_activity_debug WHERE activity_id IN
      (SELECT d.activity_id FROM ai_activity_debug d JOIN ai_activity a ON a.id=d.activity_id
       WHERE a.status!='running' AND julianday(COALESCE(a.finished_at,a.started_at))<julianday('now','-30 days'))`);
    this.store.run(`UPDATE ai_activity_debug SET retained_bytes=
      LENGTH(CAST(COALESCE(endpoint,'')||COALESCE(request,'')||COALESCE(response_body,'')||COALESCE(response,'')||COALESCE(response_headers,'')||COALESCE(error,'') AS BLOB))+
      COALESCE((SELECT SUM(LENGTH(CAST(e.data AS BLOB))+LENGTH(CAST(e.type AS BLOB))+24) FROM ai_activity_debug_events e WHERE e.activity_id=ai_activity_debug.activity_id),0)
      WHERE mode='legacy' AND retained_bytes=0`);
    let total=this.store.get<{bytes:number}>("SELECT COALESCE(SUM(retained_bytes),0) AS bytes FROM ai_activity_debug")!.bytes;
    for(const row of this.store.all<{activity_id:string;retained_bytes:number}>(`SELECT d.activity_id,d.retained_bytes FROM ai_activity_debug d JOIN ai_activity a ON a.id=d.activity_id WHERE a.status!='running' ORDER BY COALESCE(a.finished_at,a.started_at)`)) {
      if(total<=50*1024*1024-reserveBytes)break;
      this.store.run('DELETE FROM ai_activity_debug WHERE activity_id=?',row.activity_id);total-=row.retained_bytes;
    }
  }
  private prune() {
    this.pruneDebug();
    this.store.run("DELETE FROM ai_activity WHERE status!='running' AND julianday(COALESCE(finished_at,started_at))<julianday('now','-1 year')");
  }
  start(action: AIActivity['action'], selection: IntelligencePreferences, vaultId: string | null=null, objectId: string | null=null, objectKind:'page'|'entity'='page') {
    const id=randomUUID();
    this.store.run(`INSERT INTO ai_activity (id,action,status,started_at,vault_id,object_kind,object_id,model,reasoning_effort)
      VALUES (?,?,'running',?,?,?,?,?,?)`,id,action,new Date().toISOString(),vaultId,objectId?objectKind:null,objectId,selection.model,selection.reasoningEffort);
    this.prune();
    const settings=this.debugSettings();
    if (settings.enabled) {try {this.store.run('INSERT INTO ai_activity_debug (activity_id,updated_at,mode) VALUES (?,?,?)',id,new Date().toISOString(),settings.mode);}catch{/* Optional capture cannot prevent generation. */}}
    return id;
  }
  request(id: string, promptBytes: number, revision: number | null) {
    this.store.run('UPDATE ai_activity SET prompt_bytes=?,revision=? WHERE id=?',promptBytes,revision,id);
    const usage=(value:unknown)=>this.usage(id,value);
    const row=this.store.get<{mode:'compact'|'full'}>('SELECT mode FROM ai_activity_debug WHERE activity_id=?',id);
    if (!row) return {usage};
    const mode=row.mode,started=Date.now();let stream:unknown,finalResponse:Record<string,unknown>|undefined;
    const safe=(work:()=>void)=>{try{work();}catch{/* Diagnostics must never interrupt a provider request. */}};
    const limit=mode==='full'?2*1024*1024:64*1024;
    const update=(column:string,value:unknown)=>safe(()=>{
      const serialized=typeof value==='string'?value:JSON.stringify(value);
      this.pruneDebug(Buffer.byteLength(serialized??''));
      const previous=this.store.get<Record<string,unknown>>('SELECT * FROM ai_activity_debug WHERE activity_id=?',id);if(!previous)return;
      const size=Buffer.byteLength(serialized??'');const old=Buffer.byteLength(String(previous[column]??''));
      const retained=Number(previous.retained_bytes)-old+size;
      if(retained>limit||retained>50*1024*1024-(this.store.get<{bytes:number}>("SELECT COALESCE(SUM(retained_bytes),0) AS bytes FROM ai_activity_debug WHERE activity_id!=?",id)?.bytes??0)){this.store.run('UPDATE ai_activity_debug SET truncated=1,revision=revision+1 WHERE activity_id=?',id);return;}
      this.store.run(`UPDATE ai_activity_debug SET ${column}=?,retained_bytes=?,revision=revision+1,updated_at=? WHERE activity_id=?`,serialized??null,retained,new Date().toISOString(),id);
    });
    const trace: AIDebugTrace = {
      mode,usage,
      request:(endpoint,payload)=>safe(()=>{update('endpoint',endpoint);update('request',mode==='compact'?compactRequest(payload):withoutVectors(payload));}),
      headers:(status,headers)=>{safe(()=>this.store.run('UPDATE ai_activity_debug SET response_status=?,revision=revision+1,updated_at=? WHERE activity_id=?',status,new Date().toISOString(),id));update('response_headers',headers);},
      // Full streaming payloads are represented by bounded events plus the canonical final response.
      body:text=>{if(mode==='full'&&!stream&&!finalResponse)update('response_body',text);},
      stream:summary=>{stream=summary;update('response',{...finalResponse,stream,elapsedMs:Date.now()-started});},
      event:(type,data)=>{if(mode!=='full'&&!['validation','prompt','error','response.failed','response.incomplete'].includes(type))return;safe(()=>{
        const serialized=JSON.stringify(withoutVectors(data));const size=Buffer.byteLength(serialized)+Buffer.byteLength(type)+24;
        this.pruneDebug(size);
        const current=this.store.get<{retained_bytes:number}>('SELECT retained_bytes FROM ai_activity_debug WHERE activity_id=?',id);if(!current)return;
        if(current.retained_bytes+size>limit-8192||size+(this.store.get<{bytes:number}>("SELECT COALESCE(SUM(retained_bytes),0) AS bytes FROM ai_activity_debug")?.bytes??0)>50*1024*1024){this.store.run('UPDATE ai_activity_debug SET truncated=1 WHERE activity_id=?',id);return;}
        this.store.transaction(()=>{this.store.run('INSERT INTO ai_activity_debug_events (activity_id,received_at,type,data) VALUES (?,?,?,?)',id,new Date().toISOString(),type,serialized);this.store.run('UPDATE ai_activity_debug SET retained_bytes=retained_bytes+?,revision=revision+1,updated_at=? WHERE activity_id=?',size,new Date().toISOString(),id);});
      });},
      response:payload=>safe(()=>{finalResponse=(mode==='compact'?compactResponse(payload):withoutVectors(payload)) as Record<string,unknown>;update('response_body','');update('response',mode==='compact'?{...finalResponse,stream,elapsedMs:Date.now()-started}:finalResponse);}),
      error:message=>update('error',message.slice(0,8192)),
    };
    return trace;
  }

  private usage(id:string,value:unknown,preserveExisting=false) {
    if(!value||typeof value!=='object'||Array.isArray(value))return;
    const usage=value as Record<string,unknown>;
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
    const input=count(usage.input_tokens??usage.prompt_tokens),output=count(usage.output_tokens??usage.completion_tokens);
    const rawDetails=usage.input_tokens_details??usage.prompt_tokens_details;
    const details=rawDetails&&typeof rawDetails==='object'&&!Array.isArray(rawDetails)?rawDetails as Record<string,unknown>:{};
    const cached=count(details.cached_tokens),writes=count(details.cache_write_tokens);
    const outputDetails=usage.output_tokens_details??usage.completion_tokens_details;
    const reasoning=count(outputDetails&&typeof outputDetails==='object'&&!Array.isArray(outputDetails)?(outputDetails as Record<string,unknown>).reasoning_tokens:undefined);
    if(usage.logical_operation===true&&!preserveExisting){
      this.store.run('UPDATE ai_activity SET input_tokens=?,output_tokens=?,cached_input_tokens=?,cache_write_tokens=?,reasoning_tokens=?,estimated_cost=NULL,pricing_version=NULL WHERE id=?',input,output,cached,writes,reasoning,id);
      this.updateCost(id,usage);return;
    }
    if(input===null&&output===null&&cached===null&&writes===null&&reasoning===null)return;
    if(preserveExisting){
      // A debug response may describe a single historical provider request.
      // Recovery fills gaps without replacing known logical-operation totals.
      this.store.run('UPDATE ai_activity SET input_tokens=COALESCE(input_tokens,?),output_tokens=COALESCE(output_tokens,?),cached_input_tokens=COALESCE(cached_input_tokens,?),cache_write_tokens=COALESCE(cache_write_tokens,?),reasoning_tokens=COALESCE(reasoning_tokens,?) WHERE id=?',input,output,cached,writes,reasoning,id);
      this.updateCost(id,usage);return;
    }
    this.store.run(`UPDATE ai_activity SET input_tokens=COALESCE(?,input_tokens),
      output_tokens=COALESCE(?,CASE WHEN action IN ('note_embedding','search_embedding') AND ? IS NOT NULL THEN 0 ELSE output_tokens END),
      cached_input_tokens=COALESCE(?,cached_input_tokens),cache_write_tokens=COALESCE(?,cache_write_tokens),reasoning_tokens=COALESCE(?,reasoning_tokens) WHERE id=?`,input,output,input,cached,writes,reasoning,id);
    this.updateCost(id,usage);
  }
  private updateCost(id:string,usage:Record<string,unknown>={},pricing=this.pricing()) {
    const row=this.store.get<CostUsage & {action:string}>('SELECT action,model,started_at,input_tokens,output_tokens,cached_input_tokens,cache_write_tokens FROM ai_activity WHERE id=?',id);
    // Custom generic text rates cannot safely price speech; built-in audio-aware rates can.
    if(!row||row.action==='text_to_speech'&&!['gemini-3.8-flash-lite-tts','gpt-realtime-2.1-mini','gpt-4o-mini-tts'].includes(row.model))return;
    if(row.action==='text_to_speech'&&row.model==='gpt-realtime-2.1-mini'&&pricing.models[row.model]?.audioOutputPerMillion===undefined)return;
    const cost=estimateActivityCost(row,pricing,usage);
    if(cost!==null)this.store.run("UPDATE ai_activity SET estimated_cost=?,pricing_version=? WHERE id=? AND (status='running' OR pricing_version IS NULL)",cost,pricing.version,id);
  }
  private backfillCosts() {
    const pricing=this.pricing();
    this.store.transaction(()=>{
      for(const row of this.store.all<{id:string}>("SELECT id FROM ai_activity WHERE estimated_cost IS NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL"))this.updateCost(row.id,{},pricing);
    });
  }
  pricing():AIModelPricing {
    const raw=this.store.get<{value:string}>("SELECT value FROM metadata WHERE key='ai_model_pricing'")?.value;
    if(raw)try{const value=JSON.parse(raw);if(this.validPricing(value))return value;}catch{/* Fall back to verified published rates. */}
    return publishedModelPricing;
  }
  private validPricing(value:unknown):value is AIModelPricing {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const pricing=value as Record<string,unknown>;
    if(typeof pricing.version!=='string'||!pricing.version.trim()||pricing.version.length>100||pricing.currency!=='USD'||!pricing.models||typeof pricing.models!=='object'||Array.isArray(pricing.models))return false;
    return Object.entries(pricing.models).length<=100&&Object.entries(pricing.models).every(([model,raw])=>{
      if(!model||model.length>100||!raw||typeof raw!=='object'||Array.isArray(raw))return false;
      const rates=raw as Record<string,unknown>;
      return ['inputPerMillion','outputPerMillion'].every(key=>typeof rates[key]==='number'&&Number.isFinite(rates[key])&&(rates[key] as number)>=0)&&
        ['cachedInputPerMillion','cacheWritePerMillion','longContextThreshold','audioInputPerMillion','audioOutputPerMillion','cachedAudioInputPerMillion'].every(key=>rates[key]===undefined||typeof rates[key]==='number'&&Number.isFinite(rates[key])&&(rates[key] as number)>=0);
    });
  }
  savePricing(value:unknown) {
    if(!this.validPricing(value))throw new HttpError(400,'Provide versioned USD model rates per million tokens.');
    this.store.run("INSERT INTO metadata(key,value) VALUES ('ai_model_pricing',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(value));
    return this.pricing();
  }
  enrichmentMetrics(vaultId:string|null=null):PageEnrichmentMetrics {
    const scope='v.locked=0 AND (? IS NULL OR v.id=?)';
    const reasons=this.store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_enrichment_decisions'")?
      this.store.all<{reason:string;count:number;avoided:number}>(`SELECT d.reason,COUNT(*) AS count,SUM(CASE WHEN d.provider_requested=0 AND d.requested_fields='[]' THEN 1 ELSE 0 END) AS avoided FROM page_enrichment_decisions d JOIN vaults v ON v.id=d.vault_id WHERE ${scope} GROUP BY d.reason ORDER BY count DESC`,vaultId,vaultId):[];
    const avoided=new Set(['unchanged','formatting_only','insignificant_drift','semantic_stable','manual_override','cache_hit']);
    const activity=this.store.get<{providerRequests:number;completedPages:number;estimatedCost:number|null;unpriced:number}>(`SELECT
      COUNT(*) AS providerRequests,COUNT(DISTINCT CASE WHEN a.status='completed' THEN a.vault_id||':'||a.object_id END) AS completedPages,
      SUM(a.estimated_cost) AS estimatedCost,SUM(CASE WHEN a.estimated_cost IS NULL THEN 1 ELSE 0 END) AS unpriced
      FROM ai_activity a JOIN vaults v ON v.id=a.vault_id WHERE ${scope} AND a.action='page_enrichment' AND a.prompt_bytes IS NOT NULL`,vaultId,vaultId)!;
    const estimatedCost=activity.providerRequests>0&&activity.unpriced===0?activity.estimatedCost:null;
    return {decisions:reasons.reduce((sum,row)=>sum+row.count,0),requestsAvoided:reasons.filter(row=>avoided.has(row.reason)).reduce((sum,row)=>sum+row.avoided,0),providerRequests:activity.providerRequests,completedPages:activity.completedPages,estimatedCost,costPerCompletedPage:estimatedCost!==null&&activity.completedPages>0?estimatedCost/activity.completedPages:null,reasons:reasons.map(({reason,count})=>({reason,count}))};
  }
  debugSettings() {
    const enabled=this.store.get<{value:string}>("SELECT value FROM metadata WHERE key='ai_debug'")?.value==='true';
    const until=this.store.get<{value:string}>("SELECT value FROM metadata WHERE key='ai_debug_full_until'")?.value;
    const fullUntil=enabled&&until&&Date.parse(until)>Date.now()?until:null;
    return {enabled,mode:!enabled?'off' as const:fullUntil?'full' as const:'compact' as const,fullUntil};
  }
  saveDebugSettings(body: Record<string,unknown>) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400,'Choose whether AI debug mode is enabled.');
    const minutes=body.fullTraceMinutes;
    if(minutes!==undefined&&(typeof minutes!=='number'||!Number.isInteger(minutes)||minutes<0||minutes>60))throw new HttpError(400,'Full trace session must be between 0 and 60 minutes.');
    this.store.run("INSERT INTO metadata (key,value) VALUES ('ai_debug',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(body.enabled));
    if(!body.enabled||minutes!==undefined)this.store.run("INSERT INTO metadata(key,value) VALUES ('ai_debug_full_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",body.enabled&&typeof minutes==='number'&&minutes>0?new Date(Date.now()+minutes*60000).toISOString():'');
    return this.debugSettings();
  }
  debug(id: string, options:{after?:number;eventCursor?:number;limit?:number;includeEvents?:boolean}={}): AIActivityDebug {
    for(const value of [options.after,options.eventCursor,options.limit])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new HttpError(400,'Invalid debug cursor.');
    this.pruneDebug();
    if(options.after!==undefined&&options.includeEvents!==true) {
      const current=this.store.get<{revision:number;status:AIActivity['status'];updatedAt:string;mode:AIActivityDebug['mode']}> (`SELECT d.revision,a.status,d.updated_at AS updatedAt,d.mode FROM ai_activity_debug d JOIN ai_activity a ON a.id=d.activity_id LEFT JOIN vaults v ON v.id=a.vault_id WHERE d.activity_id=? AND (a.vault_id IS NULL OR v.locked=0)`,id);
      if(!current)throw new HttpError(404,'Debug payload is unavailable or its vault is locked.');
      if(current.revision===options.after)return {activityId:id,...current,endpoint:null,request:null,response:null,responseBody:'',responseStatus:null,responseHeaders:null,error:null,events:[],unchanged:true};
    }
    const row=this.store.get<Omit<AIActivityDebug,'events'>>(`SELECT d.activity_id AS activityId,a.status,a.duration_ms AS durationMs,d.mode,d.revision,d.retained_bytes AS retainedBytes,d.truncated,d.endpoint,d.request,d.response_body AS responseBody,d.response,
      d.response_status AS responseStatus,d.response_headers AS responseHeaders,d.error,d.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM ai_activity_debug_events e WHERE e.activity_id=d.activity_id) AS eventCount
      FROM ai_activity_debug d JOIN ai_activity a ON a.id=d.activity_id LEFT JOIN vaults v ON v.id=a.vault_id
      WHERE d.activity_id=? AND (a.vault_id IS NULL OR v.locked=0)`,id);
    if (!row) throw new HttpError(404,'Debug payload is unavailable or its vault is locked.');
    const limit=Math.min(100,Math.max(1,options.limit??100));
    const events=options.includeEvents===false?[]:this.store.all<AIActivityDebug['events'][number]>(`SELECT sequence,received_at AS receivedAt,type,CASE WHEN LENGTH(CAST(data AS BLOB))>32768 THEN json_object('excerpt',SUBSTR(data,1,8192),'truncated',json('true')) ELSE data END AS data FROM ai_activity_debug_events WHERE activity_id=? AND sequence>? ORDER BY sequence LIMIT ?`,id,options.eventCursor??0,limit+1);
    let hasMoreEvents=events.length>limit;events.splice(limit);
    let pageBytes=0;
    for(let i=0;i<events.length;i++){pageBytes+=Buffer.byteLength(events[i]!.data);if(pageBytes>256*1024){events.splice(i);hasMoreEvents=true;break;}}
    return {...row,truncated:!!row.truncated,events,hasMoreEvents,nextEventCursor:events.at(-1)?.sequence??null};
  }
  // Response accounting belongs to activity persistence, not JSON serialization.
  finishResponse(id: string, status: number) {
    const row=this.store.get<{prompt_bytes:number|null;action:string}>('SELECT prompt_bytes,action FROM ai_activity WHERE id=?',id);
    this.finish(id,status>=400?'failed':row?.action==='page_enrichment'&&row.prompt_bytes===null?'skipped':'completed',status);
  }
  finish(id: string, status: Exclude<AIActivity['status'], 'running'>, httpStatus: number | null) {
    const previous=this.store.get<{action:string;vault_id:string|null;object_id:string|null;status:string;prompt_bytes:number|null}>('SELECT action,vault_id,object_id,status,prompt_bytes FROM ai_activity WHERE id=?',id);
    this.store.run(`UPDATE ai_activity SET status=?,finished_at=?,duration_ms=MAX(0,CAST((julianday(?)-julianday(started_at))*86400000 AS INTEGER)),http_status=? WHERE id=?`,status,new Date().toISOString(),new Date().toISOString(),httpStatus,id);
    this.store.run('UPDATE ai_activity_debug SET revision=revision+1,updated_at=? WHERE activity_id=?',new Date().toISOString(),id);
    if(status==='completed') {
      const debug=this.store.get<{retained_bytes:number;mode:string}>('SELECT retained_bytes,mode FROM ai_activity_debug WHERE activity_id=?',id);
      if(debug?.mode==='compact'&&debug.retained_bytes>16*1024) {
        this.store.run('DELETE FROM ai_activity_debug_events WHERE activity_id=?',id);
        this.store.run("UPDATE ai_activity_debug SET truncated=1,retained_bytes=LENGTH(CAST(COALESCE(endpoint,'')||COALESCE(request,'')||COALESCE(response,'')||COALESCE(response_headers,'')||COALESCE(error,'') AS BLOB)) WHERE activity_id=?",id);
        const size=this.store.get<{retained_bytes:number}>('SELECT retained_bytes FROM ai_activity_debug WHERE activity_id=?',id)!.retained_bytes;
        if(size>16*1024)this.store.run("UPDATE ai_activity_debug SET response=NULL,request=NULL,retained_bytes=LENGTH(CAST(COALESCE(endpoint,'')||COALESCE(response_headers,'')||COALESCE(error,'') AS BLOB)) WHERE activity_id=?",id);
      }
    }
    if(previous?.status==='running'&&previous.prompt_bytes!==null) new AINotifications(this.store).outcome(previous.action,previous.vault_id,previous.object_id,status);
    this.prune();
  }
  clear() {
    this.store.run('DELETE FROM ai_activity WHERE vault_id IS NULL OR vault_id IN (SELECT id FROM vaults WHERE locked=0)');
    if(this.store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_enrichment_decisions'"))this.store.run('DELETE FROM page_enrichment_decisions WHERE vault_id IN (SELECT id FROM vaults WHERE locked=0)');
    return {ok:true};
  }
  /** Explicit maintenance removes payloads only; accounting and active requests remain intact. */
  cleanupDebug() {
    this.recoverDebugUsage();
    return this.store.transaction(()=>{
      const events=this.store.get<{count:number}>(`SELECT COUNT(*) AS count FROM ai_activity_debug_events e JOIN ai_activity a ON a.id=e.activity_id WHERE a.status!='running'`)!.count;
      const result=this.store.run("DELETE FROM ai_activity_debug WHERE activity_id IN (SELECT id FROM ai_activity WHERE status!='running')");
      return {ok:true,deletedTraces:Number(result.changes),deletedEvents:events};
    });
  }
  list(cursor: string | null) {
    this.prune();
    if(cursor!==null && (!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor))||Number(cursor)<1))throw new HttpError(400,'Invalid activity cursor');
    const rows=this.store.all<AIActivity & {cursor:number}>(`SELECT a.id,a.action,a.status,a.started_at AS startedAt,a.finished_at AS finishedAt,
      a.duration_ms AS durationMs,a.http_status AS httpStatus,a.vault_id AS vaultId,v.name AS vaultName,
      a.object_kind AS objectKind,a.object_id AS objectId,COALESCE(p.title,e.name) AS objectTitle,a.revision,
      a.model,a.reasoning_effort AS reasoningEffort,a.prompt_bytes AS promptBytes,a.input_tokens AS inputTokens,a.output_tokens AS outputTokens,
      a.cached_input_tokens AS cachedInputTokens,a.cache_write_tokens AS cacheWriteTokens,a.reasoning_tokens AS reasoningTokens,a.estimated_cost AS estimatedCost,a.pricing_version AS pricingVersion,
      (CASE WHEN a.object_kind='entity' THEN e.id IS NOT NULL ELSE p.id IS NOT NULL AND p.deleted_at IS NULL END) AS available,EXISTS(SELECT 1 FROM ai_activity_debug d WHERE d.activity_id=a.id) AS debugRecorded,a.rowid AS cursor
      FROM ai_activity a LEFT JOIN vaults v ON v.id=a.vault_id
      LEFT JOIN pages p ON a.object_kind='page' AND p.id=a.object_id AND p.vault_id=a.vault_id
      LEFT JOIN entities e ON a.object_kind='entity' AND e.id=a.object_id AND e.vault_id=a.vault_id
      WHERE (a.vault_id IS NULL OR v.locked=0) AND a.rowid<? ORDER BY a.rowid DESC LIMIT 51`,cursor?Number(cursor):Number.MAX_SAFE_INTEGER);
    const items=rows.slice(0,50);
    const titleFor=pageTitleResolver(this.store);
    return {items:items.map(({cursor:_,...row})=>({...row,objectTitle:row.objectKind==='page'&&row.vaultId&&row.objectId?titleFor(row.vaultId,row.objectId,row.objectTitle):row.objectTitle,available:!!row.available,debugRecorded:!!row.debugRecorded})),nextCursor:rows.length>50?items.at(-1)!.cursor:null,enrichmentMetrics:this.enrichmentMetrics()};
  }
}
