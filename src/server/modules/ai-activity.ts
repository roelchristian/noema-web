import { AINotifications } from './ai-notifications.js';
import { randomUUID } from 'node:crypto';
import type { AIActivity, IntelligencePreferences } from '../../shared/intelligence.js';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

// No prompts, generated text, credentials, or raw provider errors enter this table.
export class AIActivityLog {
  constructor(private store: Store) {
    for(const row of store.all<{action:string;vault_id:string|null;object_id:string|null}>("SELECT action,vault_id,object_id FROM ai_activity WHERE status='running' AND prompt_bytes IS NOT NULL")) new AINotifications(store).outcome(row.action,row.vault_id,row.object_id,'interrupted');
    store.run("UPDATE ai_activity SET status='interrupted',finished_at=? WHERE status='running'",new Date().toISOString());
    this.prune();
  }
  private prune() {
    this.store.run("DELETE FROM ai_activity WHERE rowid NOT IN (SELECT rowid FROM ai_activity ORDER BY rowid DESC LIMIT 1000) AND status!='running'");
  }
  start(action: AIActivity['action'], selection: IntelligencePreferences, vaultId: string | null=null, objectId: string | null=null) {
    const id=randomUUID();
    this.store.run(`INSERT INTO ai_activity (id,action,status,started_at,vault_id,object_kind,object_id,model,reasoning_effort)
      VALUES (?,?,'running',?,?,?,?,?,?)`,id,action,new Date().toISOString(),vaultId,objectId?'page':null,objectId,selection.model,selection.reasoningEffort);
    this.prune();
    return id;
  }
  request(id: string, promptBytes: number, revision: number | null) {
    this.store.run('UPDATE ai_activity SET prompt_bytes=?,revision=? WHERE id=?',promptBytes,revision,id);
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
      a.object_kind AS objectKind,a.object_id AS objectId,p.title AS objectTitle,a.revision,
      a.model,a.reasoning_effort AS reasoningEffort,a.prompt_bytes AS promptBytes,
      (p.id IS NOT NULL AND p.deleted_at IS NULL) AS available,a.rowid AS cursor
      FROM ai_activity a LEFT JOIN vaults v ON v.id=a.vault_id
      LEFT JOIN pages p ON a.object_kind='page' AND p.id=a.object_id AND p.vault_id=a.vault_id
      WHERE (a.vault_id IS NULL OR v.locked=0) AND a.rowid<? ORDER BY a.rowid DESC LIMIT 51`,cursor?Number(cursor):Number.MAX_SAFE_INTEGER);
    const items=rows.slice(0,50);
    return {items:items.map(({cursor:_,...row})=>({...row,available:!!row.available})),nextCursor:rows.length>50?items.at(-1)!.cursor:null};
  }
}
