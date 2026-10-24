# Document reprocessing review implementation

Implemented on `codex/document-reprocessing-review` from current main `0d5239b` (2026-10-24). Library Views and Calendar/date workflows are outside this branch.

## Phase heads

| Phase | Commit | Result |
| --- | --- | --- |
| 1 — Reliability | `4a4727a` | Real policy integration tests; two-slot editorial admission mutually excludes exclusive requests; supported selected reasoning validated before enqueueing. |
| 2 — Recoverability | `34898b3` | Durable excerpt ledger, classified failures, bounded transient retries, configuration circuit breaker, parser-consistent activity outcomes, explicit resume. |
| 3 — Job lifecycle UI | `18786de` | Visible failure and coverage, excerpt ledger, partial labels, review-first suggestions, supported configuration preview and current-session ETA. |
| 4 — Quality and review fixes | `d84f60c` | Capability-gated structured JSON, verified UTF-16 patch evidence and saved-patch binding, persisted bounded revision summaries, independent-review corrections. |

Both reported defects were confirmed against fetched main: editorial requests claimed an exclusive slot despite the two-worker dispatch, and editorial reasoning was forced to unsupported `none`. The final implementation restores intended two-worker operation through an explicit central admission semaphore; unrelated independent/exclusive policies and manual budgets remain intact. Prompt construction remains lazy, feature parsing remains local, and editorial processing retains persona exclusions and the existing provider boundary.

## Recovery guarantees and review corrections

Each attempt records counts, duration, classified outcome and effective model/reasoning. Only explicit rate-limit or temporary provider HTTP failures are automatically retried, with at most three attempts and bounded backoff. Invalid JSON, local admission, unsupported configuration and uncertain transport outcomes are not automatically resubmitted. After-dispatch cancellation and restart retain provider uncertainty; an explicit resume can repeat an unfinished, potentially billed request. No exactly-once guarantee is possible for a lost provider response.

Independent review reproduced a restart window where validated sibling success could be repeated while its slower sibling was still running. Successes now checkpoint their patches and completion immediately; the held-sibling restart regression verifies resume skips that successful excerpt. Ledger-only saves serialize the small report rather than both snapshots. A five-excerpt fixture performs six full checkpoints (five successes plus final assembly), with ten report-only updates, rather than sixteen full snapshot serializations. Accepted-document materialization remains conditional on accepted edits and final assembly.

Review also caught cancellation uncertainty, missing-usage completeness, repaired reasoning provenance and row/payload progress inconsistency. Each has a regression. Review decisions, sparse/legacy completed indexes, successful excerpts, reported usage and cumulative active time survive resume; per-session estimates use only recent successful durations from that session. New and old saved patches retain explicit original-text evidence; accepted materialization revalidates it. Raw source data stays immutable.

## Validation

- `npm run build`: passed, including style checks, application/test typechecks, server compilation and Vite build. Existing large-chunk warning remains.
- `npm run test:all`: **1,216 passed, 7 skipped, 0 failed** (1,223 total).
- Focused source reprocessing, actual Intelligence policy with mocked HTTP, UI and summary suite: **61 passed, 1 platform skip, 0 failed**.
- Synthetic Chromium desktop (1200px) and mobile (390px): passed failure recovery, ledger, retained configuration, review decisions, start preview, token completeness and horizontal-overflow checks.
- Independent review and re-review: no remaining blocking findings.
- `git diff --check`: passed.

Focused commands:

```sh
node --import tsx --test test/source-reprocessing.test.mjs test/source-reprocessing-ui.test.mjs test/source-reprocessing-summary.test.mjs test/intelligence.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/check-source-reprocessing-browser.mjs
```

The browser check uses a disposable local React fixture and intercepted local APIs; it rejects external browser traffic. Use the normal `playwright-core` package when available, or the explicit `PLAYWRIGHT_MODULE` override. Chromium defaults to `/usr/bin/chromium` and supports `CHROMIUM_PATH`.

Validation logs from this executor are in `/tmp/noema-reprocessing-{build,full-suite,final-focused,browser}.log`; independent review logs are `/tmp/noema-independent-rereview-tests.log`. Temporary logs may not survive the environment.

## Remaining limits

No real API request, paid test, credential configuration, real vault inspection or private runtime-log inspection was performed. Live provider behavior, billing and quality therefore remain unverified. Native macOS/Safari/PDF extraction checks are outside this Linux/mock-only run. The academic regression is synthetic extracted text covering equations, multilingual quotations, decomposed Unicode, footnotes, repeated headers/citations and bibliography; it is not a claim of improved extraction accuracy.

Selectors load the latest 100 persisted summaries; older revisions are retained and available by ID, with no older-revision pagination UI in this change. Nullable/missing legacy patch offsets retain the unique-exact-substring fallback and safely reject ambiguity. Automatic transport-timeout retry is intentionally withheld because provider completion/billing cannot be established. No PR, merge or deployment is part of this work.
