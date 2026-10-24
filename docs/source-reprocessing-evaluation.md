# Source reprocessing staged evaluation

The offline checkpoint is runnable with:

```sh
node --import tsx scripts/evaluate-source-reprocessing.mjs
node --import tsx --test test/source-reprocessing-ui.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/check-source-reprocessing-browser.mjs
```

The browser check needs an existing Chromium installation (`CHROMIUM_PATH`, default `/usr/bin/chromium`) and an existing Playwright module. It starts a disposable Vite fixture, intercepts API requests, blocks nonlocal browser traffic, and uses synthetic state. It neither opens a vault nor calls a provider. Desktop and mobile checks cover document-stage labels, incomplete first-pass coverage, evidence transmission consent, depth/review independence, review actions, and horizontal overflow.

## Corpus and comparison

`test/fixtures/source-reprocessing/scholarly-synthetic.json` contains four authored synthetic passages, with four known ligature repairs and ten preservation checks covering supplementary Unicode, combining marks, Greek quotation text, mathematics, footnotes, physical page markers, and unresolved competing Latin readings. The script reconstructs each fixture through the real planner and diff, applies the resulting patches against exact canonical substrings, and requires an exact expected derivative. Its comparison baseline is the original common-prefix/suffix single-span method applied to the same scripted outputs.

The initial result is 85 canonical UTF-16 code units inside baseline spans versus 4 inside granular patches. This metric measures review scope, not correction quality. The fixture precision and recall values are 1 because the scripted candidates contain the four known corrections and reconstruction exactly preserves them. They do not measure provider performance.

A separate cross-chapter fixture freezes a terminology observation with an exact canonical quote and supplies it through the real selector. An explicitly scripted verifier leaves the local-only case unresolved and detects the definition in document context. This establishes context delivery and bounded permissions, without estimating a model's reasoning ability. The uncertainty fixture leaves both competing readings intact.

The report includes elapsed process time and zero paid usage. Elapsed time is a small local fixture measurement with no provider latency; zero cost reflects no requests, not an estimated production price. All fixture passages and model outputs are synthetic. No user documents, real PDFs, credentials, models, or external transmissions are involved.

## Evaluation still required

Real-provider academic PDF reconstruction quality, correction precision/recall, independently verified correction rate, quotation and mathematics preservation at corpus scale, cost per thousand source characters, wall time, and failure rate remain **UNRUN**. Those comparisons require separately authorized representative documents and paid provider calls. Capability- or consent-gated optimization interfaces must remain opt-in until those evaluations justify changing defaults.

## Reliability checkpoint

Stages use at most two workers, and every provider request still enters the existing Intelligence admission and rate-capacity checks. A busy admission is recorded as an admission failure; the executor does not retry it silently. Transport uncertainty blocks resumption. Returned malformed JSON and canonical mapping failures retain the original raw result and usage separately from validation diagnostics. Evidence failures remain distinct from output failures.

`repairReconstructionPass` is an exported server interface requiring `allowAdditionalRequest: true`. It records a new repair request with lineage to the original request and output; it preserves both outputs and both usage records. It is not automatically invoked and does not yet have a browser/HTTP repair action. A first-pass repair cannot change an already frozen synthesis. A failed or uncertain request is never replayed through ordinary resume.

Progress updates serialize the report; completed-chunk transactions serialize report and decisions without document snapshots. Derivative materialization occurs at the final stage boundary and at startup recovery for interrupted revisions. Full revision saves remain at lifecycle/publication boundaries. Imported frozen synthesis retains its archived identity and cannot be resumed under a remapped revision ID; start a new revision explicitly. Backups preserve original requests, synthesis, repairs, usage, and uncertainty without starting provider work.

## Opt-in optimization checkpoint and limits

`planReprocessingOptimization` supplies supported, pure planning interfaces for stage-specific model routes and selective original-page demands. Opt-in, an evaluation identifier, capability, separate routing/evidence consent, official model/reasoning compatibility, and an explicit additional-request budget are required. Plans bind canonical text, document and configuration hashes. Local evidence demand does not grant external transmission permission. Synthetic tests cover disabled defaults, consent/capability denial, bounded page selection, invalid reasoning/ranges, and frozen-plan tampering.

These plans make **zero provider requests**. Production execution continues to use the revision's selected model and its existing evidence preparation. Activating routing or selective collection in the executor is deliberately deferred until evaluation; no HTTP/UI optimization switch is exposed. Ordinary bounded structural/exact-term context selection is already part of Balanced verification and needs no embeddings.

The final deterministic audit covers document-wide footnote linkage, duplicate definitions, physical page markers, substantial content loss, newly duplicated paragraphs, quotation/math changes and unresolved context. Its candidate hash, context hash and findings remain durable independently of later review materialization. Findings are diagnostics for targeted investigation or review and never trigger paid requests.

Supported limits are 128 chunks, 50 patches per chunk, 64,000 UTF-16 units per synthesis request, 128 evidence-linked synthesis observations, and bounded local/retrieved context. Oversized synthesis inputs reject explicitly; hierarchical consolidation is not implemented. Existing V1/V2 records remain readable; incompatible historical prompt versions require a new revision for further processing. Repair UI/HTTP integration must serialize owner actions and use compact report updates or optimistic concurrency to preserve concurrent editorial decisions.

Validation uses Node 24, in-memory SQLite, scripted providers and a synthetic desktop/mobile Chromium fixture. Run `npm run build`, `npm run test:all`, the offline evaluator, and the browser command above. Paid model quality, real academic PDFs, production provider latency and comparative paid cost remain **UNRUN**.

## Recorded validation (2026-10-24)

- `npm run build`: passed styles, application/test typechecks, server compilation and Vite build.
- `npm run test:all`: 1,468 passed, 7 skipped, 0 failed (1,475 total; Node 24.19.0).
- Scheduler integration: 29 passing synthetic tests including two-worker barriers, uncertain recovery, separately consented repair, frozen context, crash recovery and 1,000-finding audit truncation.
- Source desktop/mobile Chromium fixture: passed. Existing dark-theme browser fixture: 12 scenarios passed, no recorded harness errors; screenshots intentionally UNRUN.
- Independent review: 20,000 deterministic Unicode/apparatus edit round trips passed; findings were corrected and rechecked.
- Offline corpus: 4 scripted corrections, 10 protected-content checks; review spans 85 to 4 UTF-16 units. This is a diff/context delivery comparison, not a provider quality result.

No paid calls, user-document transmissions, model downloads, credential changes, remote writes, deployment or publication were performed. The implementation is on its own local branch for review.
