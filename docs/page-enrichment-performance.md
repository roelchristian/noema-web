# Page enrichment read regression

The local fixture reproduces read-time assessment and SQLite writes at baseline
`abd7d840e83972b8a139f5aa6abcabc0d52865dc`. These are fixture measurements, not
universal latency, billing, or production payload claims. Providers are mocked;
ordinary reads made no provider calls before or after the change.

Run from the checkout root:

```sh
node --import tsx scripts/benchmark-page-reads.mjs --assert
node --import tsx --test test/page-read-overhead.test.mjs
```

To reproduce the old behavior without modifying the current checkout:

```sh
mkdir -p /tmp/noema-read-baseline
git archive abd7d840e83972b8a139f5aa6abcabc0d52865dc | tar -x -C /tmp/noema-read-baseline
ln -s "$PWD/node_modules" /tmp/noema-read-baseline/node_modules
NOEMA_BENCH_ROOT=/tmp/noema-read-baseline node --import tsx scripts/benchmark-page-reads.mjs
```

The script constructs a temporary SQLite database, a 4,235-word page with nine
paragraphs and nine stored 1,536-dimensional passage vectors, an inferred
mathematics assignment, and a saved summary with internal evidence. It warms
legacy compatibility paths and removes queued work before measuring settled
reads. HTTP authorization is included. Workers stay disabled. SQL statement
counts wrap SQLite prepare/get/all/run; changed rows use SQLite total_changes,
including trigger effects. Transaction-control statements are not counted as
writes. Assessment entry and vector-select counters detect hidden processing.
The full mocked summary generation includes its initial page read.

| Operation | Bytes before → after | SQL reads before → after | Write statements before → after | Changed rows before → after |
| --- | ---: | ---: | ---: | ---: |
| Page | 34,614 → 34,623 | 20 → 11 | 2 → 0 | 1 → 0 |
| Metadata | 1,106 → 1,032 | 20 → 7 | 2 → 0 | 1 → 0 |
| Enrichments | 59,230 → 397 | 21 → 3 | 3 → 0 | 1 → 0 |
| Compact status | unavailable → 73 | unavailable → 7 | unavailable → 0 | unavailable → 0 |
| Ten enrichment reads | — | 210 → 30 | 30 → 0 | 10 → 0 |

The stored internal enrichment state is 58,429 bytes before and 58,438 bytes
after; it remains server-side. Storage size is not the public payload size.

All four read variants now have zero assessment calls, vector loads, changed rows,
write statements, and provider calls. The old page/metadata/enrichment reads each
entered assessment and loaded vectors once per request. The public enrichment
projection excludes baseline text, token histograms, embeddings and internal
record kinds.

A full mocked summary-only generation retains one provider execution. The fixture
reproduces the original 8 Knowledge.list calls, 96 Store.get calls, 39 Store.all
calls and 15 Store.run calls. The optimized path uses 0, 70, 13 and 9 respectively;
SQL reads fall from 135 to 83. Generation writes remain expected mutations.
These counters include a separate preparation immediately before generation, as
shown by the script. Detailed machine-readable measurements are in
[test/fixtures/page-read-overhead-metrics.json](../test/fixtures/page-read-overhead-metrics.json).

Independent regression review checked generation input preservation, name
resolution, policy/manual/vector invalidation, same-timestamp result changes,
public evidence exclusion and poll cancellation. Same-revision background domain
changes and restored assignments alter the compact version even when the entire
queue transition occurs between checks. The panel refreshes narrow metadata with
results and preserves unsaved drafts, newer manual assignments and page identity.
The classification queue retains work through its existing cooldown instead of
dropping policy invalidations. No unresolved correctness blocker remained in this
independent review. Cascading passage deletion was
verified to advance vector generation. Archived and inactive entity names remain
part of projected mention text, consistent with the previous resolver; these
flags alone do not change assessment inputs. Entity insertion/deletion now queue
preparation directly. Metadata conservatively reports freshness when a current
content fingerprint is unavailable, without loading the page body.

The benchmark does not measure latency, browser frame cost or production data.
Browser behavior is validated separately by the Knowledge panel browser check.
Settled refresh remains periodic (one compact check per minute), with faster
checks while pending and event/visibility wakeups.

Run the disposable populated-page browser check with Chromium installed:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs npm run test:knowledge-browser
```

It writes screenshots and `validation.json` to `output/knowledge-browser/`.
The fixture uses stored synthetic results and rejects any provider invocation.

## Integration contracts

`PreparedEnrichmentSnapshot` is exported from `page-enrichment.ts` as the non-null
return type of `prepare()`. `runPrepared(vault, snapshot, observer?, options?)`
consumes that frozen snapshot without preparing again. It carries the page,
requested fields, projected input, referenced-name resolver, prompt coverage,
shortlist, baselines, model selection and dependency identities. Future artifact
fingerprints can extend this snapshot without adding a global entity cache.
Before persistence, current projected content/headings, referenced names,
requested baselines, relevant field ownership, policy and model are checked.

`Pages.prepareHashes()` owns legacy summary fingerprint migration during queued
preparation and page creation/saves. Ordinary reads leave legacy storage intact.
Only matching old fingerprints or exact generating revisions justify rebasing;
unknown older results remain stale.

`page_assessment_vectors(page_id,generation)` is a local invalidation epoch.
Embedding insert/update/delete and segment deletion advance it and enqueue the
existing preparation queue. Dirty-index completion also queues preparation.
Assessment identity includes the epoch, index projection/dirty/current state,
caller-supplied embedding, complete classification baseline, normalized content,
title/headings, classification/taxonomy policy and domain assignments. Future
embedding batching or incremental segment persistence must preserve these
triggers or equivalent atomic invalidation. Assessment state and evidence stay
server-side. Cooldown-delayed classification remains durably queued until due.

Public clients use `GET /api/pages/:id/enrichments` for summary/scan/topics and
`GET /api/pages/:id/enrichment-status` for `{version,pending,pendingFields}`.
Versions include public results and relevant persisted metadata, so a complete
job occurring between polls is still observable. Changed versions fetch public
results and narrow `/metadata`; unchanged versions avoid those payloads. The
panel checks every two seconds while pending, every minute when settled, and on
focus/visibility/AI activity. Requests are serialized, cancellable, and bounded by
a fifteen-second timeout; transient errors retain the last displayed result.

## Local validation

On Linux/Node 24, the combined change passed `npm run build` (styles, application
and test types, server compilation, client bundle), the complete test registry
(1,789 tests: 1,781 passed, eight platform/optional skips, zero failures), and 27
focused freshness/read/polling regressions. Chromium 154 populated-page QA passed
seven checks covering settled cadence, evidence exclusion, external summary and
settled-domain refresh, pending/terminal cadence, page switching and cleanup.
There were zero browser errors and zero provider invocations. Mocked generation
tests preserve the provider request contract; live generation quality was not
benchmarked. Existing client bundle size warnings remain.
