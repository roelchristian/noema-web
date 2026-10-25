import {createHash} from 'node:crypto';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
import {PageHistory} from './page-history.js';
import type {PageDomains,Page} from '../../shared/domain.js';
import {PageEnrichmentState,type PageEnrichmentRecord} from './page-enrichment-state.js';
import {CLASSIFICATION_VERSION,assessSemanticDrift,createClassificationBaseline,type CachedPageEmbedding,type DriftDecision} from './page-semantic-drift.js';
import {embeddingModel,embeddingDimensions} from '../../shared/embeddings.js';
import {conceptContentHash} from './summary-content.js';
import {upgradeTokenHistogram,validTokenHistogram} from './token-histogram.js';
import {domainById,TAXONOMY_VERSION} from '../../shared/domains.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
export function validatedDomainIds(value:unknown,max=162):string[] {
  if(!Array.isArray(value)||value.length>max||value.some(id=>typeof id!=='string'||!domainById(id)))throw new HttpError(400,'Choose valid disciplinary domains.');
  return [...new Set(value as string[])];
}
export function domainSelection(input:Record<string,unknown>) {
  const primary=input.primaryDomainId;
  if(primary!==null&&(typeof primary!=='string'||!domainById(primary)))throw new HttpError(400,'Choose a valid primary domain.');
  const secondary=validatedDomainIds(input.secondaryDomainIds??[],2).filter(id=>id!==primary);
  return {primaryDomainId:primary as string|null,secondaryDomainIds:secondary};
}
export class Domains {
  constructor(private store:Store) {}
  /** Called only after an explicit, fingerprint-checked scholarly review. Existing assignments retain their origins. */
  acceptSourceDiscipline(vault:string,entityId:string,domainId:string,taxonomyVersion:string) {
    if(taxonomyVersion!==TAXONOMY_VERSION||!domainById(domainId))throw new HttpError(409,'The disciplinary taxonomy changed. Generate and review a current proposal.');
    const entity=this.store.get<{locked:number}>(`SELECT v.locked FROM entities e JOIN vaults v ON v.id=e.vault_id WHERE e.id=? AND e.vault_id=? AND e.type='source' AND e.archived_at IS NULL AND e.inactive=0`,entityId,vault);
    if(!entity)throw new HttpError(404,'Active Source not found in this vault.');
    if(entity.locked)throw new HttpError(423,'Unlock this vault first.');
    const changed=this.store.run("INSERT OR IGNORE INTO entity_domains (entity_id,domain_id,origin) VALUES (?,?,'inferred')",entityId,domainId).changes;
    if(changed)this.store.run('UPDATE entities SET updated_at=? WHERE id=? AND vault_id=?',now(),entityId,vault);
    return changed>0;
  }
  get(pageId:string,contentHash?:string,record?:PageEnrichmentRecord):PageDomains {
    const state=this.store.get<{origin:'manual'|'inferred';content_hash:string|null;taxonomy_version:string;revision:number}>('SELECT * FROM page_domain_state WHERE page_id=?',pageId);
    const rows=this.store.all<{domain_id:string;role:string}>('SELECT domain_id,role FROM page_domains WHERE page_id=? ORDER BY domain_id',pageId);
    const assigned=rows.length>0;
    const classification=(record??new PageEnrichmentState(this.store).metadata(pageId)).classification;
    const assessed=contentHash!==undefined&&classification?.lastAssessedContentHash===contentHash;
    const stale=classification?.needsRefresh===true||classification?.classificationVersion!==CLASSIFICATION_VERSION||state?.taxonomy_version!==TAXONOMY_VERSION||contentHash!==undefined&&state?.content_hash!==contentHash&&!assessed;
    return {primaryDomainId:rows.find(row=>row.role==='primary')?.domain_id??null,secondaryDomainIds:rows.filter(row=>row.role==='secondary').map(row=>row.domain_id),origin:state?.origin??'inferred',status:state?.origin==='manual'?'manual':!assigned?'unclassified':stale?'needs_refresh':'inferred',...(state?.content_hash?{contentHash:state.content_hash,classifiedContentHash:state.content_hash}:{}),...(classification?{lastAssessedContentHash:classification.lastAssessedContentHash,classificationVersion:classification.classificationVersion,lastClassifiedAt:classification.lastClassifiedAt,classificationOrigin:classification.classificationOrigin,freshnessReason:classification.reason}:{}),taxonomyVersion:state?.taxonomy_version??TAXONOMY_VERSION,revision:state?.revision??0};
  }
  /** Assess on meaningful saves; migrations preserve the original classification provenance. */
  assess(page:Pick<Page,'id'|'title'|'blocks'>,resolveName?:(id:string)=>string|undefined,options:{explicit?:boolean;embedding?:CachedPageEmbedding}={}):DriftDecision {
    const state=new PageEnrichmentState(this.store),record=state.get(page.id),current=this.get(page.id);
    const baseline=record.classification?.baseline;
    const contentHash=conceptContentHash(page,resolveName??(()=>undefined));
    // Fingerprint only actual evidence dependencies. Never load vector payloads to check reuse.
    const plain=(segments:Page['blocks'][number]['content'])=>segments.map(segment=>segment.entityId?segment.mentionText??resolveName?.(segment.entityId)??'[mention]':segment.text??'').join('');
    const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
    const generation=this.store.get<{generation:number}>('SELECT generation FROM page_assessment_vectors WHERE page_id=?',page.id)?.generation??0;
    const index=this.store.get<{projection_hash:string;dirty:number;current:number}>(`SELECT i.projection_hash,EXISTS(SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id) AS dirty,i.revision=p.revision AS current FROM pages p LEFT JOIN page_index_state i ON i.page_id=p.id WHERE p.id=?`,page.id);
    const dependencyKey=()=>createHash('sha256').update(JSON.stringify([1,contentHash,normalize(page.title).slice(0,500),page.blocks.filter(block=>!isAIExplanation(block)&&(block.type==='heading1'||block.type==='heading2')).map(block=>normalize(plain(block.content)).slice(0,300)).slice(0,128),CLASSIFICATION_VERSION,TAXONOMY_VERSION,current.origin,current.revision,current.primaryDomainId,current.secondaryDomainIds,record.classification?.classificationVersion,record.classification?.baseline??null,record.classification?.classifiedContentHash,record.classification?.lastClassifiedAt,generation,index,options.embedding??null])).digest('hex');
    if(!options.explicit&&record.classification?.assessment?.dependencyKey===dependencyKey())return record.classification.assessment.decision;
    if(baseline&&baseline.version!==2) {
      let histogram=upgradeTokenHistogram(baseline);
      if(!histogram&&validTokenHistogram(baseline)) {
        const source=createClassificationBaseline(page,resolveName);
        // Rebuild missing token mass only from the verified generating content.
        if(baseline.contentHash===source.contentHash&&baseline.title===source.title&&JSON.stringify(baseline.headings)===JSON.stringify(source.headings))histogram=source;
      }
      if(histogram&&record.classification)record.classification.baseline={...baseline,version:2,tokenCounts:histogram.tokenCounts,tokenCount:histogram.tokenCount};
    }
    const decision=assessSemanticDrift({page,resolveName,baseline:record.classification?.baseline,currentDomainIds:[...(current.primaryDomainId?[current.primaryDomainId]:[]),...current.secondaryDomainIds],origin:current.origin,...options,embedding:options.embedding??this.cachedEmbedding(page,resolveName)});
    if(record.classification?.classificationVersion&&record.classification.classificationVersion!==CLASSIFICATION_VERSION&&current.origin!=='manual'){decision.needsClassification=true;decision.reason='significant_drift';}
    // A registry version change can be accepted locally when all selected canonical IDs still exist.
    const valid=[...(current.primaryDomainId?[current.primaryDomainId]:[]),...current.secondaryDomainIds].every(id=>!!domainById(id));
    if(current.taxonomyVersion!==TAXONOMY_VERSION&&valid)this.store.run('UPDATE page_domain_state SET taxonomy_version=? WHERE page_id=?',TAXONOMY_VERSION,page.id);
    if(!valid&&current.origin!=='manual'){decision.needsClassification=true;decision.reason='significant_drift';}
    record.classification={...record.classification,classificationVersion:record.classification?.classificationVersion??CLASSIFICATION_VERSION,classificationOrigin:current.origin,taxonomyVersion:valid?TAXONOMY_VERSION:current.taxonomyVersion,lastAssessedContentHash:decision.contentHash,needsRefresh:decision.needsClassification,reason:decision.reason};
    record.classification.assessment={dependencyKey:dependencyKey(),decision};
    state.save(page.id,record);return decision;
  }
  /** Read only fully current indexed passages; never equate indexing hashes with body hashes. */
  private cachedEmbedding(page:Pick<Page,'id'|'title'|'blocks'>,resolveName?:(id:string)=>string|undefined):CachedPageEmbedding|undefined {
    const saved=this.store.get<{title:string;blocks:string}>('SELECT title,blocks FROM pages WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL',page.id);
    if(!saved||saved.title!==page.title)return undefined;
    const hash=conceptContentHash(page,resolveName??(()=>undefined));
    if(conceptContentHash({title:saved.title,blocks:JSON.parse(saved.blocks) as Page['blocks']},resolveName??(()=>undefined))!==hash)return undefined;
    const rows=this.store.all<{vector:string|null;token_count:number}>(`SELECT b.vector,s.token_count FROM page_segments s JOIN pages p ON p.id=s.page_id
      LEFT JOIN page_segment_embeddings b ON b.segment_id=s.id AND b.content_hash=s.content_hash AND b.model=? AND b.dimensions=?
      WHERE s.page_id=? AND s.revision=p.revision AND NOT EXISTS(SELECT 1 FROM page_index_dirty d WHERE d.page_id=p.id) ORDER BY s.ordinal`,embeddingModel,embeddingDimensions,page.id);
    if(!rows.length||rows.some(row=>!row.vector))return undefined;
    const vector=Array<number>(embeddingDimensions).fill(0);let total=0;
    for(const row of rows) {
      let values:unknown;try{values=JSON.parse(row.vector!);}catch{return undefined;}
      if(!Array.isArray(values)||values.length!==embeddingDimensions||!values.every(value=>typeof value==='number'&&Number.isFinite(value)))return undefined;
      const weight=Math.max(1,row.token_count);total+=weight;
      for(let i=0;i<vector.length;i++)vector[i]=vector[i]!+(values[i] as number)*weight;
    }
    return {contentHash:hash,model:embeddingModel+':page-weighted-v1',vector:vector.map(value=>value/total)};
  }
  private requirePage(vault:string,pageId:string) {
    const page=this.store.get<{revision:number}>('SELECT revision FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL AND archived_at IS NULL',pageId,vault);
    if(!page)throw new HttpError(404,'Page not found');return page;
  }
  private write(pageId:string,selection:ReturnType<typeof domainSelection>,origin:'manual'|'inferred',contentHash?:string) {
    this.store.run('DELETE FROM page_domains WHERE page_id=?',pageId);
    for(const [role,ids] of [['primary',selection.primaryDomainId?[selection.primaryDomainId]:[]],['secondary',selection.secondaryDomainIds]] as const)
      for(const id of ids)this.store.run('INSERT INTO page_domains (page_id,domain_id,role,origin,updated_at) VALUES (?,?,?,?,?)',pageId,id,role,origin,now());
    this.store.run('INSERT INTO page_domain_state (page_id,origin,content_hash,taxonomy_version,revision) VALUES (?,?,?,?,1) ON CONFLICT(page_id) DO UPDATE SET origin=excluded.origin,content_hash=excluded.content_hash,taxonomy_version=excluded.taxonomy_version,revision=page_domain_state.revision+1',pageId,origin,contentHash??null,TAXONOMY_VERSION);
  }
  setManual(vault:string,pageId:string,input:Record<string,unknown>,revision:unknown) {
    const selection=domainSelection(input);
    this.store.transaction(()=>{
      const page=this.requirePage(vault,pageId);
      if(page.revision!==revision)throw new HttpError(409,'This page changed. Save the latest note before editing subjects.');
      if(this.store.get('SELECT 1 FROM page_edit_locks WHERE page_id=?',pageId))throw new HttpError(423,'Unlock this page before editing subjects.');
      const current=this.get(pageId);
      if(current.origin==='manual'&&current.primaryDomainId===selection.primaryDomainId&&JSON.stringify([...current.secondaryDomainIds].sort())===JSON.stringify([...selection.secondaryDomainIds].sort()))return;
      new PageHistory(this.store).baseline(vault,pageId);
      this.write(pageId,selection,'manual');
      const enrichment=new PageEnrichmentState(this.store),record=enrichment.get(pageId);
      record.fields.domains={origin:'manual',updatedAt:now(),stale:false};
      record.classification={...record.classification,classificationOrigin:'manual',needsRefresh:false,reason:'manual_override',assessment:undefined};
      enrichment.save(pageId,record);
      this.store.run('UPDATE pages SET revision=revision+1,updated_at=? WHERE id=? AND vault_id=?',now(),pageId,vault);
      this.store.run("DELETE FROM page_ai_enrichments WHERE page_id=? AND kind='entity_scan'",pageId);
      new PageHistory(this.store).capture(vault,pageId,'edit');
    });
    return this.get(pageId);
  }
  setInferred(vault:string,pageId:string,input:Record<string,unknown>,contentHash:string,page?:Pick<Page,'title'|'blocks'>,resolveName?:(id:string)=>string|undefined) {
    this.requirePage(vault,pageId);const selection=domainSelection(input);
    if(this.get(pageId).origin==='manual')return this.get(pageId);
    const write=()=>{
      this.write(pageId,selection,'inferred',contentHash);
      const enrichment=new PageEnrichmentState(this.store),record=enrichment.get(pageId);
      const saved=this.store.get<{title:string;blocks:string}>('SELECT title,blocks FROM pages WHERE id=?',pageId);
      const snapshot=page??(saved?{title:saved.title,blocks:JSON.parse(saved.blocks) as Page['blocks']}:undefined);
      const baseline=snapshot?createClassificationBaseline(snapshot,resolveName,this.cachedEmbedding({id:pageId,...snapshot},resolveName)):undefined;
      // A caller-supplied hash that does not describe this snapshot is never made fresh.
      const compatible=baseline?.contentHash===contentHash;
      record.fields.domains={origin:'inferred',contentHash,updatedAt:now(),stale:!compatible};
      record.classification={classifiedContentHash:contentHash,lastAssessedContentHash:contentHash,taxonomyVersion:TAXONOMY_VERSION,classificationVersion:CLASSIFICATION_VERSION,classificationOrigin:'inferred',lastClassifiedAt:now(),needsRefresh:!compatible,...(compatible?{baseline}:{}),reason:'initial_enrichment'};
      enrichment.save(pageId,record);
    };
    if(this.store.db.isTransaction)write();else this.store.transaction(write);
    return this.get(pageId,contentHash);
  }
}
