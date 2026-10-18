import {readingNoteMaxWords,readingNoteWordCount,type ReadingNoteMetadata} from '../../shared/source-reading.js';
import {projectPageText} from '../../shared/page-text.js';
import {citationSourceIds} from '../../shared/citations.js';
import {PageEnrichmentState} from './page-enrichment-state.js';
import {Domains} from './domains.js';
import {enrichCitationPages,syncSourceReferences} from './source-references.js';
import {pageLanguage} from './page-language.js';
import {nextPageAIStatus, type PageAIStatus} from '../../shared/page-ai-status.js';
import {allowedInColumn} from '../../shared/column-blocks.js';
import { entityMentionName } from '../../shared/domain.js';
import {blockPageLinks,pageTitleKey} from '../../shared/page-links.js';
import { isAIExplanation, isSemanticKind } from '../../shared/semantic-blocks.js';
import { conceptContentHash, summaryContentHash } from './summary-content.js';
import { AINotifications } from './ai-notifications.js';
import { Images } from './images.js';
import { isPageIconId } from '../../shared/page-icons.js';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { blockTypes, safeHref, type Segment, type Block, type Page, type PageSummary, type TrashedPage } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, object, required, text } from '../validation.js';
import { Knowledge } from './knowledge.js';
type PageRow = Omit<Page, 'blocks' | 'sourceIds' | 'featuredImageId'> & {blocks: string; summary_content_hash: string | null; summary_hash_version:number; featured_image_id:string|null; ai_status:PageAIStatus};
export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export class Pages {
  constructor(private store: Store, private knowledge: Knowledge, private clock: () => Date = () => new Date()) {}
  private cleanupImages(vault?: string, candidates?: string[]) {
    try { new Images(this.store).cleanup(vault,candidates); } catch { console.error('Image cleanup deferred'); }
  }
  private imageIds(blocks: Block[]) { return blocks.flatMap(block => block.type === 'image' && block.imageId ? [block.imageId] : []); }
  list(vault: string) { return this.store.all<PageSummary>('SELECT id,title,icon,featured_image_id AS featuredImageId,ai_status AS aiStatus,language,updated_at FROM pages WHERE vault_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',vault); }
  backlinks(vault:string,id:string):PageSummary[] {
    const target=pageTitleKey(this.get(vault,id).title);
    const candidates=this.store.all<PageSummary & {blocks:string}>("SELECT id,title,icon,ai_status AS aiStatus,language,updated_at,blocks FROM pages WHERE vault_id=? AND deleted_at IS NULL AND id<>? AND instr(blocks,'[[')>0 ORDER BY title COLLATE NOCASE,id",vault,id);
    return candidates.flatMap(({blocks,...page})=>blockPageLinks(JSON.parse(blocks) as Block[]).some(link=>pageTitleKey(link.title)===target)?[page]:[]);
  }
  get(vault: string, id: string): Page {
    const row=this.store.get<PageRow>('SELECT * FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,vault);
    if (!row) throw new HttpError(404,'Page not found');
    const {summary_content_hash: cachedHash, summary_hash_version: hashVersion, featured_image_id: featuredImageId, ai_status: aiStatus, ...stored} = row;
    // Generated titles remain derived metadata until an authored save accepts them.
    if(!stored.title.trim()||stored.title.trim()==='Untitled') {
      const generated=this.store.get<{data:string;revision:number}>("SELECT data,revision FROM page_ai_enrichments WHERE page_id=? AND kind='title'",id);
      if(generated) {try {const data=JSON.parse(generated.data),title=data.title;const inferred=new PageEnrichmentState(this.store).get(id).fields.title?.origin==='inferred';if((generated.revision===row.revision||inferred)&&typeof title==='string'&&title.trim())stored.title=title;}catch {/* Unknown legacy records do not replace authored text. */}}
    }
    const blocks = enrichCitationPages(this.store,JSON.parse(row.blocks) as Block[]);
    const names=new Map<string,string|undefined>();
    const resolveName=(id:string)=>{if(!names.has(id))names.set(id,entityMentionName(this.knowledge.find(vault,id)));return names.get(id);};
    const classificationRow=this.store.get<{data:string}>("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='concept_classification'",id);
    const conceptClassification=classificationRow ? JSON.parse(classificationRow.data) as import('../../shared/domain.js').ConceptClassification : undefined;
    let hash = cachedHash;
    if (!hash || hashVersion !== 2) {
      hash = summaryContentHash({...stored, blocks}, resolveName);
      if (hashVersion !== 2) {
        // Rebase only summaries whose old fingerprint matches the actual note.
        // Unknown or genuinely stale summaries keep their original fingerprint.
        const legacy = summaryContentHash({...stored,blocks},resolveName,true);
        this.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary' AND content_hash=?",hash,id,legacy);
      }
      this.store.run('UPDATE pages SET summary_content_hash=?,summary_hash_version=2 WHERE id=? AND vault_id=?',hash,id,vault);
    }
    const editLock=this.store.get<{password_hash:string|null}>('SELECT password_hash FROM page_edit_locks WHERE page_id=? AND vault_id=?',id,vault);
    const domainService=new Domains(this.store);
    domainService.assess({...stored,blocks,conceptContentHash:conceptContentHash({...stored,blocks},resolveName)} as Page,resolveName);
    const readingRow=this.store.get<{source_id:string|null;file_id:string|null;source_hash:string;start_offset:number;end_offset:number;excerpt:string;reference_json:string;created_at:string}>('SELECT * FROM page_reading_notes WHERE page_id=? AND vault_id=?',id,vault);
    const readingNote:ReadingNoteMetadata|undefined=readingRow?{...JSON.parse(readingRow.reference_json),sourceId:readingRow.source_id,fileId:readingRow.file_id,sourceHash:readingRow.source_hash,startOffset:readingRow.start_offset,endOffset:readingRow.end_offset,excerpt:readingRow.excerpt,createdAt:readingRow.created_at,maxWords:200}:undefined;
    return {...stored,...(readingNote?{readingNote}:{}),enrichmentFields:new PageEnrichmentState(this.store).get(id).fields,enrichmentPending:!!this.store.get('SELECT 1 FROM page_enrichment_jobs WHERE page_id=?',id),pageDomains:domainService.get(id,conceptContentHash({...stored,blocks},resolveName)),aiStatus,editLocked:!!editLock,editProtected:!!editLock?.password_hash,featuredImageId,blocks,conceptClassification,conceptContentHash:conceptContentHash({...stored,blocks},resolveName),summaryContentHash:hash,sourceIds:[...new Set([...this.store.all<{source_id:string}>('SELECT source_id FROM page_sources WHERE page_id=?',id).map(s=>s.source_id),...citationSourceIds(blocks).filter(sourceId=>this.knowledge.find(vault,sourceId)?.type==='source')])]};
  }
  requireEditable(vault: string, id: string) {
    const page=this.get(vault,id);
    if (page.editLocked) throw new HttpError(423,'This page is locked for editing. Unlock it to make changes.');
    return page;
  }
  setEditLock(vault: string, id: string, body: Record<string,unknown>) {
    const page=this.get(vault,id);
    if (typeof body.locked !== 'boolean') throw new HttpError(400,'Choose whether to lock or unlock editing.');
    if (body.revision !== page.revision) throw new HttpError(409,'This page changed. Reload it before changing its lock.');
    if (body.locked && page.editLocked) throw new HttpError(409,'Unlock this page before changing its editing lock.');
    const existing=this.store.get<{password_hash:string|null;salt:string|null}>('SELECT password_hash,salt FROM page_edit_locks WHERE page_id=? AND vault_id=?',id,vault);
    if (!body.locked && existing?.password_hash) {
      if (typeof body.password !== 'string' || !timingSafeEqual(scryptSync(text(body.password,500),existing.salt!,64),Buffer.from(existing.password_hash,'hex'))) throw new HttpError(403,'Incorrect password. The page is still locked.');
    }
    const password=body.locked && body.password != null ? text(body.password,500) : null;
    if (password !== null && password.length < 4) throw new HttpError(400,'Use a password of at least 4 characters.');
    const salt=password === null ? null : randomUUID();
    const hash=password === null ? null : scryptSync(password,salt!,64).toString('hex');
    this.store.transaction(()=>{
      if (body.locked) this.store.run('INSERT INTO page_edit_locks VALUES (?,?,?,?)',id,vault,hash,salt);
      else this.store.run('DELETE FROM page_edit_locks WHERE page_id=? AND vault_id=?',id,vault);
      this.store.run('UPDATE pages SET revision=revision+1 WHERE id=? AND vault_id=?',id,vault);
    });
    return this.get(vault,id);
  }
  create(vault: string, body: Record<string, unknown>) {
    const id=randomUUID(),createdAt=now();
    this.store.run('INSERT INTO pages (id,title,language,blocks,updated_at,created_at,vault_id) VALUES (?,?,?,?,?,?,?)',id,required(body.title || 'Untitled'),pageLanguage(body.language),JSON.stringify([{id:randomUUID(),type:'paragraph',checked:false,content:[]}]),createdAt,createdAt,vault);
    const provenance=new PageEnrichmentState(this.store);
    if(typeof body.title==='string'&&body.title.trim()&&body.title.trim()!=='Untitled')provenance.markManual(id,'title');
    if(pageLanguage(body.language))provenance.markManual(id,'language');
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
          if(segment.sourceReference!==undefined) {
            const ref=object(segment.sourceReference),sourceId=required(ref.sourceId),fileId=required(ref.fileId);
            if(this.knowledge.find(vault,sourceId)?.type!=='source'||!this.store.get('SELECT 1 FROM source_files WHERE id=? AND entity_id=? AND vault_id=?',fileId,sourceId,vault))throw new HttpError(400,'Invalid citation source');
            if(!Number.isSafeInteger(ref.startLine)||!Number.isSafeInteger(ref.endLine)||(ref.startLine as number)<1||(ref.endLine as number)<(ref.startLine as number)||(ref.nodeId===undefined&&ref.userLocator===undefined&&(ref.endLine as number)-(ref.startLine as number)>=30)||typeof ref.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(ref.sourceHash)||segment.math||segment.code)throw new HttpError(400,'Invalid source reference');
            if(ref.sourceNumber!==undefined&&(!Number.isSafeInteger(ref.sourceNumber)||(ref.sourceNumber as number)<1||(ref.sourceNumber as number)>1_000_000_000))throw new HttpError(400,'Invalid source number');
            if(ref.startPage!==undefined&&(!Number.isInteger(ref.startPage)||!Number.isInteger(ref.endPage)||(ref.startPage as number)<1||(ref.endPage as number)<(ref.startPage as number)||(ref.endPage as number)>1000))throw new HttpError(400,'Invalid citation page');
            result.sourceReference={...(ref.startPage===undefined?{}:{startPage:ref.startPage as number,endPage:ref.endPage as number}),...(ref.sourceNumber===undefined?{}:{sourceNumber:ref.sourceNumber as number}),id:required(ref.id),sourceId,fileId,startLine:ref.startLine as number,endLine:ref.endLine as number,sourceHash:ref.sourceHash,excerpt:text(ref.excerpt,16*1024*1024)};
            if(ref.nodeId!==undefined)result.sourceReference.nodeId=required(ref.nodeId);
            if(ref.userLocator!==undefined)result.sourceReference.userLocator=text(ref.userLocator,1000);
            if(ref.appLocator!==undefined)result.sourceReference.appLocator=text(ref.appLocator,1000);
            if(ref.contextLabel!==undefined)result.sourceReference.contextLabel=text(ref.contextLabel,10000);
            if(ref.generationId!==undefined)result.sourceReference.generationId=required(ref.generationId);
            if(ref.passageId!==undefined)result.sourceReference.passageId=required(ref.passageId);
            for(const key of ['startOffset','endOffset'] as const)if(ref[key]!==undefined) {
              if(!Number.isSafeInteger(ref[key])||(ref[key] as number)<0)throw new HttpError(400,'Invalid citation offset');
              result.sourceReference[key]=ref[key] as number;
            }
          }
          if(typeof segment.href === 'string') { const href=safeHref(segment.href); if(href) result.href=href; }
          return result;
        });
      };
      const block: Block = {id,type,checked:!!b.checked,content:segments(b.content)};
      if (b.column !== undefined) {
        if (!allowedInColumn(type)) throw new HttpError(400,'Columns cannot contain tables or nested columns');
        const column=object(b.column);
        if (column.index !== 0 && column.index !== 1) throw new HttpError(400,'Invalid column index');
        block.column={id:required(column.id),index:column.index};
      }
      if (b.semantic !== undefined) {if (!isSemanticKind(b.semantic)) throw new HttpError(400,'Invalid semantic function');block.semantic=b.semantic;}
      if (b.semanticGroup !== undefined) {
        const group=object(b.semanticGroup);
        if (!isSemanticKind(group.kind)) throw new HttpError(400,'Invalid semantic group function');
        block.semanticGroup={id:required(group.id),kind:group.kind};
        if (group.kind === 'ai-explanation' && group.source !== undefined) {
          const source=object(group.source);
          if (!Array.isArray(source.blockIds) || source.blockIds.length > 2000) throw new HttpError(400,'Invalid explanation source');
          block.semanticGroup.source={blockIds:source.blockIds.map(id=>required(id)),excerpt:text(source.excerpt,2000)};
        }
      }
      if(type === 'divider') block.content = [];
      if(type === 'code') {
        if(block.content.some(segment => segment.entityId)) throw new HttpError(400,'Code blocks must contain plain text');
        block.content = [{text: block.content.map(segment => segment.text ?? '').join('')}];
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
      if(type === 'columns') {
        if(!Array.isArray(b.rows) || b.rows.length !== 1 || !Array.isArray(b.rows[0]) || b.rows[0].length !== 2) throw new HttpError(400,'Two-column blocks require exactly two columns');
        block.rows = [b.rows[0].map(segments)];
        block.content = [];
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
    const page=this.requireEditable(vault,id),blocks=this.validateBlocks(vault,body.blocks),title=text(body.title,500);
    if(page.readingNote&&readingNoteWordCount(projectPageText(blocks,id=>entityMentionName(this.knowledge.find(vault,id))).text)>readingNoteMaxWords)throw new HttpError(400,'Reading notes can contain at most 200 words.');
    const language=body.language===undefined?page.language??null:pageLanguage(body.language);
    const protectedIds=new Set(page.blocks.filter(isAIExplanation).map(block=>block.id));
    if(blocks.some(block=>protectedIds.has(block.id)&&!isAIExplanation(block)))throw new HttpError(400,'The AI Explanation tag cannot be removed or changed.');
    const icon=body.icon === undefined ? page.icon ?? null : body.icon;
    if(icon !== null && !isPageIconId(icon)) throw new HttpError(400,'Invalid page icon');
    let featuredImageId=body.featuredImageId===undefined?page.featuredImageId??null:body.featuredImageId===null?null:required(body.featuredImageId);
    if(featuredImageId!==null && !blocks.some(block=>block.type==='image' && block.imageId===featuredImageId))featuredImageId=null;
    if(featuredImageId!==null)new Images(this.store).require(vault,featuredImageId);
    const requestedSourceIds=body.sourceIds ?? page.sourceIds;
    if(!Array.isArray(requestedSourceIds))throw new HttpError(400,'Page sources must be Source entities in this vault');
    const sourceIds=[...new Set([...requestedSourceIds,...citationSourceIds(blocks)])];
    if(!Array.isArray(sourceIds)||sourceIds.length>1000||sourceIds.some(s=>typeof s!=='string'||this.knowledge.find(vault,s)?.type!=='source'))throw new HttpError(400,'Page sources must be Source entities in this vault');
    if(body.revision!==undefined && (!Number.isInteger(body.revision)||body.revision!==page.revision))throw new HttpError(409,'This page changed in another window. Reload the latest page before saving.');
    const names=new Map<string,string|undefined>();
    const aiStatus=nextPageAIStatus(page,{title,blocks},id=>{
      if(!names.has(id))names.set(id,entityMentionName(this.knowledge.find(vault,id)));
      return names.get(id);
    });
    this.store.transaction(()=>{
      const state=new PageEnrichmentState(this.store);
      if(title!==page.title)state.markManual(id,'title');
      if(language!==page.language) {
        state.markManual(id,'language');
        this.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'language',?,?,'manual','none',?) ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at",id,JSON.stringify({language,origin:'manual'}),page.revision+1,now());
      }
      syncSourceReferences(this.store,id,blocks);
      this.store.run('UPDATE pages SET title=?,language=?,icon=?,featured_image_id=?,blocks=?,ai_status=?,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',title,language,icon,featuredImageId,JSON.stringify(blocks),aiStatus,now(),id,vault);
      this.store.run('DELETE FROM page_sources WHERE page_id=?',id);
      for(const source of new Set(sourceIds as string[]))this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
      if(title!==page.title && (!page.title.trim()||page.title.trim()==='Untitled')) {
        const generated=this.store.get<{data:string;revision:number}>("SELECT data,revision FROM page_ai_enrichments WHERE page_id=? AND kind='title'",id);
        if(generated?.revision===page.revision && JSON.parse(generated.data).title===title) new AINotifications(this.store).record(vault,id,'page_title');
      }
    });
    this.cleanupImages(vault,[...this.imageIds(page.blocks),...(page.featuredImageId?[page.featuredImageId]:[])]);
    return this.get(vault,id);
  }
  delete(vault: string, id: string) {
    this.requireEditable(vault,id);
    this.store.run('UPDATE pages SET deleted_at=?,revision=revision+1 WHERE id=? AND vault_id=? AND deleted_at IS NULL',this.clock().toISOString(),id,vault);
    return {ok:true};
  }
  purgeExpired(vault?: string) {
    const cutoff = new Date(this.clock().getTime() - trashRetentionMs).toISOString();
    const expired=this.store.all<{vault_id:string; blocks:string;featured_image_id:string|null}>('SELECT vault_id,blocks,featured_image_id FROM pages WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday(?)' + (vault ? ' AND vault_id=?' : ''),cutoff,...(vault ? [vault] : []));
    const result=this.store.run('DELETE FROM pages WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday(?)' + (vault ? ' AND vault_id=?' : ''),cutoff,...(vault ? [vault] : []));
    for(const page of expired) this.cleanupImages(page.vault_id,[...this.imageIds(JSON.parse(page.blocks) as Block[]),...(page.featured_image_id?[page.featured_image_id]:[])]);
    return result;
  }
  trash(vault: string): TrashedPage[] {
    this.purgeExpired(vault);
    return this.store.all<PageSummary & {deleted_at: string}>('SELECT id,title,icon,featured_image_id AS featuredImageId,ai_status AS aiStatus,language,updated_at,deleted_at FROM pages WHERE vault_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id',vault).map(page => ({...page,expires_at:new Date(Date.parse(page.deleted_at) + trashRetentionMs).toISOString()}));
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
    const row=this.store.get<{blocks:string;featured_image_id:string|null}>('SELECT blocks,featured_image_id FROM pages WHERE id=? AND vault_id=?',id,vault)!;
    this.store.run('DELETE FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NOT NULL',id,vault);
    this.cleanupImages(vault,[...this.imageIds(JSON.parse(row.blocks) as Block[]),...(row.featured_image_id?[row.featured_image_id]:[])]);
    return {ok:true};
  }
}
