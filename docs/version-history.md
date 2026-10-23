# Page version history

Page version history is a SQLite snapshot archive attached to a page. It is separate from the page's numerical `revision` concurrency counter, the editor's transient undo/redo transactions, and the browser draft journal. It introduces no Git repository, branches, commits, or merge model for documents.

## Scope and safety

History begins when the feature observes a page. Existing pages have no invented past: the first meaningful mutation preserves the canonical pre-change state as a baseline, followed by the new committed state. New pages start with their initial committed content. A history snapshot must commit in the same transaction as its eligible page change; an archive write failure must roll back that change.

Snapshots retain authored title and blocks, stable block/entity/source/citation references, icon, featured image, language, generation metadata, creation provenance, review status, field origins, reading-note source anchors, and manual disciplinary classifications. They exclude embeddings, generated summaries and title enrichment records, match caches, and classification assessment caches. Canonical stored language and title values retain their recorded origins; inferred language changes and inferred-only origin additions do not create versions by themselves. Derived metadata is invalidated and recalculated rather than treated as historical authorship. Legacy unknown creation provenance remains unknown. Authorship and generation evidence belong to the historical content; restoring a version must not relabel generated content as manual work.

History reads and read-only previews do not replace the active document or enter its autosave queue. Restoration checks the saved page revision and editing permissions. The client must finish pending saves and resolve recovered drafts first. A successful restore produces a new current revision and a restoration record pointing to the selected version. Later versions remain available, including the state immediately before restoration. The client then reconciles the draft journal and resets transient editor undo. Existing summary suppression and automatic-summary preferences remain page preferences rather than historical authored content. Creating a separate page from a version is a safe alternative to overwriting the current page.

History is scoped to its vault and page. Locked vaults cannot expose history. Edit locks permit authorised history reading but prohibit mutation. Trashed pages retain their history; restoring content does not bypass Trash or its existing permanent-deletion rules.

## Capture and interface

Capture runs at persistence boundaries for ordinary page creation and saves, accepted AI source pages, reading notes and passage explanations, accepted entity linking, and manual disciplinary classification changes. AI source-page acceptance records the final accepted page rather than its temporary empty creation state. Backup import preserves supplied history and does not invent history for legacy archives. Startup migrations and automatic enrichment/indexing do not manufacture old revisions.

Open **More page actions → Version history**. The contextual drawer lists recent ordinary edits in expandable sessions and keeps named checkpoints and restoration events distinct. Selecting a version renders existing read-only block components. Comparison shows added, removed, and modified blocks by stable block ID; order-only changes are not reported as text edits. Dates, origins, checkpoint names, and restoration confirmation give context without exposing the save revision counter as a version number. On narrow screens the history workspace fills the available viewport.

The history routes are scoped beneath `/api/pages/:pageId/history`: list and checkpoint creation at the root; version preview at `/:versionId`; revision-checked restoration and separate-page creation at `/:versionId/restore` and `/:versionId/copy`. A preview with missing entity/source/file/image targets remains readable, while restoration or copying is blocked with a reason rather than silently changing references. Existing AI Explanation tags on surviving block IDs cannot be stripped by restoring an older snapshot.

## Images and portable backups

Historical image references protect their assets from normal image cleanup. Vault backups include historical snapshots and assets referenced only by history. Import remaps archive identities and relevant embedded references in one transaction; an archive without history remains valid. Historical references to unavailable targets must remain unavailable evidence, not instructions to recreate knowledge entities or attach to unrelated IDs.

## Retention

Automatic history pruning is disabled. There is no background deletion or destructive history migration. The pure `planHistoryRetention` preview identifies candidates using these proposed age buckets:

| Age | Candidate grouping |
| --- | --- |
| Through 7 days | Keep every distinct persisted state |
| Days 8–30 | Keep the latest state in each 15-minute bucket |
| Days 31–90 | Keep the latest state each day |
| Over 90 days | Keep the latest state each week |

Named checkpoints, pinned versions, restoration events and their source versions, and the latest state must remain protected. The planner returns `enabled: false`, retained IDs, and candidate IDs, without reading or writing storage. Candidate calculation is suitable for synthetic tests and review; it does not authorise deleting stored user history. The tradeoff is increasing snapshot and backup size until a separate explicit retention operation is designed and authorised.

## Deferred work

Word-level highlighting, moved-block detection, selective block recovery, structural comparisons of tables/citations/entities, semantic summaries, AI explanations of changes, and intellectual-history analysis remain outside this implementation. No paid model is called to capture, group, compare, preview, or restore history. Compression and content-addressed storage are also deferred until measurements justify them.

## Verification

The repository runner remains `npm run test:all`; history coverage is consolidated in `page-history`, `page-history-paths`, `page-history-backups`, and `page-history-ui` test files. Synthetic SQLite triggers verify rollback at the history insertion boundary, including AI acceptance, reading-note creation, entity-scan acceptance, and restoration. Backup tests cover historical-only images, detached references, subtype anchors, shared citation identity, legacy archives, and invalid-import rollback. Retention tests only calculate candidates in memory.

`npm run build` includes style ownership checks, client/server TypeScript checks, test-helper checks, and the production client build. Linux skips six existing macOS Keychain/PDFKit/Vision tests.

Run the additional browser regression with `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-page-history-browser.mjs` (and `CHROMIUM_PATH` if needed). It creates a disposable database, permits only loopback traffic, and takes no screenshots. It verifies read-only preview, block comparison, restore while an autosave is deliberately delayed, atomic rollback after an injected history failure, stale preview navigation, and the narrow-screen overlay in dark mode. The forced rollback intentionally logs one server error while asserting that the page revision remains unchanged.
