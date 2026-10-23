# Calendar: temporal foundation and workspace

Phases 1–4 implement page/source temporal indexing, compatible typed entity date
adapters, explicit relationship review, and the Calendar month/agenda workspace.
An independent, opt-in General Roman Calendar supplements civil dates. Recurrence, reminders,
historical/entity timelines, and external calendar integrations remain deferred.

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

`temporal_curation` independently stores an explicitly chosen Personal/Knowledge/Historical
layer, label, annotation, pinning, semantic
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

## Phase 2 workspace

Calendar is a native workspace destination, supported by the sidebar, direct URL,
reload restoration, and browser/workspace history. Month and agenda views share
Personal, Knowledge, and Historical filters. The default shows curated dates and
accepted relationships; All references opts into incidental detected dates.
Classification is explicit: uncurated references remain Knowledge regardless of
whether their year is old or upcoming. Curation can assign a date to another layer.

Month/year periods appear separately from the exact-day grid, with explicit
precision labels and no fabricated day. Selecting a day or period opens the desktop
inspector or native full-viewport mobile dialog. It provides original evidence,
stale/unavailable relation states, and editable label, annotation, pinning,
significance, personal priority, and layer. Removing curation retains evidence.
Loading, partial-index, empty, error/retry, and save feedback have visible text.

Overview queries return at most 100 date records, each with at most three current
mentions and three accepted relationships plus full counts. `offset`/`limit`
(maximum 100) and `nextOffset` allow bounded continuation. SQL applies range,
eligibility, and layer filters before selecting the bounded page. Inspector detail
uses `GET /api/temporal/dates/:dateId`, defaults to 20 mentions and 20 relationships,
and exposes independent `nextMentionOffset`/`nextRelationOffset` cursors (offsets,
not snapshot tokens). A manual refresh restarts pagination; concurrent edits can
change result ordering. Indexing stays bounded and reports remaining dirty pages.
The `layers=personal,knowledge,historical` query is explicit; an empty list selects
none. The uncuration endpoint is `DELETE /api/temporal/curation/:dateId`.

Calendar selection, mode, filters, and unsaved curation drafts remain in memory per
vault during evidence navigation. Drafts are not persisted across browser reloads.
All page transitions use the existing save queue; a failed flush keeps the editor.
Exact UTF-16 selection bookmarks restore only when the original editable block
surface still has identical text. Evidence opening re-resolves its mention, loads
the saved page, validates its revision/block/offsets, and highlights the original
passage. Aborted or superseded requests never initiate a late page jump. A Return
to Calendar action retains the selected date and curation draft.

The month grid has roving keyboard focus, Arrow/Home/End/PageUp/PageDown movement,
and Enter/Space activation. The mobile sheet uses native modal focus containment
and restores its trigger on close. Calendar controls use real 44px targets,
including at 320px width. Styling reuses existing neutral/status tokens and owns
its rules in `styles/features/calendar.css` with zero literal colours.

New layer columns migrate additively. Prior temporal backups without a layer
restore into Knowledge; new exports preserve the chosen layer. Synthetic tests
cover bounds, filters, backup compatibility, civil grid edges, exact selections,
and interrupted save/history transitions. `npm run test:browser` now includes the
real Calendar app harness, alongside existing regressions. It uses a disposable
synthetic vault and verifies desktop/mobile screens, stale evidence, error/retry,
reference pagination, repeated/aborted navigation, draft/caret preservation,
keyboard movement, full-height sheet geometry and touch target sizes. Set
`NOEMA_SCREENSHOTS` to retain its PNGs and `calendar-validation.json`.

### Checkpoint validation

On Linux with Chromium 154, `npm test` passed the build, stylesheet ownership,
application/test typechecks and all 787 tests: 781 passed, six macOS-only
Keychain/PDF tests skipped, zero failures. All seven `npm run test:browser`
harnesses passed sequentially. An initial concurrent attempt timed out in the
existing source-reading end-of-source check while the full suite was running;
the complete browser command then passed without changing that assertion or its
timeout. The Calendar harness reported zero browser errors and no AI activity.
It captured and visually inspected real desktop month/agenda/inspector and mobile
month/full-height sheet screens using synthetic data only.

## Phase 3 source and entity evidence

Source extraction operates over the existing canonical source passages, stable IDs,
source hashes, and generation IDs. Source import/reprocessing enqueues local work;
each temporal batch processes at most 25 passages. The existing passage worker
runs bounded temporal evidence work after source segmentation. Page keystrokes do
not invoke source parsing, semantic interpretation, or any paid service.

`temporal_source_mentions` retains the original source/file/passage/generation,
source and passage hashes, exact UTF-16 span, line range, spelling, precision and
calendar. Repeated occurrences have distinct source offsets; overlapping chunks
share a single occurrence. A full expression takes precedence over a partial
expression recognized at a chunk boundary. A file's references become queryable
only when its active temporal generation is complete, with partial progress
reported separately. `temporal_source_cache` reuses extraction for unchanged
passage content; `temporal_source_state` protects batch cursor/version progress.
Commit rechecks source eligibility, active generation/hash/context, cursor, and
bounded passage snapshots. Old async work cannot overwrite a new revision or
newer batch progress.

Reprocessing creates new occurrence identities. It never mutates a manually linked
old generation into a relocated occurrence, even when identical date text exists
elsewhere. Old relationships retain their pointer and expose stale evidence.
Source opening validates that pointer again, including in the source viewer; exact
marking uses canonical offsets rather than searching for the first matching date.
If context cannot be verified, the viewer identifies the saved excerpt as such.
The Calendar inspector yields its desktop column/mobile modal while source context
is open and restores it on close.

`temporal_property_values` is a read adapter alongside authored text properties.
It recognizes the existing Person birth date, Event start/end dates, Creative Work
release date, and Source publication/accessed dates. ISO year/month/day values are
unambiguous in these typed fields; supported English values retain their precision
and explicit calendar. Numeric locale ambiguity, ranges and unsupported expressions
remain unresolved. Entity property panels show the original value and its precision
or unresolved reason. No property is rewritten or migrated to a fabricated date.

Adapted dates create field-derived **pending** relationship proposals. They appear
under All references, not as accepted commitments. Accept/reject uses a token covering
the relationship and current evidence, and accepting stale/unresolved evidence is
rejected. Decisions survive re-indexing. Changing/deleting a field leaves a previously
accepted relationship with stale/unavailable support instead of reinterpreting it.
End/accessed date fields use the conservative `discusses` proposal kind rather than
inventing a new event or appointment. Calendar also provides explicit entity/role/
support selection for manual relationships, and removal records a rejection. Manual
creation is idempotent for the same accepted assertion and evidence.

Additional inspector lists (sources, original properties, review proposals) are
independently bounded and paginated. `GET /api/temporal/dates/:dateId` accepts
`sourceOffset`, `propertyOffset`, and `proposalOffset`, returning corresponding
`nextSourceOffset`, `nextPropertyOffset`, and `nextProposalOffset` values.
`GET /api/temporal/source-mentions/:id` resolves original source evidence.
`PUT /api/temporal/relations/:id` accepts `{status: 'accepted'|'rejected', version}`.
`POST /api/temporal/relations` also accepts one optional `sourceMentionId` anchor.

Archive, failed/unadmitted files, deletion, foreign vaults and vault locking exclude
source/property evidence. Source deletion removes its mention rows and clears
surviving relationship support pointers; independent date curation remains. Entity
lifecycle previews include temporal counts and their fingerprints include temporal
relationships. Vault deletion fingerprints include source content and structural
metadata. Backup version 1 adds optional source mentions and relationship support
fields. Restore remaps source/file/property/mention identities and preserves review
status and curation. Retired source generations are retained as explicitly stale
historical evidence; they are not silently redirected to freshly generated passages.
Derived source caches, cursors, and property values rebuild locally. Prior backups
without these fields remain importable.

### Phase 3 validation

`npm test` passed build/styles/typechecks and 793 tests (787 passed, six explicit
macOS-only skips, zero failures). A final build and all seven browser harnesses
passed after the source-viewer layout/highlight adjustment. The real Calendar
harness verified a repeated source occurrence, source relationship creation,
reprocessing without redirect, typed property acceptance, mobile source-viewer
focus/modal handoff, and existing interrupted/repeated page navigation. All data
was synthetic; no provider calls were made. Six new temporal evidence tests cover
batching/cache reuse/overlap, obsolete commits, source lifecycle, typed review,
backup remapping and strict occurrence rendering.

### Reading continuity diagnosis

The original timeout was observed once at the existing end-of-source reopen
assertion during a concurrent full-suite/browser run. The fixture mounts SourceReader
directly, without the Calendar workspace or its editor selection hook. Optional
`NOEMA_READING_REPEAT=10` and `NOEMA_READING_TRACE=1` now repeat end-of-source
close/reopens and retain a synthetic request trace. Ten standalone cycles and ten
cycles during the complete suite passed. The loaded trace recorded 37 reading
requests, including ten end-anchor writes after the first end marker and zero
subsequent non-end overwrites. No source-reading product change or timeout increase
was made. The original root cause remains unconfirmed; these results do not prove
that timing/resource contention was the only cause, and do not claim that a product
race has been fixed. Keep the trace-enabled stress case for recurrence.

## Phase 4: independent General Roman Calendar

The supplement is off by default. It never writes temporal dates, evidence,
relationships or appointments. Exact civil days can show the observed principal
celebration or weekday, rank, season and colour; optional memorials are revealed
in the inspector. Provider-supplied additional non-optional liturgies remain visible.
The month grid stays restrained and the agenda supplement is separate from knowledge.
Coarse month/year records never acquire an invented liturgical day.

The server pins both `romcal` and `@romcal/calendar.general-roman` to
`3.0.0-dev.140` (MIT; notice in `licenses/romcal-MIT.txt`). The maintained v3 line
is explicitly prerelease, unlike the legacy stable v1 package. Registry metadata
records publication on 30 August 2026, with matching source revision
`6246bad8c548c1f2528916df40e433c1f7c97c6a`. This is a deliberate pinned dependency
tradeoff: future updates require the rule fixtures and cache/provider key to change.
The published package's actual types/output were checked because some upstream
v2 output documentation is stale. The adapter uses named `Romcal`, localized
`GeneralRoman_En`, `generateCalendar`, `id`, `colors`, and ordered observed days.
It does not invent fixed feast labels or precedence.

Primary references reviewed:
- [Romcal source and maintenance](https://github.com/romcal/romcal)
- [Current usage/API](https://github.com/romcal/romcal/blob/dev/docs/general-usage.md)
- [Changelog](https://github.com/romcal/romcal/blob/dev/docs/CHANGELOG.md)
- [Pinned MIT license](https://github.com/romcal/romcal/blob/6246bad8c548c1f2528916df40e433c1f7c97c6a/LICENSE)
- [General Norms for the Liturgical Year and Calendar](https://www.liturgyoffice.org.uk/Calendar/Info/GNLY.pdf)

Supported civil years are **1970–2099**, under the provider's current universal
rules, not historical reconstructions. No national/diocesan proper is loaded.
Universal fixed-date Epiphany, Ascension and Corpus Christi are explicit; no
national Sunday-transfer convention is silently selected. Precedence and solemnity
transfers are calculated by the provider. A missing colour (for example Holy
Saturday before the Vigil) remains unspecified, rather than invented.

Generation is server-only in an isolated 128 MiB worker with a 12 second limit,
one active generation and at most two pending years. No vault content or network
is supplied. Validated normalized results are under 1 MB. SQLite retains eight
years, keyed by generator, data package, locale, universal options and adapter
version; corrupt/obsolete rows regenerate. Browser memory/local storage retain
four validated years with the same version key. Cached years work without a
request. Missing data or generation failure leaves the civil calendar usable and
provides retry. Vault access is checked before and after asynchronous generation.
Derived public cache data is reconstructible and is not vault backup content.

Focused tests exercise Easter/Pentecost, the 2024 Annunciation transfer, the 2023
Saint Joseph transfer, Sunday precedence over Saint Francis, universal fixed-day
settings, optional memorials, additional Triduum liturgies, empty colour metadata,
cache reuse/version invalidation/corruption/bounds, serial concurrency, range and
vault locking. Browser checks cover desktop/mobile, optional detail, separate
agenda, cached reuse, error recovery and absence of temporal-entity writes.

## Scope audit and deferrals

The completed scope covers canonical page/source dates, evidence and navigation,
revision-aware incremental indexing, lifecycle/backup boundaries, separate curation,
month/agenda/inspectors, explicit filters, typed compatible property review, manual
relationships and the independent universal supplement. Extraction deliberately
supports exact English day/month/year expressions conservatively; numeric prose,
relative/approximate expressions, ranges, BCE, centuries and conversions between
historical calendars remain unresolved rather than guessed. Explicit original
calendar qualifiers and precision are retained; typed date fields accept ISO dates.
No incidental mention becomes a personal commitment or semantic event.

A separate curated Date entity homepage remains future UI work; current date
curation and evidence live in the Calendar inspector. No multilingual extraction
beyond English is claimed. Advanced Phase 5 remains deferred: historical/entity
timelines, recurrence/reminders, and external calendar integrations. Philippine
propers, lectionary/propers/readings and regional transfer settings are excluded.

## Final integration verification

Phase 4 before main integration passed the build (styles and application/test
helper/server typechecks), 798 tests (792 pass, six explicit macOS-only skips),
and all seven browser harnesses sequentially. Current main `cc8c399` was merged
with both Calendar and presentation imports preserved. The integrated full suite
passed 803 tests: 797 pass, six explicit macOS-only skips, zero failures.
All seven browser harnesses passed sequentially on the integrated tree after
the Escape guard fix; screenshots and
machine-readable Calendar checks are retained outside the repository with
synthetic fixtures only. No screenshot delivery success is claimed: Library's
connection-check failed before upload, and no file IDs were returned.

During integrated browser validation, document-find's old selector counted four
closed-menu buttons at 0×0 along with eight visible 44×44 controls. Its assertion
now checks visible controls in both dimensions, retains minimum control count,
and reports measured diagnostics. No product style change was needed. Two cold
fixture starts also exceeded the previous shared seven-second deadline while Vite
logged dependency scanning/bundling. Only the initial fixture navigation now has a
30-second setup budget; all interaction deadlines and other assertions remain.
These findings are separate from the unconfirmed earlier source-reading timeout.
The production find flow also used a removed toolbar button after main moved
Find into More page actions; its harness now follows that actual menu route.
Main integration also exposed a real rapid-Escape boundary: Focus's nested-panel
guard consumed Escape while Find was already closing/inert for its 200ms animation.
It now recognizes only an open Find panel, preserving first-Escape dismissal while
allowing a second Escape to leave Focus. The production browser flow exercises
this immediate sequence; this is independent of Calendar evidence state.

The final post-fix build/styles/typechecks and 803-test suite passed again
(797 pass, six macOS-only skips), followed by a green complete `test:browser`
command. The production presentation checks passed rapid Find/Escape priority,
repeated mode restoration, reload, mobile interactions and data fidelity; Calendar
checks passed exact/stale evidence, interrupted navigation, editor draft/caret,
source/property review, overlay independence/cache/error states and 44px targets.
