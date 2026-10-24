# Source metadata reconciliation

The Source inspector and Source homepage embed the same `SourceMetadata` workspace. Overview links to it; Inbox property decisions and editorial processing summaries open that workspace with the saved proposal or extraction-run context. General entity connections remain owned by the entity workflow.

## Owners and review

- `source:display_name` updates the Source entity without changing its publication title or citation key.
- `bibliography:*` dispatches to `Bibliography.save`; its projections are never copied into ordinary properties. Ordered credited creator text remains bibliographic evidence. Resolved creator references are separate knowledge assertions. Credited author/editor/translator updates offer uniquely matched existing active identities for explicit review, while ambiguous names remain unresolved and no new entities are created.
- Existing entity properties keep their canonical knowledge owner. Literal legacy publication properties appear as preserved authored values alongside the publication field; explicit acknowledgement retains them during bibliographic reconciliation.
- Attachment import URLs update only the attached `source_files` record. Attachment language/format are read-only extraction facts.

Metadata candidates extend `property_proposals` through `source_metadata_candidates`, rather than using editorial patches or a second review store. Decisions preserve extracted values and corrected accepted values separately. Bibliographic manual/import history and proposal evidence are available in field disclosures. The legacy property reviewer rejects publication writes that would bypass canonical ownership.

Compatible batch acceptance first validates all reviewed fingerprints, then writes in one SQLite transaction. An owner failure rolls back canonical records and proposal decisions. Existing/manual values, competing candidates, changed targets and stale evidence require attention. Repeating an accepted batch is idempotent. Matching extractions add supporting evidence without another pending decision; obsolete evidence can supersede a pending proposal without deleting its history.

## Extraction and policy

Metadata policy is per Source: `review` by default or `fill_validated_empty`. It is independent from editorial text acceptance. Only deterministically validated, current evidence for an empty unprotected field is eligible for automatic filling. Confidence is never an acceptance criterion.

Extraction examines a bounded initial title/imprint region once per document pass. Explicit field and creator-role labels are checked in a publication-title context; references, contents, forewords and ordinary prose end the region. Identifier checks and exact date precision prevent guessed publication facts. This deterministic pass makes **no additional provider requests** and never repeats full metadata extraction for each editorial chunk. Results are cached by the actual evidence region, publication title and validator version. Accepted editorial changes to that region can register additional derivative candidates; unrelated body changes do not trigger another metadata reconciliation.

## Reprocessing integration contract

`SourceMetadataExtraction.process(vault, sourceId, revision, version = 'canonical')` is the document-level integration hook. It returns `{candidateCount, added, corroborated, requiresReview, cacheHit, evidenceHash}`. `SourceReprocessing.reconcileMetadata` checkpoints those counts into `revision.report.metadata` once for the canonical pass and after an accepted derivative changes the imprint region. Persist the editorial revision before registering derivative evidence so its run/version can be verified.

The lower-level `SourceMetadata.registerCandidate(vault, sourceId, candidate)` accepts the shared `MetadataCandidate` contract: `fieldKey`, `value`, `fileId`, `runId`, `version`, `revision`, `excerpt`, `start`, `end`, `evidenceHash`, `validated`, `validationReason`. The document/version revision is a SHA-256 text fingerprint, the evidence fingerprint hashes the exact excerpt, and offsets are original zero-based UTF-16, end-exclusive coordinates. Deterministic publication validation belongs before registration; registration rechecks evidence and current canonical ownership. Its `registrationOutcome` distinguishes a changed field, existing satisfaction, pending review, and ignored history. Reprocessing V2 should reuse these hooks and the metadata sidecars/cache, rather than introduce per-chunk metadata extraction or another candidate store.

Relevant integration files are `src/shared/source-metadata.ts`, `src/server/modules/source-metadata-extraction.ts`, `src/server/modules/source-metadata.ts`, `src/server/modules/source-metadata-evidence.ts`, `src/server/modules/source-metadata-schema.ts`, `src/server/modules/source-reprocessing.ts`, `src/server/runtime.ts`, and `src/shared/source-reprocessing.ts`. UI run links dispatch `noema:open-source-metadata` with `{vaultId, sourceId, runId}`. `SourceMetadata` supports contextual embedding with `{vaultId, sourceId, density, proposalId, runId, onUpdated}`; Source-only mounting currently resides in `EntityHome` and `EntityPanel`, with inspector navigation in `App`.

## Evidence and persistence

Canonical extraction text and citation coordinates are never rewritten. A proposal retains its original excerpt, offsets, content fingerprint, attachment, run and version. Freshness requires unique exact supporting evidence and an unchanged target. Missing, changed or ambiguous support fails closed. Reader jumps map verified evidence to an existing reader node; they do not invent canonical anchors for derivative text.

Metadata sidecars, decisions and policies participate in backups and vault-deletion impact checks. Restores validate references, remap owners/runs, preserve already-stale target decisions and safely rebind unchanged targets. Old backups without these tables default to review. Disposable extraction caches are validated then discarded on restore; no restored archive starts provider work.

## Scope and retained controls

The extractor intentionally does not infer unlabeled, multilingual, or distant copyright/colophon facts. Such facts can still be entered manually. Ambiguous identities are not created or guessed. Advanced bibliography import/export, DOI lookup consent, citation-key/entry-type editing, multi-value typed property/reference editing and attachment lifecycle controls remain with their existing editors. Those controls have not been removed without equivalent coverage. A restored candidate involving legacy preserved property identities can conservatively require a fresh extraction rather than silently rebinding an uncertain target.

## Validation

Use only disposable synthetic databases and mock providers:

```sh
npm run build
node --import tsx --test test/source-metadata.test.mjs test/source-metadata-ui.test.mjs test/source-metadata-provenance.test.mjs test/source-reprocessing.test.mjs test/review-centre.test.mjs
npm run test:all
node --import tsx scripts/check-source-metadata-browser.mjs
node --import tsx scripts/check-bibliography-browser.mjs
node --import tsx scripts/check-source-redesign-browser.mjs
```

The focused tests consolidate owner protection, rollback, fingerprint races, idempotence, stale/ambiguous evidence, corroboration, interrupted replay, derivative provenance, backup migration and repeated UI navigation. The metadata browser check blocks external requests, injects no credentials, checks desktop/mobile/dark layouts, verifies canonical writes and metadata run filters, and checks that the workspace does not poll metadata while idle. `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, and `NOEMA_SCREENSHOTS` can select a local browser/tool install and evidence directory without changing application dependencies.
