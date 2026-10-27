# Organization operations: synthetic measurements

Baseline `d85aaa6`; Linux x64 cloud executor, Node 24.19.0. Only disposable synthetic databases and fixtures were used. Reproduce with `node --import tsx scripts/benchmark-organization-bulk.mjs` and `node --import tsx scripts/benchmark-organization-index.mjs`.

For 50 favourite operations, sequential calls returned 62,945 bytes across 50 HTTP requests. The bulk command returned one final 2,385-byte snapshot in one request. Loopback elapsed time was 3,713 ms versus 50 ms; these are not device responsiveness measurements.

At 10,000 synthetic library rows, repeated array scans took 3,399 ms; building indexes took 19 ms and indexed lookups 2 ms in a single cloud run. The UI memoizes indexes against their immutable input arrays. Filtering, sorting and DOM rendering still process the visible library; no server pagination or virtualization was introduced. Representative device profiling remains necessary before choosing those larger changes.

Bulk commands accept 1–100 distinct page IDs. The server checks vault access and applies the whole command in a transaction, then returns one final snapshot. Invalid/duplicate IDs, protected automatic memberships or a database failure roll back every mutation. Retrying an uncertain outcome is idempotent for these set operations. The UI preserves selection after failures and exposes the 100-page bound without silently truncating a selection.
