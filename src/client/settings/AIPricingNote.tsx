import {DisclosureSummary} from '../components/DisclosureSummary';
import {pricingSources} from '../../shared/ai-pricing';
import {t as uiText} from '../i18n';

export function AIPricingNote() {
  return <details className="ai-usage-note"><DisclosureSummary>{uiText("About USD estimates · Prices verified October 25, 2026")}</DisclosureSummary><p>{uiText("Estimates use reported tokens and published standard paid API rates. Cached input, default cache writes, long prompts, and speech audio rates are included. Reasoning tokens are already included in output. Free tiers, credits, taxes, regional premiums, and account discounts are excluded. Unpriced actions are excluded from the estimate, not counted as free. Older unpriced records use this verified price snapshot when sufficient usage is retained; existing versioned estimates are preserved. Gemini speech uses the published price increase from January 1, 2027. Custom configured prices take precedence. These are estimates, not invoices.")}</p><p><a href={pricingSources.openai} target="_blank" rel="noreferrer">OpenAI {uiText("published prices")}</a> · <a href={pricingSources.gemini} target="_blank" rel="noreferrer">Gemini {uiText("published prices")}</a></p></details>;
}
