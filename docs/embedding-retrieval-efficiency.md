# Embedding and retrieval efficiency

Implemented locally from verified remote `main` and supplied baseline
`abd7d840e83972b8a139f5aa6abcabc0d52865dc`. Providers in all fixtures are mocked.

## Worker correctness and request packing

The worker reconciles every distinct Page in a completed request before validating
its individual vectors. Unrelated dirty Pages no longer consume the bounded
reconciliation sweep and cause a valid in-flight result to be discarded. Exact
hashes, current availability, vault state and each job's cancellation status still
control persistence.

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
retrieval references and stale-source evidence behavior remain intact. Baseline
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
