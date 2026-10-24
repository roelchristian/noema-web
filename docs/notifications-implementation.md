# Unified Alerts & Notifications — implementation evidence

Implemented Option B (Quiet Structured) against main `a0667a7` (includes #100,
#101, #103 and #102). Work is local on `feat/unified-notifications`; no push,
PR, merge or deployment was performed. No dependencies or database schema changed.

## Increment boundaries

Each of the first six committed snapshots was independently exported to a clean
`/tmp/noema-phase-N` directory and passed `npm run build` and its focused tests.

| Phase | Commit | Actual scope | Focused tests |
| --- | --- | --- | ---: |
| 1 | `56cccd4a56b5092b4509d3147a887bd26a2a3117` | Primitives, isolated manager, queue/timing/actions/scope, aliases and stylesheet contracts | 14 |
| 2 | `30b78f45a8f925b8bfe1a5b1ad986d8348929df2` | Shared app viewport, occurrence errors, guarded archive Undo and save-error suppression | 26 |
| 3 | `e109fbe10a2854e39c12381315c5eff876a91c43` | Eight local form consumers and four-second visible-time FormNotice | 8 |
| 4 | `dc1caf9fc6989d8d5a2cf748dc1a5c96f8538999` | Persistent save/browser-copy/draft notices; contextual ConfirmDialog errors moved into this safety increment | 2 |
| 5 | `2857badd5c96018ceeac0e57745da960e71fc113` | Source/reprocessing presentation adapters, diagnostics and partial completion | 21 |
| 6 | `97640857254f6c5c7ead8749b2ead271798fbaa9` | Activity status presentation; feed logic preserved | 20 |
| 7 | Final local commit | Legacy removal, style ownership audit, independent bridge/race tests, scope-update and busy-action guards, explicit saturation feedback, browser harnesses | 47 final focused tests |

Independent reviewers found and verified fixes for mutable store snapshots,
important queue priority, stale action results, vault-sensitive announcer text,
scoped updates, busy Undo activation and failed-save propagation through the
application reporter. The provider's stable command context keeps toast updates
out of editor subscriptions. Save and recovery authority stays in Workspace;
processing and Activity authority stays in the feature/server model.

The queue has two visible slots and 32 pending records. Queued routine records
are evicted before important feedback. If every record is important, an existing
visible record retains its action and shows a persistent generic overflow count.
This makes saturation explicit without copying protected content or claiming
that underlying work resolved. It cannot retain unlimited transient messages.

## Validation

- Build (including styles, client/server types and typed tests): passed.
- Unit suite: 209 passed, zero skipped.
- DOM suite: 426 passed, zero skipped (before the final five bridge cases).
- Full suite on the committed implementation: 1,407 passed, seven platform
  skips, zero failures. Final scoped-update and exact-error reporter regressions
  also passed the 47-test focused set plus build.
- Seven skipped native extraction tests require macOS PDFKit, Vision, Swift and
  sandbox-exec; they were not reported as passes.
- Synthetic notifications browser: four light/dark desktop/mobile combinations,
  coarse pointer, wrapping, 44px targets, neutral surfaces, contrast, keyboard
  focus, async failure/retry, Focus mode, reduced motion, 200% CSS zoom and native
  dialog layering passed. 28 screenshots plus JSON evidence.
- Design harness: 12 combinations passed, minimum semantic text contrast 5.59;
  110 screenshots plus JSON evidence.
- Archive, source reprocessing and Review Centre browser workflows passed.
  Review Centre completed 14 groups with zero provider calls, retaining polling,
  cancellation/read-state, lock/vault fallback and exact destination checks.
- Aggregate `test:browser` initially stopped at a selection-toolbar timing
  timeout. The unchanged phase-1 snapshot and final toolbar rerun both passed;
  editor, reading continuity, entity linking, selection toolbar, entity scan,
  document find and Calendar all passed individually. The aggregate command
  itself was not rerun or described as passing.
- Dark harness: an earlier direct run passed 12 cases; a later literal npm run
  failed because the mobile source-viewer sample disappeared before contrast
  evaluation. The targeted mobile npm follow-up (`NOEMA_THEME_WIDTHS=390`)
  passed all six theme/accent cases, minimum semantic contrast 5.59;
  `/tmp/noema-dark-mobile-recheck.log` records the result.

Harness-only selector updates follow already-merged contracts: toolbar density
controls, explicit source review and bulk choices, Connections tab, Retry AI and
SourceMetadata suggestion rows. No production processing, source pass count,
metadata helper or toolbar algorithm was changed.

Evidence is local and uses synthetic data only:

- `/tmp/noema-phase-validation.json`, `/tmp/noema-phase-N-{build,focused}.log`
- `/tmp/noema-test-all-committed.log`, `/tmp/noema-final-focused.log`, `/tmp/noema-final-build.log`
- `/tmp/noema-notifications-evidence/validation.json` and 28 PNGs
- `/tmp/noema-notifications-design/validation.json` and 110 PNGs
- `/tmp/noema-review-evidence/verification.json`
- `/tmp/noema-toolbar-final-evidence/toolbar-browser-result.json`
- `/tmp/noema-remaining-browser.json`

Native browser UI zoom, Safari and native extraction remain untested on Linux.
The existing dark harness documents pre-existing light out-of-month Calendar
text contrast of 4.4376:1; the notification palette introduces no new colours.
