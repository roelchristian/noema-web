# Decoded vectors and deferred historical retention

The decoded-vector scan cache now has a resident segment (seven eighths of the
4,096 entry budget) and an admission window. A repeated scan does not evict every
resident when the corpus exceeds the budget by one. Window hits promote a new
working set and demote the least recently used resident. A new serialized value
for the same key always invalidates the cached value, including invalid vectors.
Keys include dimensions. Clearing an adapter also clears its query cache.

Normalized vectors use `Float64Array`. This gives explicit eight-byte elements
and preserves the previous double-precision normalization and dot-product order.
`Float32Array` could halve that payload but was not chosen because it can alter
near-tied rankings. V8 can already use packed doubles for JavaScript arrays;
this change does not claim a twofold total memory reduction.

There are two independent retention limits: 4,096 entries and 256 MiB of estimated
retained payload per adapter. The latter conservatively counts two bytes per
serialized UTF-16 code unit, typed-vector bytes, key bytes, and 128 bytes of entry
overhead. Actual engine Map overhead and temporary parsing allocations are not a
hard process-RSS bound. Query vectors remain weakly keyed by caller arrays. The
resident segment obeys seven eighths of both budgets, leaving space for admission
even when long serialized vectors reach the byte bound before the entry bound.
The previous cache bounded entries only and could retain arbitrarily large
serialized strings. Multiple adapter instances each have their own budget.

Run the synthetic, local-only benchmark with:

```
node --expose-gc --import tsx scripts/benchmark-vector-cache.mjs
```

Optional positive integer arguments select corpus sizes. The benchmark compares
the exact previous FIFO admission algorithm with the segmented cache at 1,536
dimensions, counts JSON parses separately for cold and warm scans, measures
elapsed time, reports heap/ArrayBuffer deltas after optional GC, and verifies
score checksums. Fixtures contain distinct keys and 128 reused payload strings;
therefore observed heap deltas isolate decoded-vector retention and undercount
the unique serialized payload strings of a real corpus. Memory numbers are not
an end-to-end database/search benchmark. SQL still loads serialized candidates;
the cache addresses decoding, not SQL transfer or dot-product work.

The stable resident segment favors earlier corpus members during long scans. A
scan larger than cache capacity still decodes its nonresident tail each time.
Recurring new window members can replace residents, but a wholly different large
sequential corpus can keep the prior resident segment until clear. Lock/close
lifecycle behavior is unchanged. An ANN index or separate native vector store is
not justified by this optimization alone.

## Historical persistent cache: assessment only

`page_segment_cache` holds content-addressed historical variants for provider-free
reuse after undo. It is distinct from the in-memory decoded-vector cache.
Incremental segment persistence reduces attachment churn but does not bound this
historical table. No pruning, TTL, migration, or scheduled deletion is enabled by
this change.

A proposed later policy should:

- Always retain every `(page_id, content_hash, model, dimensions)` referenced by a
  current segment/vector attachment. Current vectors must be exempt from quotas.
- Preserve the three most recently used unreferenced variants per page for at
  least 30 days, including distinct model/dimension variants where useful. Define
  whether recency means creation or actual reuse before implementation; the
  current `updated_at` alone is not a complete usage ledger.
- Bound *additional unused history* by an explicit global byte budget, removing
  oldest unreferenced variants first after the protected undo window. If protected
  variants exceed the quota, report the excess instead of evicting current vectors
  or silently shortening the undo guarantee.
- Scope maintenance by vault/page, recheck current references atomically with any
  deletion, and measure SQL cost, deleted bytes, provider re-requests after undo,
  and restored retrieval quality. Include deletion, archive, and concurrent-save
  fixtures, plus backup/restore behavior.

This remains a proposal for approval. A useful next step is a read-only report of
current versus historical cache bytes, per-page variant distribution, age, and
undo reuse. It would establish an evidence-based quota before any destructive
maintenance is considered. Current vectors can grow with corpus size even under
a bounded historical policy; a global cap cannot promise both unlimited current
coverage and a fixed total persistent-cache size.

## Recorded local measurement

Node 24.19.0, Linux saved cloud environment, 1,536 dimensions; concurrent tests
were running, so elapsed times are indicative rather than latency guarantees.
Each cold scan parsed every candidate in both adapters. Warm results:

| Candidates | FIFO parses | Segmented parses | FIFO warm ms | Segmented warm ms |
| ---: | ---: | ---: | ---: | ---: |
| 4,096 | 0 | 0 | 383.9 | 73.2 |
| 4,097 | 4,097 | 513 | 2,005.1 | 256.9 |
| 8,192 | 8,192 | 4,608 | 2,890.6 | 1,026.8 |
| 16,384 | 16,384 | 12,800 | 6,623.4 | 3,629.8 |

All paired score checksums matched exactly. The 16,384-member cold run was slower
for the new adapter (6,627.9 ms versus 4,001.4 ms); this is a repeat-scan
optimization and does not promise faster cold scans. Earlier cold runs in the
same measurement favored the new adapter, underscoring timing variability.

The retained decoded payload measured approximately 48.6–48.7 MiB of heap for the
baseline and 1.35 MiB of heap plus 48.01 MiB of ArrayBuffers for the new adapter.
The conservative accounted total, including serialized strings at every distinct
key, was 197.23 MiB against the 256 MiB per-adapter payload bound. This benchmark
shows a shift out of the GC heap, not lower total decoded-vector bytes. Every
candidate is still scored; only repeated parsing/normalization work decreases.
