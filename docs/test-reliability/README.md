# Focused test reliability and reduction pass

Base: `5822ecc59f7c931b2a873bfe282cf1455ece2466` (verified main, merged PR15).
Local branch: `test-reliability-reduction`. No production source changes, dependency changes, pushes, PRs, merges or deployments.

The supported default suite now passes, with six explicit platform skips on Linux. All 71 baseline failure identities were investigated and repaired or mapped to equivalent passing consolidated coverage. The failure ledger records their evidence, classification and disposition. No production defect or product decision was needed to obtain the passing result.

## Measurement

Linux, Node 24.19.0, locked dependencies installed with `npm ci --ignore-scripts`. Synthetic temporary data only; no live vaults, credentials or AI calls. Baseline build passed before the original `node --import tsx --test --test-reporter=tap test/*.test.mjs` test phase. Final runs use the same Node runner/import, process isolation and default concurrency, with explicit recursively discovered files. Build is measured separately from test duration.

| Measurement | Before | After |
| --- | ---: | ---: |
| Runnable `.test.mjs` files | 113 | 113 |
| Reported cases | 592 | 584 |
| Passed | 515 | 578 |
| Failed | 71 | 0 |
| Skipped | 6 | 6 |
| Cancelled | 0 | 0 |
| Test-phase wall time | 30.20 s | 30.56 / 30.98 s (two final runs) |

Ten redundant case registrations were eliminated through removal/consolidation, and two infrastructure regression cases added: net **eight fewer cases**. The math suite was absorbed into editor tests; the new small infrastructure suite keeps runnable file count flat. This is a modest reduction, not a claim that the suite has been radically shrunk. Most critical scenarios are distinct and were retained.

`inventory.json` enumerates every before/after runnable file, declaration counts and matched TAP case-duration sums. The full case-name/result inventory and complete diagnostics are in the delivered evidence bundle; compact repository ledgers retain identities, reasons and error excerpts. Static declarations differ from runtime case totals because of nested/dynamic tests and the original whole-file CSS import failure. Per-case durations overlap under concurrency; their sum is not wall time. There is no coverage-percentage claim: no code-coverage instrumentation was run.

## Repairs and missing coverage

- Small `setupDOM` owns global descriptors and capabilities, registers cleanup before React mount, supports explicit deferred teardown, continues cleanup after individual errors and closes idempotently. Semantic, selection, App navigation and rendering fixtures reuse it; ordinary tests do not inherit the 200-block performance fixture.
- A checked TypeScript `Pick<Intelligence, ...>` factory supplies the actual selective enrichment interface in domain and enrichment suites. `npm run typecheck:tests` is part of normal typecheck/build. JavaScript tests remain JavaScript.
- Semantic tests now traverse current Turn into / AI actions menus, assert current accessible labels, explicitly include the trailing typing surface, and retain grouping, clipboard ownership, reorder, retry, changed-input cancellation, unmount cancellation and unrelated-edit preservation assertions.
- Selection fixtures provide explicit hit testing and deterministic frame flushing. Drag fixtures model object-form scrolling, column metadata, valid viewport/document bounds and landing frames. Concurrent edits assert cancellation with the edited object retained, rather than demanding a stale snapshot reorder.
- Exact mention wording is asserted in canonical and alias links; input immutability moved into the broader paragraph/table formatting matrix. Browser-dependent SSR tests have explicit DOM ownership.
- Source tests enforce one original per source, verify rejection leaves the original attached, round-trip separate sources through backup/remapping, verify original bytes, retain vault/lock/recovery checks, and explicitly assert that unadmitted downloads return 409 before admitted downloads succeed. Empty extraction/retry is exercised on an attached source; abandoned upload removal is a separate explicit fixture operation.
- Summary tests select records by `kind` instead of ordinal position. Legacy mutations target only summary rows; ownership state is preserved. Rename, stale/current fingerprints, restart, exact-generating-revision backfill and generated-content exclusion remain asserted. The broad entity lookup-count implementation check was replaced with observable fingerprint/provenance assertions; render/history instrumentation owns performance checks.
- Status/preferences assertions include the full current rate-limit/enrichment-profile shape. Compatibility title output budget is asserted at its current 512-token bound.
- Added infrastructure regression coverage: recursive nested discovery; rejection of omitted, duplicate, absent or unknown group entries; teardown registered before a throwing React mount; cleanup continuation after a cleanup failure; restoration of prior globals; idempotent close.

These changes resolve all 71 baseline failing identities: 39 stale assertions/contracts and 32 fixture/environment gaps. One formerly failing display case is replaced by the passing two-delimiter matrix; meaningful scenarios were not deleted to make a failure disappear. There are no remaining failing or unclassified identities. No production code was changed.

The follow-up investigation repaired the remaining contracts as follows:

- Vector fixtures now call public `PageSegments.synchronize(vault, pageId)` instead of a private method whose signature changed. Ranking, exclusions, corrupted/stale vectors, restart and no-provider-call assertions all pass unchanged.
- Workspace fixtures model the current metadata endpoint and server-filtered Trash organization. Save-before-delete, restoration and no-extra-autosave assertions remain intact.
- HTTP provider fixtures return only fields requested by the selective response schema, using one checked transport envelope. Enrichment storage tests distinguish generated summary/topics from ownership metadata, assert inferred summary provenance, and prove summary deletion preserves unrelated records and suppression state.
- Notification tests exercise the real title-enrichment commit instead of pretending a manual title save is an automatic commit. Bare saved legacy results still produce no title notification; manual changes remain silent.
- Schema tests assert current subtype-owned definitions, category inheritance, sibling/value isolation, missing-field rejection and inability to remove a subtype/category until dependent values are cleared. The custom fixture name no longer collides with the built-in Researcher. The legacy migration test actually restores its unapplied migration marker before reopening.
- Entity scan tests preserve exact mention text and dynamically computed page mentions, assert durable indexing dirty work instead of obsolete synchronous jobs, verify saved-context cache reuse without a provider call, and change evidence before forcing fresh inference. Alias controls are asserted through their current visible chips and labeled controls.
- Source quotation and summary rendering tests distinguish stored textual provenance from obsolete presentation flags and consumed Markdown syntax. Unsafe-link/HTML, literal code, currency and incomplete-math cases remain distinct.
- The lock regression now asserts cancellation of an in-flight request with 409, fresh locked requests with 423, the exact cancelled activity record, and retention of the last saved summary. The legacy title endpoint is tested as a selective-enrichment facade: stale results are rejected and manually named titles survive later classification.

## Reduction and coverage map

| Removed/consolidated original cases | Retained replacement and reason |
| --- | --- |
| `editor`: display equations paste as independent blocks; `math-delimiters`: bracket display equations | `editor`: display equation blocks preserve multiline commands for both delimiter styles. Two labeled delimiter inputs retain exact LaTeX, surrounding blocks, adjacent equations, fenced-code protection and incomplete input. Two registrations become one. |
| `math-delimiters`: parenthesis/bracket equations across saves; `editor`: inline/display persistence and scan exclusions | Existing editor round-trip now runs both delimiter families against current revisions, preserving native records, scan exclusion and invalid entity-in-math rejection. Two registrations become one. |
| Remaining `math-delimiters` inline, literal/escaped and caret cases | Moved intact to `editor.test.mjs`; the separate suite is deleted. These cases were relocated, not counted as deletions. |
| `auto-entities`: matching spans styled text and preserves surrounding formatting | `entity-formatting`: utility/AI evidence matching matrix covers six styles across paragraph/table inputs; now also asserts input immutability. Single overlapping example removed. |
| `page-titler`: empty drafts do not poll before idle delay | Existing observer timing case checks before-delay and exact idle boundary. The removed case only advanced half the delay and did not establish a separate empty-content policy. |
| `page-titler`: editing/leaving after read failure | Existing read-failures case asserts no independent retries across 429/502/503 and long delays. Cancelling after an already terminal failure could not distinguish cancellation behavior; separate pending-result cancellation cases remain. |
| Three `page-language-composition` cases | One four-row named decision matrix preserves small same-language edits, major script changes, substantial Latin-language replacement and missing baseline. Three registrations become one; every row has a diagnostic label. |

| `page-titler`: pending title reads and completed named-page classifications | One two-scenario observer lifecycle matrix retains exact 1999/2000 ms boundaries, applied title/domain transitions and stopping after completion. It additionally rejects unsolicited background renaming of an authored title. Error and cancellation cases stay separate. |
| `entity-review-feedback`: final acceptance and final rejection cases | One three-row named completion matrix retains acceptance after rejection, rejection after acceptance and all-rejected reviews, with exact message/detail assertions. Partial, bulk and invalid/no-change decisions remain distinct. |
| `summary-math`: multiline display beside prose | Folded into the existing inline/display delimiter rendering case, which now contains multiline bracket math, exact annotations and before/after prose. Security and invalid-LaTeX fallbacks remain distinct. |

No other whole suite was judged obsolete. No suite was skipped or excluded to lower counts. No large opaque mega-test was introduced. Provider/mount failures were repaired before interpreting their semantic assertions.

## Commands and discovery

| Command | What runs |
| --- | --- |
| `npm test` | Build (including application and narrow fixture typecheck), then every recursively discovered `.test.mjs` file. |
| `npm run test:all` | Full test phase without rebuilding. |
| `npm run test:unit` | Unit/shared boundary group. |
| `npm run test:dom` | DOM/editor/component behavior group. |
| `npm run test:server` | Server/persistence and native integration files, including tests that also render components. |
| `npm run test:list` | Exact default discovery list and count. `node scripts/test.mjs --group=dom --list` lists one group. |
| `npm run test:browser` | Synthetic Chromium editor and reading-continuity checks; requires `PLAYWRIGHT_MODULE` and optionally `CHROMIUM_PATH`. |
| `npm run test:performance` | Render isolation assertions plus mounted document-history and deterministic semantic-drift replay measurements. |
| `npm run test:native` | Explicit macOS source-native integration command; fails with requirements on unsupported platforms. |

`test/groups.json` is an exact partition: ungrouped discoveries, duplicate paths, stale paths and unknown groups fail loudly. Discovery recursively walks `test`, so nested suites cannot silently disappear through the old root-only shell glob. All default files still run. Native tests remain in default discovery with truthful skip reasons on unsupported hosts; they were not moved out to manufacture a reduction.

Only the App navigation suite registers the CSS-only Node loader before dynamically importing App. This loader does not claim to test styles; real styles remain exercised in browser checks. Scoping it to that worker avoids adding loader overhead to every suite.

On Linux the six skips are the Keychain adapter plus five macOS PDFKit/Vision/Swift/sandbox source tests. `NOEMA_NATIVE_TESTS=1` is additionally required for the opt-in sanitizer integration. Native behavior remains unverified here.

## Verification and limits

Two final runs after the additional consolidation returned identical counts: 578 pass, 0 fail, 6 platform skips; 584 reported cases. Test-phase times were 30.56 s and 30.98 s. The preceding full run before the three additional consolidations also passed (581 pass, 0 fail, 6 skips). Earlier intermediate logs remain as historical evidence, not outstanding failures.

- Build/typecheck passed, including the checked provider factory. Vite retains its existing large-chunk warning.
- Browser checks passed on Chromium 154.0.8037.57: native typing/caret, undo/redo, split/merge, clipboard paste, format shortcut, cross-block selection, CDP IME, entity rename/type; reading anchor/bookmark CRUD, ambiguity refusal, API/database/browser-context restart, final flush, error/retry, end-of-source reopen and mobile viewport. Synthetic injected API 500/503 logs are expected retry probes; browser harness error arrays were empty.
- Performance command passed after matching PR15's immutable ingress in its history fixture and supplying tsx to TypeScript benchmark imports. Both direct and history edits assert one rendered/synced row, zero editable replacements and zero observed DOM mutations. Deterministic history and semantic-drift measurements are included as evidence, not production latency/billing estimates. The render script's `before` output counts calls to its legacy renderer anchor; this task did not change production rendering, and that label is not a production before/after improvement claim.
- Test runtimes are not a speedup claim. Default now executes App navigation assertions that previously failed during CSS module bootstrap. Repeated tests detect obvious instability only; they do not prove absence of races or all-platform correctness.

## Remaining limits

There are **zero remaining supported-default failures** and no unresolved product decisions. The six platform skips are not treated as passes. Native macOS PDFKit/Vision/Swift/sandbox and Keychain behavior could not be executed on Linux; the native command explicitly reports its platform requirements. Browser and benchmark evidence is synthetic, not a production performance certification.

The first local pass (`a8dd114`) repaired 48 baseline identities but retained 23 failures. The follow-up continued all 23 investigations to completion; those intermediate failures are no longer outstanding. Earlier logs remain in the evidence bundle and the Library's prior report version.

## Maintenance rules

1. Every new test file must enter exactly one reviewed group; keep default discovery exhaustive. Put expensive optional checks behind named commands without calling that redundancy removal.
2. Add a case for a distinct contract or regression, not each assertion. Use small labeled matrices for true input variants; retain separate test boundaries for lifecycle, security and concurrent behavior.
3. Use explicit minimal fixture inputs. Shared DOM capabilities do not imply sharing page size, provider behavior or all application mocks. Register resource cleanup before mount and restore globals/API methods even after failure.
4. Keep provider doubles narrow and checked against their consumed interface. Capture output shape and freshness/cancellation contracts rather than legacy implementation method names.
5. Select persisted records by identity/kind. Avoid asserting incidental record order, menu wrappers or global lookup counts. Use exact content/provenance assertions and dedicated instrumentation for performance.
6. Require a removed-case-to-retained-coverage mapping for deletions. Never accept a lower count obtained from skips, narrower globs, swallowed errors or dropped security/recovery/selection edges.
7. Reproduce failures against the current main, keep unresolved identities in the ledger, and repeat the full default after fixture changes. Prefer a truthful red result over an invented green baseline.
