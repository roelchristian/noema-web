# Navigation and loading validation

Baseline `d85aaa6e52fe733b4f218af98463a29b6c7cfe41`; integration also includes subsequently verified main `9a40c63` (separately merged fixture reliability PR125). Linux x64 cloud executor, Node24.19.0, Chromium154. Synthetic data, temporary databases and mocked providers only. No representative-device timing measurement was made.

## Reproducible behavior and counts

Run `node --import tsx scripts/measure-navigation-loading.mjs` as documented in its header, using a production build. Committed synthetic request/response traces are in `evidence/navigation-before.json` and `evidence/navigation-after.json`; screenshots are generated beneath `output/navigation-loading/`. Each scenario records exact paths; request totals vary with polling and deliberately held responses, so aggregate timing-dependent totals are not presented as an optimization ratio.

| Observation | Before | After |
| --- | --- | --- |
| Initial vault access reads | 2 | 1 |
| Cached note displayed while body revalidation held, PDF processing | false | true |
| Background body revalidation requests | 1 | 1 |
| Synthetic browser progress response bytes | 3,136 (entity inventory) | 278 (compact status) |
| Bounded entity overview visible while full detail held | false | true |
| Full editorial revision fetch when opening original reader | 1 | 0 |
| Opening Review loads required comparison detail | baseline observation only | passed |

Final browser checks also pass: priority note appears before entity inventory, edits remain protected until names are available, a switch to a locked vault cancels delayed inventory without exposing prior content, locked mobile view and repeated startup remain stable, no runtime errors, external requests or mobile overflow. The baseline checks deliberately observe the old behavior rather than asserting improvements.

Workspace regressions show four progress updates retain four cached-note object identity hits with zero evictions. Source content invalidation evicts only dependent cached notes while retaining the active draft and unrelated cached notes. Alias/name dictionary changes invalidate recognition. Mounted-editor instrumentation shows zero matching recomputes for four progress renders and one recompute for an alias change. The compact source scalar-status fixture is 132 bytes versus a 10,744-byte entity inventory (98.77% reduction); it excludes body/file/revision payloads. Terminal completion performs one full reconciliation to discover generated entities, with retry on failure.

## Production bundle

Vite production output, decimal kB:

| Asset | Before | After |
| --- | ---: | ---: |
| Entry JavaScript minified | 3,391.11 | 2,712.88 |
| Entry JavaScript gzip | 931.75 | 733.62 |
| Entry CSS | 614.76 | 569.92 |

Feature JavaScript is split into SourceReader170.87kB, Settings134.99kB, Chat62.37kB, Calendar46.21kB, ReviewCentre13.50kB and smaller source dialogs/viewer chunks, plus shared chunks. All application JS after splitting totals3,409,002 bytes (935,301 gzip bytes, each chunk compressed separately), excluding the PDF worker. Splitting reduces initial transfer; it does not establish device responsiveness or reduce all-feature download size. The entry remains large and Vite retains its size warning. Module rejection and retry have a DOM regression with visible pending/error fallbacks.

## Shared contracts for later work

- `state/scoped-request-cache.ts` shares **pending requests only**, keyed by vault, access epoch, route and explicit version. Each subscriber owns cancellation; the last departure aborts the transport. App resets access on vault/lock transitions. No resolved values are reused across access changes.
- `EntityHome` publishes bounded `api.entity(..., true, signal)` data before its independent cancellable full-detail request. It preserves drafts and retry, and checks vault/id before displaying a record.
- `EntityPanel` uses the pending cache and compact source attachment statuses, avoiding duplicate reader/inspector full-file inventories.
- `GET entities/source-status` returns scalar source processing fields; `source-files?entity=...&compact=1` returns a bounded-per-file representation without readable text or structures. File `contentVersion` changes when readable content changes.
- `source-files/:id/reprocessing/:revision/reading` is the reading presentation; full revision comparison stays behind Review. `useSourceReadingVersion` owns chosen version restoration independently of Review visibility.
- Source editorial mutations call `Workspace.invalidateSourceDependencies(sourceId)` through `SourceReader.onRevisionChanged`; this evicts dependent cached bodies without replacing active drafts.

Later bibliography work should preserve these contracts in `EntityHome.tsx`, `EntityPanel.tsx`, `api.ts` and `transport.ts`. KnowledgeLibrary and bibliography workflows were not redesigned here.

## Additional browser validation

`check-source-reprocessing-browser.mjs` passed all six combinations of 1440/1024/390px and light/dark: bulk review and decisions, V2 consent reset, processing setup focus/Escape, pass ledger and configuration recovery, repeated interrupted resume/stop, and overflow. `check-reading-continuity-browser.mjs` passed 11 behavior categories with two close/reopen cycles: exact durable anchor preservation across backend/browser-context restart, bookmark create/rename/delete and failure retry, ambiguous revised source destinations, section progress, citation jump/return, ordinary selection without position writes, persistence failure/retry, pagehide flush before debounce, end-of-source restoration and mobile layout. Both used synthetic fixtures; runtime error lists were empty.

The continuity fixture now uses the current activity/rename controls, an isolated Vite cache, and a settled deliberate reading position before recording the restart baseline. It retains exact persisted-anchor equality checks. The review fixture follows Diff → Detailed review and current enhanced-select controls. These align previously stale UI assumptions without changing the production behavior or removing the underlying assertions.

The final navigation probe against `7399398` also selected a completed synthetic editorial reading version, reloaded, and verified the same selected version returned through the compact reading endpoint with no additional full comparison request. This test exposed and drove a fix to persist reading choice independently of comparison detail; the focused UI regression suite passed 63 tests. Final navigation traces include these extra version/startup scenarios (203 requests, 140 captured responses), so their whole-run totals remain observational, not a before/after ratio. The compact progress response remained 278 bytes. Independent integration review found no remaining blocking issue after this fix.

## Reconciliation with subsequent main

After draft PR127 was created, independently merged PR126 moved main to `f08df4a`. The optimization branch reconciles that main in `f78dbac`, with final explicit-acceptance scope safeguards in `da7a3be`. The new sidebar, PDF/math progress, provider workflows and Accept-and-read action are preserved. Explicit acceptance loads detail on user action with single-flight, version and vault/file guards; ordinary reading continues to avoid comparison detail. Compact attachment status now safely projects scalar math processing progress without including private fields or changing its content fingerprint for progress alone.

A fresh production build of **current main f08df4a** reports entry JS3,411.67kB/937.13kB gzip and entry CSS624.46kB/104.92kB gzip. The reconciled optimization build reports entry JS2,725.34kB/737.20kB gzip and entry CSS579.63kB/97.54kB gzip. These are a separate current-main comparison from the original d85aaa6 phase above; neither establishes device performance. SourceReader is178.00kB/50.57kB gzip after retaining new main's math/acceptance behavior.

The reconciled navigation probe passed against the rebuilt production client: chosen-version restoration, compact reading fetch with no comparison request, cached note visibility, bounded overview, one startup vault read, locked-vault cancellation, repeated actions and mobile layout. Final raw traces contain205requests and143capturedresponses because they include extra version/startup scenarios. Runtime errors, external requests and mobile overflow remained empty/false. The selected native chooser check waits for its summary option to arrive before asserting its exact restored ID; readable compact content is allowed to arrive first.
