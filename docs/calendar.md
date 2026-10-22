# Calendar: Phase 1 temporal foundation

This checkpoint implements saved-page temporal indexing and its query/navigation
contracts. It does **not** implement the Calendar workspace or complete the calendar
feature. Source extraction, typed entity properties, and the liturgical overlay are
subsequent phases. Recurrence, reminders, historical/entity timelines, and external
calendar integrations remain deferred.

## Review of the proposal against the repository

- A temporal date is not an Event or a document occurrence. Adding every detected
  date to `entities` would contaminate name matching and the general directory.
  Canonical dates therefore live in their own vault-scoped tables. Explicit date
  curation has its own API/storage; a curated Date homepage remains future UI work.
- `projectPageText` supplies canonical UTF-16 offsets, including table and column
  separators. Saved pages already supply stable block IDs and authored revisions.
  Temporal evidence reuses these anchors rather than storing generated summaries.
- Page saves may be frequent. SQLite triggers enqueue only the page ID; they do not
  extract dates. Refresh occurs on demand, with a default batch of 100 dirty pages.
  A query reports outstanding work rather than presenting partial indexing as final.
- Source passages have generation/hash and offset infrastructure suitable for Phase
  3. They should not be converted into arbitrary detached text chunks for the calendar.
- Backups use an explicit allowlist and remap page/entity identities. Temporal data
  must participate explicitly; simply adding tables would silently lose curation.
- Existing text properties are compatible: Person has `birth date`; Event has
  `start date` and `end date`; Creative Work has `release date`; Source has
  `publication date` and `accessed date`. These properties are untouched. Phase 3
  should add a typed adapter alongside the original text, leaving ambiguous text
  unresolved and preserving original user values. No bulk migration is needed.

## Data boundaries

`temporal_dates` stores canonical identity, value, precision, and calendar. For
example, `gregorian:month:2026-10` is different from
`gregorian:day:2026-10-01`. A month/year is never stored as a fabricated day.
Identities are deterministic and scoped by vault. Original spellings remain in
mention evidence.

`temporal_mentions` stores page/block identity, block fingerprint, block-relative
UTF-16 span, original expression, page revision, and optional canonical date ID.
Unsupported expressions retain an explicit reason and a null canonical ID. A
changed/removed block leaves its previous evidence stale. Repeated expressions
retain distinct occurrence IDs while sharing the same canonical date.

`temporal_relations` separates semantic assertions from recognition. Its schema
supports manual/inferred origin, accepted/pending/rejected review states, and
optional confidence. The current creation endpoint writes only an explicit manual,
accepted relationship. Extracting text creates no Event, deadline, or commitment.
Accepted relationships with stale evidence remain identifiable as such. Archived
entities are excluded from query results; permanent entity deletion cascades their
relationships.

`temporal_curation` independently stores label, annotation, pinning, semantic
importance, and personal priority. A curated date survives loss of its evidence.
No ordinary dates are inserted into the general entity directory.

`temporal_index_state`, `temporal_block_state`, and `temporal_dirty` are derived
index state. Blocks are fingerprinted independently; unchanged blocks skip the
parser. Unrelated edits can change global offsets, which are recomputed from the
current projection at navigation time. Code, math, and divider blocks are excluded.

## Extraction policy

Version `english-civil-v1` deterministically supports full English month names:

- `23 October 2026` and `October 23, 2026` (also without the comma), including
  valid ordinal forms such as `23rd October 2026`.
- `October 2026` with month precision.
- Contextual years such as `in 1848`, `since 1848`, or a standalone `1848` block.
  Arbitrary four-digit numbers in prose are not assumed to be years.
- Explicit parenthesized `(Julian)` / `(Old Style)` and `(Gregorian)` /
  `(New Style)` suffixes. Julian identities are separate; no conversion is attempted.

Unqualified civil dates use Gregorian indexing. The parser is deliberately not a
historical calendar inference engine. Numeric date forms (including ISO-shaped
prose dates in this first English-only extractor), ranges, BCE expressions,
approximate dates, question-mark uncertainty, centuries, and relative expressions
are retained as unresolved evidence where recognized. Invalid civil dates are
unresolved. Broader languages, abbreviated months, and calendar inference need a
versioned extension with dedicated fixtures, not silent reinterpretation.

Range queries accept exact civil day boundaries, with an explicit calendar
parameter. A month/year matches an overlapping query as that period, retaining its
original precision. The API does not assign it to the first day. Gregorian queries
do not silently include converted Julian dates.

## Refresh and navigation

Page insert/revision/content/trash changes and referenced entity label changes
enqueue a dirty page ID. Dirty evidence immediately fails navigation and is excluded
from current-reference queries. Preparation extracts only changed blocks. Commit
uses a savepoint and compares both the saved revision and projected content hash;
an old result cannot overwrite a newer page or entity-label projection. Work is
local and synchronous today; this guard also applies if scheduling becomes async.

Navigation returns `current`, `unresolved`, `stale`, or `unavailable`. Current and
unresolved evidence includes a `PageReference` plus exact block-relative offsets.
The existing passage highlighter validates temporal references before applying a
range. It never searches for an identical date elsewhere when the block disappears.
Tables/columns can use the existing exact block-anchor highlighting when their DOM
does not match the flat canonical projection.

All temporal service methods enforce open-vault access. Trashed pages disappear
immediately from query/navigation eligibility. Purging a page cascades its mentions,
clears supporting relationship pointers, and preserves independently curated dates.
Vault deletion cascades all temporal data. Its confirmation fingerprint includes
date curation and relationships, so intervening user changes invalidate a preview.

## API contracts

All endpoints use the existing `X-Vault-Id` scoping and same-origin transport.
Mutations require `X-Noema-Request: 1` and JSON.

| Method/path | Behavior |
| --- | --- |
| `GET /api/temporal/dates?from=2026-10-01&to=2026-10-31` | Curated dates and explicitly accepted relationships, with precision and indexing progress |
| Same query with `references=all` | Also includes incidental current page references |
| Same query with `calendar=julian` | Query Julian civil values without conversion |
| `GET /api/temporal/pages/:pageId` | Refresh one saved page and return anchored recognized/unresolved mentions |
| `GET /api/temporal/mentions/:mentionId` | Resolve exact evidence; stale/unavailable results contain no replacement anchor |
| `POST /api/temporal/refresh` | Process the next batch and return `{refreshed,pending}` |
| `PUT /api/temporal/curation` | Explicitly curate `{value,calendar?,label?,annotation?,pinned?,importance?,personalPriority?}` |
| `POST /api/temporal/relations` | Explicitly assert `{dateId,entityId,mentionId?,kind}` |

Relation kinds are `occurs_on`, `born_on`, `published_on`, `deadline`, and
`discusses`. A supporting mention must belong to the same vault and date. Curation
PUT replaces the curation fields and defaults omitted fields; it is not a PATCH.

Backup version 1 gains optional temporal date, mention, curation, and relationship
tables. New imports validate canonical identities, remap page/entity/mention IDs,
and initially mark restored evidence stale. On-demand extraction rebuilds current
evidence from restored pages. Old archives remain importable and acquire an index
on first query. Derived index state is not trusted or exported. Other older app
versions cannot be assumed to preserve fields they do not know when re-exporting.

## Remaining phases and acceptance gates

1. **Phase 2 — Calendar workspace.** Add restrained month/agenda views and a desktop
   inspector/mobile sheet. Carry selection in navigation state; render at most a
   few entries per day. Keep the curated-first query default, expose All references,
   and distinguish Personal/Knowledge/Historical without inferring commitments.
   Month/year periods need honest period presentation. Add loading/partial-index,
   empty, stale, keyboard, and mobile cases, plus curation controls. Wire exact
   evidence navigation through the existing page opening flow. A Date homepage
   can be introduced explicitly for curated dates without exposing all auto dates.
2. **Phase 3 — Sources and entities.** Add source-passage evidence using existing
   passage IDs, content hashes, generation IDs, and offsets. Deduplicate overlapping
   spans by source offset and fingerprint; refresh affected passages only. Mark
   manual evidence stale across reprocessing, preserve curation, and extend backup,
   source deletion/merge previews, and access checks. Add a compatible typed adapter
   for the date property names above and explicit reviewed relation decisions.
   Validate reprocessing, deleted sources, original precision/calendar, and stale
   passage navigation before extending query layers.
3. **Phase 4 — General Roman Calendar.** First verify current generator APIs,
   licensing, maintenance, and universal-calendar coverage from primary sources.
   No dependency has been selected or added at this checkpoint. Calculate observed
   years locally, test precedence and transfers, cache by year/provider version,
   and keep this optional overlay independent of temporal entities and appointments.
   Include rank/season/colour and optional memorials. Universal calendar only;
   Philippine propers, readings, and illustrative hardcoded feast lists are excluded.

Phase 5 remains deferred: historical/entity timelines, recurrence/reminders, and
external calendar integrations.
