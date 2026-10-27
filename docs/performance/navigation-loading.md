# Navigation and loading evidence

Measured in the Linux cloud executor with Node 24.19.0 and headless Chromium 154.0.8037.57. The before client was built from `d85aaa6`; the after client from `6a5d395`. The browser used a disposable SQLite database, invented notes, a generated synthetic PDF left queued, and mocked editorial responses. No live providers or user settings were used.

Reproduce with `node --import tsx scripts/measure-navigation-loading.mjs`. To observe the baseline, set `MEASUREMENT_LABEL=before CLIENT_DIST=<baseline-dist/client>`. The script writes full request paths, response byte counts and screenshots under `output/navigation-loading/<label>/`.

| Check | Before | After |
| --- | --- | --- |
| Startup vault access requests | 2 | 1 |
| Cached note visible while its editor response is held, with background PDF work | No | Yes |
| Background progress representation, synthetic response bytes | 3,136 (entire entity inventory) | 278 (source status) |
| Overview visible while full entity detail is held | No | Yes |
| Hidden original reader full editorial revision requests | 1 | 0 |
| Opening Review requests its full revision | Already fetched while hidden | Yes, on opening |
| Main production JS, Vite minified / gzip kB | 3,391.11 / 931.75 | 2,712.88 / 733.61 |

Cached navigation still issues one background editor revalidation request. The slow-response check verifies that this request does not delay displaying the cached note. It does not assert zero network traffic or disable revalidation. Progress polling keeps its cadence; the payload and mutation scope changed. In the observed navigation window after the initial editor appeared and before the first entity preview, full entity-list requests were 7 before and 2 after, with 6 compact status requests after. Counts include destination initialization and vary with execution timing; raw traces retain their timestamps.

The after-only browser assertions also passed for a note rendered while entity inventories remain pending, protected editing during that interval, switching to a locked vault with an old inventory pending, releasing that stale response without repopulating the locked vault, two repeated startup reloads, and desktop/mobile reader and locked-vault layouts. There were no page runtime errors, external requests, or observed mobile horizontal overflow in this harness.

The initial entry JS decreased, while split feature chunks remain available for later navigation; aggregate application JS was 3,409,002 bytes (935,301 gzip bytes) after splitting. These are build and cloud-browser observations, not representative-device responsiveness, CPU, memory, or battery measurements. The browser harness's extra after-only startup scenarios make its whole-run request totals unsuitable as a before/after comparison.

Independent integration review checked vault authorization on the new endpoints, request scoping/cancellation, save ownership and flush paths, canonical revision guards, bounded/transactional organization operations, and indexed diff overlap/group behavior. No blocking issue remained after fixing delayed inventory/archive overwrite races. Reading-position/version tests and the full validation results are reported separately; this document does not imply unexecuted coverage passed.
