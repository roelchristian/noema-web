# Combined optimization validation

Baseline main was fetched and verified as `d85aaa6` before work; main was refreshed and locally integrated at `9a40c63` after PR125 was merged independently. This task did not merge that PR remotely. Workstreams ran in parallel with distinct ownership: source progress/cache identity, reader/review, overview/bulk organization, startup, save path, root lazy/integration, and independent review. Shared App/workspace/API/transport changes were integrated by narrow regions. No bibliography redesign is included.

## Passed

- `npm ci --ignore-scripts --cache /tmp/noema-npm-cache`; ordinary install initially failed its GitHub-dependent lifecycle download. The ignored-script install matches repository CI.
- `npm run build`: style contracts, application and test-helper TypeScript, server compilation and production Vite build passed after the final production change `7399398`. Vite still warns about a large entry chunk.
- `npm run test:all`: **2,147 tests, 2,139 passed, zero failed, eight skipped**, 405,289 ms on this Linux executor. The final reading-choice regression test was included. Eight platform-dependent native tests are skips, not passes.
- Final synthetic navigation browser probe: desktop/mobile, held body revalidation during queued PDF processing, held full overview detail, protected destination-first startup, cancel/switch/locked/repeated startup, original and selected editorial reading versions. Runtime errors and external requests were empty.
- Reading continuity browser: 11 categories and two reopen cycles, exact persisted anchor across browser/backend restart, predebounce flush, bookmark/persistence failures and retry, end restoration and mobile.
- Reprocessing browser: six viewport/theme combinations, review and bulk decisions, focus/Escape, failure recovery, repeated interrupted resume/stop, overflow.
- Full entity-linking browser: desktop/mobile and original selection/focus assertions passed. Entity-scan browser also passed. Editor browser passed on the broader suite retry before that suite stopped at the then-stale continuity fixture.
- Independent production review found no remaining blocking issue after fixes to inventory/archive races, bounded diff materialization/group keys, lazy import graph, compact response whitelisting, and chosen-version persistence.

## Earlier failures and explicit limits

An earlier full run had two failures: a pre-existing interval race consuming the entity-scan pending-index assertion (also reproduced on baseline), and a source-presentation fixture missing the new compact inventory mock. These were fixed without changing assertions; their focused suites and the subsequent exhaustive run passed. A browser test found and drove the actual chosen-version persistence fix, then passed the exact reload assertion.

The broad `npm run test:browser` command was attempted and was not green as one uninterrupted invocation. Under concurrent cloud load, editor/Chat/Chat research/Calendar initial navigation and document-find visibility hit their existing 5–12 second limits; selection-toolbar later hit its visibility limit. Those individual Chat, Chat research, Calendar, document-find and selection-toolbar runs are **not counted as passes** here. No assertions were removed to hide those failures. Entity-linking initially hit its fixed100ms restoration sleep; a diagnostic observed restoration by600ms, and a bounded observable wait retained its exact selection/focus assertions before the complete rerun passed.

No macOS native execution, representative desktop/mobile hardware performance, CPU/memory/battery profiling, deployment, live provider call, real settings change or remote merge was performed. Synthetic operation counts and production byte sizes do not establish device responsiveness. Full history snapshot storage remains deliberately unchanged; delta/checkpoint storage and current-image indexing are documented follow-ups rather than migrations in this change. Library rows still render without virtualization.

Raw synthetic navigation network evidence is committed beside the benchmark reports. Reproduction scripts and per-workstream limitations are in this directory. Browser screenshots remain in the workspace under `output/navigation-loading/after`, `/workspace/noema-reading-evidence`, and the synthetic harness artifact directories.
