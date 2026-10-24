# AI usage estimates

Published rates verified October 25, 2026. The built-in table is versioned as
`published-2026-10-25-standard` in `src/shared/ai-pricing.ts`. Estimates use standard
paid API rates in USD per million tokens, regardless of free-tier eligibility.

| Wired model | Input | Cached input | Output | Official source |
| --- | ---: | ---: | ---: | --- |
| GPT-6 Luna | 0.10 | 0.01 | 0.50 | [Model](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| GPT-6.1 Sol | 2.00 | 0.10 | 10.00 | [Model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| GPT-6 Astra | 10.00 | 1.00 | 50.00 | [Model](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| GPT-6 Sol | 2.00 | 0.20 | 10.00 | [Model](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| GPT-5.6 Luna | 0.20 | 0.02 | 1.20 | [Model](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| GPT-5.6 Terra | 2.00 | 0.20 | 12.00 | [Model](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| GPT-5.6 Sol | 4.00 | 0.40 | 20.00 | [Model](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| GPT-5 Mini | 0.25 | 0.025 | 2.00 | [Model](https://developers.openai.com/api/docs/models/gpt-5-mini) |
| text-embedding-3-small | 0.02 | — | — | [Model](https://developers.openai.com/api/docs/models/text-embedding-3-small) |
| gpt-4o-mini-tts (historical) | 0.60 text | — | 12.00 audio | [Model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) |
| gpt-realtime-2.1-mini text | 0.60 | 0.06 | 2.40 | [Pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-realtime-2.1-mini audio | 10.00 | 0.30 | 20.00 | [Pricing](https://developers.openai.com/api/docs/pricing) |
| Gemini 3.8 Flash-Lite TTS | 0.50 text | — | 6.00 audio | [Pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts) |

GPT-6 and GPT-5.6 models use 1.25× input for default 30-minute cache writes.
For prompts over 272,000 tokens, input/cache rates double and output rates rise
by 1.5× for the entire request. Cached reads and writes are subsets of input;
reasoning is already part of output and is never added again.

GPT-5.6 Sol's published promotional rate is available at least through November
21, 2026; no replacement price is inferred. Gemini speech input/output rates
double for requests starting January 1, 2027, per its published schedule.
Review this snapshot when providers announce other changes.

OpenAI speech requires reported text/audio token details, including cached
modality details when cache reads exist. Missing usage or unknown models remain
unpriced. Gemini's wired endpoint accepts text and produces audio, so its totals
use those respective rates. Local Kokoro has no published API token price.

At startup, retained unpriced rows with sufficient counts receive an estimate
using this snapshot; historical prices are not inferred. Existing versioned
estimates are preserved. Valid custom `ai_model_pricing` metadata takes precedence.
Removing debug traces does not remove stored costs. Locked vault records remain
excluded from reports and exports.

The activity CSV includes `estimatedCost` and `pricingVersion`. The token report
sums costs across its date/action/status filters and displays unpriced action
counts alongside partial estimates, including daily/monthly and action totals.
Credits, taxes, account discounts, regional premiums, and other billing adjustments
are excluded. Estimates are not invoices.

The token report automatically ignores local Kokoro speech, DOI metadata
lookups, and attempts with no provider request or token counts. Failed,
interrupted, or skipped attempts without counts are also excluded. Any reported
counts (including zero) keep a provider attempt in the report regardless of status.
Completed provider requests with missing counts remain visible as accounting gaps.
These rules replace the earlier optional unpaid-activity toggle. The activity log
and CSV always include all retained activity from unlocked vaults.
