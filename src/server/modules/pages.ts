import { isAIExplanation, isSemanticKind } from '../../shared/semantic-blocks.js';
import { summaryContentHash } from './summary-content.js';
import { AINotifications } from './ai-notifications.js';
import { Images } from './images.js';
import { isPageIconId } from '../../shared/page-icons.js';
import { randomUUID } from 'node:crypto';
import { blockTypes, safeHref, type Segment, type Block, type Page, type PageSummary, type TrashedPage } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, object, required, text } from '../validation.js';
import { Knowledge } from './knowledge.js';
type PageRow = Omit<Page, 'blocks' | 'sourceIds'> & {blocks: string; summary_content_hash: string | null};
export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export class Pages {
  constructor(private store: Store, private knowledge: Knowledge, private clock: () => Date = () => new Date()) {}
  private cleanupImages(vault?: string, candidates?: string[]) {
    try { new Images(this.store).cleanup(vault,candidates); } catch { console.error('Image cleanup deferred'); }
  }
  private imageIds(blocks: Block[]) { return blocks.flatMap(block => block.type === 'image' && block.imageId ? [block.imageId] : []); }
  list(vault: string) { return this.store.all<PageSummary>('SELECT id,title,icon,updated_at FROM pages WHERE vault_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',vault); }
  get(vault: string, id: string): Page {
    const row=this.store.get<PageRow>('SELECT * FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,vault);
    if (!row) throw new HttpError(404,'Page not found');
    const {summary_content_hash: cachedHash, ...stored} = row;
    const blocks = JSON.parse(row.blocks) as Block[];
    let hash = cachedHash;
    if (!hash) {
      const names = new Map<string, string | undefined>();
      hash = summaryContentHash({...stored, blocks}, entityId => {
        if (!names.has(entityId)) names.set(entityId, this.knowledge.find(vault, entityId)?.name);
        return names.get(entityId);
      });
      this.store.run('UPDATE pages SET summary_content_hash=? WHERE id=? AND vault_id=?',hash,id,vault);
    }
    return {...stored,blocks,summaryContentHash:hash,sourceIds:this.store.all<{source_id:string}>('SELECT source_id FROM page_sources WHERE page_id=?',id).map(s=>s.source_id)};
  }
  create(vault: string, body: Record<string, unknown>) {
    const id=randomUUID();
    this.store.run('INSERT INTO pages (id,title,blocks,updated_at,vault_id) VALUES (?,?,?,?,?)',id,required(body.title || 'Untitled'),JSON.stringify([{id:randomUUID(),type:'paragraph',checked:false,content:[]}]),now(),vault);
    return this.get(vault,id);
  }
  validateBlocks(vault: string, input: unknown): Block[] {
    if (!Array.isArray(input) || input.length>2000) throw new HttpError(400,'Invalid blocks');
    const ids=new Set<string>();
    const validated = input.map(value=>{
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
            return {entityId, ...(segment.mentionText !== undefined ? {mentionText: text(segment.mentionText,10000)} : {})};
          }
          const result: Segment = {text:text(segment.text)};
          for (const mark of ['bold','italic','underline','strike','code','math','skipAutoTag'] as const) if(segment[mark] === true) result[mark]=true;
          if(typeof segment.href === 'string') { const href=safeHref(segment.href); if(href) result.href=href; }
          return result;
        });
      };
      const block: Block = {id,type,checked:!!b.checked,content:segments(b.content)};
      if (b.semantic !== undefined) {if (!isSemanticKind(b.semantic)) throw new HttpError(400,'Invalid semantic function');block.semantic=b.semantic;}
      if (b.semanticGroup !== undefined) {
        const group=object(b.semanticGroup);
        if (!isSemanticKind(group.kind)) throw new HttpError(400,'Invalid semantic group function');
        block.semanticGroup={id:required(group.id),kind:group.kind};
      }
      if(type === 'math') {
        if(block.content.some(segment => segment.entityId)) throw new HttpError(400,'Equations must contain LaTeX text');
        block.content = [{text: block.content.map(segment => segment.text ?? '').join('')}];
      }
      if(type === 'image') {
        block.imageId=required(b.imageId);
        new Images(this.store).require(vault,block.imageId);
        block.alt=b.alt === undefined ? '' : text(b.alt,1000);
      }
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
    const groups=new Map<string,{kind:string;count:number}>(),closed=new Set<string>();let current:string|undefined;
    for (const block of validated) {
      const group=block.semanticGroup;
      if (current && group?.id!==current) closed.add(current);
      if (group) {
        if (ids.has(group.id) || closed.has(group.id)) throw new HttpError(400,'Semantic groups must be contiguous and have distinct IDs');
        const previous=groups.get(group.id);
        if (previous && previous.kind!==group.kind) throw new HttpError(400,'A semantic parent must have one function');
        groups.set(group.id,{kind:group.kind,count:(previous?.count??0)+1});
      }
      current=group?.id;
    }
    return validated;
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    const page=this.get(vault,id),blocks=this.validateBlocks(vault,body.blocks),title=text(body.title,500);
    const protectedIds=new Set(page.blocks.filter(isAIExplanation).map(block=>block.id));
    if(blocks.some(block=>protectedIds.has(block.id)&&!isAIExplanation(block)))throw new HttpError(400,'The AI Explanation tag cannot be removed or changed.');
    const icon=body.icon === undefined ? page.icon ?? null : body.icon;
    if(icon !== null && !isPageIconId(icon)) throw new HttpError(400,'Invalid page icon');
    const sourceIds=body.sourceIds ?? page.sourceIds;
    if(!Array.isArray(sourceIds)||sourceIds.length>1000||sourceIds.some(s=>typeof s!=='string'||this.knowledge.find(vault,s)?.type!=='source'))throw new HttpError(400,'Page sources must be Source entities in this vault');
    if(body.revision!==undefined && (!Number.isInteger(body.revision)||body.revision!==page.revision))throw new HttpError(409,'This page changed in another window. Reload the latest page before saving.');
    this.store.transaction(()=>{
      this.store.run('UPDATE pages SET title=?,icon=?,blocks=?,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',title,icon,JSON.stringify(blocks),now(),id,vault);
      this.store.run('DELETE FROM page_sources WHERE page_id=?',id);
      for(const source of new Set(sourceIds as string[]))this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
      if(title!==page.title && (!page.title.trim()||page.title.trim()==='Untitled')) {
        const generated=this.store.get<{data:string;revision:number}>("SELECT data,revision FROM page_ai_enrichments WHERE page_id=? AND kind='title'",id);
        if(generated?.revision===page.revision && JSON.parse(generated.data).title===title) new AINotifications(this.store).record(vault,id,'page_title');
      }
    });
    this.cleanupImages(vault,this.imageIds(page.blocks));
    return this.get(vault,id);
  }
  delete(vault: string, id: string) {
    this.get(vault,id);
    this.store.run('UPDATE pages SET deleted_at=?,revision=revision+1 WHERE id=? AND vault_id=? AND deleted_at IS NULL',this.clock().toISOString(),id,vault);
    return {ok:true};
  }
  purgeExpired(vault?: string) {
    const cutoff = new Date(this.clock().getTime() - trashRetentionMs).toISOString();
    const expired=this.store.all<{vault_id:string; blocks:string}>('SELECT vault_id,blocks FROM pages WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday(?)' + (vault ? ' AND vault_id=?' : ''),cutoff,...(vault ? [vault] : []));
    const result=this.store.run('DELETE FROM pages WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday(?)' + (vault ? ' AND vault_id=?' : ''),cutoff,...(vault ? [vault] : []));
    for(const page of expired) this.cleanupImages(page.vault_id,this.imageIds(JSON.parse(page.blocks) as Block[]));
    return result;
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
    const row=this.store.get<{blocks:string}>('SELECT blocks FROM pages WHERE id=? AND vault_id=?',id,vault)!;
    this.store.run('DELETE FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NOT NULL',id,vault);
    this.cleanupImages(vault,this.imageIds(JSON.parse(row.blocks) as Block[]));
    return {ok:true};
  }
}
