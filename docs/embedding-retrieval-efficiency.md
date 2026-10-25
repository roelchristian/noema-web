# Embedding and retrieval efficiency

Implemented locally from verified remote `main` and supplied baseline
`abd7d840e83972b8a139f5aa6abcabc0d52865dc`. Providers in all fixtures are mocked.

## Worker correctness and request packing

The worker reconciles every distinct Page in a completed request before validating
its individual vectors. Unrelated dirty Pages no longer consume the bounded
reconciliation sweep and cause a valid in-flight result to be discarded. Exact
hashes, current availability, vault state and each job's cancellation status still
control persistence. The deterministic 20-dirty-Page reproduction persisted
**0 valid vectors on baseline → 1 after the fix**; unrelated dirty work remains
queued instead of consuming completion reconciliation.

Cross-Page batches rotate the starting Page and visit one job per Page before
another job from that Page. Each request stays within one unlocked vault, current
model/dimensions, 16 inputs, 64,000 aggregate input bytes and durable smaller batch
limits. Inputs remain separate and retain provider index mapping. Existing
foreground admission reserve and source/Page scheduling remain in place.
Multi-Page activity is attributed to the vault rather than misleadingly to the
first Page. Cancelling one member does not discard other current results.

An identical 100-single-segment fixture measured against the exact baseline and
the implementation uses **100 → 7 requests**, with 100 inputs and **700 mock tokens
in both**. Batching reduces request overhead; it does not reduce embedding token
volume. The regression suite additionally covers delayed completion behind 20
unrelated dirty Pages, concurrent ticks, member cancellation/edit/archive/deletion,
byte caps, vault isolation and incompatible model settings. Existing reversed
provider indices, response shrinking/restart and transient-failure tests remain.

## Incremental SQL persistence

For an identical three-section Page edit changing its first section, SQL audit
triggers measured:

| Mutation | Baseline | Incremental |
| --- | ---: | ---: |
| Segment deletes | 3 | 1 |
| Segment inserts | 3 | 1 |
| Surviving segment reference updates | 0 | 2 |
| Vector attachment deletes | 3 | 1 |
| Vector attachment inserts | 2 | 0 |

Content and block anchors match surviving identities before fallback matching for
content-equivalent moves. Reference updates preserve attachment row identities and
do not touch FTS. Reordering uses temporary ordinal slots to respect SQLite's
immediate uniqueness checks. Real text/heading changes still refresh FTS, including
headings beyond the bounded provider context. Undo reattaches only the reverted
member from the content-addressed cache. Tests cover moves, splits, merges,
duplicates, unchanged saves, undo, deletion and FTS mutation counts.

The exact existing provider input/hash contract is preserved. Section separators
can make moving the last section change its input hash even when visible words
are unchanged; this appropriately causes fresh content handling instead of
silently normalizing existing embeddings.

## Scoped semantic retrieval

Both vector-availability checks and candidate SQL accept Page/source scopes.
Explicit empty lists, unavailable IDs and cross-vault IDs cannot widen retrieval
or trigger a needless query embedding. Scoring rows contain identifiers and
serialized vectors rather than snippets, titles and retrieval anchors. Bounded
shortlists preserve score/tie ordering and hybrid reciprocal-rank fusion.

A synthetic 115-candidate fixture scores all 115 in an unrestricted search;
scoping to one eligible Page/source scores only that owner's eligible segments.
Navigation limit 3 materializes **115 → 3** candidates; hybrid limit 1 materializes
**115 → 1**, or zero extra rows when lexical evidence already supplies the winner.
Hybrid retains its existing semantic candidate budget for ranking and lexical
evidence priority. Exact
retrieval references and stale-source evidence behavior remain intact. Lexical
evidence is captured after the query-provider await, so deletion, archive and
vault moves during that wait cannot return stale pre-request evidence. Baseline
source archive behavior is preserved consistently with lexical search; archived
Pages remain excluded.

## Decoded cache and deferred work

See [decoded vector benchmark and retention policy](embedding-vector-cache-policy.md)
for the repeatable baseline comparison, payload limits and limitations. Historical
persistent-cache pruning remains explicitly deferred; no destructive pruning,
TTL or deletion job is enabled.

The scoped search still scans all eligible vectors inside its scope. SQLite
scoring rows stream through a bounded shortlist rather than retaining the corpus
as a JavaScript array. These changes do not introduce ANN infrastructure or
claim sublinear semantic scoring.

## Integration and review

Read/assessment snapshot commit `753021cb71709b508f28686386903624564481fb`
is integrated locally. Its assessment generation counter still increments when
vectors are replaced or segments deleted, and index completion still queues
reassessment. An integration regression verifies reference-only moves and
unchanged saves do not manufacture vector-generation changes, while a real
replacement and its eventual vector each invalidate the assessment.

Independent review found and resolved two issues: metadata changes beyond bounded
heading context, and stale lexical evidence across the asynchronous query wait.
No unresolved review findings remain for the implementation present here.

The typed retry commit `fb8db3ae4451e69168ca393cd6199b9ab1906520` is now
integrated from the verified safeguards Git branch. The earlier Library transfer
failed without writing archive bytes; subsequent explicit publication authority
made the verified Git branch available. The combined worker preserves cross-Page
packing, distinct-Page completion reconciliation and per-job attempt accounting,
while terminal provider errors stop automatic retries and `Retry-After` governs
transient retries. Local admission consumes zero attempts. Cancelled members do
not acquire terminal retry blocks from a later failed provider response; this
applies to both Page and source workers.

## Validation before safeguards integration

- `npm run test:all`: **1,810 passed, eight skipped, zero failed** (1,818 tests).
  The initial broad run exposed two obsolete singleton-provider/API activity
  fixture assumptions; those fixtures now accept indexed batch responses and
  assert correct request attribution. The complete corrected suite was rerun.
- `npm run build`: passed, including style ownership checks, application/test
  typechecking, server compilation and production frontend build. Existing
  frontend chunk-size advice remains informational.
- Integrated focused suites: 39/39 passed; the additional generation regression
  passed in the eight-test incremental persistence suite; deferred-query lifecycle
  regressions passed in the 19-test focused retrieval run.
- Mocked Chat browser validation: desktop/mobile, light/dark, exact note/source/
  entity evidence, cancellation, provider failure recovery and vault switching;
  no page errors or horizontal overflow. Screenshots were disabled.
- `scripts/benchmark-page-reads.mjs --assert`: passed after integration; ordinary
  Page/metadata/enrichment/status reads retain zero writes, classification
  assessments and vector loads.
- Independent source and integration review: no unresolved findings;
  `git diff --check` passed.

All provider tests and measurements use mocked or synthetic vectors. No real
provider calls were made. These results cover the initial embedding/retrieval and
read/snapshot changes; combined validation with safeguards is recorded below.
Publication was subsequently explicitly authorized for the draft PR only.
