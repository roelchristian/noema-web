import {PageHistory} from './page-history.js';
import {parsePageGenerationMetadata} from '../../shared/page-generation.js';
import {parsePersonaIdentity} from '../../shared/ai-personas.js';
import {readingNoteMaxWords,readingNoteWordCount,type ReadingNoteMetadata} from '../../shared/source-reading.js';
import {syncReadingNotesCollection} from './reading-notes-collection.js';
import {projectPageText} from '../../shared/page-text.js';
import {citationSourceIds} from '../../shared/citations.js';
import {PageEnrichmentState} from './page-enrichment-state.js';
import {resolvePageTitle} from './page-title.js';
import {Domains} from './domains.js';
import {enrichCitationPages,syncSourceReferences} from './source-references.js';
import {pageLanguage} from './page-language.js';
import {nextPageAIStatus, reviewedPageAIStatus, type PageAIStatus} from '../../shared/page-ai-status.js';
import {allowedInColumn} from '../../shared/column-blocks.js';
import { entityMentionName } from '../../shared/domain.js';
import {blockPageLinks,resolvePageLink} from '../../shared/page-links.js';
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
type PageRow = Omit<Page, 'blocks' | 'sourceIds' | 'featuredImageId'> & {blocks: string; summary_content_hash: string | null; summary_hash_version:number; featured_image_id:string|null; ai_status:PageAIStatus;ai_review_accepted:number;generation_metadata:string|null;creation_method:Page['creationMethod']};
export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export class Pages {
  constructor(private store: Store, private knowledge: Knowledge, private clock: () => Date = () => new Date()) {}
  private cleanupImages(vault?: string, candidates?: string[]) {
    try { new Images(this.store).cleanup(vault,candidates); } catch { console.error('Image cleanup deferred'); }
  }
  private imageIds(blocks: Block[]) { return blocks.flatMap(block => block.type === 'image' && block.imageId ? [block.imageId] : []); }
  list(vault: string, includeArchived=false) {
    return this.store.all<PageSummary>(`SELECT id,title,icon,creation_method AS creationMethod,featured_image_id AS featuredImageId,
      ai_status AS aiStatus,ai_review_accepted AS aiReviewAccepted,language,updated_at,archived_at,
      EXISTS(SELECT 1 FROM json_each(pages.blocks) block WHERE json_extract(block.value,'$.semantic')='ai-explanation'
        OR json_extract(block.value,'$.semanticGroup.kind')='ai-explanation') AS containsAIExplanations,
      EXISTS(SELECT 1 FROM page_reading_notes r WHERE r.page_id=pages.id AND r.vault_id=pages.vault_id) AS isReadingNote,
      EXISTS(SELECT 1 FROM entity_page_associations a JOIN entities e ON e.id=a.entity_id WHERE a.page_id=pages.id AND e.vault_id=pages.vault_id) AS hasEntityAssociations
      FROM pages WHERE vault_id=? AND deleted_at IS NULL AND (?=1 OR archived_at IS NULL) ORDER BY updated_at DESC`,vault,includeArchived?1:0).map(page=>({...page,
        containsAIExplanations:!!page.containsAIExplanations,isReadingNote:!!page.isReadingNote,
        hasEntityAssociations:!!page.hasEntityAssociations,aiReviewAccepted:!!page.aiReviewAccepted,
        aiStatus:reviewedPageAIStatus(page.aiStatus??'regular',!!page.aiReviewAccepted)}));
  }
  // Triage is a read of stored content, with no domain assessment, match cache or enrichment.
  preview(vault:string,id:string):import('../../shared/domain.js').PagePreview {
    const row=this.store.get<{id:string;title:string;blocks:string;revision:number;updated_at:string}>('SELECT id,title,blocks,revision,updated_at FROM pages WHERE vault_id=? AND id=? AND deleted_at IS NULL',vault,id);
    if(!row)throw new HttpError(404,'Page not found');
    const blocks=JSON.parse(row.blocks) as Block[];
    return {...row,blocks:blocks.slice(0,80),truncated:blocks.length>80};
  }
  backlinks(vault:string,id:string):PageSummary[] {
    this.get(vault,id);
    const catalog=this.store.all<PageSummary>('SELECT id,title FROM pages WHERE vault_id=? AND deleted_at IS NULL',vault);
    const candidates=this.store.all<PageSummary & {blocks:string}>("SELECT id,title,icon,ai_status AS aiStatus,ai_review_accepted AS aiReviewAccepted,language,updated_at,archived_at,blocks FROM pages WHERE vault_id=? AND deleted_at IS NULL AND id<>? AND instr(blocks,'[[')>0 ORDER BY title COLLATE NOCASE,id",vault,id);
    return candidates.flatMap(({blocks,...page})=>blockPageLinks(JSON.parse(blocks) as Block[]).some(link=>resolvePageLink(link,catalog).length===1&&resolvePageLink(link,catalog)[0]!.id===id)?[{...page,aiReviewAccepted:!!page.aiReviewAccepted,aiStatus:reviewedPageAIStatus(page.aiStatus??'regular',!!page.aiReviewAccepted)}]:[]);
  }
  associations(vault:string,id:string):import('../../shared/domain.js').PagePageAssociation[] {
    this.get(vault,id);
    return this.store.all<Omit<import('../../shared/domain.js').PagePageAssociation,'pinned'> & {pinned:number}>(`SELECT p.id,p.title,p.icon,p.updated_at,p.archived_at,a.pinned,a.annotation,a.created_at FROM page_page_associations a JOIN pages p ON p.id=CASE WHEN a.source_id=? THEN a.target_id ELSE a.source_id END WHERE (a.source_id=? OR a.target_id=?) AND p.vault_id=? AND p.deleted_at IS NULL ORDER BY a.pinned DESC,p.title COLLATE NOCASE,p.id`,id,id,id,vault).map(row=>({...row,pinned:!!row.pinned}));
  }
  associate(vault:string,id:string,targetId:string,body:Record<string,unknown>) {
    this.requireEditable(vault,id);this.requireActive(vault,targetId);
    if(id===targetId)throw new HttpError(400,'Choose another page.');
    if(body.pinned!==undefined&&typeof body.pinned!=='boolean')throw new HttpError(400,'Pinned must be a boolean.');
    const [source,target]=[id,targetId].sort() as [string,string];
    const existing=this.store.get<{pinned:number;annotation:string}>('SELECT pinned,annotation FROM page_page_associations WHERE source_id=? AND target_id=?',source,target);
    const annotation=body.annotation===undefined?existing?.annotation??'':text(body.annotation,2000);
    const pinned=body.pinned===undefined?existing?.pinned??0:body.pinned?1:0;
    this.store.run('INSERT INTO page_page_associations (source_id,target_id,pinned,annotation,created_at) VALUES (?,?,?,?,?) ON CONFLICT(source_id,target_id) DO UPDATE SET pinned=excluded.pinned,annotation=excluded.annotation',source,target,pinned,annotation,now());
    return this.associations(vault,id);
  }
  removeAssociation(vault:string,id:string,targetId:string) {
    this.requireEditable(vault,id);this.get(vault,targetId);
    const [source,target]=[id,targetId].sort() as [string,string];
    this.store.run('DELETE FROM page_page_associations WHERE source_id=? AND target_id=?',source,target);
    return this.associations(vault,id);
  }
  get(vault: string, id: string): Page {
    const row=this.store.get<PageRow>('SELECT * FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,vault);
    if (!row) throw new HttpError(404,'Page not found');
    const {summary_content_hash: cachedHash, summary_hash_version: hashVersion, featured_image_id: featuredImageId, ai_status: aiStatus, ai_review_accepted: aiReviewAccepted, generation_metadata: generationMetadata, creation_method: creationMethod, ...stored} = row;
    stored.title=resolvePageTitle(this.store,stored);
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
    if(!stored.archived_at)domainService.assess({...stored,blocks,conceptContentHash:conceptContentHash({...stored,blocks},resolveName)} as Page,resolveName);
    const readingRow=this.store.get<{source_id:string|null;file_id:string|null;source_hash:string;start_offset:number;end_offset:number;excerpt:string;reference_json:string;created_at:string}>('SELECT * FROM page_reading_notes WHERE page_id=? AND vault_id=?',id,vault);
    const readingNote:ReadingNoteMetadata|undefined=readingRow?{...JSON.parse(readingRow.reference_json),sourceId:readingRow.source_id,fileId:readingRow.file_id,sourceHash:readingRow.source_hash,startOffset:readingRow.start_offset,endOffset:readingRow.end_offset,excerpt:readingRow.excerpt,createdAt:readingRow.created_at,maxWords:200}:undefined;
    const enrichmentState=new PageEnrichmentState(this.store).get(id);
    const queued=this.store.get<{fields:string}>('SELECT fields FROM page_enrichment_jobs WHERE page_id=?',id);
    let enrichmentPendingFields:NonNullable<Page['enrichmentPendingFields']>=[];
    if(queued)try {
      const fields:unknown=JSON.parse(queued.fields);
      if(Array.isArray(fields))enrichmentPendingFields=(['title','domains','language','summary'] as const).filter(field=>fields.includes(field)&&enrichmentState.fields[field]?.origin!=='manual'&&!enrichmentState.fields[field]?.suppressed);
    }catch{/* Invalid queue data cannot claim a particular field is being generated. */}
    if(this.store.get<{automatic_summaries:number}>('SELECT automatic_summaries FROM page_enrichment_settings WHERE vault_id=?',vault)?.automatic_summaries===0)enrichmentPendingFields=enrichmentPendingFields.filter(field=>field!=='summary');
    return {...stored,creationMethod,editedAfterGeneration:aiStatus==='ai_generated_edited',containsAIExplanations:blocks.some(isAIExplanation),aiReviewAccepted:!!aiReviewAccepted,generationMetadata:parsePageGenerationMetadata(generationMetadata),...(readingNote?{readingNote}:{}),enrichmentFields:enrichmentState.fields,enrichmentPending:!!queued,enrichmentPendingFields,pageDomains:domainService.get(id,conceptContentHash({...stored,blocks},resolveName)),aiStatus:reviewedPageAIStatus(aiStatus,!!aiReviewAccepted),editLocked:!!editLock,editProtected:!!editLock?.password_hash,featuredImageId,blocks,conceptClassification,conceptContentHash:conceptContentHash({...stored,blocks},resolveName),summaryContentHash:hash,sourceIds:[...new Set([...this.store.all<{source_id:string}>('SELECT source_id FROM page_sources WHERE page_id=?',id).map(s=>s.source_id),...citationSourceIds(blocks).filter(sourceId=>this.knowledge.find(vault,sourceId)?.type==='source')])]};
  }
  requireActive(vault:string,id:string) {
    const page=this.get(vault,id);
    if(page.archived_at)throw new HttpError(409,'This page is archived. Restore it before making changes.');
    return page;
  }
  archiveList(vault:string):import('../../shared/domain.js').ArchivedPage[] {
    return this.list(vault,true).filter(page=>page.archived_at).map(page=>{
      const location=this.store.get<{folderId:string|null;folderName:string|null}>("SELECT f.id AS folderId,f.name AS folderName FROM item_locations l LEFT JOIN folders f ON f.id=l.folder_id AND f.vault_id=l.vault_id WHERE l.vault_id=? AND l.kind='page' AND l.item_id=?",vault,page.id);
      return {...page,archived_at:page.archived_at!,revision:this.store.get<{revision:number}>('SELECT revision FROM pages WHERE id=?',page.id)!.revision,folderId:location?.folderId??null,folderName:location?.folderName??null,
        collectionIds:this.store.all<{collection_id:string}>("SELECT collection_id FROM collection_memberships WHERE vault_id=? AND kind='page' AND item_id=?",vault,page.id).map(row=>row.collection_id),
        subjectIds:this.store.all<{domain_id:string}>('SELECT domain_id FROM page_domains WHERE page_id=?',page.id).map(row=>row.domain_id)};
    }).sort((a,b)=>b.archived_at.localeCompare(a.archived_at)||a.id.localeCompare(b.id));
  }
  setArchived(vault:string,id:string,archived:boolean,body:Record<string,unknown>) {
    this.store.transaction(()=>{
      const page=this.get(vault,id);
      // Repeating an already achieved transition is harmless, including a lost response retry.
      if(!!page.archived_at===archived)return;
      if(body.revision!==page.revision)throw new HttpError(409,'This page changed. Reload it before changing its archive state.');
      this.store.run('UPDATE pages SET archived_at=?,revision=revision+1 WHERE id=? AND vault_id=?',archived?this.clock().toISOString():null,id,vault);
      if(archived)this.store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',id);
    });
    return this.get(vault,id);
  }
  requireEditable(vault: string, id: string) {
    const page=this.get(vault,id);
    if (page.archived_at) throw new HttpError(409,'This page is archived. Restore it before making changes.');
    if (page.editLocked) throw new HttpError(423,'This page is locked for editing. Unlock it to make changes.');
    return page;
  }
  setEditLock(vault: string, id: string, body: Record<string,unknown>) {
    const page=this.requireActive(vault,id);
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
  create(vault: string, body: Record<string, unknown>, captureHistory=true) {
    const id=randomUUID(),createdAt=now();
    const destination=body.destination===undefined?{}:object(body.destination);
    const collection=destination.collection == null || destination.collection === '' ? null : required(destination.collection);
    const folder=destination.folder == null || destination.folder === '' ? null : required(destination.folder);
    // A savepoint also works when source-page acceptance owns the outer transaction.
    this.store.db.exec('SAVEPOINT create_page');
    try {
      if(collection&&!this.store.get('SELECT id FROM collections WHERE id=? AND vault_id=?',collection,vault))throw new HttpError(404,'Collection not found');
      if(folder&&!this.store.get('SELECT id FROM folders WHERE id=? AND vault_id=?',folder,vault))throw new HttpError(404,'Folder not found');
      this.store.run("INSERT INTO pages (id,title,language,blocks,updated_at,created_at,vault_id,creation_method) VALUES (?,?,?,?,?,?,?,'manual_creation')",id,required(body.title || 'Untitled'),pageLanguage(body.language),JSON.stringify([{id:randomUUID(),type:'paragraph',checked:false,content:[]}]),createdAt,createdAt,vault);
      if(collection)this.store.run('INSERT INTO collection_memberships VALUES (?,?,?,?)',vault,'page',id,collection);
      if(folder)this.store.run('INSERT INTO item_locations VALUES (?,?,?,?)',vault,'page',id,folder);
      const provenance=new PageEnrichmentState(this.store);
      if(typeof body.title==='string'&&body.title.trim()&&body.title.trim()!=='Untitled')provenance.markManual(id,'title');
      if(pageLanguage(body.language))provenance.markManual(id,'language');
      if(captureHistory)new PageHistory(this.store).capture(vault,id,'created');
      this.store.db.exec('RELEASE create_page');
    } catch(error) {
      this.store.db.exec('ROLLBACK TO create_page; RELEASE create_page');
      throw error;
    }
    return this.get(vault,id);
  }
  validateBlocks(vault: string, input: unknown, historical=false): Block[] {
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
            if(!historical&&!this.knowledge.find(vault,entityId))throw new HttpError(400,'Referenced entity does not exist');
            return {entityId, ...(segment.skipAutoTag === true ? {skipAutoTag:true} : {}), ...(segment.mentionText !== undefined ? {mentionText: text(segment.mentionText,10000)} : {})};
          }
          const result: Segment = {text:text(segment.text)};
          for (const mark of ['bold','italic','underline','strike','superscript','subscript','code','math','skipAutoTag'] as const) if(segment[mark] === true) result[mark]=true;
          if(segment.bibliographicReference!==undefined) {
            const ref=object(segment.bibliographicReference),sourceId=required(ref.sourceId);
            if(segment.sourceReference||segment.math||segment.code||segment.href)throw new HttpError(400,'Invalid bibliographic citation');
            if(!historical&&this.knowledge.find(vault,sourceId)?.type!=='source')throw new HttpError(400,'Invalid bibliographic source');
            if(ref.label!==undefined&&!['page','chapter','section'].includes(ref.label as string))throw new HttpError(400,'Invalid bibliographic locator label');
            result.bibliographicReference={id:required(ref.id),sourceId,...(ref.locator===undefined?{}:{locator:text(ref.locator,1000)}),...(ref.label===undefined?{}:{label:ref.label as 'page'|'chapter'|'section'})};
          }
          if(segment.sourceReference!==undefined) {
            const ref=object(segment.sourceReference),sourceId=required(ref.sourceId),fileId=required(ref.fileId);
            if(!historical&&(this.knowledge.find(vault,sourceId)?.type!=='source'||!this.store.get('SELECT 1 FROM source_files WHERE id=? AND entity_id=? AND vault_id=?',fileId,sourceId,vault)))throw new HttpError(400,'Invalid citation source');
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
      if(b.writingProvenance!==undefined){
        if(!Array.isArray(b.writingProvenance)||b.writingProvenance.length>100)throw new HttpError(400,'Invalid writing provenance.');
        block.writingProvenance=b.writingProvenance.map(value=>{
          const item=object(value);
          if(!['proofread','refine','rewrite','recast'].includes(String(item.action))||typeof item.acceptedAt!=='string'||!Number.isFinite(Date.parse(item.acceptedAt)))throw new HttpError(400,'Invalid writing provenance.');
          let persona;try{persona=parsePersonaIdentity(item.persona);}catch{throw new HttpError(400,'Invalid writing persona.');}
          return {action:item.action as import('../../shared/editor-review.js').WritingAction,acceptedAt:item.acceptedAt,...(persona?{persona}:{})};
        });
      }
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
        if(group.kind==='ai-explanation'&&group.persona!==undefined){try{block.semanticGroup.persona=parsePersonaIdentity(group.persona);}catch{throw new HttpError(400,'Invalid explanation persona.');}}
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
    const page=this.requireEditable(vault,id),blocks=this.validateBlocks(vault,body.blocks);
    const incomingTitle=text(body.title,500);
    const authored=this.store.get<{title:string}>('SELECT title FROM pages WHERE id=?',id)!;
    // Background enrichment does not advance the authored revision. A body-only
    // autosave may therefore still carry the placeholder from before generation.
    const stalePlaceholder=body.titleEdited!==true&&(!incomingTitle.trim()||incomingTitle.trim()==='Untitled')
      &&incomingTitle===authored.title&&page.title!==authored.title
      &&new PageEnrichmentState(this.store).get(id).fields.title?.origin==='inferred';
    const title=stalePlaceholder?page.title:incomingTitle;
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
    const aiStatus=nextPageAIStatus(page,{title,blocks,editedAfterGeneration:body.editedAfterGeneration===true,aiReviewAccepted:body.aiReviewAccepted===true},id=>{
      if(!names.has(id))names.set(id,entityMentionName(this.knowledge.find(vault,id)));
      return names.get(id);
    });
    // ai_status retains the original schema's origin values; accepted reviews
    // are persisted independently and projected as ai_assisted when reading.
    const storedAIStatus=aiStatus==='ai_assisted'?(blocks.some(isAIExplanation)?'regular_with_ai_explanations':'regular'):aiStatus;
    this.store.transaction(()=>{
      const current=this.store.get<{revision:number}>('SELECT revision FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL AND archived_at IS NULL',id,vault);
      if(!current||current.revision!==page.revision)throw new HttpError(409,'This page changed in another window. Reload the latest page before saving.');
      const history=new PageHistory(this.store);history.baseline(vault,id);
      const state=new PageEnrichmentState(this.store);
      if(title!==page.title||body.titleEdited===true)state.markManual(id,'title');
      if(language!==page.language) {
        state.markManual(id,'language');
        this.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'language',?,?,'manual','none',?) ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at",id,JSON.stringify({language,origin:'manual'}),page.revision+1,now());
      }
      syncSourceReferences(this.store,id,blocks);
      this.store.run('UPDATE pages SET title=?,language=?,icon=?,featured_image_id=?,blocks=?,ai_status=?,ai_review_accepted=MAX(ai_review_accepted,?),updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',title,language,icon,featuredImageId,JSON.stringify(blocks),storedAIStatus,body.aiReviewAccepted===true?1:0,now(),id,vault);
      this.store.run('DELETE FROM page_sources WHERE page_id=?',id);
      for(const source of new Set(sourceIds as string[]))this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
      history.capture(vault,id,'edit');
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
    this.store.transaction(()=>{
      this.store.run('UPDATE pages SET deleted_at=?,revision=revision+1 WHERE id=? AND vault_id=? AND deleted_at IS NULL',this.clock().toISOString(),id,vault);
      syncReadingNotesCollection(this.store,vault);
    });
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
    return this.store.all<PageSummary & {deleted_at: string}>('SELECT id,title,icon,featured_image_id AS featuredImageId,ai_status AS aiStatus,ai_review_accepted AS aiReviewAccepted,language,updated_at,archived_at,deleted_at FROM pages WHERE vault_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id',vault).map(page => ({...page,aiReviewAccepted:!!page.aiReviewAccepted,aiStatus:reviewedPageAIStatus(page.aiStatus??'regular',!!page.aiReviewAccepted),expires_at:new Date(Date.parse(page.deleted_at) + trashRetentionMs).toISOString()}));
  }
  private trashed(vault: string, id: string) {
    this.purgeExpired(vault);
    const row = this.store.get('SELECT id FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NOT NULL',id,vault);
    if (!row) throw new HttpError(404,'Note not found in Trash');
  }
  restore(vault: string, id: string) {
    this.trashed(vault,id);
    this.store.transaction(()=>{
      this.store.run('UPDATE pages SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',this.clock().toISOString(),id,vault);
      syncReadingNotesCollection(this.store,vault);
    });
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
