# Test fixture streamlining

Reviewed and implemented on 2026-10-23. Pinned paired comparison base: `14f6e073e276aef94194601dedc88d2fd8514dc2` (main including PR 54–58). Initial work began at PR 54 merge `ee4f6c32a18e2841013ac68932be2bb62325bdae`; local commits were rebased cleanly as PR 56, PR 55/58 and PR 57 landed, and paired measurements were repeated on each new base. Earlier integration base was `965c3fb98253ba565eaf9109d1aa34d0c9aab1b8` (PR 59/60); its validation is separate from the controlled comparison. PR 54's asynchronous real-search Worker and queued/unadmitted source-file admission fixes remain intact.

This change reduces fixture work while preserving named scenarios and assertions. There is no case-count target, production change, dependency/configuration/runner change, snapshot refresh or slow-suite exclusion. Higher-risk embedding scheduler/prompt-contract options are reviewed separately in [higher-risk-follow-up.md](higher-risk-follow-up.md), without implementation.

## Invariant-preservation map

| Target | Implementation | Retained or strengthened coverage |
| --- | --- | --- |
| Editor rendering fixture | Ordinary cases default to six rows, with remapped middle/neighbor indices; two integrated paragraph cases request seven to retain six populated rows plus the empty typing row. The native-node case and performance `measure()` explicitly request 200. | All fifteen editor cases remain, including PR 57 paragraph flow, readonly parity, authored entity spaces and composition undo/redo. The original nine retain: native typing/caret/selection/composition/history, formatting/entity refresh/alias/unknown entity, numbering/reorder, citations/review decoration, table unlink, image paste/error/cross-block/copy and undo/redo. Large case asserts 200 mounted rows; performance assertions retain row b 87 and unchanged-neighbor guarantees. |
| PDF worker fixture | Tiny executable bytes replace the entire Node binary. Test both direct and canonicalized linked paths; Windows uses a directory junction rather than privileged file symlinks. | Exact byte copy, mode, canonical path/profile replacement, preserved input restriction, copy disposal and surviving original. No claim of native macOS sandbox execution. |
| Find shortcut fixture | Scoped mocked `setTimeout` after initial mount; React unmount precedes clock reset. | Closing/inert/query state, visible 199ms/hidden 200ms fallback, separate animation completion, reopen surviving old dismissal, reduced motion and listener cleanup. PR 54 asynchronous Worker backed by real search remains, with explicit 149/150ms debounce assertions. |
| Four entity DOM suites | `helpers/entity-dom.mjs` composes unchanged `setupDOM`, fresh doctype DOM, draft clearing, pre-mount root cleanup and shared click primitive. | Feature records/API doubles and all cases remain local. Overview evidence and Sources-tab evidence retain distinct endpoints, cancellation/retry/pagination behavior. No shared mutable DOM or database. |
| Three property HTTP suites | `helpers/http.mjs` owns fresh DB/store/real HTTP listener, early registered teardown, JSON/request mechanics. | No implicit client, Origin or vault credentials. Original feature writes, compatibility/hierarchy rejection, authored provenance/review scope, reference pagination/isolation and external-Origin rejection remain. Existing broader CSRF/vault/locking tests remain in full discovery. |
| Three backup suites | Shared fresh gzip/JSON archive decode/rewrite only. | Existing mutation/assertion bodies remain: validation/rollback, remapping, cross-vault/hash failures, temporal/type/provenance authority, legacy imports, rejected evidence and paused AI work. No shared mutable archive objects. |
| Legacy freshness/drift/migration | Named builders for numbered vocabulary, omitted tails and historical first 4096-distinct histogram. | Exact 5000/4096/6000 dimensions and 10096 token mass remain. Original trailing-whitespace, NFKC/symbol tokenizer, versions, punctuation/serialization, omitted-tail replacement, cumulative edits and generating evidence remain. Builders are independent of production histogram code. |
| Calendar overlay/week input | Compact normalized records for 84 Roman days and 7 regional days; complete-year API objects fill unobserved dates with explicit synthetic placeholders. | Every observed month/season row retains exact source-derived records. Fresh clones preserve Latin overrides/mutation isolation. Original full-provider normalization tests remain; added parity checks compare all 91 retained dates and validate full 365-day API shape. All optional alternatives, precedence, ranks/colors, year/week transitions and missing regional metadata remain. |

No cases or assertions were removed. The PDF registration now covers both direct and linked paths; calendar parity assertions and find timer boundaries add sensitivity within existing registrations. Source normalization fixtures remain available to the full provider tests.

## Measurement

Environment: Linux x 64 kernel 6.18.55, AMD EPYC 9V 74, five visible CPUs with a four-CPU cgroup quota, Node available parallelism four, 16 GiB memory limit and no swap. Node 24.19.0, npm 11.9.0, TypeScript 7.0.2, tsx 4.23.15, Vite 8.3.4. Default Node file concurrency was three. No competing benchmark jobs were run; this shared/container host is not a dedicated machine.

| Command, same pinned source base | Before wall seconds | After wall seconds |
| --- | --- | --- |
| Clean dependency setup, warm cache, `npm ci --ignore-scripts` | 1.497 | 1.442 |
| `npm run build` (separate) | 4.349 | 3.870 |
| `npm run test:all`, run 1 | 74.319 | 67.372 |
| Full run 2 | 71.260 | 66.887 |
| Full run 3 | 69.774 | 68.684 |
| Full median | **71.260** | **67.372** |
| Full range | 69.774–74.319 | 66.887–68.684 |
| Nineteen affected files together | 13.484 | 10.672 |
| Editor file, fifteen cases | 11.151 | 3.032 |
| Find file, three cases | 1.660 | 1.341 |

All six full runs discovered 1046 tests: 1040 passed, zero failed/cancelled and six platform skips. Median improvement is **3.888 seconds (5.5%)**. The editor-file improvement is 8.118 seconds (72.8%); concurrent suite execution means this is not an additive suite saving. No case-count reduction. Three samples per tree provide useful observed variance, not a statistical guarantee or isolated causal attribution among helpers. Before-first order, shared host and warmed caches remain limitations. No separate style/typecheck script was timed; build is reported by its actual command rather than relabeled as a standalone typecheck.

Measured after-tree was local commit `f246194bd7c7df730c369a4ed338837b779b1fa8`. Its test-only diff against `14f6e07` is byte-identical to this change against final integration base `965c3fb`: SHA256 `0ad0ca4291907892add3e016a7ddfa347aa4d822c6fdb08020c1369657745fe0`. To reproduce the comparison after publication, export `git diff 965c3fb <PR-head> -- test`, apply it to an isolated checkout of `14f6e07`, install with the recorded command and run three sequential full commands per tree. Keep that comparison separate from current-main integration validation.

Earlier exploration repeated three-before/three-after cohorts as features landed, but those different source trees are not pooled into this result. Raw numeric samples, exact commands and TAP totals are recorded in [benchmark-evidence.json](benchmark-evidence.json). The original audit's 102.44-second CI test step belonged to an older tree/runner and is not a cloud speed claim for this patch; exact-head PR CI is a separate acceptance check.

Only one owner ran tests/builds/benchmarks; independent reviewers did not run competing commands. Warm npm cache was reused for clean `npm ci --ignore-scripts` installs. First-in-directory means first invocation in that archive, not a flushed host cache. Full runs were sequential with the existing recursive runner/default settings. Representative file timings are single samples unless stated. Per-case durations overlap and are not suite wall time; affected-set wall times are separate commands, not additive components of the full run.

## Validation and remaining scope

Earlier integration at main `965c3fb` plus this test patch: `npm run build` passed (4.844s); full `test:all` passed **1062 tests, 1056 pass, zero failures, six platform skips** (71.088s); nineteen affected files passed (10.842s). These single later-tree observations validate integration and are not compared with the older baseline for a speed claim.

The disposable editor isolation harness retained explicit 200-row input and reported exactly one rendered/synced row, zero editable replacements and zero observed unrelated DOM mutations for direct and history input. The Chromium 154 browser acceptance command passed native typing/caret, undo/redo, split/merge, native clipboard, shortcuts, cross-block selection, IME and entity rename/type; no screenshots were taken. Native macOS behavior remains unverified here.

Three deliberate fault checks on disposable copies each produced its expected failure: ignoring the explicit 200-row fixture request; lowering the legacy histogram cap 4096→4095; bypassing archive mutation. These expected failures are sensitivity evidence, not suite flakes. Higher-risk review controls are proposed and were not executed. No provider calls or spend were used. No Windows/macOS execution claim; the linked-worker path uses a Windows-compatible directory junction by construction.

No default-suite failures or varying skips were observed across the paired or integration runs. This is bounded evidence, not proof that the suite has no flakes. No coverage or mutation score is claimed.

Mixed-layer group splitting/co-location was left unchanged: this patch does not establish a wall-time benefit from moving the pure/provider cases in `page-enrichment-generation` or splitting `source-page-options-ui`. Adding worker files merely to relabel layers could increase startup cost. Only proven unused entity-suite imports were removed.

No broad duplicate/obsolete behavior was established, so no registrations were deleted or merged. Extracted archive/content/environment mechanics were identical; distinct feature surfaces remain separate. Existing KaTeX/React fixture diagnostics elsewhere are not suppressed by this change and are not claimed fixed.

## New-test admission and future consolidations

For a new test identify its protected contract/regression, cheapest observable layer, existing overlapping owner, new branch/race/security boundary and minimum fixture. Extend named matrices only when setup and contract are truly shared; retain separate diagnosis/cleanup when needed. Small ordinary fixtures should request large documents explicitly when size is part of the guarantee.

Keep exhaustive recursive discovery and truthful native skips. Track actual wall time separately from case counts and overlapping durations. Several same-environment runs plus affected-file measurements are required for speed claims. Preserve a removed-case-to-retained-invariant map and targeted negative controls for critical consolidations. Avoid broad snapshot refreshes, blanket console suppression or moving slow cases outside acceptance to improve a metric.

Publication check: main advanced to `12a2d0dc483057a0d9d741ffe5cab04bfa94f513` (PR61 appearance/provenance presentation) after integration validation. Its four changed production files do not overlap this patch. The draft PR retains the validated base and requires current-main CI integration acceptance; no unlike-tree benchmark is substituted.


## PR62 reconciliation and current acceptance

Rebased cleanly onto `ee4d8f3af9d2f51c52526bb45e299a25b0cc6eef` on 2026-10-23, preserving page-history production changes, new tests and group discovery. The test patch remains byte-identical to the historical measured patch (SHA256 above). No benchmark comparison was rerun on a drifting source tree.

Separate current integration: clean warm-cache install 1.727s; build including existing styles/typecheck 6.024s; full suite **1084 tests,1078 pass,zero failures,six platform skips** in **73.134s**; nineteen affected files 10.274s. Editor isolation and Chromium acceptance passed again; all three disposable negative controls detected their expected faults. These are validation observations on this newer tree, not a new before/after speed claim. No screenshots, provider calls or higher-risk implementation.
