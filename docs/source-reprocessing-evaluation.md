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
