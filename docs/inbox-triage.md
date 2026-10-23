# Inbox triage

The Inbox’s To organise facet contains pages with no folder location. It opens in triage interaction mode. Browse pages leaves triage and exposes the separate List, Compact and Grid presentation choices; Start triage begins another session. Existing saved browsing layouts remain available. Filing and outstanding review conditions are independent.

- **File** sets the existing single folder location and advances to the next position in the current filtered/sorted queue (or the preceding final position). It preserves collection memberships and page content. The server checks that the page is still unfiled before applying the move.
- **Add to collection** adds an existing collection membership, keeps the folder location, and stays on the selected page so several collections can be added. It does not file the page or remove it from Inbox. Existing and automatic memberships are never removed by triage.
- **Skip for now** skips the page in this mounted triage session and advances. When all remaining pages are skipped, the session stops. Review skipped pages explicitly starts another pass. Switching Inbox facets preserves the mounted triage session; reloading, leaving Inbox or choosing Browse pages starts a new session. No processing status is stored. Durable leave-unfiled decisions, deferral and resurfacing remain deferred to Phase 4.
- **Trash** uses the existing shell confirmation and recoverable 30-day Trash. Cancellation and failure preserve selection. Inbox stays mounted during the operation so navigation and skip decisions survive the shell loading state.

The queue uses page summaries. Reading-note indicators come from `page_reading_notes`; entity-association indicators come from `entity_page_associations`, matching the app's explicit page-association definition. Inline mentions are separate. Unknown optional metadata does not claim that associations are absent. No topic, domain or processing classification is inferred.

`GET /api/pages/:id/preview` requires an open owning vault, reads stored content, returns at most 80 blocks and reports truncation. It bypasses editor/domain assessment, entity matching, enrichment and request-triggered Trash expiry cleanup. Only the selected preview is fetched; selection changes abort its request and discard late responses. The existing read-only renderer preserves content and link behavior. The full editor uses the existing save/flush navigation path.

Folder and collection pickers lock navigation during writes. A synchronous operation guard suppresses repeated submissions. Before retrying, organization is read again; collection adds are idempotent and filing uses an atomic expected-unfiled check. The UI never retries writes automatically. Refresh reloads summaries and organization without changing editor content; use it for changes made in another tab or stale/deleted items. Cross-tab changes are not pushed live.

Search and sort feed the same queue, and batch selection uses the existing selection state and toolbar. On narrow screens the queue opens a separate detail view, with Back to queue restoring focus. Decision and navigation controls have 44px minimum targets.

## Validation

- `npm test`: style ownership, application/test typecheck, production build and all grouped unit/DOM/server tests.
- `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-inbox-browser.mjs`: real application shell and disposable synthetic SQLite vault, read-only preview count, folder/collection semantics, picker cancellation, failed/repeated submissions, batch actions, finite session skip, Trash session continuity, all layout alternatives and desktop/mobile screenshots. External browser requests are blocked; no provider is configured or called.
- Existing `npm run test:browser` harnesses; entity-scan status assertions distinguish the visible status from the screen-reader announcement.

Set `NOEMA_SKIP_SCREENSHOTS=1` to run the Inbox browser checks without capturing images. Review images are otherwise written outside the repository to `/workspace/noema-inbox-evidence` by default. `NOEMA_SCREENSHOTS` can override that directory. No real vault is used.
