import {createHash,randomUUID} from 'node:crypto';
import {entityMentionName,type Block} from '../../shared/domain.js';
import {projectPageText,type PageProjection} from '../../shared/page-text.js';
import {extractTemporal,temporalDate,temporalExtractorVersion,temporalOverlaps,type TemporalCalendar,type TemporalCuration,type TemporalDate,type TemporalEvidence,type TemporalExpression} from '../../shared/temporal.js';
import {Store} from '../store.js';
import {HttpError,text} from '../validation.js';
import {Vaults} from './vaults.js';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const temporalMentionId=(vault:string,pageId:string,blockId:string,blockHash:string,start:number,end:number)=>hash(JSON.stringify([vault,pageId,blockId,blockHash,start,end]));
type PageRow={id:string;revision:number;blocks:string;deleted_at:string|null};
type Mention={id:string;page_id:string;block_id:string;block_hash:string;start_offset:number;end_offset:number;original_text:string;date_id:string|null;reason:string|null;revision:number;stale:number};
export interface TemporalSnapshot {vault:string;pageId:string;revision:number;projection:PageProjection;projectionHash:string;blocks:{id:string;hash:string;expressions:TemporalExpression[]|null}[]}

/** Local, demand-driven saved-content index. Page writes only enqueue a dirty ID. */
export class TemporalIndex {
 constructor(private store:Store) {}
 private open(vault:string) {new Vaults(this.store).requireOpen(vault);}
 private page(vault:string,id:string) {return this.store.get<PageRow>('SELECT id,revision,blocks,deleted_at FROM pages WHERE vault_id=? AND id=?',vault,id);}
 private projection(vault:string,blocks:Block[]) {
  const names=new Map(this.store.all<{id:string;name:string;mention_case:'canonical'|'lowercase'}>('SELECT id,name,mention_case FROM entities WHERE vault_id=?',vault).map(entity=>[entity.id,entityMentionName({name:entity.name,mentionCase:entity.mention_case})]));
  return projectPageText(blocks,id=>names.get(id));
 }
 prepare(vault:string,pageId:string):TemporalSnapshot|null {
  this.open(vault);
  const page=this.page(vault,pageId);if(!page||page.deleted_at)return null;
  const projection=this.projection(vault,JSON.parse(page.blocks) as Block[]);
  const state=this.store.get<{extractor_version:string}>('SELECT extractor_version FROM temporal_index_state WHERE page_id=?',pageId);
  const cached=new Map(this.store.all<{block_id:string;block_hash:string}>('SELECT block_id,block_hash FROM temporal_block_state WHERE page_id=?',pageId).map(block=>[block.block_id,block.block_hash]));
  const blocks=projection.blocks.map(block=>{
   const fingerprint=hash(temporalExtractorVersion+'\0'+block.type+'\0'+block.text);
   // Code and math are not prose date evidence.
   const expressions=cached.get(block.id)===fingerprint&&state?.extractor_version===temporalExtractorVersion?null:['code','math','divider'].includes(block.type)?[]:extractTemporal(block.text);
   return {id:block.id,hash:fingerprint,expressions};
  });
  return {vault,pageId,revision:page.revision,projection,projectionHash:hash(projection.text),blocks};
 }
 /** Compare both revision and projection: entity labels can change without a page revision.
  * The savepoint supports restore's outer transaction. No async write can win after an edit. */
 commit(snapshot:TemporalSnapshot):boolean {
  const {vault,pageId,revision,projectionHash}=snapshot;this.open(vault);
  this.store.db.exec('SAVEPOINT temporal_refresh');
  try {
   const page=this.page(vault,pageId);
   if(!page||page.deleted_at||page.revision!==revision||hash(this.projection(vault,JSON.parse(page.blocks) as Block[]).text)!==projectionHash) {
    this.store.db.exec('RELEASE temporal_refresh');return false;
   }
   // All old evidence is stale until matched to an unchanged block or extracted again.
   this.store.run('UPDATE temporal_mentions SET stale=1 WHERE page_id=?',pageId);
   for(const block of snapshot.blocks) {
    if(block.expressions===null) {
     this.store.run('UPDATE temporal_mentions SET stale=0,revision=? WHERE page_id=? AND block_id=? AND block_hash=?',revision,pageId,block.id,block.hash);
    } else for(const expression of block.expressions) {
     if(expression.date)this.ensureDate(vault,expression.date);
     const id=temporalMentionId(vault,pageId,block.id,block.hash,expression.start,expression.end);
     this.store.run(`INSERT INTO temporal_mentions (id,vault_id,page_id,block_id,block_hash,start_offset,end_offset,original_text,date_id,reason,revision,stale)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET date_id=excluded.date_id,reason=excluded.reason,original_text=excluded.original_text,revision=excluded.revision,stale=0`,id,vault,pageId,block.id,block.hash,expression.start,expression.end,expression.text,expression.date?.id??null,expression.reason,revision);
    }
   }
   this.store.run('DELETE FROM temporal_block_state WHERE page_id=?',pageId);
   for(const block of snapshot.blocks)this.store.run('INSERT INTO temporal_block_state VALUES (?,?,?)',pageId,block.id,block.hash);
   this.store.run(`INSERT INTO temporal_index_state VALUES (?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET vault_id=excluded.vault_id,revision=excluded.revision,extractor_version=excluded.extractor_version,projection_hash=excluded.projection_hash`,pageId,vault,revision,temporalExtractorVersion,projectionHash);
   this.store.run('DELETE FROM temporal_dirty WHERE page_id=?',pageId);
   this.store.db.exec('RELEASE temporal_refresh');return true;
  } catch(error) {this.store.db.exec('ROLLBACK TO temporal_refresh; RELEASE temporal_refresh');throw error;}
 }
 refresh(vault:string,limit=100) {
  this.open(vault);
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new HttpError(400,'Invalid temporal refresh limit');
  let refreshed=0;
  for(const {page_id} of this.store.all<{page_id:string}>('SELECT page_id FROM temporal_dirty WHERE vault_id=? ORDER BY page_id LIMIT ?',vault,limit)) {
   const snapshot=this.prepare(vault,page_id);
   if(snapshot){if(this.commit(snapshot))refreshed++;}
   else {
    this.store.run('UPDATE temporal_mentions SET stale=1 WHERE page_id=?',page_id);
    this.store.run('DELETE FROM temporal_index_state WHERE page_id=?',page_id);
    this.store.run('DELETE FROM temporal_block_state WHERE page_id=?',page_id);
    this.store.run('DELETE FROM temporal_dirty WHERE page_id=?',page_id);
   }
  }
  return {refreshed,pending:this.store.get<{n:number}>('SELECT count(*) n FROM temporal_dirty WHERE vault_id=?',vault)!.n};
 }
 private ensureDate(vault:string,date:TemporalDate) {
  this.store.run('INSERT OR IGNORE INTO temporal_dates VALUES (?,?,?,?,?)',vault,date.id,date.value,date.precision,date.calendar);
 }
 curate(vault:string,value:string,body:Record<string,unknown>,calendar:TemporalCalendar='gregorian') {
  this.open(vault);const date=temporalDate(value,calendar);if(!date)throw new HttpError(400,'Invalid temporal date');
  const curation:TemporalCuration={label:text(body.label??'',200),annotation:text(body.annotation??'',2000),pinned:body.pinned===true,importance:body.importance===undefined?'ordinary':body.importance as TemporalCuration['importance'],personalPriority:body.personalPriority===undefined?'ordinary':body.personalPriority as TemporalCuration['personalPriority']};
  if(body.pinned!==undefined&&typeof body.pinned!=='boolean'||!['ordinary','notable','important'].includes(curation.importance)||!['ordinary','important'].includes(curation.personalPriority))throw new HttpError(400,'Invalid temporal curation');
  this.store.db.exec('SAVEPOINT temporal_curate');
  try {
   this.ensureDate(vault,date);
   this.store.run(`INSERT INTO temporal_curation VALUES (?,?,?,?,?,?,?) ON CONFLICT(vault_id,id) DO UPDATE SET label=excluded.label,annotation=excluded.annotation,pinned=excluded.pinned,importance=excluded.importance,personal_priority=excluded.personal_priority`,vault,date.id,curation.label,curation.annotation,curation.pinned?1:0,curation.importance,curation.personalPriority);
   this.store.db.exec('RELEASE temporal_curate');return {date,curation};
  }catch(error){this.store.db.exec('ROLLBACK TO temporal_curate; RELEASE temporal_curate');throw error;}
 }
 /** Semantic assertions are explicit user decisions, never a consequence of recognition. */
 relate(vault:string,dateId:string,body:Record<string,unknown>) {
  this.open(vault);
  if(!this.store.get('SELECT 1 FROM temporal_dates WHERE vault_id=? AND id=?',vault,dateId))throw new HttpError(404,'Temporal date not found');
  const entityId=text(body.entityId,200),kind=text(body.kind,40),mentionId=body.mentionId==null?null:text(body.mentionId,200);
  if(!this.store.get('SELECT 1 FROM entities WHERE vault_id=? AND id=?',vault,entityId))throw new HttpError(404,'Entity not found');
  if(!['occurs_on','born_on','published_on','deadline','discusses'].includes(kind))throw new HttpError(400,'Invalid temporal relationship');
  if(mentionId&&!this.store.get('SELECT 1 FROM temporal_mentions WHERE vault_id=? AND id=? AND date_id=?',vault,mentionId,dateId))throw new HttpError(400,'Evidence does not support this date');
  const id=randomUUID();
  this.store.run("INSERT INTO temporal_relations VALUES (?,?,?,?,?,?, 'manual','accepted',NULL)",id,vault,dateId,entityId,mentionId,kind);
  return {id};
 }
 query(vault:string,from:string,to:string,allReferences=false,calendar:TemporalCalendar='gregorian') {
  this.open(vault);
  if(temporalDate(from,calendar)?.precision!=='day'||temporalDate(to,calendar)?.precision!=='day'||from>to)throw new HttpError(400,'Choose valid temporal range boundaries');
  const indexing=this.refresh(vault);
  const dates=this.store.all<TemporalDate>(`SELECT id,value,precision,calendar FROM temporal_dates WHERE vault_id=? AND calendar=? ORDER BY value,precision`,vault,calendar).filter(date=>temporalOverlaps(date,from,to));
  const items=dates.flatMap(date=>{
   const stored=this.store.get<{label:string;annotation:string;pinned:number;importance:TemporalCuration['importance'];personal_priority:TemporalCuration['personalPriority']}>('SELECT * FROM temporal_curation WHERE vault_id=? AND id=?',vault,date.id);
   const curation=stored?{label:stored.label,annotation:stored.annotation,pinned:!!stored.pinned,importance:stored.importance,personalPriority:stored.personal_priority}:null;
   const mentions=this.store.all<{id:string;pageId:string;blockId:string;text:string}>(`SELECT m.id,m.page_id AS pageId,m.block_id AS blockId,m.original_text AS text FROM temporal_mentions m
    JOIN pages p ON p.id=m.page_id AND p.vault_id=m.vault_id JOIN temporal_index_state s ON s.page_id=p.id
    WHERE m.vault_id=? AND m.date_id=? AND m.stale=0 AND p.deleted_at IS NULL AND m.revision=p.revision AND s.revision=p.revision
    AND NOT EXISTS(SELECT 1 FROM temporal_dirty d WHERE d.page_id=p.id) ORDER BY m.page_id,m.block_id,m.start_offset`,vault,date.id);
   const relations=this.store.all<{id:string;entityId:string;mentionId:string|null;kind:string;origin:string;status:string;confidence:number|null}>(`SELECT r.id,r.entity_id AS entityId,r.mention_id AS mentionId,r.kind,r.origin,r.status,r.confidence FROM temporal_relations r JOIN entities e ON e.id=r.entity_id AND e.vault_id=r.vault_id WHERE r.vault_id=? AND r.date_id=? AND e.archived_at IS NULL AND r.status='accepted'`,vault,date.id).map(relation=>({...relation,evidence:relation.mentionId?this.relationEvidence(vault,relation.mentionId,date.id):{status:'unresolved',reason:'No supporting mention'}}));
   if(!curation&&!relations.length&&(!allReferences||!mentions.length))return [];
   return [{date,curation,mentions,relations}];
  });
  return {items,indexing};
 }
 pageEvidence(vault:string,pageId:string) {
  this.open(vault);const page=this.page(vault,pageId);if(!page||page.deleted_at)throw new HttpError(404,'Page not found');
  const snapshot=this.prepare(vault,pageId);if(snapshot)this.commit(snapshot);
  return this.store.all<Mention>('SELECT * FROM temporal_mentions WHERE vault_id=? AND page_id=? AND stale=0 ORDER BY block_id,start_offset',vault,pageId).map(mention=>({id:mention.id,dateId:mention.date_id,text:mention.original_text,evidence:this.resolve(vault,mention.id)}));
 }
 private relationEvidence(vault:string,id:string,dateId:string):TemporalEvidence {
  if(this.store.get<{date_id:string|null}>('SELECT date_id FROM temporal_mentions WHERE vault_id=? AND id=?',vault,id)?.date_id!==dateId)return {status:'stale',reason:'Evidence no longer supports this date'};
  return this.resolve(vault,id);
 }
 resolve(vault:string,id:string):TemporalEvidence {
  this.open(vault);
  const mention=this.store.get<Mention>('SELECT * FROM temporal_mentions WHERE vault_id=? AND id=?',vault,id);
  if(!mention)return {status:'unavailable',reason:'Mention no longer available'};
  const page=this.page(vault,mention.page_id);if(!page||page.deleted_at)return {status:'unavailable',reason:'Page no longer available'};
  if(mention.stale||mention.revision!==page.revision||this.store.get('SELECT 1 FROM temporal_dirty WHERE page_id=?',page.id))return {status:'stale',reason:'Saved evidence requires refresh'};
  const projection=this.projection(vault,JSON.parse(page.blocks) as Block[]),block=projection.blocks.find(block=>block.id===mention.block_id);
  if(!block||hash(temporalExtractorVersion+'\0'+block.type+'\0'+block.text)!==mention.block_hash||block.text.slice(mention.start_offset,mention.end_offset)!==mention.original_text)return {status:'stale',reason:'Original block or expression changed'};
  return {status:mention.date_id?'current':'unresolved',reason:mention.reason,reference:{pageId:page.id,segmentId:id,revision:page.revision,projectionHash:hash(projection.text),blockIds:[block.id],blockId:block.id,blockStart:mention.start_offset,blockEnd:mention.end_offset,blockHash:mention.block_hash,startOffset:block.start+mention.start_offset,endOffset:block.start+mention.end_offset,excerpt:mention.original_text}};
 }
}
