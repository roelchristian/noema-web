import { AINotifications } from './ai-notifications.js';
import { randomUUID } from 'node:crypto';
import type { AIActivity, AIActivityDebug, IntelligencePreferences } from '../../shared/intelligence.js';
import type { AIDebugTrace } from './ai-debug.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

// Summary rows stay lightweight; opt-in payload traces live in cascading child tables.
export class AIActivityLog {
  constructor(private store: Store) {
    // Recover provider-reported counts from older debug snapshots without retaining payloads.
    for(const row of store.all<{id:string;usage:string|null}>(`SELECT a.id,json_extract(CASE WHEN json_valid(d.response) THEN d.response ELSE '{}' END,'$.usage') AS usage
      FROM ai_activity a JOIN ai_activity_debug d ON d.activity_id=a.id WHERE a.input_tokens IS NULL OR a.output_tokens IS NULL OR a.cached_input_tokens IS NULL OR a.cache_write_tokens IS NULL`)) {
      if(!row.usage)continue;
      let usage:unknown;try{usage=JSON.parse(row.usage);}catch{continue;}
      this.usage(row.id,usage);
    }
    for(const row of store.all<{action:string;vault_id:string|null;object_id:string|null}>("SELECT action,vault_id,object_id FROM ai_activity WHERE status='running' AND prompt_bytes IS NOT NULL")) new AINotifications(store).outcome(row.action,row.vault_id,row.object_id,'interrupted');
    store.run("UPDATE ai_activity SET status='interrupted',finished_at=? WHERE status='running'",new Date().toISOString());
    this.prune();
  }
  private prune() {
    this.store.run("DELETE FROM ai_activity WHERE rowid NOT IN (SELECT rowid FROM ai_activity ORDER BY rowid DESC LIMIT 1000) AND status!='running'");
  }
  start(action: AIActivity['action'], selection: IntelligencePreferences, vaultId: string | null=null, objectId: string | null=null, objectKind:'page'|'entity'='page') {
    const id=randomUUID();
    this.store.run(`INSERT INTO ai_activity (id,action,status,started_at,vault_id,object_kind,object_id,model,reasoning_effort)
      VALUES (?,?,'running',?,?,?,?,?,?)`,id,action,new Date().toISOString(),vaultId,objectId?objectKind:null,objectId,selection.model,selection.reasoningEffort);
    this.prune();
    if (this.debugSettings().enabled) this.store.run('INSERT INTO ai_activity_debug (activity_id,updated_at) VALUES (?,?)',id,new Date().toISOString());
    return id;
  }
  request(id: string, promptBytes: number, revision: number | null) {
    this.store.run('UPDATE ai_activity SET prompt_bytes=?,revision=? WHERE id=?',promptBytes,revision,id);
    const usage=(value:unknown)=>this.usage(id,value);
    if (!this.store.get('SELECT 1 FROM ai_activity_debug WHERE activity_id=?',id)) return {usage};
    const update = (columns: string, ...values: (string | number)[]) => this.store.run(`UPDATE ai_activity_debug SET ${columns},updated_at=? WHERE activity_id=?`,...values,new Date().toISOString(),id);
    let events:{receivedAt:string;type:string;data:string}[]=[],lastFlush=Date.now();
    const flushEvents=()=>{
      if(!events.length)return;
      this.store.transaction(()=>{
        for(const event of events)this.store.run('INSERT INTO ai_activity_debug_events (activity_id,received_at,type,data) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ai_activity_debug WHERE activity_id=?)',id,event.receivedAt,event.type,event.data,id);
      });
      events=[];lastFlush=Date.now();
    };
    const trace: AIDebugTrace = {
      usage,
      request: (endpoint,payload) => { update('endpoint=?,request=?',endpoint,JSON.stringify(payload)); },
      headers: (status,headers) => { update('response_status=?,response_headers=?',status,JSON.stringify(headers)); },
      body: text => { flushEvents();update('response_body=?',text); },
      event: (type,data) => { events.push({receivedAt:new Date().toISOString(),type,data:JSON.stringify(data)});if(events.length>=100||Date.now()-lastFlush>=100)flushEvents(); },
      response: payload => { flushEvents();update('response=?',JSON.stringify(payload)); },
      error: message => { flushEvents();update('error=?',message); },
    };
    return trace;
  }
  private usage(id:string,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))return;
    const usage=value as Record<string,unknown>;
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
    const input=count(usage.input_tokens??usage.prompt_tokens),output=count(usage.output_tokens??usage.completion_tokens);
    const rawDetails=usage.input_tokens_details??usage.prompt_tokens_details;
    const details=rawDetails&&typeof rawDetails==='object'&&!Array.isArray(rawDetails)?rawDetails as Record<string,unknown>:{};
    const cached=count(details.cached_tokens),writes=count(details.cache_write_tokens);
    if(input===null&&output===null&&cached===null&&writes===null)return;
    this.store.run(`UPDATE ai_activity SET input_tokens=COALESCE(?,input_tokens),
      output_tokens=COALESCE(?,CASE WHEN action IN ('note_embedding','search_embedding') AND ? IS NOT NULL THEN 0 ELSE output_tokens END),
      cached_input_tokens=COALESCE(?,cached_input_tokens),cache_write_tokens=COALESCE(?,cache_write_tokens) WHERE id=?`,input,output,input,cached,writes,id);
  }
  debugSettings() { return {enabled: this.store.get<{value:string}>("SELECT value FROM metadata WHERE key='ai_debug'")?.value === 'true'}; }
  saveDebugSettings(body: Record<string,unknown>) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400,'Choose whether AI debug mode is enabled.');
    this.store.run("INSERT INTO metadata (key,value) VALUES ('ai_debug',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(body.enabled));
    return this.debugSettings();
  }
  debug(id: string): AIActivityDebug {
    const row=this.store.get<Omit<AIActivityDebug,'events'>>(`SELECT d.activity_id AS activityId,a.status,d.endpoint,d.request,d.response_body AS responseBody,d.response,
      d.response_status AS responseStatus,d.response_headers AS responseHeaders,d.error,d.updated_at AS updatedAt
      FROM ai_activity_debug d JOIN ai_activity a ON a.id=d.activity_id LEFT JOIN vaults v ON v.id=a.vault_id
      WHERE d.activity_id=? AND (a.vault_id IS NULL OR v.locked=0)`,id);
    if (!row) throw new HttpError(404,'Debug payload is unavailable or its vault is locked.');
    return {...row,events:this.store.all<AIActivityDebug['events'][number]>('SELECT sequence,received_at AS receivedAt,type,data FROM ai_activity_debug_events WHERE activity_id=? ORDER BY sequence',id)};
  }
  finish(id: string, status: Exclude<AIActivity['status'], 'running'>, httpStatus: number | null) {
    const previous=this.store.get<{action:string;vault_id:string|null;object_id:string|null;status:string;prompt_bytes:number|null}>('SELECT action,vault_id,object_id,status,prompt_bytes FROM ai_activity WHERE id=?',id);
    this.store.run(`UPDATE ai_activity SET status=?,finished_at=?,duration_ms=MAX(0,CAST((julianday(?)-julianday(started_at))*86400000 AS INTEGER)),http_status=? WHERE id=?`,status,new Date().toISOString(),new Date().toISOString(),httpStatus,id);
    if(previous?.status==='running'&&previous.prompt_bytes!==null) new AINotifications(this.store).outcome(previous.action,previous.vault_id,previous.object_id,status);
    this.prune();
  }
  clear() {
    this.store.run('DELETE FROM ai_activity WHERE vault_id IS NULL OR vault_id IN (SELECT id FROM vaults WHERE locked=0)');
    return {ok:true};
  }
  list(cursor: string | null) {
    if(cursor!==null && (!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor))||Number(cursor)<1))throw new HttpError(400,'Invalid activity cursor');
    const rows=this.store.all<AIActivity & {cursor:number}>(`SELECT a.id,a.action,a.status,a.started_at AS startedAt,a.finished_at AS finishedAt,
      a.duration_ms AS durationMs,a.http_status AS httpStatus,a.vault_id AS vaultId,v.name AS vaultName,
      a.object_kind AS objectKind,a.object_id AS objectId,COALESCE(p.title,e.name) AS objectTitle,a.revision,
      a.model,a.reasoning_effort AS reasoningEffort,a.prompt_bytes AS promptBytes,a.input_tokens AS inputTokens,a.output_tokens AS outputTokens,
      a.cached_input_tokens AS cachedInputTokens,a.cache_write_tokens AS cacheWriteTokens,
      (CASE WHEN a.object_kind='entity' THEN e.id IS NOT NULL ELSE p.id IS NOT NULL AND p.deleted_at IS NULL END) AS available,EXISTS(SELECT 1 FROM ai_activity_debug d WHERE d.activity_id=a.id) AS debugRecorded,a.rowid AS cursor
      FROM ai_activity a LEFT JOIN vaults v ON v.id=a.vault_id
      LEFT JOIN pages p ON a.object_kind='page' AND p.id=a.object_id AND p.vault_id=a.vault_id
      LEFT JOIN entities e ON a.object_kind='entity' AND e.id=a.object_id AND e.vault_id=a.vault_id
      WHERE (a.vault_id IS NULL OR v.locked=0) AND a.rowid<? ORDER BY a.rowid DESC LIMIT 51`,cursor?Number(cursor):Number.MAX_SAFE_INTEGER);
    const items=rows.slice(0,50);
    return {items:items.map(({cursor:_,...row})=>({...row,available:!!row.available,debugRecorded:!!row.debugRecorded})),nextCursor:rows.length>50?items.at(-1)!.cursor:null};
  }
}
