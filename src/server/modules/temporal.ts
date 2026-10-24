import {TemporalSources,currentTemporalSources} from './temporal-sources.js';
import {TemporalProperties,currentTemporalProperties} from './temporal-properties.js';
import {createHash,randomUUID} from 'node:crypto';
import {entityMentionName,type Block} from '../../shared/domain.js';
import {projectPageText,type PageProjection} from '../../shared/page-text.js';
import {extractTemporal,temporalDate,temporalExtractorVersion,type TemporalCalendar,type TemporalCuration,type TemporalDate,type TemporalEvidence,type TemporalExpression,type TemporalLayer,type TemporalItem,type TemporalResults,type TemporalDetail,type TemporalMentionSummary,type TemporalRelationSummary,type TemporalSourceSummary,type TemporalPropertySummary} from '../../shared/temporal.js';
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
 readonly sources:TemporalSources;readonly properties:TemporalProperties;
 constructor(private store:Store) {this.sources=new TemporalSources(store);this.properties=new TemporalProperties(store);}
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
  const sourceWork=this.sources.refresh(vault),propertyWork=this.properties.refresh(vault);
  const pending=['temporal_dirty','temporal_source_dirty','temporal_property_dirty'].reduce((total,table)=>total+this.store.get<{n:number}>(`SELECT count(*) n FROM ${table} WHERE vault_id=?`,vault)!.n,0);
  return {refreshed:refreshed+sourceWork+propertyWork,pending};
 }
 tickEvidence() {
  const row=this.store.get<{vault_id:string}>(`SELECT vault_id FROM (SELECT d.vault_id FROM temporal_source_dirty d JOIN source_passage_state s ON s.file_id=d.file_id WHERE s.status='completed' AND NOT EXISTS(SELECT 1 FROM source_passage_dirty p WHERE p.file_id=d.file_id) UNION SELECT vault_id FROM temporal_property_dirty) q JOIN vaults v ON v.id=q.vault_id WHERE v.locked=0 LIMIT 1`);
  if(row){this.sources.refresh(row.vault_id);this.properties.refresh(row.vault_id);}
 }
 private ensureDate(vault:string,date:TemporalDate) {
  this.store.run('INSERT OR IGNORE INTO temporal_dates VALUES (?,?,?,?,?)',vault,date.id,date.value,date.precision,date.calendar);
 }
 curate(vault:string,value:string,body:Record<string,unknown>,calendar:TemporalCalendar='gregorian') {
  this.open(vault);const date=temporalDate(value,calendar);if(!date)throw new HttpError(400,'Invalid temporal date');
  const curation:TemporalCuration={label:text(body.label??'',200),annotation:text(body.annotation??'',2000),pinned:body.pinned===true,importance:body.importance===undefined?'ordinary':body.importance as TemporalCuration['importance'],personalPriority:body.personalPriority===undefined?'ordinary':body.personalPriority as TemporalCuration['personalPriority'],layer:(body.layer??'knowledge') as TemporalLayer};
  if(!['personal','knowledge','historical'].includes(curation.layer)||body.pinned!==undefined&&typeof body.pinned!=='boolean'||!['ordinary','notable','important'].includes(curation.importance)||!['ordinary','important'].includes(curation.personalPriority))throw new HttpError(400,'Invalid temporal curation');
  this.store.db.exec('SAVEPOINT temporal_curate');
  try {
   this.ensureDate(vault,date);
   this.store.run(`INSERT INTO temporal_curation (vault_id,id,label,annotation,pinned,importance,personal_priority,layer) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(vault_id,id) DO UPDATE SET label=excluded.label,annotation=excluded.annotation,pinned=excluded.pinned,importance=excluded.importance,personal_priority=excluded.personal_priority,layer=excluded.layer`,vault,date.id,curation.label,curation.annotation,curation.pinned?1:0,curation.importance,curation.personalPriority,curation.layer);
   this.store.db.exec('RELEASE temporal_curate');return {date,curation};
  }catch(error){this.store.db.exec('ROLLBACK TO temporal_curate; RELEASE temporal_curate');throw error;}
 }
 /** Semantic assertions are explicit user decisions, never a consequence of recognition. */
 uncurate(vault:string,dateId:string) {
  this.open(vault);this.store.run('DELETE FROM temporal_curation WHERE vault_id=? AND id=?',vault,dateId);return {removed:true};
 }
 relate(vault:string,dateId:string,body:Record<string,unknown>) {
  this.open(vault);
  if(!this.store.get('SELECT 1 FROM temporal_dates WHERE vault_id=? AND id=?',vault,dateId))throw new HttpError(404,'Temporal date not found');
  const entityId=text(body.entityId,200),kind=text(body.kind,40),mentionId=body.mentionId==null?null:text(body.mentionId,200),sourceMentionId=body.sourceMentionId==null?null:text(body.sourceMentionId,200);
  if(mentionId&&sourceMentionId)throw new HttpError(400,'Choose one evidence anchor');
  if(!this.store.get('SELECT 1 FROM entities WHERE vault_id=? AND id=? AND archived_at IS NULL',vault,entityId))throw new HttpError(404,'Entity not found');
  if(!['occurs_on','born_on','published_on','deadline','discusses','ends_on','died_on','founded_on','accessed_on'].includes(kind))throw new HttpError(400,'Invalid temporal relationship');
  if(mentionId&&!this.store.get('SELECT 1 FROM temporal_mentions WHERE vault_id=? AND id=? AND date_id=?',vault,mentionId,dateId))throw new HttpError(400,'Evidence does not support this date');
  if(sourceMentionId&&!this.store.get('SELECT 1 FROM temporal_source_mentions WHERE vault_id=? AND id=? AND date_id=?',vault,sourceMentionId,dateId))throw new HttpError(400,'Source evidence does not support this date');
  if(mentionId&&this.resolve(vault,mentionId).status!=='current'||sourceMentionId&&this.sources.resolve(vault,sourceMentionId).status!=='current')throw new HttpError(409,'Evidence changed. Refresh before linking it.');
  const existing=this.store.get<{id:string}>("SELECT id FROM temporal_relations WHERE vault_id=? AND date_id=? AND entity_id=? AND kind=? AND mention_id IS ? AND source_mention_id IS ? AND property_id IS NULL AND origin='manual' AND status='accepted'",vault,dateId,entityId,kind,mentionId,sourceMentionId);if(existing)return existing;
  const id=randomUUID();
  this.store.run("INSERT INTO temporal_relations (id,vault_id,date_id,entity_id,mention_id,kind,origin,status,confidence,source_mention_id) VALUES (?,?,?,?,?,?, 'manual','accepted',NULL,?)",id,vault,dateId,entityId,mentionId,kind,sourceMentionId);
  return {id};
 }
 private currentMentions=`FROM temporal_mentions m JOIN pages p ON p.id=m.page_id AND p.vault_id=m.vault_id JOIN temporal_index_state s ON s.page_id=p.id
  WHERE m.vault_id=? AND m.date_id=? AND m.stale=0 AND p.deleted_at IS NULL AND p.archived_at IS NULL AND m.revision=p.revision AND s.revision=p.revision
  AND NOT EXISTS(SELECT 1 FROM temporal_dirty d WHERE d.page_id=p.id)`;
 private acceptedRelations=`FROM temporal_relations r JOIN entities e ON e.id=r.entity_id AND e.vault_id=r.vault_id WHERE r.vault_id=? AND r.date_id=? AND e.archived_at IS NULL AND r.status='accepted'`;
 private pagination(offset:number,limit:number) {
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Invalid temporal pagination');
 }
 private item(vault:string,date:TemporalDate,offset=0,relationOffset=0,limit=3):TemporalItem {
  const stored=this.store.get<{label:string;annotation:string;pinned:number;importance:TemporalCuration['importance'];personal_priority:TemporalCuration['personalPriority'];layer:TemporalLayer}>('SELECT * FROM temporal_curation WHERE vault_id=? AND id=?',vault,date.id);
  const curation=stored?{label:stored.label,annotation:stored.annotation,pinned:!!stored.pinned,importance:stored.importance,personalPriority:stored.personal_priority,layer:stored.layer}:null;
  const mentionCount=this.store.get<{n:number}>(`SELECT count(*) n ${this.currentMentions}`,vault,date.id)!.n;
  const relationCount=this.store.get<{n:number}>(`SELECT count(*) n ${this.acceptedRelations}`,vault,date.id)!.n;
  const mentions=this.store.all<TemporalMentionSummary>(`SELECT m.id,m.page_id AS pageId,m.block_id AS blockId,m.original_text AS text,p.title ${this.currentMentions} ORDER BY m.page_id,m.block_id,m.start_offset LIMIT ? OFFSET ?`,vault,date.id,limit,offset);
  const sources=this.store.all<TemporalSourceSummary>(`SELECT m.id,m.source_id AS sourceId,m.file_id AS fileId,m.original_text AS text,e.name AS title,m.start_line AS startLine,substr(sp.text,max(1,m.start_offset-sp.start_offset-60),180) AS context ${currentTemporalSources} ORDER BY m.file_id,m.start_offset LIMIT ? OFFSET ?`,vault,date.id,limit,0);
  const sourceCount=this.store.get<{n:number}>(`SELECT count(*) n ${currentTemporalSources}`,vault,date.id)!.n;
  const properties=this.store.all<TemporalPropertySummary>(`SELECT p.id,p.entity_id AS entityId,p.name,p.value AS raw,e.name AS title ${currentTemporalProperties} ORDER BY p.id LIMIT ?`,vault,date.id,limit);
  const propertyCount=this.store.get<{n:number}>(`SELECT count(*) n ${currentTemporalProperties}`,vault,date.id)!.n;
  const relations=this.relations(vault,date.id,'accepted',relationOffset,limit);
  const proposals=this.relations(vault,date.id,'review',0,limit);
  const proposalCount=this.store.get<{n:number}>(`SELECT count(*) n ${this.acceptedRelations.replace("r.status='accepted'","r.status IN ('pending','rejected')")}`,vault,date.id)!.n;
  return {date,curation,mentions,mentionCount,relations,relationCount,layer:curation?.layer??'knowledge',sources,sourceCount,properties,propertyCount,proposals,proposalCount};
 }
 query(vault:string,from:string,to:string,allReferences=false,calendar:TemporalCalendar='gregorian',options:{offset?:number;limit?:number;layers?:TemporalLayer[]}={}):TemporalResults {
  this.open(vault);
  const offset=options.offset??0,limit=options.limit??100,layers=options.layers??['personal','knowledge','historical'];
  this.pagination(offset,limit);
  if(!Array.isArray(layers)||layers.length>3||layers.some(layer=>!['personal','knowledge','historical'].includes(layer)))throw new HttpError(400,'Invalid temporal layers');
  if(temporalDate(from,calendar)?.precision!=='day'||temporalDate(to,calendar)?.precision!=='day'||from>to)throw new HttpError(400,'Choose valid temporal range boundaries');
  const indexing=this.refresh(vault);
  if(!layers.length)return {items:[],indexing,nextOffset:null};
  // Both date rows and nested evidence are bounded before materialization.
  const sourceExists=currentTemporalSources.replace('m.vault_id=? AND m.date_id=?','m.vault_id=d.vault_id AND m.date_id=d.id');
  const propertyExists=currentTemporalProperties.replace('v.vault_id=? AND v.date_id=?','v.vault_id=d.vault_id AND v.date_id=d.id');
  const dates=this.store.all<TemporalDate>(`SELECT d.id,d.value,d.precision,d.calendar FROM temporal_dates d LEFT JOIN temporal_curation c ON c.vault_id=d.vault_id AND c.id=d.id
   WHERE d.vault_id=? AND d.calendar=? AND COALESCE(c.layer,'knowledge') IN (${layers.map(()=>'?').join(',')})
   AND (CASE d.precision WHEN 'year' THEN d.value||'-01-01' WHEN 'month' THEN d.value||'-01' ELSE d.value END)<=?
   AND (CASE d.precision WHEN 'year' THEN d.value||'-12-31' WHEN 'month' THEN d.value||'-31' ELSE d.value END)>=?
   AND (c.id IS NOT NULL OR EXISTS(SELECT 1 FROM temporal_relations r JOIN entities e ON e.id=r.entity_id AND e.vault_id=r.vault_id WHERE r.vault_id=d.vault_id AND r.date_id=d.id AND r.status='accepted' AND e.archived_at IS NULL)
    OR (?=1 AND (EXISTS(SELECT 1 FROM temporal_mentions m JOIN pages p ON p.id=m.page_id AND p.vault_id=m.vault_id JOIN temporal_index_state s ON s.page_id=p.id WHERE m.vault_id=d.vault_id AND m.date_id=d.id AND m.stale=0 AND p.deleted_at IS NULL AND p.archived_at IS NULL AND m.revision=p.revision AND s.revision=p.revision AND NOT EXISTS(SELECT 1 FROM temporal_dirty dirty WHERE dirty.page_id=p.id)) OR EXISTS(SELECT 1 ${sourceExists}) OR EXISTS(SELECT 1 ${propertyExists}))))
   ORDER BY d.value,d.precision,d.id LIMIT ? OFFSET ?`,vault,calendar,...layers,to,from,allReferences?1:0,limit+1,offset);
  return {items:dates.slice(0,limit).map(date=>this.item(vault,date)),indexing,nextOffset:dates.length>limit?offset+limit:null};
 }
 detail(vault:string,dateId:string,offset=0,relationOffset=0,limit=20,sourceOffset=0,propertyOffset=0,proposalOffset=0,proposalId?:string):TemporalDetail {
  this.open(vault);this.pagination(offset,limit);this.pagination(relationOffset,limit);this.pagination(sourceOffset,limit);this.pagination(propertyOffset,limit);this.pagination(proposalOffset,limit);
  this.refresh(vault);
  const date=this.store.get<TemporalDate>('SELECT id,value,precision,calendar FROM temporal_dates WHERE vault_id=? AND id=?',vault,dateId);
  if(!date)throw new HttpError(404,'Temporal date not found');
  const item=this.item(vault,date,offset,relationOffset,limit);
  item.sources=this.store.all<TemporalSourceSummary>(`SELECT m.id,m.source_id AS sourceId,m.file_id AS fileId,m.original_text AS text,e.name AS title,m.start_line AS startLine,substr(sp.text,max(1,m.start_offset-sp.start_offset-60),180) AS context ${currentTemporalSources} ORDER BY m.file_id,m.start_offset LIMIT ? OFFSET ?`,vault,date.id,limit,sourceOffset);
  item.properties=this.store.all<TemporalPropertySummary>(`SELECT p.id,p.entity_id AS entityId,p.name,p.value AS raw,e.name AS title ${currentTemporalProperties} ORDER BY p.id LIMIT ? OFFSET ?`,vault,date.id,limit,propertyOffset);
  item.proposals=this.relations(vault,date.id,'review',proposalOffset,limit);
  if(proposalId){const selected=this.relations(vault,date.id,'review',0,1,proposalId)[0];if(selected&&!item.proposals.some(row=>row.id===selected.id))item.proposals=[selected,...item.proposals];}
  return {...item,nextSourceOffset:sourceOffset+item.sources.length<(item.sourceCount??0)?sourceOffset+limit:null,nextPropertyOffset:propertyOffset+item.properties.length<(item.propertyCount??0)?propertyOffset+limit:null,nextProposalOffset:proposalOffset+limit<(item.proposalCount??0)?proposalOffset+limit:null,nextMentionOffset:offset+item.mentions.length<item.mentionCount?offset+limit:null,nextRelationOffset:relationOffset+item.relations.length<item.relationCount?relationOffset+limit:null};
 }
 pageEvidence(vault:string,pageId:string) {
  this.open(vault);const page=this.page(vault,pageId);if(!page||page.deleted_at)throw new HttpError(404,'Page not found');
  const snapshot=this.prepare(vault,pageId);if(snapshot)this.commit(snapshot);
  return this.store.all<Mention>('SELECT * FROM temporal_mentions WHERE vault_id=? AND page_id=? AND stale=0 ORDER BY block_id,start_offset',vault,pageId).map(mention=>({id:mention.id,dateId:mention.date_id,text:mention.original_text,evidence:this.resolve(vault,mention.id)}));
 }
 private relations(vault:string,dateId:string,state:'accepted'|'review',offset:number,limit:number,proposalId?:string):TemporalRelationSummary[] {
  const clause=state==='accepted'?this.acceptedRelations:this.acceptedRelations.replace("r.status='accepted'","r.status IN ('pending','rejected')");
  return this.store.all<{id:string;entity_id:string;mention_id:string|null;source_mention_id:string|null;property_id:string|null;property_hash:string|null;kind:string;origin:string;status:string;confidence:number|null;name:string}>(`SELECT r.*,e.name ${clause}${proposalId?' AND r.id=?':''} ORDER BY r.id LIMIT ? OFFSET ?`,vault,dateId,...proposalId?[proposalId,limit,offset]:[limit,offset]).map(row=>{
   const evidence=row.mention_id?this.relationEvidence(vault,row.mention_id,dateId):row.source_mention_id?this.sources.resolve(vault,row.source_mention_id):row.property_id?this.properties.resolve(vault,row.property_id,dateId,row.property_hash):{status:'unresolved' as const,reason:'No supporting evidence'};
   const version=hash(JSON.stringify([row,evidence]));
   return {id:row.id,entityId:row.entity_id,mentionId:row.mention_id,sourceMentionId:row.source_mention_id,propertyId:row.property_id,kind:row.kind,origin:row.origin,status:row.status,confidence:row.confidence,name:row.name,evidence,version};
  });
 }
 reviewRelation(vault:string,id:string,body:Record<string,unknown>) {
  this.open(vault);
  if(body.status!=='accepted'&&body.status!=='rejected')throw new HttpError(400,'Choose accept or reject');
  return this.store.transaction(()=>{
   const row=this.store.get<{date_id:string;status:string}>(`SELECT r.date_id,r.status FROM temporal_relations r JOIN entities e ON e.id=r.entity_id AND e.vault_id=r.vault_id WHERE r.id=? AND r.vault_id=? AND e.archived_at IS NULL`,id,vault);
   if(!row)throw new HttpError(404,'Temporal relationship not found');
   // Bound the single-row review lookup independently of list pagination.
   const saved=this.store.get<Record<string,unknown>>('SELECT * FROM temporal_relations WHERE id=?',id)!;
   const entity=this.store.get<{name:string}>('SELECT name FROM entities WHERE id=?',String(saved.entity_id))!;
   const evidence=saved.mention_id?this.relationEvidence(vault,String(saved.mention_id),row.date_id):saved.source_mention_id?this.sources.resolve(vault,String(saved.source_mention_id)):saved.property_id?this.properties.resolve(vault,String(saved.property_id),row.date_id,saved.property_hash as string|null):{status:'unresolved',reason:'No supporting evidence'};
   if(body.version!==hash(JSON.stringify([{...saved,name:entity.name},evidence])))throw new HttpError(409,'Relationship or evidence changed. Refresh before reviewing.');
   if(body.status==='accepted'&&evidence.status!=='current')throw new HttpError(409,'Stale or unresolved evidence cannot be accepted.');
   this.store.run('UPDATE temporal_relations SET status=? WHERE id=? AND vault_id=?',String(body.status),id,vault);
   return {id,status:body.status};
  });
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
