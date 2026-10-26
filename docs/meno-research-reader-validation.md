# Meno research reader validation

Validated in the saved Linux cloud environment on 26 October 2026 using Node 24.19.0 and Chromium 154.0.8037.57. Synthetic SQLite fixtures, in-memory credentials and deterministic providers were used throughout. No paid provider calls or real vault were used.

## Source and local commits

- Branch: `codex/meno-research-reader`.
- Clean starting point: fresh `origin/main` fetch verified `65983e2dfe209c7dcee009fb5d27d187984eb7a4`.
- Phase A: `21ab7f8` — drafts, confirmation, immutable failed-turn retry and temporary teardown.
- Phase B: `77bbf2a` — reader typography, grouped evidence index and accessible resizing.
- Phase C: `46ab32c` — separate scope/mention controls, research prompts, title search and real diagnostics.
- Published PR122 head `92b1f5968e8f679a7ae2635af2fad432ec0852ae`, independently verified through the connected GitHub read tools and subsequently confirmed by the parent, was applied in `464223a`. Both published files were applied, preserving persona assertions and header pointer/touch/focus/Rename assertions. Git fetch subsequently lacked credentials (`could not read Username`), so this records an exact published patch integration rather than that remote commit's Git ancestry.
- Follow-up commits retain readable responsive titles and persona controls, cancel stale evidence checks, prevent Stop from submitting the next draft, recover uncertain request identities before retry, preserve temporary request context and back up retry depth.
- No push, PR creation, remote merge or deployment was performed. No PDF-ingestion changes were included.

## Final checks

| Check | Result |
| --- | --- |
| Build, application/test types, server compilation, styles | Passed (`npm run build`) |
| Full normal suite | 1949 passed, 8 skipped, 0 failed (`npm run test:all`) |
| Focused navigation | 25/25 passed |
| Focused reliability | 10/10 passed |
| Focused evidence | 5/5 passed |
| Recovery/security/orchestration/backup | 54/54 passed |
| Existing integrated Chat browser workflow | 4/4 passed; 52 mocked provider requests, 8 cancellations, zero page errors |
| Research browser workflow | 4/4 passed; 32 mocked provider requests, 8 cancellations, zero page errors |
| Whitespace/conflict check | Passed (`git diff --check`) |

Both browser workflows cover 1440px desktop and 390px touch in light and dark themes with reduced motion. The existing workflow retains PR122's real hit testing, touch actions, history keyboard traversal and focus restoration, Rename save/cancel, persona policy, evidence original navigation, cancellation and vault switching. The new workflow additionally verifies:

- Per-thread drafts switched and reloaded.
- Temporary drafts absent from browser persistence; idle and pending temporary teardown without retry leakage.
- Failed retry preserves question, mentions, scope and depth; duplicate clicks dispatch once.
- Stop retains the old answer and next draft and does not submit that draft.
- Scope confirmation and cancellation, retaining available resolved entity references.
- Delete cancellation and confirmation with server DELETE intercepted in the research fixture.
- Grouped evidence count index versus exact verified inline citation; selected highlighting; keyboard and pointer resizing; mobile focus trap and trigger focus return.
- Visible conversation title, explicit persona touch/keyboard control and retained avatar gestures.

Unit/DOM/server regressions also cover lost first thread events, reuse of the original id for missing requests, blocking running/unknown outcomes, completed-answer reconciliation without dispatch, stale evidence verification cancellation, and backup retry depth.

## Evidence and limitations

Browser JSON and screenshots are retained under `output/chat-browser/` and `output/chat-research-browser/` (ignored local artifacts). Each contains `validation.json`; the research folder contains 12 screenshots. Build and full-suite logs are `/tmp/meno-verified-build.log` and `/tmp/meno-verified-suite.log`.

Native Safari/macOS, other browsers, widths outside the stated matrix, live model quality and the unrelated aggregate editor/browser suite were not run. Noema currently has no separate user-account/login model; isolation was checked at the available vault, vault-lock, tab and temporary-session boundaries. Historical response diagnostics are not invented when unavailable, and Thorough is explicitly non-exhaustive.

Dependency setup used `npm ci --ignore-scripts --cache /tmp/noema-npm-cache` after the default npm cache was unavailable and the optional ONNX GPU download failed DNS resolution. Native ONNX installation was not exercised. The eight normal-suite skips are platform-specific Keychain/PDFKit/Vision/Swift/OCR checks and the optional Kokoro model check. Build retains the existing large-chunk warning.

Earlier iterations included expected pre-integration test failures (missing build output and obsolete navigation expectations), fixture corpus/timing failures, and a real Stop/Send DOM reuse defect. The defect and verification races found by independent review were fixed and regression-tested; final results above supersede those intermediate runs.
