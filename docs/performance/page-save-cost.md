# Page save cost: synthetic server measurements

Run `node --import tsx scripts/benchmark-page-save-cost.mjs`. To compare an unchanged checkout, set `SAVE_COST_ROOT=/absolute/baseline/path`; this selects the implementation while using the same synthetic fixture. The benchmark writes only a temporary database and synthetic PNG, removed on exit.

Baseline: `d85aaa6e52fe733b4f218af98463a29b6c7cfe41`. Environment: Linux x64, Node v24.19.0 cloud executor. Fixture: 1,001 blocks (including one image), 2,000 repeated mentions of one entity, 50 unrelated notes, five one-block text edits with unchanged image references.

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Image cleanup calls | 5 | 0 |
| Vault body scan queries | 5 | 0 |
| Note bodies scanned by cleanup | 260 | 0 |
| Entity SQL queries | 20,020 | 5 |
| Total Store SQL calls | 30,305 | 260 |
| Five-save elapsed time (ms) | 4,910.7 | 3,340.6 |
| New history rows | 5 | 5 |
| History snapshot bytes written | 1,880,520 | 1,880,520 |

Timings were single runs while other agents were active, so deterministic operation counts are stronger evidence than elapsed time. This is not a representative-device or browser responsiveness measurement. A changed image set still runs conservative cleanup when an old reference disappears; active notes, Trash, and history continue to guard candidate deletion. Global sweeps still scan current bodies, outside ordinary unchanged-image autosaves.

A mutation-local dictionary loads a narrow, vault-scoped entity projection once per distinct ID and shares it through validation, source offsets, fingerprints, AI provenance, domain assessment, and the response. Independent page reads also compute the concept fingerprint once. History capture returns its already constructed canonical snapshot rather than rereading and parsing it after insertion. No reference or history retention rules changed.

## History storage limitation and later proposal

The fixture modifies 45 text bytes across five saves but writes 1,880,520 bytes of complete immutable history snapshots: 41,789x amplification. This result supports investigating delta/checkpoint storage separately. This change deliberately preserves complete snapshots, atomic capture, checkpoints, backups, and reversible restore.

A follow-up design should compare compressed full snapshots with periodic checkpoints plus verified deltas; define bounded replay, checksums and corruption recovery; preserve protected provenance and exact image references; specify backup portability and reversible migration; and fault-test transaction/restore failures before migrating any existing history. No pruning, lossy coalescing, or migration is enabled here.

## Verification

`node --import tsx --test test/page-save-cost.test.mjs test/image-cleanup.test.mjs test/page-history.test.mjs test/page-history-backups.test.mjs`: 21 passed before adding the Unicode offset regression; the new save-cost suite then passed 3/3. Additional citation/source/history-path suites passed 28/28. The new tests cover unchanged image sets including reordering/duplicate removal, candidate removal retaining historical files, restoration, stale-save rejection without cleanup/history, repeated entity lookup bounds, and cross-vault rejection. Existing suites cover shared references, Trash, expiry, abandoned-upload grace, immutable history rollback, restored citations, and backup retention.
