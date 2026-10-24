# Dark mode redesign: P0 and P1

> Historical October 23 record. See [Quiet Graphite](quiet-graphite.md) for the October 24 rendered visual pass and current validation.

Implemented on a local branch from current main, including the merged entity-property UI and smart collections. No parallel branch or PR was edited.

## Scope and ownership

P0 establishes neutral charcoal canvas/sidebar/elevation tokens and migrates the editor, sidebar and toolbar to owned semantic rules. Dark selected navigation uses neutral selection with stronger text; accents remain available for interactive highlights. Body copy uses warm off-white. Readable metadata and placeholders use the secondary text role rather than the proposed decorative grey. Control boundaries and focus rings remain stronger than structural dividers. Existing geometry and hit target contracts are retained. The math editor now uses the shared focus-ring role in both modes: its old light border mixture was below 3:1, so this narrowly improves focus accessibility without changing the light palette or dimensions.

P1 gives buttons, selects, dialogs, menus, settings, knowledge/intelligence and source panels shared surfaces and interaction roles. Migrated owners were removed from grouped dark repairs rather than adding another override layer. `light-dark()` preserves distinct existing light values where one shared light token would change them; semantic dark roles remain centralized. The existing light/dark `color-scheme` establishes which side is active. Legacy library/organization repairs outside this narrow scope remain.

Midnight Ink, Juniper and Atlantic keep their existing accent definitions. Entity palette choices and overrides are preserved. Status tokens retain meaning independently of accent selection. Entity identity colors remain subdued and readable. New property UI and smart collection behavior are preserved.

A small parser-blocking, same-origin script in `public/appearance-bootstrap.js` applies validated saved/system mode and the selected accent before body parsing. It makes no storage writes and tolerates corrupt preferences and unavailable storage/media queries. Tests compare its compact accent map against the runtime source of truth to prevent drift. It respects the existing script CSP without enabling inline scripts. The React appearance hook continues owning live changes and storage failure feedback.

## Validation

No screenshots were captured. Visual screenshot validation is **UNRUN**, not passed. The new checks inspect computed styles, contrast, hit rectangles and real interactions with disposable synthetic data; they create no screenshot baselines or private vault content and make no paid-provider requests.

Reproduction on Linux with Chromium and an independently installed `playwright-core`:

```sh
npm ci --cache /tmp/noema-npm-cache
npm run build
npm run test:all
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs npm run test:dark-mode
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs npm run test:appearance-bootstrap
```

The normal build runs CSS ownership checks, application/test typechecks, server compilation and Vite production bundling. `test:all` is the complete repository unit/DOM/server suite. Browser scripts remain optional like the existing browser harnesses; they use `CHROMIUM_PATH` when provided.

The screenshot-free matrix covers desktop and mobile in both modes and all three accents: editor/sidebar/toolbar, knowledge panel, page/block/selection/semantic menus, rename dialog, search, appearance settings/selects, calendar and a source viewer opened from synthetic source evidence. Special code/math/quote/property/placeholder cases use synthetic owned-class fixtures. It checks text and status/entity palette contrast, keyboard focus, destructive hover/focus consistency, disabled state, real touch target dimensions and non-overlap, dense reader marker grouping and 200% CSS zoom reflow. Native browser UI zoom is not exercised. Neutral surfaces and status roles must remain invariant across accent choices.

The bootstrap checks observe the actual external script before body parsing with React absent under a restrictive CSP; they cover all accents with explicit/system modes and system light/dark, corrupt/invalid preferences and denied storage. Unit tests also cover unavailable media queries and ensure bootstrap performs no writes. A second real-app runtime harness covers normal/read-denied/write-denied/both-denied/corrupt storage, live system changes, explicit mode precedence, saved fonts, accent switching and visible persistence warnings. Synthetic dev runs emitted duplicate `default/welcome` React-key warnings; there were no page errors or failed assertions. This unrelated dev warning remains outside the styling scope.

A pre-existing light-mode contrast limitation is recorded rather than changed in this dark-mode task: outside-month calendar dates can render `#717171` against hovered `#f4f4f4` (about 4.44:1). Current-month light dates and all dark dates are checked strictly. This is not a new light-theme regression.

## Recorded results (2026-10-23)

- Reconciled base: `e756d55` (smart collections merged); entity property phase 4 was already included.
- `npm run build`: passed, including CSS ownership, application/test typechecks, server compilation and Vite. Existing bundle-size advisory remains.
- `npm run test:all`: 991 tests, 985 passed, zero failed, six platform skips (macOS Keychain/PDFKit/Vision/Swift/sandbox extraction checks on Linux).
- Chromium `154.0.8037.57`: twelve desktop/mobile mode/accent cases passed across the sampled contracts above, plus coarse-pointer and CSS zoom checks. Minimum checked status/entity text pair contrast: 5.59:1. Dark body/metadata/placeholder samples require 4.5:1; sampled focus rings and dark unchecked control boundaries require 3:1. Desktop/mobile runs are split using `NOEMA_THEME_WIDTHS=1440` and `NOEMA_THEME_WIDTHS=390`.
- Isolated actual-textarea math focus checks: all six mode/accent combinations passed; light border contrast 3.396:1, dark 6.968:1.
- Bootstrap: 22 pre-body/CSP scenarios passed; real application appearance runtime: five storage scenarios passed. Appearance unit tests: six passed.
- `git diff --check`: passed. No screenshot capture or screenshot baseline suite was introduced. Visual screenshot validation: **UNRUN**.

## Deferred P2

Rendered screenshot review and dedicated visual baselines remain future work, explicitly deferred at the user's request. A later P2 should include editor, sidebar, knowledge/property panels, search, settings, menus, source reading and calendar, plus systematic contrast review of remaining legacy surfaces. The optional high-contrast preference is also deferred; it should be independent of theme/accent and extend the same semantic tokens. This implementation does not add that preference or a screenshot baseline suite.
