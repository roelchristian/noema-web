# A–C design consistency review

The initial review used verified `main` **58ace01f15fe3fc3fe3ea43f2219f5987ba460c5**,
including entity tagging and lifecycle archival. Publication preparation subsequently merged
main **be43bffc1c8ef980111fa4e6a85a77e7bed21514**, preserving its AI-debug and archive-control changes.
The metrics and 604-pass results below record the initial review; updated publication validation
is recorded in the PR description. D typography/hierarchy,
product-flow redesign, live AI and user data were excluded.

## Changes

- `styles.css` is an import-only entrypoint. Foundations load first, followed by shell,
  owned feature modules, semantic paint and interaction contracts. See [ownership rules](styles.md).
  The existing unlayered specificity model is retained and import order is explicit.
- Removed 143 provably superseded declarations. Removal required matching selectors,
  conditional ancestry and importance, with a later equivalent property/shorthand covering
  the earlier value. Distinct responsive, theme and state rules were retained. Centralized
  55 status-paint declarations instead of distributing the same competing danger colours.
- Added accent-independent light/dark danger, warning, success and information text,
  subdued-background and border tokens. Existing error/destructive surfaces now use them.
  `--danger` remains an alias; local danger fallbacks are gone. State labels, named icons,
  accessible roles and action names remain. Inspector failures additionally have a leading rule.
- Added 30px compact / 36px regular desktop target contracts, both 44px on narrow screens
  or coarse pointers. Knowledge actions, toolbar controls, menus, dialog actions, inspector
  actions and comparable controls use real layout minima. Glyph and field sizing remain separate.
- The only owned TypeScript change is annotation-marker geometry: it reads the compact target
  token instead of assuming 28px and uses the existing grouped-note action for overlapping
  targets. Six densely positioned synthetic notes remain available in two non-overlapping
  44px targets. Pointer-mode changes also trigger measurement. No note data or action callbacks change.
- Added a small build-time guard for import order, semantic ownership, danger fallbacks and
  per-module existing hex/functional-colour budgets; no lint framework was introduced.

## Metrics

Initial main `55f57e2` had a **353,049-byte**, 3,555-line `styles.css`. At the final base,
`styles.css` is **357,759 bytes** after upstream tagging/storage additions. The comparison
below includes fonts, tokens, the entrypoint, owned modules and the preserved archive stylesheet.

| Metric | Main 58ace01 | Final |
| --- | ---: | ---: |
| Source bytes | 366,628 | 397,874 |
| CSS rules | 3,325 | 3,306 |
| Declarations | 10,763 | 10,666 |
| Hex/functional colour occurrences | 505 | 440 |
| Distinct colour literals | 204 | 198 |
| Source gzip bytes (Node default) | 62,329 | 60,648 |
| Built CSS bytes | 368,255 | 374,086 |
| Built CSS gzip bytes (same Node settings) | 64,503 | 65,149 |

The readable declaration formatting increases raw source size. Production CSS increases by
5,831 bytes (646 gzip bytes); this is a maintainability/semantic-contract change, not a bundle
size reduction. The 143 declaration removals are substantive retirement; most remaining CSS
is redistributed into owners. Added tokens/control contracts account for new declarations.
Existing content art and entity-palette colours remain; they were not broadly recoloured.

## Validation

- `npm test`: **604 pass, 0 fail, 6 platform skips** out of 610 cases. This includes the
  full build, application/server and test typechecks, plus the stylesheet guard.
- `npm run test:browser`: passed editor native caret/typing, undo/redo, clipboard,
  split/merge, IME, formatting, selection preservation and entity updates; reading
  continuity/bookmark/restart/error-retry/mobile cases; and tagging/correction/alias recovery.
- Lifecycle browser regression: passed actual impact/archive/restore, archived filtering/search,
  stale preview, failed request, source/citation/bookmark readability, access checks and mobile preview.
- `npm run test:design`: passed 12 desktop/mobile × light/dark × all three accent combinations,
  plus desktop coarse pointer, keyboard focus, hover/destructive, disabled/error appearance,
  hit rectangles, centre reachability, overlap and horizontal clipping. Status text contrast
  is at least **5.59:1** on its subdued surface, workspace surface and raised surface.
- Source-reader matrix: 12 width/mode/accent combinations, baseline/final screenshots,
  actual visible action/address targets and unchanged computed typography.
- Before semantic/control normalization, module reordering matched all sampled computed styles
  in 36 same-DOM states. Final baseline comparisons found no font family/size/weight,
  line-height or letter-spacing changes in core and reader matrices.
- 200% CSS zoom reflow passed without horizontal overflow. Native browser-UI zoom was not exercised.
- `git diff --check` passed. Chromium **154.0.8037.57** on Linux was used under AGENTS.md guidance.

The six skips are the macOS Keychain adapter and five PDFKit/Vision/Swift/sandbox source tests.
The native command, Safari/macOS checks and performance benchmarks were not run. Existing
React duplicate-key console warnings are present in the full shell and DOM suite; browser
page-error arrays are empty. Build chunk-size warnings also remain. These were not hidden or
changed by editing feature behaviour.

## Evidence and integration

Cloud workspace evidence: `/workspace/noema-design-evidence/`.

- `current-main-{baseline,final}-*.png`: editor, sidebar/topbar, Knowledge, menu and dialog comparisons.
- `current-main-differential-computed.json`: 36 core computed-style comparisons.
- `contracts/validation.json`: actual measured rectangles and contrast results;
  adjacent marker and CSS zoom screenshots are in the same directory.
- `source-matrix/source-*.png` and `source-matrix/source-matrix.json`: reader baselines/finals and targets.
- `status-matrix/`: labelled error/destructive/disabled/job-state baselines and finals, using disposable fixture DOM.
- `reading-final-main/` and `lifecycle-final/browser-result.json`: regression screenshots/results.
- `stylesheet-metrics.json`, `manifest.json` and copied command logs: supporting measurements.

Tagging styles are preserved in `styles/features/tagging.css`. Archival's upstream
`search/archive-search.css` and its SearchPanel import are preserved unchanged and covered by
the guard. Neither task's TypeScript behaviour was edited. Future toolbar-option work should
reuse target tokens and keep any feature module before shared semantics/controls. A later
merge that appends to the old monolith must be assigned to its feature owner; update the
explicit import list/budget only for an intentional new owner.

Library delivery is blocked: prepare returned three signed reservations, but the first
screenshot PUT could not establish its proxy tunnel (**403 Forbidden**). No transfer was
established, no alternative route/retry was attempted, and no finalize call was made.
The other two reservations were not transferred. **There are no verified Library screenshot IDs.**
Local screenshots, the report and the patch remain available. The user subsequently authorized
push, PR creation and normal merge after validation; deployment and branch deletion remain excluded.
