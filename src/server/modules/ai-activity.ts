import { AINotifications } from './ai-notifications.js';
import { randomUUID } from 'node:crypto';
import type { AIActivity, AIActivityDebug, IntelligencePreferences } from '../../shared/intelligence.js';
import type { AIDebugTrace } from './ai-debug.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

// Summary rows stay lightweight; opt-in payload traces live in cascading child tables.
export class AIActivityLog {
  constructor(private store: Store) {
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
    if (!this.store.get('SELECT 1 FROM ai_activity_debug WHERE activity_id=?',id)) return;
    const update = (columns: string, ...values: (string | number)[]) => this.store.run(`UPDATE ai_activity_debug SET ${columns},updated_at=? WHERE activity_id=?`,...values,new Date().toISOString(),id);
    const trace: AIDebugTrace = {
      request: (endpoint,payload) => { update('endpoint=?,request=?',endpoint,JSON.stringify(payload)); },
      headers: (status,headers) => { update('response_status=?,response_headers=?',status,JSON.stringify(headers)); },
      body: text => { update('response_body=?',text); },
      event: (type,data) => { this.store.run('INSERT INTO ai_activity_debug_events (activity_id,received_at,type,data) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ai_activity_debug WHERE activity_id=?)',id,new Date().toISOString(),type,JSON.stringify(data),id); },
      response: payload => { update('response=?',JSON.stringify(payload)); },
      error: message => { update('error=?',message); },
    };
    return trace;
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
      a.model,a.reasoning_effort AS reasoningEffort,a.prompt_bytes AS promptBytes,
      (p.id IS NOT NULL AND p.deleted_at IS NULL) AS available,EXISTS(SELECT 1 FROM ai_activity_debug d WHERE d.activity_id=a.id) AS debugRecorded,a.rowid AS cursor
      FROM ai_activity a LEFT JOIN vaults v ON v.id=a.vault_id
      LEFT JOIN pages p ON a.object_kind='page' AND p.id=a.object_id AND p.vault_id=a.vault_id
      LEFT JOIN entities e ON a.object_kind='entity' AND e.id=a.object_id AND e.vault_id=a.vault_id
      WHERE (a.vault_id IS NULL OR v.locked=0) AND a.rowid<? ORDER BY a.rowid DESC LIMIT 51`,cursor?Number(cursor):Number.MAX_SAFE_INTEGER);
    const items=rows.slice(0,50);
    return {items:items.map(({cursor:_,...row})=>({...row,available:!!row.available,debugRecorded:!!row.debugRecorded})),nextCursor:rows.length>50?items.at(-1)!.cursor:null};
  }
}
