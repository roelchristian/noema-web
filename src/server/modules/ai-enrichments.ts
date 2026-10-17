import { limitSummaryWords } from '../../shared/summary-text.js';
import { AINotifications } from './ai-notifications.js';
import type { AIEnrichment } from '../../shared/domain.js';
import type { IntelligencePreferences } from '../../shared/intelligence.js';
import { Store } from '../store.js';
import { HttpError, now } from '../validation.js';
import { Pages } from './pages.js';

type EnrichmentRow = Omit<AIEnrichment, 'data' | 'reasoningEffort'> & {data: string; reasoning_effort: AIEnrichment['reasoningEffort']};

// All page enrichment kinds share storage, revision checks and page deletion semantics.
export class AIEnrichments {
  constructor(private store: Store, private pages: Pages) {}
  list(vault: string, pageId: string): AIEnrichment[] {
    const page = this.pages.get(vault, pageId);
    // Only backfill legacy results when their exact generating revision is known.
    this.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary' AND content_hash IS NULL AND revision=?",page.summaryContentHash!,pageId,page.revision);
    return this.store.all<EnrichmentRow>('SELECT kind,data,revision,model,reasoning_effort,updated_at,content_hash AS contentHash FROM page_ai_enrichments WHERE page_id=? ORDER BY kind', pageId)
      .map(({data, reasoning_effort, ...row}) => {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (row.kind === 'summary' && typeof parsed.summary === 'string') parsed.summary = limitSummaryWords(parsed.summary);
        return {...row, data: parsed, reasoningEffort: reasoning_effort};
      });
  }
  removeSummary(vault: string, pageId: string) {
    this.pages.get(vault, pageId);
    this.store.run('DELETE FROM page_ai_enrichments WHERE page_id=? AND kind=?', pageId, 'summary');
    return {ok: true as const};
  }
  save(vault: string, pageId: string, kind: string, data: Record<string, unknown>, revision: number, preferences: IntelligencePreferences) {
    if (kind === 'summary' && typeof data.summary === 'string') data = {...data, summary: limitSummaryWords(data.summary)};
    return this.store.transaction(() => {
      const page = this.pages.get(vault, pageId);
      if (page.revision !== revision) throw new HttpError(409, 'The page changed. Generate a fresh result.');
      this.store.run(`INSERT INTO page_ai_enrichments (page_id,kind,data,revision,model,reasoning_effort,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(page_id,kind) DO UPDATE SET data=excluded.data,revision=excluded.revision,model=excluded.model,reasoning_effort=excluded.reasoning_effort,updated_at=excluded.updated_at,content_hash=excluded.content_hash`,
        pageId, kind, JSON.stringify(data), revision, preferences.model, preferences.reasoningEffort, now(), kind === 'summary' ? page.summaryContentHash! : null);
      if(kind==='summary'||kind==='entity_scan') new AINotifications(this.store).record(vault,pageId,kind==='summary'?'page_summary':'entity_scan');
    });
  }
}
