# Page archiving

Pages have three lifecycle states: Active, Archive, and Trash. Archive is manual,
reversible, indefinite, and independent of review status. It is a virtual view:
archiving preserves the original modified date, content, folder, collection and
favourite memberships, source references, associations, provenance and history.
Deleted folders remain deleted; restoring their pages leaves them unfiled.

`PUT /api/pages/:id/archive` archives a page and
`DELETE /api/pages/:id/archive` restores it. Both accept `{revision}` and use a
transaction. Repeating an achieved transition is idempotent; a transition to a
different state requires the latest revision. Every transition advances revision
without changing `updated_at`. `GET /api/pages/archive` returns archive summaries
with filtering metadata. Ordinary `GET /api/pages` remains active-only.

The client flushes pending saves before archive, disables editing during that
transition, removes successful pages immediately, and retains their revisions
for Undo. Batch operations keep completed pages undoable if a later item fails.
Undo and Restore share the guarded restore operation. Archived direct links stay
readable, with an explicit Restore action. They never restore on open. Content
writes, AI mutations, history restoration and direct moves to Trash are rejected
until restoration to Active. Existing edit locks survive archive and restore.

Ordinary organization, smart collections, Inbox/review queues, calendar attention,
entity discovery, related-note suggestions and semantic/RAG retrieval use active
eligibility on the server. Historical entity associations and backlinks retain
archived pages and expose their lifecycle. Text search excludes archived pages
unless `scope.includeArchived` is true; `scope.all` selects the whole vault rather
than an explicit set of page/entity IDs. Automatic semantic retrieval stays
active-only. Existing embeddings remain stored; lifecycle changes do not request
new embeddings. The local projection synchronizer reuses unchanged projections
and vectors after revision changes.

Vault backups include `archived_at`, archived content and canonical relationships.
Older backups without the field import as Active. Trash retains its existing
30-day policy.

Synthetic coverage lives in `test/page-archive.test.mjs`, the workspace and vault
backup suites, and `scripts/check-page-archive-browser.mjs`. The browser script
uses an in-memory vault and an unconfigured fake provider; run it after building:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node --import tsx scripts/check-page-archive-browser.mjs
```
