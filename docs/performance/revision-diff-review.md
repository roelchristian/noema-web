# Independent revision diff / organization review

Reviewed the bounded bulk command, organization indexes, revision diff indexes and progressive materialization, and App lazy boundaries in the integrated working tree. Review corrections were sent to the owners before acceptance:

- The initial diff only bounded DOM rendering while materializing every section first. It now plans ranges and materializes only the initial 12 sections, with a Show more control.
- Index group keys could collide between a linked group named `patch:B` and independent patch `B`. Group keys now use the same `group:` / `patch:` namespaces as the original grouping helper.
- The bulk command rejects more than 100 IDs, but Select all can select more. The UI now disables organization/favourite actions for oversized selections and explains how to reduce the selection.
- SourceReferencePreview initially imported a utility from SourceViewer, bypassing its lazy boundary. It now imports the shared citation helper directly.

The command requires an open vault, validates the operation/kind/count/unique IDs and scopes each item/destination. Existing membership protection is retained. A single transaction covers all item writes, so an invalid later item, automatic Reading Notes removal, or storage failure rolls back earlier changes. Retry operations remain idempotent. The Map/Set indexes preserve input membership order and are rebuilt when either inventory identity changes.

Focused existing suites passed 26/26 (`organization`, `organization-descriptions-ui`, `source-revision-diff`, `lazy-feature`). They cover fifty-page request aggregation, failed selection retention and retry clearing, foreign IDs, bounds, duplicate IDs, protected membership, injected rollback, linked hunk actions, decided/reversible patches, narrow/wide layouts, and module failure/retry. Owners added further regressions for the corrections above. A separate scratch differential check compared 500 deterministic randomized UTF-16/multiline fixtures against `d85aaa6`; source contexts, before/after text, line numbers, and section membership matched. Comparison normalized patch-array order because the optimized section controls use physical source order.

## Synthetic diff measurement

Reproduce with `REVISION_DIFF_BASELINE=/absolute/baseline node --import tsx scripts/benchmark-revision-diff.mjs`. Baseline checkout requires the same dependencies. The benchmark uses only generated text and patches; it does not touch a vault or providers.

Environment: Linux x64 cloud executor, Node v24.19.0. Source: 20,000 lines / 1,268,889 UTF-16 units, 1,000 separated patches with multiline/non-BMP replacements. One local run, concurrent agent activity possible.

| Initial review preparation | Baseline | Optimized |
| --- | ---: | ---: |
| Source slice calls | 1,003,000 | 12 |
| Source characters sliced (logical count) | 1,272,200,170 | 3,681 |
| Source prefix slice calls | 2,000 | 0 |
| Array sort calls | 4,003 | 1,004 |
| Planned sections | 1,000 | 1,000 |
| Materialized sections | 1,000 | 12 |
| Line comparison computations | 1,000 | 12 |
| Elapsed milliseconds | 5,007.0 | 33.6 |

Logical slice counts do not imply physical allocation: JavaScript engines may share string storage. Timings include planning, initial materialization and line comparisons. This is neither browser/device responsiveness evidence nor a claim about performance on a representative device. Bulk/browser interrupted flows and production bundles belong to the integration evidence; this review did not independently repeat full browser QA.
