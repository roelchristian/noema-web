# PDF provider ingestion: implementation and validation

Date: 26 October 2026. Base: fetched `roelchristian/noema-web` main at `65983e2dfe209c7dcee009fb5d27d187984eb7a4`. Isolated branch: `codex/pdf-provider-ingestion`. The root `AGENTS.md` was read; no repository `.agents/skills/SKILL.md` files exist in this checkout. Work used coordinated contract, provider/PDF, durability, UI, correction and independent-review ownership.

The implementation remains behind `NOEMA_PDF_PROVIDER_INGESTION=1`, off by default. No user documents, live provider evaluations, real credentials/settings or deployment were used. Publication and merge are separately authorized, subject to final checks and the parent’s merge-order gate. `scripts/check-chat-browser.mjs` was not modified.

## Implemented

| Area | Delivered behavior |
| --- | --- |
| Creation | Independent route, model, depth and acceptance choices; explicit provider-PDF consent; per-vault route preference; unavailable local extraction explained; staged bytes/configuration/idempotency retained across entity failure. URL content is fetched and identified before PDF choices and consent. |
| Providers | OpenAI Files/Responses strict schemas and Gemini stable v1 Interactions; exact verified models, versioned effective prices, output/byte/context/page limits, cancellation/deadlines, expiry/cleanup and normalized refusal/incomplete/error/usage handling. No persona, browsing or execution tools. See [verification evidence](pdf-provider-verification.md). |
| Portable PDF/credentials | Bounded PDF.js/pdf-lib workers for admission, page windows, context/native inspection and lazy PNG evidence; server secret-store abstraction alongside macOS Keychain. Quarantine and the existing conservative PDF scanner remain intact. |
| Durable publication | Immutable configuration/context and input fingerprints; run/window/attempt records; exclusive leases; atomic canonical/IR publication; completion ledger; no legacy extraction/math/author/enrichment replay. Reading readiness and indexing remain separate. |
| Structure/citations | Full owned-page accounting, blank/unreadable states, local physical-page markers, UTF-16 end-exclusive ranges, local immutable IDs, tables/footnotes/logical relationships and approximate-only model geometry. Rich data rebuilds from authoritative IR after cache deletion. |
| Bounded reconstruction | Complete first-pass windows; charged truncated attempts retained and split into smaller windows; selective exact-span repair by depth; bounded adjacent-page relation checks with existing IDs and consistency validation. Ambiguous or empty relations remain explicit uncertainty. |
| Reader/review | Creation-time monitor; PDF versus provider-transcription evidence; existing sparse patch policies, linked/bulk/manual decisions, optimistic guards, audit and reversal; metadata reconciliation preserves manual authority. Opening review never generates. |
| Later recovery | Failed optional repairs retry independently into explicit sparse derivatives. A wholly unreadable page can be sent alone using the frozen provider/model and recovered into a mandatory manual-review derivative. Original text/IR/citations stay unchanged; new reading anchors are explicitly unmapped to original extraction. |
| Restart/restore | Unknown paid work cannot replay without explicit recovery. Successful paid candidates finish locally without PDF/provider work. Authoritative IR, rich structure, decisions, context, provenance and usage survive restore; remote handles and credentials do not. Restored work pauses. |
| Usage/audit | Exact SHA256 input hash per attempt, including retries/repair/relations/page recovery; document-level ordered hash manifests; cumulative usage and conservative unknown-paid budget reservations. Existing AI Activity records safe scoped summaries and usage without PDF/prompt/body/credential traces, including full-debug mode. |
| Retrieval | Rich passage boundaries preserve small tables/equations/footnotes; oversized structures retain parent context and precise ranges. Legacy embedding choices, generation identities and content/vector reuse remain separate from extraction provider. |

## Independent review findings resolved

- The real evidence endpoint initially omitted provider transcription while UI mocks supplied it. Both-provider HTTP tests now cover the actual projection.
- Restored sparse revisions now rebind ingestion identities and base/patch hashes without becoming stale or losing decisions.
- Paid outer-response failures remain unknown rather than safely retryable; optional work and new-unit candidates retain local-only recovery.
- Truncated-window namespaces no longer assume numeric order equals physical page adjacency.
- Relation validation checks endpoint scope, kind, direction, cycles, table dimensions and definite footnote pairing; archives use the same checks.
- Recovered text cannot quote-match identical wording on another original page. Canonical mappings remain explicitly unmapped.
- Large assembly JSON can exceed 32 million characters while its canonical source remains within publication limits. Restore uses the existing global archive bound, not an artificial smaller field ceiling.
- Per-attempt input hashes preserve earlier bytes even when a retry changes PDF creation metadata. Archives retain them without borrowing the latest window hash; legacy missing hashes remain null.

## Verification

All provider responses are mocked; PDFs and source content are synthetic. Separate focused runs overlap and must not be added together.

| Check | Result/evidence |
| --- | --- |
| Preintegration final build | `npm run build` passed after the last legacy guards: styles, application/test TypeScript, server compilation and Vite. `/tmp/pdf-legacy-guards-build.log`. Existing large-bundle warning remains. |
| Preintegration final full suite | `npm run test:all`: **2,088 total; 2,080 passed, 8 skipped, 0 failed**, 222.4 seconds. `/tmp/pdf-draft-final-all.tap`. Includes the last legacy guards. Skips require unavailable native/platform capabilities. Combined-main results are recorded separately below. |
| Actual Linux HTTP/runtime | Both providers pass actual upload/staging, portable PDF operations, one-call clean publication, per-page evidence/PNG endpoints, exact per-attempt wire hashes, cache rebuild and backup restore. Also covers selected-page recovery/manual acceptance/restore and two extraction windows plus one bounded relation call. |
| Scheduler/contracts/relations | Latest combined checkpoint: 28 scheduler + 12 relation + 23 contract tests passed; later per-attempt hash tests also passed. Includes ownership, cancellation, unknown outcomes, budgets, partial progress and truncation. |
| Independent restore | 15 tests passed before final aggregate, including retained paid candidates with zero PDF/provider calls and an 8.1-million-character source whose assembly JSON exceeds 32 million characters. |
| Activity/privacy | 7 tests passed, including no content/secret traces in full debug, no replay, thinking/cache usage and unknown post-dispatch failure. |
| UI/review | React/JSDOM interactions cover consent/staging/URL identification, creation monitor, optional retry, selected-page recovery, evidence, inherited decisions and reading positions. Latest recovery-related regression batch passed 75 tests. |
| Baseline regression | Earlier requested-family checkpoint: 116 passed, 1 macOS-only skip. Earlier broad checkpoint: 2,040 passed, 8 skipped. These are superseded by the final aggregate. |

Reproduction:

```sh
npm run build
npm run test:all
node --import tsx --test test/source-ingestion*.test.mjs test/document-providers.test.mjs
```

## Release gates and limitations

- No real transcription accuracy, omissions, reading order, multilingual scan quality, table/equation fidelity, footnote accuracy, review burden, real elapsed provider time, billed cost or savings were measured. Representative live comparison against the local route remains separately authorized release work. Mocks cannot establish production quality.
- Browser validation is no longer blocked: `/usr/bin/chromium` was verified in this same environment as Chromium 154.0.8037.57 on Debian 13. The earlier shell check short-circuited before executable discovery; its missing-browser conclusion was corrected. The separate official-CDN download returned HTTP 403 `Domain forbidden` (network egress, not an approval-review rejection); it was not retried or bypassed. QA used the already-installed browser.
- Passive reconstruction is implemented but unavailable in this workspace: the `bwrap` capability probe failed with `setting up uid map: Read-only file system`. PDFs requiring that isolation fail closed. Screened synthetic PDF import and rendering work on Linux.
- Publication has an explicit 1,000-page application limit and 16 MiB canonical UTF-8 limit, plus a 16,000,000-character IR ceiling. A missing-page recovery unit is bounded to 16,000 characters. Limits fail before incompatible publication; correction and restore budgets match.
- Stateless provider work advertises no remote result retrieval/cancellation or explicit inference caching. Uploads are temporary and freshly created when needed; completed local outputs are reused. Transport abort is not proof a submitted paid request was cancelled.
- New recovered reading spans have exact derivative page/block anchors but no original-text mapping. Existing canonical-backed annotation APIs reject those selections rather than invent coordinates; unaffected original annotations remain valid.
- Model registry verification does not prove configured-account model access. Settings reports access unchecked until processing; quota/model failures are explicit. No credentials were configured here.
- Follow-up official model-page verification confirmed OpenAI’s >272K tariff: 2x input/cache and 1.5x output. Registry version `2026-10-26.2` records these fields; the conservative application window guard stays unchanged. Google guide/reference v1beta examples conflict with explicit v1 GA documentation; the adapter follows the latter. All four requested model IDs were verified; none was fabricated or left unavailable due to unverifiable identity.

No remaining safe implementation item is intentionally deferred in the delivered paths. Genuinely unresolved source evidence remains reviewable uncertainty. Keep the development flag off by default until the external release gates pass.

Final independent signoff: 9/9 runtime/activity tests passed after the exact per-attempt wire-hash assertion; 15/15 restore tests passed. `/tmp/pdf-final-independent-signoff.tap` and `/tmp/pdf-final-attempt-provenance-restore.tap`. These overlap the full aggregate and are not additional totals.

## Installed Chromium follow-up

`PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node --import tsx scripts/check-source-ingestion-browser.mjs` passed **32/32** checks across OpenAI/Gemini at desktop 1440px and mobile 390px. There were **12 mocked generation calls, zero live calls and zero browser page errors**.

Creation and recovery use the actual application components/CSS with real HTTP/runtime services and a disposable database. Restored-source navigation additionally exercises the complete App shell. Checks cover consent, Balanced/Verified defaults, creation-time Stop/Resume, one-call clean publication, PNG/provider evidence, sparse acceptance, explicit recovery/manual derivative selection, actual HTTP backup export/import, unchanged anchors/decisions, and viewport fit. The development flag is enabled only inside the disposable fixture process and restored in `finally`; the product default remains off.

Browser QA found and fixed stale monitor counts after review, misleading labels on accepted recovered readings, and inherited legacy-unavailable findings in fresh provider manifests. The final rerun asserts that provider evidence never shows that fallback warning. The legacy-import fallback itself remains unchanged.

Evidence is generated under `output/pdf-ingestion-browser/`: `validation.json` (2026-10-26T11:41:44.612Z) and 28 screenshots, including `gemini-390-full-app-restored.png` and `openai-1440-full-app-restored.png`. These generated artifacts are ignored by Git; the committed replay script reproduces them. The latest final-code replay passed again after both legacy guards. Its build and exhaustive preintegration results appear in the verification table. The fresh-main integration gate is separate.

The final legacy guards reject initial provider ingestion over any retained canonical text (including a failed/queued local retry), and reject flattened legacy viewing bytes as original evidence when the original is missing. Fresh imports and local publication of retained paid candidates are unchanged. Independent targeted guard tests passed.
