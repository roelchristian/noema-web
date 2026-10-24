# Stylesheet ownership and interaction contracts

`src/client/main.tsx` loads `styles/fonts.css`, `styles/tokens.css`, then the ordered
`styles.css` entrypoint. Keep that order. `styles.css` contains imports only:

1. `styles/primitives.css`: reset, shared buttons, selects, focus and basic surfaces.
2. `styles/layout.css`: workspace shell, navigation, toolbar frame and shared theme bridges.
3. `styles/features/`: editor, library, Knowledge, sources, settings, dialogs, menus, tagging and Calendar.
4. `styles/semantics.css`: shared meaning for errors, destructive actions and job status.
5. `styles/controls.css`: shared interaction minima and responsive control layout.

Imports use the existing unlayered cascade. This preserves specificity against browser-owned
editor markup and existing component styles; introducing cascade layers would change those
relationships. Import order breaks equal-specificity ties. A feature owns its base, theme,
responsive, focus, disabled and active rules together. Shell selectors that span several
features stay in layout. The upstream `search/archive-search.css` remains owned and imported by SearchPanel; its unique archival selectors are also covered by the guard. Shared status paint belongs to semantics, rather than an extra
feature-specific colour override. Document typography remains in its existing rules and tokens.

For a new feature, add one module before semantics and controls, then update the entrypoint
and the explicit import list in `scripts/check-styles.mjs`. Use existing neutral surfaces
(`--surface`, `--surface-raised`, `--surface-hover`, `--line`, `--text`, `--text-muted`).
Do not append a late override to the entrypoint. Repeated selectors can represent different
responsive or interaction states; repetition alone is not evidence that a rule can be removed.

## Semantic colour

Use `--status-{danger,warning,success,info}-{text,bg,border}`. Each light/dark pair is
independent of the chosen accent and entity palette. `--danger` is a compatibility alias.
Do not add a local danger fallback. Accent tokens express selection and emphasis.

`data-status="danger|warning|success|info"` is available for a labelled status primitive.
A state must also have visible explanatory text or a meaningful named icon; retain accessible
names, roles and destructive action labels. Existing failure notices keep explanatory text
and recovery actions. Inspector failures additionally have a leading rule. Do not generate
state labels using CSS content or rely on colour alone.

## Controls

- `--control-target-compact`: 30px desktop, for small icon actions and toolbars.
- `--control-target-regular`: 36px desktop, for buttons, menus and action rows.
- Both resolve to `--touch-target-size` (44px) at widths up to 750px **or** with a coarse pointer.
- Glyph sizes remain feature-owned, typically 15–17px. Field dimensions remain separate:
  `--field-height` and existing content/textarea sizing are not replaced by hit-target sizes.

Use these tokens in the actual box or minimum dimensions. Do not simulate a larger target
with overlapping pseudo-elements or negative margins. Keep a flexible text track and allow
action groups to wrap. When an owner has a more specific minimum, use the same target token
there so the shared touch contract can resolve it. Do not change fonts or content hierarchy
to make controls fit.

## Checks

`npm run check:styles` runs in every build. It checks import order/ownership, status-token
ownership, absence of local danger fallbacks and per-module literal-colour budgets. Existing
art, entity palette and content colours remain budgeted; a new UI should reuse tokens.
The guard is deliberately small and is not a substitute for browser validation.

`npm run test:design` uses the optional Chromium harness, with `PLAYWRIGHT_MODULE` and
`CHROMIUM_PATH` configured as for `test:browser`. It starts an isolated SQLite database,
checks the real shell at desktop/mobile widths across all accents and light/dark themes,
measures hit rectangles and overlap (including dense grouped annotation targets), checks keyboard focus, destructive hover and disabled
appearance, verifies status-text contrast, and exercises desktop coarse-pointer and 200%
CSS zoom layouts. `NOEMA_SCREENSHOTS` selects an evidence directory. Run `npm run test:browser`
for editor, source-reading and entity-linking regressions. Native browser UI zoom, native
extractors and Safari still require their respective platforms/environments.

## Unified feedback (Quiet Structured)

`styles/features/notifications.css`, the last feature import, owns shared notice
geometry, wrapping, focus, motion and responsive layout. Notice aliases in
`tokens.css` resolve through each theme's neutral surfaces. `semantics.css` paints
only the `NoticeIcon` indicator and action failure text; notice roots use
`data-tone`, never the broad `[data-status]` panel treatment.

`notifications/NotificationProvider` owns ephemeral client presentations in an
isolated store. Its stable command context does not subscribe the editor to toast
changes. The viewport is portalled to the document body, below the native dialog
layer, with two visible slots and a bounded pending queue. Timers count visible
time and independently pause for hover, focus, hidden documents and pending actions.

Inline notices have no timer. FormNotice owns local four-second confirmation
occurrences; workspace save failures, browser-copy failures and draft recovery
remain authoritative and non-dismissible. The Focus exception continues to use
`.page-persistence-notices`, which owns the containing layout only. Archive Undo
binds a vault and monotonically increasing operation; both activation and async
completion validate scope. Activity retains its server feed, polling and read
semantics and shares only status presentation.

The old SuccessNotice/ArchiveNotice components, `#toast`, tinted source failure
panels, entity insertion notices and unused Activity popover rules are retired.
Run `node scripts/check-notifications-browser.mjs` with the documented Playwright
environment for synthetic light/dark, mobile, touch, zoom, Focus and native modal
coverage. It writes screenshots and layout evidence to `/tmp/noema-notifications-evidence`.

If the queue is saturated entirely by important feedback, an existing visible
record displays a persistent generic overflow count. Existing actions remain
intact, no protected text is copied into the count, and no authoritative failure
is resolved. Ordinary queued feedback is discarded before this saturation policy
is used. This deliberately bounded presentation cannot retain unlimited messages;
recovery remains available at each authoritative feature location.
