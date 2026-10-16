import { randomUUID } from 'node:crypto';
import { blockTypes, type Block, type Page, type PageSummary } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, object, required, text } from '../validation.js';
import { Knowledge } from './knowledge.js';
type PageRow = Omit<Page, 'blocks' | 'sourceIds'> & {blocks: string};
export class Pages {
  constructor(private store: Store, private knowledge: Knowledge) {}
  list(vault: string) { return this.store.all<PageSummary>('SELECT id,title,updated_at FROM pages WHERE vault_id=? ORDER BY updated_at DESC',vault); }
  get(vault: string, id: string): Page {
    const row=this.store.get<PageRow>('SELECT * FROM pages WHERE id=? AND vault_id=?',id,vault);
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
      return {id,type,checked:!!b.checked,content:b.content.map(value=>{
        const segment=object(value);
        if(segment.entityId) {
          const entityId=required(segment.entityId);
          if(!this.knowledge.find(vault,entityId))throw new HttpError(400,'Referenced entity does not exist');
          return {entityId};
        }
        return {text:text(segment.text)};
      })};
    });
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    const page=this.get(vault,id),blocks=this.blocks(vault,body.blocks),title=text(body.title,500);
    const sourceIds=body.sourceIds ?? page.sourceIds;
    if(!Array.isArray(sourceIds)||sourceIds.length>1000||sourceIds.some(s=>typeof s!=='string'||this.knowledge.find(vault,s)?.type!=='source'))throw new HttpError(400,'Page sources must be Source entities in this vault');
    if(body.revision!==undefined && (!Number.isInteger(body.revision)||body.revision!==page.revision))throw new HttpError(409,'This page changed in another window. Reload the latest page before saving.');
    this.store.transaction(()=>{
      this.store.run('UPDATE pages SET title=?,blocks=?,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',title,JSON.stringify(blocks),now(),id,vault);
      this.store.run('DELETE FROM page_sources WHERE page_id=?',id);
      for(const source of new Set(sourceIds as string[]))this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
    });
    return this.get(vault,id);
  }
  delete(vault: string, id: string) { this.get(vault,id);this.store.run('DELETE FROM pages WHERE id=? AND vault_id=?',id,vault);return {ok:true}; }
}
