import {createHash} from 'node:crypto';
import { limitSummaryWords } from '../../shared/summary-text.js';
import { AINotifications } from './ai-notifications.js';
import type { AIEnrichment } from '../../shared/domain.js';
import type { IntelligencePreferences } from '../../shared/intelligence.js';
import { Store } from '../store.js';
import { HttpError, now } from '../validation.js';
import { Pages } from './pages.js';
import {PageEnrichmentState} from './page-enrichment-state.js';

type EnrichmentRow = Omit<AIEnrichment, 'data' | 'reasoningEffort'> & {data: string; reasoning_effort: AIEnrichment['reasoningEffort']};

// All page enrichment kinds share storage, revision checks and page deletion semantics.
export class AIEnrichments {
  constructor(private store: Store, private pages: Pages) {}
  private requirePage(vault:string,pageId:string) {
    const page=this.store.get<{revision:number;archived_at:string|null;title:string;language:string|null;summary_content_hash:string|null;summary_hash_version:number}>('SELECT revision,archived_at,title,language,summary_content_hash,summary_hash_version FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',pageId,vault);
    if(!page)throw new HttpError(404,'Page not found');
    return page;
  }
  list(vault: string, pageId: string): AIEnrichment[] {
    this.requirePage(vault,pageId);
    // Public projections are explicit: evidence, baseline text, histograms and vectors
    // never leave storage, including evidence embedded in a summary record.
    return this.store.all<EnrichmentRow>(`SELECT kind,
      CASE kind WHEN 'summary' THEN json_object('summary',json_extract(data,'$.summary'),'origin',json_extract(data,'$.origin'),'generatedContentHash',json_extract(data,'$.generatedContentHash'))
      WHEN 'entity_scan' THEN json_object('scan',json_extract(data,'$.scan'))
      WHEN 'topics' THEN json_object('topics',json_extract(data,'$.topics')) END AS data,
      revision,model,reasoning_effort,updated_at,content_hash AS contentHash
      FROM page_ai_enrichments WHERE page_id=? AND json_valid(data) AND kind IN ('summary','entity_scan','topics') ORDER BY kind`,pageId)
      .map(({data,reasoning_effort,...row})=>{
        const parsed=JSON.parse(data) as Record<string,unknown>;
        if(row.kind==='summary'&&typeof parsed.summary==='string')parsed.summary=limitSummaryWords(parsed.summary);
        return {...row,data:parsed,reasoningEffort:reasoning_effort};      });
  }
  status(vault:string,pageId:string):import('../../shared/domain.js').PageEnrichmentStatus {
    const page=this.requirePage(vault,pageId);
    const rows=this.store.all<{kind:string;revision:number;updated_at:string;content_hash:string|null;publicData:string|null}>(`SELECT kind,revision,updated_at,content_hash,
      CASE kind WHEN 'summary' THEN json_extract(data,'$.summary') WHEN 'entity_scan' THEN json_extract(data,'$.scan') WHEN 'topics' THEN json_extract(data,'$.topics') WHEN 'title' THEN json_extract(data,'$.title') END AS publicData
      FROM page_ai_enrichments WHERE page_id=? AND json_valid(data) AND kind IN ('summary','entity_scan','topics','title') ORDER BY kind`,pageId);
    const job=page.archived_at?undefined:this.store.get<{fields:string;generation:number;attempts:number}>('SELECT fields,generation,attempts FROM page_enrichment_jobs WHERE page_id=?',pageId);
    let pendingFields:import('../../shared/domain.js').PageEnrichmentStatus['pendingFields']=[];
    if(job)try {const fields:unknown=JSON.parse(job.fields);if(Array.isArray(fields))pendingFields=['title','domains','language','summary'].filter(field=>fields.includes(field)) as typeof pendingFields;}catch{/* Malformed jobs are settled by queue preparation. */}
    const provenance=this.store.get<{fields:string;classification:string}>("SELECT json_extract(data,'$.fields') AS fields,json_object('hash',json_extract(data,'$.classification.lastAssessedContentHash'),'needsRefresh',json_extract(data,'$.classification.needsRefresh'),'reason',json_extract(data,'$.classification.reason'),'policy',json_extract(data,'$.classification.classificationVersion')) AS classification FROM page_ai_enrichments WHERE page_id=? AND kind='enrichment_state' AND json_valid(data)",pageId);
    let fields:Record<string,{origin?:string;suppressed?:boolean}>={};
    if(provenance?.fields)try{fields=JSON.parse(provenance.fields) as typeof fields;}catch{/* Unknown ownership does not imply suppression. */}
    pendingFields=pendingFields.filter(field=>fields[field]?.origin!=='manual'&&!fields[field]?.suppressed);
    const settings=this.store.get<{automatic_summaries:number}>('SELECT automatic_summaries FROM page_enrichment_settings WHERE vault_id=?',vault);
    if(settings?.automatic_summaries===0)pendingFields=pendingFields.filter(field=>field!=='summary');
    const domainState=this.store.get(`SELECT s.revision,s.origin,s.content_hash,s.taxonomy_version,
      (SELECT group_concat(domain_id||':'||role,',') FROM (SELECT domain_id,role FROM page_domains WHERE page_id=? ORDER BY domain_id,role)) AS assignments
      FROM pages p LEFT JOIN page_domain_state s ON s.page_id=p.id WHERE p.id=?`,pageId,pageId);
    const version=createHash('sha256').update(JSON.stringify([page,rows,job??null,pendingFields,provenance??null,domainState??null,settings??null])).digest('hex').slice(0,24);
    return {version,pending:pendingFields.length>0,pendingFields};
  }
  removeSummary(vault: string, pageId: string) {
    this.pages.requireActive(vault, pageId);
    this.store.transaction(()=>{
      this.store.run('DELETE FROM page_ai_enrichments WHERE page_id=? AND kind=?', pageId, 'summary');
      new PageEnrichmentState(this.store).suppressSummary(pageId);
      this.store.run("INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at) VALUES (?,'summary_preferences',?,?, 'local','none',?) ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",pageId,JSON.stringify({suppressed:true,deletedAt:now()}),this.pages.get(vault,pageId).revision,now());
    });
    return {ok: true as const};
  }
  save(vault: string, pageId: string, kind: string, data: Record<string, unknown>, revision: number, preferences: IntelligencePreferences) {
    if (kind === 'summary' && typeof data.summary === 'string') data = {...data, summary: limitSummaryWords(data.summary)};
    const persist = () => {
      const page = this.pages.requireActive(vault, pageId);
      if (page.revision !== revision) throw new HttpError(409, 'The page changed. Generate a fresh result.');
      this.store.run(`INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,revision=excluded.revision,model=excluded.model,reasoning_effort=excluded.reasoning_effort,updated_at=excluded.updated_at,content_hash=excluded.content_hash`,
        pageId, kind, JSON.stringify(data), revision, preferences.model, preferences.reasoningEffort, now(), kind === 'summary' ? page.summaryContentHash! : null);
      if(kind==='summary'||kind==='entity_scan') new AINotifications(this.store).record(vault,pageId,kind==='summary'?'page_summary':'entity_scan');
    };
    return this.store.db.isTransaction ? persist() : this.store.transaction(persist);
  }
}
