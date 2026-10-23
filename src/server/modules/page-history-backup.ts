import {randomUUID} from 'node:crypto';
import type {PageHistorySnapshot,PageVersionKind} from '../../shared/page-history.js';
import {isPageAIStatus} from '../../shared/page-ai-status.js';
import {isPageIconId} from '../../shared/page-icons.js';
import {parsePageGenerationMetadata} from '../../shared/page-generation.js';
import {domainById} from '../../shared/domains.js';
import {Store} from '../store.js';
import {HttpError,object,required,text} from '../validation.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {historyHash} from './page-history.js';

type Row=Record<string,unknown>;
export type DetachedSourceEvidenceMaps={generations:Map<string,string>;passages:Map<string,string>};
/** These source-processing rows are not archived. Keep evidence detached and consistent. */
export function remapDetachedSourceEvidence(value:Row,maps:DetachedSourceEvidenceMaps):Partial<Record<'generationId'|'passageId',string>> {
  const result:Partial<Record<'generationId'|'passageId',string>>={};
  for(const [key,map] of [['generationId',maps.generations],['passageId',maps.passages]] as const)if(value[key]!==undefined) {
    const id=required(value[key]);if(!map.has(id))map.set(id,randomUUID());result[key]=map.get(id)!;
  }
  return result;
}
type Maps={evidence:DetachedSourceEvidenceMaps;pages:Map<string,string>;entities:Map<string,string>;files:Map<string,string>;images:Map<string,string>;citations:Map<string,string>;detachedEntities?:Map<string,string>;detachedFiles?:Map<string,string>};
const invalid=()=>new HttpError(400,'This backup contains invalid page history or missing historical assets.');
const kinds:PageVersionKind[]=['baseline','created','edit','ai_acceptance','import','checkpoint','restore'];
function list(value:unknown):unknown[] {if(!Array.isArray(value)||value.length>2000)throw invalid();return value;}
function date(value:unknown):string {const result=text(value,100);if(!Number.isFinite(Date.parse(result)))throw invalid();return result;}
function integer(value:unknown,min:number):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw invalid();return value;}
/** History is imported inside the vault's transaction; no invented legacy versions. */
export function restorePageVersions(store:Store,vault:string,rows:Row[],maps:Maps):void {
  const versionsById=new Map(rows.map(row=>[row.id,row]));
  const versionIds=new Map<string,string>(),detached=new Map<string,Map<string,string>>([['entity',maps.detachedEntities??new Map()],['file',maps.detachedFiles??new Map()]]);
  const strict=(map:Map<string,string>,value:unknown)=>{const id=required(value),mapped=map.get(id);if(!mapped)throw invalid();return mapped;};
  // A deleted historical target stays detached, with one consistent new identity.
  // Never bind a restored archive to an entity in another vault or recreate it.
  const reference=(kind:string,map:Map<string,string>,value:unknown)=>{
    const id=required(value),existing=map.get(id);if(existing)return existing;
    let missing=detached.get(kind);if(!missing){missing=new Map();detached.set(kind,missing);}
    if(!missing.has(id))missing.set(id,randomUUID());return missing.get(id)!;
  };
  for(const row of rows){const id=required(row.id);if(versionIds.has(id))throw invalid();versionIds.set(id,randomUUID());}
  const pages=new Pages(store,new Knowledge(store));
  for(const row of rows) {
    const pageId=strict(maps.pages,row.page_id),pageRevision=integer(row.page_revision,1);
    const current=store.get<{revision:number}>('SELECT revision FROM pages WHERE id=? AND vault_id=?',pageId,vault);
    if(!current||pageRevision>current.revision||!kinds.includes(row.kind as PageVersionKind)||(row.pinned!==0&&row.pinned!==1))throw invalid();
    let original:PageHistorySnapshot;
    try {original=JSON.parse(text(row.snapshot_json,256*1024*1024)) as PageHistorySnapshot;}catch{throw invalid();}
    const value=object(original);
    if(value.version!==1||typeof value.aiReviewAccepted!=='boolean'||!isPageAIStatus(value.aiStatus)||value.creationMethod!==null&&value.creationMethod!=='manual_creation'&&value.creationMethod!=='ai_generated')throw invalid();
    if(value.icon!==null&&!isPageIconId(value.icon)||value.language!==null&&typeof value.language!=='string')throw invalid();
    if(typeof row.content_hash!=='string'||historyHash(original)!==row.content_hash)throw invalid();
    const sourceIds=list(value.sourceIds).map(id=>{
      const mapped=reference('entity',maps.entities,id),target=store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',mapped,vault);
      if(target&&target.type!=='source')throw invalid();return mapped;
    });
    if(new Set(sourceIds).size!==sourceIds.length)throw invalid();
    const blocks=list(value.blocks).map(item=>{
      const block={...object(item)};
      const segments=(items:unknown)=>list(items).map(item=>{
        const segment={...object(item)};
        if(segment.entityId)segment.entityId=reference('entity',maps.entities,segment.entityId);
        if(segment.sourceReference!==undefined) {
          const citation={...object(segment.sourceReference)};
          citation.id=reference('citation',maps.citations,citation.id);
          citation.sourceId=reference('entity',maps.entities,citation.sourceId);
          citation.fileId=reference('file',maps.files,citation.fileId);
          segment.sourceReference={...citation,...remapDetachedSourceEvidence(citation,maps.evidence)};
        }
        return segment;
      });
      block.content=segments(block.content);
      if(block.type==='image')block.imageId=strict(maps.images,block.imageId);
      if(block.rows!==undefined)block.rows=list(block.rows).map(row=>list(row).map(segments));
      return block;
    });
    const domainIds=new Set<string>();let primaryCount=0;
    const manualDomains=list(value.manualDomains).map(item=>{
      const domain=object(item),domainId=required(domain.domain_id);
      if(domainIds.has(domainId)||!domainById(domainId)||!['primary','secondary'].includes(String(domain.role))||domain.origin!=='manual')throw invalid();
      domainIds.add(domainId);if(domain.role==='primary'&&++primaryCount>1)throw invalid();
      return {domain_id:domainId,role:String(domain.role),origin:'manual',updated_at:date(domain.updated_at)};
    });
    const fieldOrigins:PageHistorySnapshot['fieldOrigins']={};
    for(const [key,origin] of Object.entries(object(value.fieldOrigins))) {
      if(!['title','language','domains'].includes(key)||!['manual','inferred','unknown'].includes(String(origin)))throw invalid();
      fieldOrigins[key as keyof typeof fieldOrigins]=origin as 'manual'|'inferred'|'unknown';
    }
    if(value.featuredImageId!==null&&!blocks.some(block=>block.type==='image'&&block.imageId===strict(maps.images,value.featuredImageId)))throw invalid();
    const snapshot:PageHistorySnapshot={version:1,title:text(value.title,500),blocks:pages.validateBlocks(vault,blocks,true),icon:value.icon as string|null,featuredImageId:value.featuredImageId===null?null:strict(maps.images,value.featuredImageId),language:value.language===null?null:text(value.language,100),sourceIds,aiStatus:value.aiStatus as string,aiReviewAccepted:value.aiReviewAccepted,generationMetadata:parsePageGenerationMetadata(value.generationMetadata),creationMethod:value.creationMethod,manualDomains,fieldOrigins};
    if(value.readingNote!==undefined) {
      const note=object(value.readingNote),anchor=object(note.reference),sourceHash=text(note.sourceHash,64),startOffset=integer(note.startOffset,0),endOffset=integer(note.endOffset,startOffset+1),excerpt=text(note.excerpt,65536);
      if(!/^[a-f0-9]{64}$/.test(sourceHash)||excerpt.length!==endOffset-startOffset||anchor.sourceHash!==sourceHash||anchor.startOffset!==startOffset||anchor.endOffset!==endOffset||anchor.excerpt!==excerpt)throw invalid();
      if(note.sourceId!==null&&anchor.sourceId!==note.sourceId||note.fileId!==null&&anchor.fileId!==note.fileId)throw invalid();
      const sourceId=note.sourceId===null?null:reference('entity',maps.entities,note.sourceId),fileId=note.fileId===null?null:reference('file',maps.files,note.fileId);
      if(sourceId){const target=store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',sourceId,vault);if(target&&target.type!=='source')throw invalid();}
      if(sourceId&&fileId){const file=store.get<{entity_id:string}>('SELECT entity_id FROM source_files WHERE id=? AND vault_id=?',fileId,vault);if(file&&file.entity_id!==sourceId)throw invalid();}
      snapshot.readingNote={sourceId,fileId,sourceHash,startOffset,endOffset,excerpt,createdAt:date(note.createdAt),reference:{...anchor,...remapDetachedSourceEvidence(anchor,maps.evidence),id:reference('citation',maps.citations,anchor.id),sourceId:sourceId??reference('entity',maps.entities,anchor.sourceId),fileId:fileId??reference('file',maps.files,anchor.fileId),startLine:integer(anchor.startLine,1),endLine:integer(anchor.endLine,integer(anchor.startLine,1))}};
    }
    const id=strict(versionIds,row.id),restoredFrom=row.restored_from_version_id===null?null:reference('version',versionIds,row.restored_from_version_id);
    if(row.restored_from_version_id!==null) {
      const source=versionsById.get(row.restored_from_version_id);
      if(source&&source.page_id!==row.page_id&&row.kind!=='created')throw invalid();
    }
    store.run('INSERT INTO page_versions (id,vault_id,page_id,page_revision,created_at,kind,name,pinned,content_hash,snapshot_json,restored_from_version_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,vault,pageId,pageRevision,date(row.created_at),row.kind as string,row.name===null?null:text(row.name,200),row.pinned,historyHash(snapshot),JSON.stringify(snapshot),restoredFrom);
    const imageIds=new Set(snapshot.blocks.flatMap(block=>block.type==='image'&&block.imageId?[block.imageId]:[]));
    if(snapshot.featuredImageId)imageIds.add(snapshot.featuredImageId);
    for(const imageId of imageIds)store.run('INSERT INTO page_version_images (version_id,image_id) VALUES (?,?)',id,imageId);
  }
}
