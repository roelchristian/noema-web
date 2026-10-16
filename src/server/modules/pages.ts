import { isPageIconId } from '../../shared/page-icons.js';
import { randomUUID } from 'node:crypto';
import { blockTypes, safeHref, type Segment, type Block, type Page, type PageSummary, type TrashedPage } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, object, required, text } from '../validation.js';
import { Knowledge } from './knowledge.js';
type PageRow = Omit<Page, 'blocks' | 'sourceIds'> & {blocks: string};
export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export class Pages {
  constructor(private store: Store, private knowledge: Knowledge, private clock: () => Date = () => new Date()) {}
  list(vault: string) { return this.store.all<PageSummary>('SELECT id,title,icon,updated_at FROM pages WHERE vault_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',vault); }
  get(vault: string, id: string): Page {
    const row=this.store.get<PageRow>('SELECT * FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,vault);
    if (!row) throw new HttpError(404,'Page not found');
    return {...row,blocks:JSON.parse(row.blocks) as Block[],sourceIds:this.store.all<{source_id:string}>('SELECT source_id FROM page_sources WHERE page_id=?',id).map(s=>s.source_id)};
  }
  create(vault: string, body: Record<string, unknown>) {
    const id=randomUUID();
    this.store.run('INSERT INTO pages (id,title,blocks,updated_at,vault_id) VALUES (?,?,?,?,?)',id,required(body.title || 'Untitled'),JSON.stringify([{id:randomUUID(),type:'paragraph',checked:false,content:[]}]),now(),vault);
    return this.get(vault,id);
  }
  private blocks(vault: string, input: unknown): Block[] {
    if (!Array.isArray(input) || input.length>2000) throw new HttpError(400,'Invalid blocks');
    const ids=new Set<string>();
    return input.map(value=>{
      const b=object(value), type=blockTypes.find(t=>t===b.type);
      if (!type || !Array.isArray(b.content) || b.content.length>1000) throw new HttpError(400,'Invalid block');
      const id=required(b.id);if(ids.has(id))throw new HttpError(400,'Duplicate block ID');ids.add(id);
      const segments = (input: unknown): Segment[] => {
        if (!Array.isArray(input) || input.length > 1000) throw new HttpError(400,'Invalid cell content');
        return input.map(value => {
          const segment=object(value);
          if(segment.entityId) {
            const entityId=required(segment.entityId);
            if(!this.knowledge.find(vault,entityId))throw new HttpError(400,'Referenced entity does not exist');
            return {entityId};
          }
          const result: Segment = {text:text(segment.text)};
          for (const mark of ['bold','italic','underline','strike','code'] as const) if(segment[mark] === true) result[mark]=true;
          if(typeof segment.href === 'string') { const href=safeHref(segment.href); if(href) result.href=href; }
          return result;
        });
      };
      const block: Block = {id,type,checked:!!b.checked,content:segments(b.content)};
      if(type === 'table') {
        if(!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 100 || !Array.isArray(b.rows[0]) || !b.rows[0].length || b.rows[0].length > 20) throw new HttpError(400,'Invalid table');
        const width=b.rows[0].length;
        block.rows=b.rows.map(row => {
          if(!Array.isArray(row) || row.length !== width) throw new HttpError(400,'Invalid table row');
          return row.map(segments);
        });
      }
      return block;
    });
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    const page=this.get(vault,id),blocks=this.blocks(vault,body.blocks),title=text(body.title,500);
    const icon=body.icon === undefined ? page.icon ?? null : body.icon;
    if(icon !== null && !isPageIconId(icon)) throw new HttpError(400,'Invalid page icon');
    const sourceIds=body.sourceIds ?? page.sourceIds;
    if(!Array.isArray(sourceIds)||sourceIds.length>1000||sourceIds.some(s=>typeof s!=='string'||this.knowledge.find(vault,s)?.type!=='source'))throw new HttpError(400,'Page sources must be Source entities in this vault');
    if(body.revision!==undefined && (!Number.isInteger(body.revision)||body.revision!==page.revision))throw new HttpError(409,'This page changed in another window. Reload the latest page before saving.');
    this.store.transaction(()=>{
      this.store.run('UPDATE pages SET title=?,icon=?,blocks=?,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',title,icon,JSON.stringify(blocks),now(),id,vault);
      this.store.run('DELETE FROM page_sources WHERE page_id=?',id);
      for(const source of new Set(sourceIds as string[]))this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
    });
    return this.get(vault,id);
  }
  delete(vault: string, id: string) {
    this.get(vault,id);
    this.store.run('UPDATE pages SET deleted_at=?,revision=revision+1 WHERE id=? AND vault_id=? AND deleted_at IS NULL',this.clock().toISOString(),id,vault);
    return {ok:true};
  }
  purgeExpired(vault?: string) {
    const cutoff = new Date(this.clock().getTime() - trashRetentionMs).toISOString();
    return this.store.run('DELETE FROM pages WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday(?)' + (vault ? ' AND vault_id=?' : ''),cutoff,...(vault ? [vault] : []));
  }
  trash(vault: string): TrashedPage[] {
    this.purgeExpired(vault);
    return this.store.all<PageSummary & {deleted_at: string}>('SELECT id,title,icon,updated_at,deleted_at FROM pages WHERE vault_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id',vault).map(page => ({...page,expires_at:new Date(Date.parse(page.deleted_at) + trashRetentionMs).toISOString()}));
  }
  private trashed(vault: string, id: string) {
    this.purgeExpired(vault);
    const row = this.store.get('SELECT id FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NOT NULL',id,vault);
    if (!row) throw new HttpError(404,'Note not found in Trash');
  }
  restore(vault: string, id: string) {
    this.trashed(vault,id);
    this.store.run('UPDATE pages SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',this.clock().toISOString(),id,vault);
    return this.get(vault,id);
  }
  permanentlyDelete(vault: string, id: string) {
    this.trashed(vault,id);
    this.store.run('DELETE FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NOT NULL',id,vault);
    return {ok:true};
  }
}
