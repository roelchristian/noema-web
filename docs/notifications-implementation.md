# Unified Alerts & Notifications — implementation evidence

Implemented Option B (Quiet Structured) against main `a0667a7` (includes #100,
#101, #103 and #102). The original seven increments were completed locally on
`feat/unified-notifications`. Publication integration is recorded below. No
notification dependency or database schema changes are introduced relative to
current main.

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


## Draft publication integration

The user subsequently authorized a separate draft PR. Main was fetched again at
`f3f7d2cbe04d8ae6d8bfdd686ebaa647dcefcb71`, including merged ReprocessingV2
[#104](https://github.com/roelchristian/noema-web/pull/104). No duplicate open
Unified Alerts/Notifications PR or existing remote alerts branch was found.
All seven phase commits above are preserved unchanged; integration uses a merge
commit rather than rebasing them.

Three conflicts were resolved in `SourceReprocessing.tsx`, its UI suite and its
browser harness. The resulting source adapter preserves V2 processing depth,
independent review policy, exact pass-count labels and pass ledger, local evidence
preparation, transmission consent, uncertainty/replay restrictions and existing
retry/reading-version behavior. Preparation progress uses native shared progress;
its live region announces meaningful stages while checkpoint counts remain
outside it. Server and shared processing files are byte-identical to main.
Independent review and 89 affected checks passed; the evidence preparation test
also checks numeric updates without repeated stage announcements.

At the first publication attempt, Quiet Graphite [#106](https://github.com/roelchristian/noema-web/pull/106)
was a separate unmerged draft, and no changes from that branch were included.
A subsequent remote reconciliation found #106 already merged into main at
`1753f1cae20d50122019502ee0605b8959299c82`. That current main was integrated by a
second merge, preserving all seven phase commits and the prior #104 integration.
No standalone Graphite branch was merged or copied.

Independent review confirmed the complete base token file remains identical to
current main, followed only by the notice aliases. Graphite owns the dark base
values; shared notices consume those values through neutral surface/status
aliases. The automatic merge preserved the removed legacy selectors, neutral
shared geometry and updated browser fixtures, without feature-specific dark
notice overrides. Source processing/server/shared algorithms remain identical
to current main.

Publication validation and exact-head CI are reported in the draft PR. No ready,
merge or deployment action is authorized by this follow-up.

Integrated publication evidence (main `f3f7d2c`): build/styles/types passed;
89 affected tests passed; independent V2 UI review passed 31 checks; full suite
passed **1,459 tests, seven platform skips, zero failures**. Notifications browser
passed four combinations; V2 reprocessing passed desktop/mobile; Review Centre
and Activity passed 14 groups with zero provider calls; design passed 12 cases;
the isolated mobile dark follow-up passed six cases. The full dark attempt hit
the known disappearing mobile source-viewer sample and the initial concurrent
reprocessing load timed out; both failures remain in the raw logs, with unchanged
isolated reruns reported separately. Native/macOS extraction, Safari and native
browser UI zoom remain unrun.

Current integration logs: `/tmp/noema-alerts-integration-{build,focused,all}.log`,
`/tmp/noema-integrated-{notifications,reprocessing-rerun,review,design,dark,dark-mobile}.log`.
Current screenshots/JSON use `/tmp/noema-integrated-*-evidence`.

After main incorporated #106 (`1753f1c`), build/styles/types, 69 focused checks
and the full suite passed again (1,459 passed, seven skips, zero failures).
Current Graphite browser checks all passed: notifications four combinations,
design 12, dark 12, V2 reprocessing desktop/mobile, and Review Centre/Activity
14 groups with zero provider calls. Upstream #106's atomic contrast sampling
removed the prior dark-harness timing failure. Logs use
`/tmp/noema-graphite-alerts-{build,focused,all,notifications,design,dark,reprocessing,review}.log`.
Notification/design evidence contains 28/110 screenshots respectively; minimum
sampled notification contrast is 6.15:1.
