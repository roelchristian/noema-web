import {randomUUID} from 'node:crypto';
import type {AINotification, AINotificationQueue, AIRunningActivity, NotificationAction} from '../../shared/ai-notifications.js';
import {Store} from '../store.js';
import {HttpError, now} from '../validation.js';

const actions=['block_explanation','page_title','page_summary','entity_scan','note_embedding'];
export class AINotifications {
  constructor(private store: Store) {}
  record(vault: string, pageId: string, action: NotificationAction, status: AINotification['status']='completed') {
    // The originating page may have been permanently deleted while a request ran.
    this.store.run(`INSERT INTO ai_notifications (id,vault_id,page_id,action,status,created_at)
      SELECT ?,vault_id,id,?,?,? FROM pages WHERE id=? AND vault_id=?`,randomUUID(),action,status,now(),pageId,vault);
    this.prune();
  }
  recordSource(vault:string,entityId:string,status:'completed'|'failed'|'interrupted',action:NotificationAction='source_import') {
    const id=randomUUID();
    this.store.run(`INSERT INTO ai_notifications (id,vault_id,entity_id,action,status,created_at)
      SELECT ?,vault_id,id,?,?,? FROM entities WHERE id=? AND vault_id=? AND type='source'`,id,action,status,now(),entityId,vault);
    this.prune();
    return id;
  }
  outcome(action: string, vault: string | null, pageId: string | null, status: string) {
    if(action==='create_page_from_source'&&vault&&pageId&&(status==='failed'||status==='interrupted')){this.recordSource(vault,pageId,status,action);return;}
    if(vault && pageId && actions.includes(action) && (status==='failed'||status==='interrupted')) this.record(vault,pageId,action as NotificationAction,status);
  }
  private prune() {
    this.store.run('DELETE FROM ai_notifications WHERE seq NOT IN (SELECT seq FROM ai_notifications ORDER BY seq DESC LIMIT 10)');
  }
  list(): AINotificationQueue {
    // Also clear old notifications saved before the ten-item limit was introduced.
    this.prune();
    const items=this.store.all<AINotification>(`SELECT n.id,n.action,n.status,n.vault_id AS vaultId,v.name AS vaultName,COALESCE(n.page_id,'') AS pageId,n.entity_id AS entityId,
      COALESCE(p.title,e.name) AS pageTitle,CASE WHEN n.entity_id IS NOT NULL THEN e.id IS NOT NULL ELSE p.id IS NOT NULL AND p.deleted_at IS NULL END AS available,n.created_at AS createdAt,n.read_at AS readAt
      FROM ai_notifications n JOIN vaults v ON v.id=n.vault_id AND v.locked=0
      LEFT JOIN pages p ON p.id=n.page_id AND p.vault_id=n.vault_id
      LEFT JOIN entities e ON e.id=n.entity_id AND e.vault_id=n.vault_id
      ORDER BY n.seq DESC LIMIT 10`).map(item=>({...item,available:!!item.available}));
    const unreadCount=this.store.get<{count:number}>(`SELECT count(*) AS count FROM ai_notifications n JOIN vaults v ON v.id=n.vault_id AND v.locked=0 WHERE n.read_at IS NULL`)!.count;
    const through=this.store.get<{seq:number}>('SELECT COALESCE(MAX(seq),0) AS seq FROM ai_notifications')!.seq;
    const running=this.store.all<AIRunningActivity>(`SELECT a.id,a.action,a.vault_id AS vaultId,CASE WHEN a.object_kind='page' THEN a.object_id ELSE '' END AS pageId,CASE WHEN a.object_kind='entity' THEN a.object_id END AS entityId,COALESCE(p.title,e.name) AS pageTitle,
      CASE WHEN a.object_kind='entity' THEN e.id IS NOT NULL ELSE p.id IS NOT NULL AND p.deleted_at IS NULL END AS available,a.started_at AS startedAt
      FROM ai_activity a JOIN vaults v ON v.id=a.vault_id AND v.locked=0 LEFT JOIN pages p ON a.object_kind='page' AND p.id=a.object_id AND p.vault_id=a.vault_id
      LEFT JOIN entities e ON a.object_kind='entity' AND e.id=a.object_id AND e.vault_id=a.vault_id
      WHERE a.status='running' AND a.object_kind IN ('page','entity') AND a.action IN ('block_explanation','page_title','page_summary','entity_scan','note_embedding','create_page_from_source')
      ORDER BY a.rowid DESC LIMIT 100`).map(item=>({...item,available:!!item.available}));
    const sources=this.store.all<AIRunningActivity>(`SELECT f.id,'source_import' AS action,f.vault_id AS vaultId,'' AS pageId,f.entity_id AS entityId,e.name AS pageTitle,
      1 AS available,f.created_at AS startedAt FROM source_files f JOIN entities e ON e.id=f.entity_id JOIN vaults v ON v.id=f.vault_id AND v.locked=0
      WHERE f.status IN ('queued','processing') ORDER BY f.created_at LIMIT 100`).map(item=>({...item,available:true}));
    return {items,running:[...running,...sources].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100),unreadCount,through};
  }
  read(body: Record<string,unknown>) {
    const {ids,through}=body;
    if(ids!==undefined) {
      if(through!==undefined||!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!id||id.length>200)) throw new HttpError(400,'Invalid notification IDs');
      this.store.run(`UPDATE ai_notifications SET read_at=? WHERE read_at IS NULL AND vault_id IN (SELECT id FROM vaults WHERE locked=0) AND id IN (${ids.map(()=>'?').join(',')})`,now(),...ids as string[]);
    } else {
      if(typeof through!=='number'||!Number.isSafeInteger(through)||through<0) throw new HttpError(400,'Invalid notification position');
      this.store.run('UPDATE ai_notifications SET read_at=? WHERE read_at IS NULL AND seq<=? AND vault_id IN (SELECT id FROM vaults WHERE locked=0)',now(),through);
    }
    return this.list();
  }
}
