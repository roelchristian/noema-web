# AI Review Centre

The Review Centre answers which saved generated work needs attention in the current open vault. It introduces no review-state table, provider calls, mutation controls or background generation. Settings retains logs and usage. Feature code lives in `src/client/review`, `src/shared/review-centre.ts` and `src/server/modules/review-centre.ts`; shell integration adds one view, navigation entry and scoped destination context.

## Review experience

The Review Centre follows the flat list, shared typography, semantic colours and compact toolbar used by Noema's libraries. To review, Needs attention and In progress separate saved suggestions from operational issues and running source work. Contextual actions open the existing evidence and decision interface: Review entities, Review discoveries, Review corrections, Revisit page, Inspect source or View progress. Opening an item still revalidates its saved identity and run before navigation.

Search filters the selected group by title, type of work, task or status. Both search and group selection survive a round trip within the vault session. Counts describe loaded items; continuation is explicit. Failed refreshes retain loaded work, partial coverage provides a retry, and empty states distinguish a clear queue from unavailable or not-yet-loaded work. Dates for source processing explicitly mean imported dates.

The return strip identifies the item being reviewed and appears only in its original page, entity or source workspace. Review intent is cleared when switching or locking vaults. The sidebar uses the same checklist icon as the return strip.

## Authoritative-state audit

| Workflow | Persisted authority / specialised interface | Included behavior |
| --- | --- | --- |
| Page entity scanning | `page_ai_enrichments`, kind `entity_scan`, scan and subtype suggestion decisions / Knowledge panel `EntityScanReview` | One stable page queue identity, current scan ID, count of pending entity/subtype suggestions. Revision mismatch is operational staleness. Open validates the current scan context key as well as page access and revision. |
| Entity discovery | Latest `entity_discoveries` row per entity, pending suggestion statuses / entity home Discovery | One current draft per entity, synthesis/relationship/page decisions grouped by origin. Historical drafts are superseded. Open invokes existing fingerprint validation and shows its stale warning. |
| Source corrections/reprocessing | Latest `source_reprocessing` row per attachment, patch decisions and job status / source reader `SourceReprocessing` | Completed pass with pending patches is a decision; failed/interrupted is operational; queued/running is activity even when checkpoint patches exist. Successful later passes suppress older failures. Exact attachment/run selected on open. |
| Source import/enrichment | Current `source_files.status` and `enrichment_status` / source inspector Edit → attachments | Current failure or ongoing processing only. Inactive sources remain reachable here because failed extraction deliberately marks them inactive; archived sources are excluded. Opens existing status/retry interface without retrying. Recency says imported because this table has no reliable status-change timestamp. |
| Generated note from source | `source_page_drafts` and existing creation dialog | Not included: this dialog lacks a supported independent direct review destination. Saved proposals remain in its existing workflow. This queue does not substitute an entity-home link or duplicate the dialog. |
| Page summaries, explanations, automatic enrichment | Saved enrichments, scheduling/assessment state | Not proposed decisions. There is no persisted accept/reject model. Automatic scheduler records are not pending user judgement. |
| General AI errors/running operations | `ai_activity`, `ai_notifications` | Not imported. These are history/notifications, not a durable unresolved incident model; old failures cannot safely be treated as current work. Technical logs, metrics and usage stay in Settings. Source current-state activity above is explicitly separate. |

## Freshness and coverage limits

Discovery freshness uses an existing vault-wide content fingerprint; editorial freshness uses the canonical source snapshot hash. Running those for every queue item would read evidence/source documents. The queue therefore explicitly labels their saved pending state as freshness checked on open. Only revision-stale entity scans are preclassified under Needs attention. Context-only scan staleness, discovery staleness and editorial staleness are validated on open and shown by their specialised interfaces; there is no invented persisted stale flag or parallel fingerprint model.

Only the current/latest discovery and editorial run is actionable here. Older runs remain available through their original interfaces. Counts represent loaded records, not an unbounded vault total. When earlier loaded records have no pending work but older status remains, the empty message says so and offers Load more.

## Access, navigation and draft safety

Every request calls `Vaults.requireOpen`. Queries constrain vault ownership and exclude deleted pages, edit-locked pages, archived entities and orphan attachments. Entity discovery excludes inactive entities. Resolving a queue identity rechecks current persisted state, ownership and run identity; resolved, replaced or unavailable work stays in the queue with a safe refresh notice. Wrong-vault and unsupported identities return no destination. No redirect URL is accepted from clients or saved payloads.

A cancelled/unmounted queue aborts pending reads and opening validation. The shell checks current vault/view again after flushing the page saver. Existing workspace navigation supplies browser/internal back history; a Return to Review Centre action and session-scoped per-vault filters preserve queue context. The queue never reloads the document to navigate. Existing page journals and entity drafts remain in use. Source patch replacement drafts now survive a round trip in session memory keyed by vault/file/run/patch and authoritative patch baseline; they are not queue states and are not applied automatically. They do not survive a full browser reload.

## Query and refresh bounds

GET `/api/review-centre?offset=0` projects four independent categories. JSON-bearing categories materialize at most 51 candidate status rows before traversing suggestion/patch arrays; at most 50 rows per category are exposed per page. Page blocks, discovery evidence and source document bodies are not transferred to the browser queue. No activity payloads are queried. Resolved candidates can produce a sparse page; continuation remains available rather than scanning unbounded history to fill it. The next page uses offset +50 and stable ordering/IDs with client deduplication. Live status changes may reorder offset pages; refresh starts from current state.

Manual refresh, foreground focus/online events and a 30-second visible refresh replace the bounded first page; Load more incrementally appends candidates. The queue does not fetch from providers or mutate notifications. Individual category errors are reported independently. Network failures preserve loaded rows, while opening still requires a successful current-state read.

## Verification

- `npm run build`: style ownership, production and test typechecks, server compilation, Vite production build.
- `npm run test:all`: full existing architecture, including focused review aggregation tests.
- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/check-review-centre-browser.mjs`: real built app with disposable synthetic SQLite, disabled providers, intercepted external browser network. Covers deep links, repeated scan open/close/back, stale discovery, pending-to-resolved fallback, partial category failure, interrupted validation, offline recovery, entity overview and editorial replacement draft return, filter persistence, desktop/mobile screenshots and 44px targets.
- Screenshots are written outside the repository to `/workspace/review-centre-evidence`; no real vault data is used.

## Evidence upload

Desktop/mobile screenshots were captured and inspected at `/workspace/review-centre-evidence/review-desktop-decisions.png` and `/workspace/review-centre-evidence/review-mobile-decisions.png`. The supported Library prepared-upload helper failed during hosted-app tool discovery with `hosted apps tools/list request failed: network`, before preparation or any file-create/finalization request. No Library IDs were returned; both files and local verification evidence remain preserved. This is a failed upload setup, not a denied action or an uncertain remote write.

Final verification on 2026-10-23: build/styles/typechecks passed; full suite 848 tests, 842 passed, 6 skipped, 0 failed. Review Centre browser flow passed ten groups (including draft preservation), provider calls 0 and no AI generation/decision mutations. Existing entity-scan and entity-linking browser scripts passed. Two ambiguous entity-scan confirmation locators were narrowed with `.first()` because visible and live-region confirmations share text. The Review Centre resolved-item assertion waits for its asynchronous refresh before checking removal.

UX update on 2026-10-23: production build, styles and typechecks passed, along with 14 focused review/navigation and document-search tests. The full suite recorded 870 passed, one skipped and one document-search shortcut failure (`Worker is not defined`); the document-search file passed on the focused rerun. Browser validation was intentionally skipped at the user’s request. The browser evidence above records the earlier queue implementation, not visual verification of this update.
