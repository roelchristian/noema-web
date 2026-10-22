# Reading continuity

The canonical source reader stores resume locations and named passage/section
bookmarks in SQLite, separately from editable-page history and its in-memory
pixel scroll cache (`use-page-scroll.ts`). Opening a source offers Continue
reading without overwriting the saved location with its initial viewport.
Bookmarks can be created at a selected passage/section or the visible passage,
renamed, opened and removed from the floating navigation's star button.

## Coordinates and reconciliation

`source_reading_locations` is an additive, idempotent schema migration scoped to
vault and source-file identity. The reserved `resume` ID stores the most recent
location; UUID IDs store bookmarks. File and vault deletion clean up locations.
Vault backups retain anchors and remap file identities on import; legacy backups
without locations continue to import.

Anchors contain the source text's SHA-256 revision, canonical UTF-16 offset
(CRLF/CR normalized to LF), passage ID when available, a text quote with surrounding
context, an end-of-source flag and only extractor-recorded physical page numbers.
The server creates this evidence from current source text, rather than accepting
unverified quotes from the client. Stale saves return 409.

For the same revision, offsets must still match their quote. After changes, IDs
and offsets cannot establish identity: an exact quote and its context must match
uniquely, or a sufficiently long exact quote must occur only once. Multiple
matches remain explicitly ambiguous; missing/insufficient evidence is unresolved.
The original anchor is retained, including its excerpt and original physical page;
reading the list never rewrites the evidence. Changed wording can therefore
require a new bookmark. This conservative behavior avoids fuzzy false matches.

Progress remains a current structural position, using recorded physical pages
or sections/passages. It makes no claim about percentage read. An empty source
has no progress control. An end-of-source resume label is used only while the
source revision still matches.

Jump origins are captured synchronously before navigation, including citation,
footnote and table-of-contents jumps. One Return to reading action goes back to
the original stable reading passage through a series of jumps. The return slot
is session-local; resume and bookmarks are durable. Saving is debounced and uses
keepalive on close/reload. Errors retain reading and bookmark editing, allow
retry, and never clear saved bookmarks.

## API

- `GET /api/source-files/:file/reading-locations`
- `PUT /api/source-files/:file/reading-locations/:id`
  with `{revision, offset, label?, atEnd?}` (input offsets are raw rendered text)
- `PATCH /api/source-files/:file/reading-locations/:id` with `{label}`
- `DELETE /api/source-files/:file/reading-locations/:id`

Existing vault access, JSON, same-origin and client-header checks apply. Storage
is per vault/file in this local application, shared by clients of that vault;
there is no separate reader account or cross-device synchronization service.
The latest completed save wins if multiple clients read the same file. A sudden
process/device failure before the debounce/keepalive reaches the server may lose
the last unsaved movement; already committed anchors survive restarts.

The beta editorial revision/comparison pane is a separate derivative view; these
controls belong to the canonical source reader. Editorial passes preserve that
canonical extraction, so they cannot silently mutate its saved bookmarks. If the
canonical extraction or passage structure changes, evidence reconciliation applies
when it is next opened. This feature does not bookmark derivative-only wording.

## Validation

Run `npm run build`, then:

```
node --import tsx --test test/reading-continuity.test.mjs test/source-reader-refresh.test.mjs test/page-scroll.test.mjs test/source-reprocessing.test.mjs test/vault-backups.test.mjs test/vault-deletion.test.mjs test/document-history.test.mjs test/editor-rendering.test.mjs test/semantic-citations.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-reading-continuity-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/check-editor-browser.mjs
```

The reading browser harness creates a temporary synthetic source/database and
uses the real API. It checks database/server/browser-context restarts, immediate
reload flush, reopening, bookmark CRUD, ambiguity, structural progress, citation
return, ordinary selection, persistence failures/retry, end-of-source and mobile
layout. It saves five screenshots under `NOEMA_SCREENSHOTS` (default
`/workspace/noema-reading-evidence`). No live vault is read.
