# Unified Inbox

Inbox answers which saved generated work needs attention in the current open vault. It introduces no review-state table, provider calls, mutation controls or background generation. Activity adds the existing notification feed alongside saved actionable work; Settings retains technical logs and usage. Feature code lives in `src/client/review`, `src/shared/review-centre.ts` and `src/server/modules/review-centre.ts`; the shell exposes one Inbox destination and scoped return context. Existing `view=review` links canonicalize to `view=inbox&facet=review`.

## Review experience

Inbox follows the flat list, shared typography, semantic colours and compact toolbar used by Noema's libraries. Overview groups saved work by purpose; To review, To organise, Issues, In progress and Activity provide dedicated workflows. To organise composes existing page triage, lazily mounted on first entry and retained across facet changes. Its page previews remain selective and limited to 80 blocks. Regular and Compact are browse list densities; Start triage enters the processing interaction. Contextual actions open the existing evidence and decision interface: Review entities, Review discoveries, Review corrections, Revisit page, Inspect source or View progress. Opening an item still revalidates its saved identity and run before navigation.

Search filters the selected group by title, type of work, task or status. Both search and group selection survive a round trip within the vault session. Counts describe loaded items; continuation is explicit. Failed refreshes retain loaded work, partial coverage provides a retry, and empty states distinguish a clear queue from unavailable or not-yet-loaded work. Dates for source processing explicitly mean imported dates.

The return strip identifies the item being reviewed and appears only in its original page, entity or source workspace. Review intent is cleared when switching or locking vaults. The sidebar has one Inbox entry. Folders → Unfiled pages opens To organise. Filing a page and resolving its review suggestions remain independent.

## Activity

The bell is a navigation shortcut to `view=inbox&facet=activity`, with an unread/running dot. If the selected vault is locked it chooses an unlocked vault; when none is available the shortcut is disabled. Activity shows the existing global feed across unlocked vaults, clearly separate from the current vault's decisions and issues. Routine successes never enter the actionable queue. The Activity badge says **unread**, while review badges retain their loaded-work meaning.

Recent and Unread show completed, failed and interrupted outcomes; a separate failed/interrupted filter keeps failures accessible without classifying historical failures as unresolved issues. Running work stays visible with page/source navigation. Existing notification retention remains the latest ten outcomes, with up to 100 running operations. There is no new database model or record migration. Settings → AI provides the technical activity log, diagnostics, clearing and usage controls.

The shared feed polls only while the document is visible, every 15 seconds (previously the bell polled every five), plus foreground/activity events and existing workspace refresh signals. Feed state updates only the shortcut, Activity view and count, not the editor shell. Replaced reads are aborted and stale responses ignored; failed refreshes retain prior outcomes. Vault lock/unlock changes reset the visible feed. All reads use the existing endpoints.

The original three-second visible-reading delay is retained only while Recent/Unread is mounted and visible; switching facets, opening Settings/mobile navigation, load failure or hiding the document cancels it. Filtering failures does not mark hidden successes read. Individual/all-read buttons retain existing ID/high-watermark semantics. Navigation marks an outcome read only after confirming its destination, and an interrupted entity lookup cannot navigate after leaving Activity. Page/source destinations use existing save and navigation paths, including explicit cross-vault addresses.

## Authoritative-state audit

| Workflow | Persisted authority / specialised interface | Included behavior |
| --- | --- | --- |
| Page entity scanning | `page_ai_enrichments`, kind `entity_scan`, scan and subtype suggestion decisions / Knowledge panel `EntityScanReview` | One stable page queue identity, current scan ID, count of pending entity/subtype suggestions. Revision mismatch is operational staleness. Open validates the current scan context key as well as page access and revision. |
| Entity discovery | Latest `entity_discoveries` row per entity, pending suggestion statuses / entity home Discovery | One current draft per entity, synthesis/relationship/page decisions grouped by origin. Historical drafts are superseded. Open invokes existing fingerprint validation and shows its stale warning. |
| Source corrections/reprocessing | Latest `source_reprocessing` row per attachment, patch decisions and job status / source reader `SourceReprocessing` | Completed pass with pending patches is a decision; failed/interrupted is operational; queued/running is activity even when checkpoint patches exist. Successful later passes suppress older failures. Exact attachment/run selected on open. |
| Source import/enrichment | Current `source_files.status` and `enrichment_status` / source inspector Edit → attachments | Current failure or ongoing processing only. Inactive sources remain reachable here because failed extraction deliberately marks them inactive; archived sources are excluded. Opens existing status/retry interface without retrying. Recency says imported because this table has no reliable status-change timestamp. |
| Property and name proposals | Pending `property_proposals` / entity Overview or source inspector Overview `PropertyProposalReview` | Exact proposal identity with metadata hash. Specialized reviewer fetches the selected proposal beyond ordinary list bounds, then validates source fingerprints, conflicts and typed values before decisions. |
| Pending date relationships | Field-derived pending `temporal_relations` with current property evidence / Calendar pending evidence | Exact relation/date identity. Dirty, superseded or removed property evidence is excluded; reviewer validates the evidence/version again. Julian dates retain explicit calendar identity. |
| Generated note from source | `source_page_drafts` and existing creation dialog | Not included: this dialog lacks a supported independent direct review destination. Saved proposals remain in its existing workflow. This queue does not substitute an entity-home link or duplicate the dialog. |
| Page summaries, explanations, automatic enrichment | Saved enrichments, scheduling/assessment state | Not proposed decisions. There is no persisted accept/reject model. Automatic scheduler records are not pending user judgement. |
| General AI errors/running operations | `ai_activity`, `ai_notifications` | Shown only in the Activity facet, never imported into actionable work. These are history/notifications, not a durable unresolved incident model; old failures cannot safely be treated as current work. Technical logs, metrics and usage stay in Settings. Source current-state activity above is explicitly separate. |

## Freshness and coverage limits

Discovery freshness uses an existing vault-wide content fingerprint; editorial freshness uses the canonical source snapshot hash. Running those for every queue item would read evidence/source documents. The queue therefore explicitly labels their saved pending state as freshness checked on open. Only revision-stale entity scans are preclassified under Issues. Context-only scan staleness, discovery staleness and editorial staleness are validated on open and shown by their specialised interfaces; there is no invented persisted stale flag or parallel fingerprint model.

Only the current/latest discovery and editorial run is actionable here. Older runs remain available through their original interfaces. Counts represent loaded records, not an unbounded vault total. When earlier loaded records have no pending work but older status remains, the empty message says so and offers Load more.

## Access, navigation and draft safety

Every request calls `Vaults.requireOpen`. Queries constrain vault ownership and exclude deleted pages, edit-locked pages, archived entities and orphan attachments. Entity discovery excludes inactive entities. Resolving a queue identity rechecks current persisted state, ownership and run identity; resolved, replaced or unavailable work stays in the queue with a safe refresh notice. Wrong-vault and unsupported identities return no destination. No redirect URL is accepted from clients or saved payloads.

A cancelled/unmounted queue aborts pending reads and opening validation. The shell checks current vault/view again after flushing the page saver. Existing workspace navigation supplies browser/internal back history; a Return to Inbox action and session-scoped per-vault filters preserve queue context. The queue never reloads the document to navigate. Existing page journals and entity drafts remain in use. Source patch replacement drafts now survive a round trip in session memory keyed by vault/file/run/patch and authoritative patch baseline; they are not queue states and are not applied automatically. They do not survive a full browser reload.

## Query and refresh bounds

GET `/api/review-centre?offset=0` projects six independent categories. JSON-bearing categories materialize at most 51 candidate status rows before traversing suggestion/patch arrays; at most 50 rows per category are exposed per page. Page blocks, discovery evidence and source document bodies are not transferred to the browser queue. No activity payloads are queried. Resolved candidates can produce a sparse page; continuation remains available rather than scanning unbounded history to fill it. The next page uses offset +50 and stable ordering/IDs with client deduplication. Live status changes may reorder offset pages; refresh starts from current state.

Manual refresh, foreground focus/online events and a 30-second visible refresh replace the bounded first page; Load more incrementally appends candidates. The review queue does not fetch from providers or mutate notifications; the separate Activity facet uses existing notification read actions. Individual category errors are reported independently. Network failures preserve loaded rows, while opening still requires a successful current-state read.

## Verification

- `npm run build`: style ownership, production and test typechecks, server compilation, Vite production build.
- `npm run test:all`: full existing architecture, including focused review aggregation tests.
- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/check-review-centre-browser.mjs`: real built app with disposable synthetic SQLite, disabled providers, intercepted external browser network. Covers deep links, repeated scan open/close/back, stale discovery, pending-to-resolved fallback, partial category failure, interrupted validation, offline recovery, entity overview and editorial replacement draft return, filter persistence, desktop/mobile layout and 44px targets. Also covers Activity shortcut/deep links, repeated facets, active/completed/failed outcomes, delayed-read visibility, interrupted source lookup and stale feed responses, source/page destinations across vaults, locked-vault and keyboard shortcuts, error/retry/empty states, and narrow dark mode. Use `NOEMA_SKIP_SCREENSHOTS=1` to validate without screenshots.
- Synthetic verification summaries and optional screenshots are written outside the repository, by default to `/workspace/review-centre-evidence`. No providers or private vaults are used.


## Deferred scope

Generated source-page drafts remain in their creation dialog until navigation can open a saved draft directly. Durable leave-unfiled dispositions, deferral and resurfacing remain Phase 4. “Skip for now” only advances the current triage session. There are no generic tasks or parallel acceptance records. Inbox does not depend on Smart Collections and uses existing semantic theme styles.
