# Editor toolbar contracts

The page header responds to its own available inline size, so opening an inspector
can expose compact View without a window resize. Presentation mode choices remain
Standard, Subtle, and Focus. Exit Focus uses the existing appearance restoration
hook and keeps the mounted sidebar, Knowledge, contents, and editor state.
Favourite and the editing lock render in `#page-identity-tools`; an independently
mounted PageToolbar falls back to rendering those controls alongside its tools.
The existing `.presentation-focus` hook remains available for keyboard entry.

## Shared menus and parallel integration

`MenuAction` accepts optional `id`, `group`, `shortcut`, and `description` fields.
IDs identify actions across live rerenders; labels remain available through
`data-menu-action`, and IDs through `data-menu-id`. Descriptions and shortcuts are
visible while the accessible command name stays concise. `ActionMenu.triggerText`
provides an optional visible trigger label. Existing callers remain compatible.
Invalid or disabled submenu ancestors return to the nearest valid level.

The page action with ID `entities` retains `Organize with entities…` and its
existing association-dialog callback. At the verified unpublished
Entities/Connections contract `2c698f4`, integration changes that label to Connect…
and passes `pages` alongside `page` and `entities` into PageToolbar and the existing
PageEntityAssociationsDialog. Keep the dialog keyed by vault_id + ":" + page.id.
The Entities/Connections work owns its common Connect picker. This change adds no competing picker,
changes no entity/page IDs or associations, and changes no page-link or clipboard
hyperlink formats. Source-inspector metadata and the Inbox Activity bell retain
their existing owners and behavior. Association writes in that integration emit
`noema:page-connections-changed` with `{vaultId, pageId}`; preserve that refresh event.
Merge the shared App.tsx/PageToolbar.tsx edits together; no unpublished files were
pulled into this branch.

## Content operations

Markdown shortcuts while typing changes only the preference for future input.
Format existing Markdown… explains current-page scope, requires choosing Format
current page, and sends one change through the existing document history.

Selection More keeps formatting, semantic-function scope, speech, and AI routes
available. Entity linking and inline-equation eligibility explanations are visible
on touch; keyboard focus moves within one toolbar Tab entry. Nested Escape backs
out one level, and selection cancellation retains the highlighted text.

Add citation… reuses the source citation picker, selection bookmark, insertion,
and document-history transaction. It appends after the highlighted text; it does
not replace the text. Endpoints inside table cells, code, hyperlinks, or atomic
references show an unavailable reason and are guarded before insertion. Link…, Inline code, and Clear formatting are deliberately
not added: current shared selection transactions only support B/I/U/strike and
citations. Existing hyperlink paste, inline-code typing/paste, and page-link
workflows remain available. Adding those contextual commands requires an explicit
selection transaction and its cross-block/undo tests first.

## Synthetic checks

`node scripts/check-page-toolbar-browser.mjs` checks wide/narrow available
containers, a long title, an open inspector, headings/no headings, lock/archive,
Focus restoration, shortcuts, Escape focus, and Markdown preference/conversion
with Undo/Redo. Configure `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` as for the other
browser checks. The selection browser script covers repeated/interrupted flows,
keyboard and touch, cross-block/table selections, and speech-enabled 320px layout.
All fixtures use synthetic data; no real vault or paid model call is needed.

## Validation recorded 2026-10-24

- Base/final upstream check: `origin/main` is `9b6fecc` (including #95–#97).
- Build, stylesheet contracts, application and test types: passed.
- Full suite: 1,335 tests, 1,328 passed, zero failed, seven native/model skips.
- All seven `test:browser` scripts passed. The run resumed at entity scan after
  correcting a stale Knowledge button selector; the preceding four suites passed.
- Page-toolbar synthetic fixture and targeted citation/speech checks passed.
- Design: 12 cases passed, minimum status text contrast 5.59, zero page errors.
  Its console reported duplicate `default/welcome` keys; no unrelated key behavior
  was changed in this work.
- Independent review completed, including live lock/menu changes and citation
  endpoint guards. No remaining actionable source finding.

Linux Chromium was used. Native macOS extraction/keychain and live Kokoro model
execution were skipped; no real vault, paid request, credentials, or external
sharing was used. Commits remain local, with no PR, push, merge, or deployment.
