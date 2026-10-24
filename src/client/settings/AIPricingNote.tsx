import {DisclosureSummary} from '../components/DisclosureSummary';
import {pricingSources} from '../../shared/ai-pricing';
import {t as uiText} from '../i18n';

export function AIPricingNote({report=false}:{report?:boolean}) {
  return <details className="ai-usage-note ai-usage-about ai-activity-disclosure">
    <DisclosureSummary>{uiText("Usage & pricing notes")}</DisclosureSummary>
    <p>{uiText("Unlocked vaults only. Activity stays local for one year without a record-count limit; debug traces expire after 30 days.")}{' '}{report?uiText("Totals follow the selected filters and local dates; missing counts are excluded. Cached and reasoning tokens are included in input/output, never added twice. Refreshes every 15 seconds."):uiText("CSV exports all retained activity. Clear removes all unlocked-vault records. Loading older activity pauses auto-refresh.")}</p>
    <p>{uiText("USD estimates use reported tokens and standard paid rates verified October 25, 2026, including cache, long-prompt and speech pricing. Missing estimates are excluded, not treated as free. Older unpriced usage uses this snapshot; existing estimates and custom rates are preserved. Credits, free tiers, taxes and account adjustments are excluded.")}{' '}<a href={pricingSources.openai} target="_blank" rel="noreferrer">OpenAI</a> · <a href={pricingSources.gemini} target="_blank" rel="noreferrer">Gemini</a></p>
  </details>;
}
