import type {Page} from '../../shared/domain.js';
import {Store} from '../store.js';
import {CLASSIFICATION_VERSION,type ClassificationBaseline,type DriftReason,type DriftDecision} from './page-semantic-drift.js';

export type EnrichmentField='title'|'domains'|'language'|'summary';
export interface EnrichmentFieldState {
  origin:'manual'|'inferred'|'unknown';contentHash?:string;updatedAt?:string;
  suppressed?:boolean;stale?:boolean;
}
export interface ClassificationState {
  classifiedContentHash?:string;lastAssessedContentHash?:string;taxonomyVersion?:string;
  classificationVersion?:string;classificationOrigin:'manual'|'inferred';lastClassifiedAt?:string;
  needsRefresh:boolean;reason?:DriftReason;baseline?:ClassificationBaseline;
  assessment?:{dependencyKey:string;decision:DriftDecision};
}
export interface PageEnrichmentRecord {
  version:1;fields:Partial<Record<EnrichmentField,EnrichmentFieldState>>;
  classification?:ClassificationState;automaticSummaries?:boolean;
}
/** Uses existing derived-metadata storage, including cascade deletion and vault backups. */
export class PageEnrichmentState {
  constructor(private store:Store) {}
  get(pageId:string):PageEnrichmentRecord {
    const row=this.store.get<{data:string}>("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='enrichment_state'",pageId);
    if(row)try {const value=JSON.parse(row.data) as PageEnrichmentRecord;if(value.version===1&&value.fields&&typeof value.fields==='object')return value;}catch {/* Legacy/corrupt metadata is not evidence of freshness. */}
    return {version:1,fields:{}};
  }
  /** Read public provenance without materializing the private text, histograms or embeddings. */
  metadata(pageId:string):PageEnrichmentRecord {
    const row=this.store.get<{fields:string|null;classification:string|null}>(`WITH valid AS (
      SELECT CASE WHEN json_valid(data) THEN data ELSE '{}' END AS data FROM page_ai_enrichments WHERE page_id=? AND kind='enrichment_state')
      SELECT CASE WHEN json_type(data,'$.fields')='object' THEN json_extract(data,'$.fields') END AS fields,
      CASE WHEN json_type(data,'$.classification')='object' THEN json_remove(json_extract(data,'$.classification'),'$.baseline','$.assessment') END AS classification
      FROM valid WHERE json_extract(data,'$.version')=1`,pageId);
    if(!row)return {version:1,fields:{}};
    try {return {version:1,fields:row.fields?JSON.parse(row.fields) as PageEnrichmentRecord['fields']:{},...(row.classification?{classification:JSON.parse(row.classification) as ClassificationState}:{})};}
    catch {return {version:1,fields:{}};}
  }
  save(pageId:string,state:PageEnrichmentRecord):void {
    const page=this.store.get<Pick<Page,'revision'>>('SELECT revision FROM pages WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL',pageId);
    if(!page)return;
    this.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'enrichment_state',?,?,'local','none',?) ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at WHERE page_ai_enrichments.data<>excluded.data",pageId,JSON.stringify(state),page.revision,new Date().toISOString());
  }
  setField(pageId:string,field:EnrichmentField,state:EnrichmentFieldState):void {
    const record=this.get(pageId);record.fields[field]=state;this.save(pageId,record);
  }
  markManual(pageId:string,field:EnrichmentField,contentHash?:string):void {
    this.setField(pageId,field,{origin:'manual',...(contentHash?{contentHash}:{}),updatedAt:new Date().toISOString(),stale:false});
  }
  suppressSummary(pageId:string):void {this.setField(pageId,'summary',{origin:'manual',suppressed:true,updatedAt:new Date().toISOString()});}
  eligible(pageId:string,field:EnrichmentField,explicit=false):boolean {
    const state=this.get(pageId).fields[field];
    return state?.suppressed ? explicit : state?.origin!=='manual';
  }
}
export {CLASSIFICATION_VERSION};
