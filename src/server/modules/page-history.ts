import {createHash,randomUUID} from 'node:crypto';
import type {PageHistorySnapshot,PageVersion,PageVersionDetail,PageVersionKind} from '../../shared/page-history.js';
import type {Block,Page} from '../../shared/domain.js';
import type {Pages} from './pages.js';
import {Store} from '../store.js';
import {HttpError,now,text} from '../validation.js';
import {PageEnrichmentState} from './page-enrichment-state.js';
import {syncSourceReferences} from './source-references.js';
import {TAXONOMY_VERSION} from '../../shared/domains.js';
import {Images} from './images.js';
import {Vaults} from './vaults.js';
import {syncReadingNotesCollection} from './reading-notes-collection.js';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
export type {PageHistorySnapshot} from '../../shared/page-history.js';
/** Stable canonical serialization makes key order immaterial and does no work until persistence. */
function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
export function historyHash(snapshot:PageHistorySnapshot) {
 const authored={...snapshot,title:snapshot.fieldOrigins.title==='inferred'||snapshot.fieldOrigins.title!=='manual'&&(!snapshot.title.trim()||snapshot.title.trim()==='Untitled')?null:snapshot.title,fieldOrigins:Object.fromEntries(Object.entries(snapshot.fieldOrigins).filter(([,origin])=>origin==='manual')),language:snapshot.fieldOrigins.language==='inferred'?null:snapshot.language,manualDomains:snapshot.manualDomains.map(({domain_id,role,origin})=>({domain_id,role,origin}))};
 return createHash('sha256').update(stable(authored)).digest('hex');
}
type Row={id:string;page_id:string;page_revision:number;created_at:string;kind:PageVersionKind;name:string|null;pinned:number;content_hash:string;snapshot_json:string;restored_from_version_id:string|null};
function summary(row:Row):PageVersion {return {id:row.id,pageId:row.page_id,pageRevision:row.page_revision,createdAt:row.created_at,kind:row.kind,name:row.name,pinned:!!row.pinned,contentHash:row.content_hash,restoredFromVersionId:row.restored_from_version_id};}
/** No scheduling or pruning: preservation is the default. Retention requires a future explicit opt-in. */
export class PageHistory {
 constructor(private store:Store) {}
 private page(vault:string,id:string,editable=false) {
  new Vaults(this.store).requireOpen(vault);
  const row=this.store.get<{revision:number;deleted_at:string|null}>('SELECT revision,deleted_at FROM pages WHERE id=? AND vault_id=?',id,vault);
  if(!row)throw new HttpError(404,'Page not found');
  if(editable&&row.deleted_at)throw new HttpError(409,'Restore this page from Trash before editing its history.');
  if(editable&&this.store.get('SELECT 1 FROM page_edit_locks WHERE page_id=? AND vault_id=?',id,vault))throw new HttpError(423,'Unlock this page before restoring or naming a version.');
  return row;
 }
 canonical(vault:string,id:string):PageHistorySnapshot {
  const p=this.store.get<{title:string;blocks:string;icon:string|null;featured_image_id:string|null;language:string|null;ai_status:string;ai_review_accepted:number;generation_metadata:string|null;creation_method:Page['creationMethod']}>('SELECT * FROM pages WHERE id=? AND vault_id=?',id,vault);
  if(!p)throw new HttpError(404,'Page not found');
  const fields=new PageEnrichmentState(this.store).get(id).fields;
  const note=this.store.get<{source_id:string|null;file_id:string|null;source_hash:string;start_offset:number;end_offset:number;excerpt:string;reference_json:string;created_at:string}>('SELECT * FROM page_reading_notes WHERE page_id=? AND vault_id=?',id,vault);
  const readingNote=note?{sourceId:note.source_id,fileId:note.file_id,sourceHash:note.source_hash,startOffset:note.start_offset,endOffset:note.end_offset,excerpt:note.excerpt,reference:JSON.parse(note.reference_json) as Record<string,unknown>,createdAt:note.created_at}:undefined;
  return {...(readingNote?{readingNote}:{}),version:1,title:p.title,blocks:JSON.parse(p.blocks) as Block[],icon:p.icon??null,featuredImageId:p.featured_image_id??null,language:p.language??null,sourceIds:this.store.all<{source_id:string}>('SELECT source_id FROM page_sources WHERE page_id=? ORDER BY source_id',id).map(r=>r.source_id),aiStatus:p.ai_status,aiReviewAccepted:!!p.ai_review_accepted,generationMetadata:p.generation_metadata?JSON.parse(p.generation_metadata) as Page['generationMetadata']:null,creationMethod:p.creation_method,manualDomains:this.store.all('SELECT domain_id,role,origin,updated_at FROM page_domains WHERE page_id=? AND origin=\'manual\' ORDER BY role,domain_id',id),fieldOrigins:Object.fromEntries((['title','language','domains'] as const).flatMap(k=>fields[k]?[ [k,fields[k]!.origin] ]:[]))};
 }
 /** Call only inside the successful content mutation transaction, before changing existing content. */
 baseline(vault:string,id:string) {if(!this.store.get('SELECT 1 FROM page_versions WHERE page_id=?',id))this.capture(vault,id,'baseline');}
 /** Capture all canonical authored fields in the same transaction as the page write. */
 capture(vault:string,id:string,kind:PageVersionKind='edit',options:{name?:string;restoredFromVersionId?:string;force?:boolean}={}):PageVersionDetail {
  const p=this.page(vault,id),snapshot=this.canonical(vault,id),hash=historyHash(snapshot);
  const last=this.store.get<Row>('SELECT * FROM page_versions WHERE page_id=? ORDER BY rowid DESC LIMIT 1',id);
  if(last?.content_hash===hash&&!options.force)return {...summary(last),snapshot:JSON.parse(last.snapshot_json) as PageHistorySnapshot};
  const versionId=randomUUID(),createdAt=now();
  this.store.run('INSERT INTO page_versions (id,vault_id,page_id,page_revision,created_at,kind,name,pinned,content_hash,snapshot_json,restored_from_version_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',versionId,vault,id,p.revision,createdAt,kind,options.name??null,kind==='checkpoint'||kind==='restore'?1:0,hash,JSON.stringify(snapshot),options.restoredFromVersionId??null);
  for(const imageId of new Set([snapshot.featuredImageId,...snapshot.blocks.flatMap(b=>b.imageId?[b.imageId]:[])].filter((v):v is string=>!!v)))this.store.run('INSERT INTO page_version_images VALUES (?,?)',versionId,imageId);
  return this.get(vault,id,versionId);
 }
 list(vault:string,id:string):PageVersion[] {this.page(vault,id);return this.store.all<Row>('SELECT id,page_id,page_revision,created_at,kind,name,pinned,content_hash,restored_from_version_id FROM page_versions WHERE vault_id=? AND page_id=? ORDER BY created_at DESC,rowid DESC',vault,id).map(summary);}
 get(vault:string,id:string,versionId:string):PageVersionDetail {this.page(vault,id);const row=this.store.get<Row>('SELECT * FROM page_versions WHERE vault_id=? AND page_id=? AND id=?',vault,id,versionId);if(!row)throw new HttpError(404,'Version not found');return {...summary(row),snapshot:JSON.parse(row.snapshot_json) as PageHistorySnapshot};}
 private latest(vault:string,id:string,revision:unknown) {const p=this.page(vault,id,true);if(!Number.isInteger(revision)||revision!==p.revision)throw new HttpError(409,'This page changed. Save and reload the latest page before using history.');}
 checkpoint(vault:string,id:string,body:Record<string,unknown>) {const name=text(body.name,200).trim();if(!name)throw new HttpError(400,'Name this checkpoint.');return this.store.transaction(()=>{this.latest(vault,id,body.revision);return this.capture(vault,id,'checkpoint',{name,force:true});});}
 private available(vault:string,s:PageHistorySnapshot) {
  const missing=new Set<string>();
  const entity=(id:string)=>{if(!this.store.get('SELECT 1 FROM entities WHERE id=? AND vault_id=?',id,vault))missing.add('entity or source');};
  for(const id of s.sourceIds)if(!this.store.get("SELECT 1 FROM entities WHERE id=? AND vault_id=? AND type='source'",id,vault))missing.add('source');
  if(s.readingNote?.sourceId)entity(s.readingNote.sourceId);
  if(s.readingNote?.fileId&&!this.store.get('SELECT 1 FROM source_files WHERE id=? AND vault_id=?',s.readingNote.fileId,vault))missing.add('reading file');
  for(const b of s.blocks) {
   if(b.imageId)try{new Images(this.store).require(vault,b.imageId);}catch{missing.add('image');}
   for(const segment of [...b.content,...(b.rows??[]).flatMap(row=>row.flat())]) {
    if(segment.entityId)entity(segment.entityId);
    if(segment.sourceReference) {entity(segment.sourceReference.sourceId);if(!this.store.get('SELECT 1 FROM source_files WHERE id=? AND entity_id=? AND vault_id=?',segment.sourceReference.fileId,segment.sourceReference.sourceId,vault))missing.add('citation file');}
   }
  }
  if(s.featuredImageId)try{new Images(this.store).require(vault,s.featuredImageId);}catch{missing.add('image');}
  if(missing.size)throw new HttpError(409,'This version references unavailable '+[...missing].join(', ')+'. It can still be previewed; restore is blocked to preserve references.');
 }
 private apply(vault:string,id:string,s:PageHistorySnapshot) {
  this.store.run('UPDATE pages SET title=?,blocks=?,icon=?,featured_image_id=?,language=?,ai_status=?,ai_review_accepted=?,generation_metadata=?,creation_method=?,summary_content_hash=NULL,updated_at=?,revision=revision+1 WHERE id=? AND vault_id=?',s.title,JSON.stringify(s.blocks),s.icon,s.featuredImageId,s.language,s.aiStatus,s.aiReviewAccepted?1:0,s.generationMetadata?JSON.stringify(s.generationMetadata):null,s.creationMethod??null,now(),id,vault);
  this.store.run('DELETE FROM page_sources WHERE page_id=?',id);for(const source of s.sourceIds)this.store.run('INSERT INTO page_sources VALUES (?,?)',id,source);
  syncSourceReferences(this.store,id,s.blocks);
  this.store.run('DELETE FROM page_reading_notes WHERE page_id=?',id);
  if(s.readingNote){const n=s.readingNote;this.store.run('INSERT INTO page_reading_notes (page_id,vault_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,vault,n.sourceId,n.fileId,n.sourceHash,n.startOffset,n.endOffset,n.excerpt,JSON.stringify(n.reference),n.createdAt);}
  syncReadingNotesCollection(this.store,vault);
  this.store.run('DELETE FROM page_domains WHERE page_id=?',id);
  for(const d of s.manualDomains)this.store.run('INSERT INTO page_domains (page_id,domain_id,role,origin,updated_at) VALUES (?,?,?,?,?)',id,d.domain_id,d.role,d.origin,now());
  this.store.run('DELETE FROM page_domain_state WHERE page_id=?',id);
  if(s.manualDomains.length||s.fieldOrigins.domains==='manual')this.store.run('INSERT INTO page_domain_state (page_id,origin,content_hash,taxonomy_version,revision) VALUES (?,\'manual\',NULL,?,1)',id,TAXONOMY_VERSION);
  const preferences=new PageEnrichmentState(this.store).get(id);
  this.store.run("DELETE FROM page_ai_enrichments WHERE page_id=?",id);
  this.store.run('DELETE FROM page_enrichment_jobs WHERE page_id=?',id);
  const state=new PageEnrichmentState(this.store);state.save(id,{version:1,fields:preferences.fields.summary?.suppressed?{summary:preferences.fields.summary}:{},...(preferences.automaticSummaries===undefined?{}:{automaticSummaries:preferences.automaticSummaries})});for(const k of ['title','language','domains'] as const)if(s.fieldOrigins[k])state.setField(id,k,{origin:s.fieldOrigins[k]!,updatedAt:now()});
 }
 restore(vault:string,id:string,versionId:string,body:Record<string,unknown>,pages:Pages) {
  this.store.transaction(()=>{
   this.latest(vault,id,body.revision);const s=this.get(vault,id,versionId).snapshot;this.available(vault,s);
   // Existing protected AI blocks cannot lose their provenance tag through restore.
   const current=this.canonical(vault,id),incoming=new Map(s.blocks.map(b=>[b.id,b]));
   if(current.blocks.some(b=>isAIExplanation(b)&&incoming.has(b.id)&&!isAIExplanation(incoming.get(b.id)!)))throw new HttpError(409,'This version would remove an AI Explanation tag. Create a separate page instead.');
   this.baseline(vault,id);const before=this.capture(vault,id,'edit');this.store.run('UPDATE page_versions SET pinned=1 WHERE id IN (?,?)',before.id,versionId);this.apply(vault,id,s);this.capture(vault,id,'restore',{restoredFromVersionId:versionId,force:true});
  });return pages.get(vault,id);
 }
 copy(vault:string,id:string,versionId:string,body:Record<string,unknown>,pages:Pages) {
  let newId='';this.store.transaction(()=>{this.latest(vault,id,body.revision);const s=this.get(vault,id,versionId).snapshot;this.available(vault,s);newId=randomUUID();const date=now();this.store.run('INSERT INTO pages (id,title,blocks,updated_at,created_at,vault_id,creation_method) VALUES (?,?,?,?,?,?,?)',newId,s.title,JSON.stringify(s.blocks),date,date,vault,s.creationMethod??null);this.apply(vault,newId,s);this.capture(vault,newId,'created',{restoredFromVersionId:versionId,force:true});});return pages.get(vault,newId);
 }
}

/** Pure preview only. No runtime pruning is enabled, and this function never touches storage. */
export function planHistoryRetention(versions:readonly PageVersion[],clock=Date.now()):{enabled:false;keepIds:string[];candidateIds:string[]} {
 const keep=new Set<string>(),buckets=new Map<string,PageVersion>(),previousByPage=new Map<string,PageVersion>();
 const ordered=[...versions].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.pageRevision-b.pageRevision);
 for(let i=0;i<ordered.length;i++) {
  const version=ordered[i]!,time=Date.parse(version.createdAt),age=clock-time;
  if(version.pinned||version.name||version.kind==='checkpoint'||version.kind==='restore'||!Number.isFinite(time)||age<=7*86400000)keep.add(version.id);
  if(version.restoredFromVersionId)keep.add(version.restoredFromVersionId);
  const previous=previousByPage.get(version.pageId);
  if(version.kind==='restore'&&previous)keep.add(previous.id);
  previousByPage.set(version.pageId,version);
  const interval=age<=30*86400000?15*60000:age<=90*86400000?86400000:7*86400000;
  const bucket=version.pageId+':'+(age<=30*86400000?'quarter:':age<=90*86400000?'day:':'week:')+Math.floor(time/interval);
  const prior=buckets.get(bucket);
  if(!prior||time>=Date.parse(prior.createdAt))buckets.set(bucket,version);
 }
 for(const version of buckets.values())keep.add(version.id);
 for(const latest of previousByPage.values())keep.add(latest.id);
 return {enabled:false,keepIds:versions.filter(v=>keep.has(v.id)).map(v=>v.id),candidateIds:versions.filter(v=>!keep.has(v.id)).map(v=>v.id)};
}
