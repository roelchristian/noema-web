# Bibliographic intelligence: implementation and review

Local implementation branch: `codex/bibliographic-intelligence`. No push, PR, deployment, or live user-data migration was performed. Main through Inbox Activity #90 (`ce6101786de7a31c61cff0ad846681d369e255a7`) is included. Existing #89 and Settings #88 changes are preserved. The supplied Library text was used directly; it was not downloaded.

## Delivered phases

| Phase | Usable behavior | Limits |
| --- | --- | --- |
| 1 | Sources import BibTeX/BibLaTeX through an explicit review table; metadata-only Sources; ordered creator parsing; stable keys; editor; field provenance; unknown fields; exact original batches; deterministic export; scoped identifier matching and atomic idempotent merge | Conflicting imported fields retain canonical values and exact raw evidence; no per-field import conflict editor. New-source modal still expects a document; metadata-only creation uses bibliography import. Ordinary DOI/ISBN property projection is incomplete: existing authored identifiers participate in matching and conflicting canonical writes are blocked, but property edits are not synchronized. |
| 2 | DOI-only, explicitly consented Crossref then DataCite verification; selected-field acceptance; stale revision checks; bounded response/cache/concurrency/timeouts/backoff; activity events in existing Inbox Activity; attach PDF directly to the same Source; inspect local matching evidence | Per-request consent, not a persistent remote lookup policy. DOI proposals are source-local, not Inbox review rows (attempts appear in Activity). No ISBN/arXiv resolver, fuzzy title search, OpenAlex graph lookup, or reassignment of another Source's attachment. Existing Source processing settings apply to uploaded PDFs. |
| 3 | On-demand scholarly synopsis, evidence-bearing discipline IDs, existing concept links and work relationship proposals; existing provider, activity, notifications and property review; consent, document/target freshness, exact quote validation, deduplication by document/metadata/model fingerprint | Requires processed document; no metadata-only intellectual synopsis. Discipline IDs remain part of reviewed synopsis data; no canonical taxonomy assignment. No automatic bulk enrichment or metadata recovery request. |
| 4 | Separate file-free `/cite` publication citations with locators; editor DOM/save/reload/history/backup preservation; one bibliography entry per Source; local citeproc APA7/IEEE bibliographies; CSL JSON, LaTeX and Pandoc copy tools | Inline chips retain neutral Source labels rather than dynamic author-date/numeric CSL styling. No footnote rendering, Chicago/MLA selector, or persisted style preference. BibLaTeX-specific export conversion and reviewed annotated exports are unfinished. CSL field mapping is intentionally limited; complex TeX publication titles and uncommon entry/date semantics require further fidelity work. |
| 5 | Local extraction from explicitly headed reference lists; original text/line evidence; exact DOI candidates; user-verified title before provisional Source import; deterministic retry identity; explicit reviewed cites/translation/edition/commentary/response/influence links; existing Source navigation | Conservative heuristic extraction, not automatic reference identification. No footnote extraction, remote discovery, automatic editions/work creation, concept-driven scholarly graph ranking, or full-text inference about cited works. |

These are five bounded implementations, not completion of every ambition in the brief. Standard exports carry canonical bibliographic facts only. AI synopsis does not become a publication abstract. The JSON sidecar currently carries bibliographic facts, provenance and shared raw batches; it does not yet serialize reviewed scholarly proposals/relationships.

## Storage and compatibility

`bibliographic_records` belongs to an existing Source ID. `bibliographic_import_batches` stores an exact batch once per SHA-256/vault, avoiding amplification on thousand-entry imports. `bibliographic_proposals` holds revision-bound DOI proposals. Migrations are additive. Backup export/restore validates batch hashes, source scope, provenance and review revisions; older archives omit these tables safely. Raw imports remain immutable evidence; canonical exports normalize field order and resolve macros/crossrefs, so use original-data evidence for byte-exact archival recovery.

`TextStyle.bibliographicReference` is additive: `{id, sourceId, locator?, label?}`. Existing `sourceReference` file/hash/range anchors are unchanged. Current and historical backup remapping preserves the two citation kinds independently. No SourceDocumentView, reader version selection, editorial autoacceptance, or unrelated reprocessing design was changed; those belong to the separate Source Viewer task.

## Privacy and validation

Import/export/local extraction perform no remote lookup. A DOI lookup discloses only its normalized DOI to fixed HTTPS provider origins, with redirects rejected. Scholarly context explicitly discloses document excerpts, bibliography and existing concept/work names to the configured provider; this may cost money when the user invokes it. Development tests use synthetic in-memory/disposable databases and mocked services. No credentials or live vaults are required.

Build includes style ownership, source/test TypeScript, server compile and Vite. Focused tests cover parser round-trips, macros/corporate creators/historical dates/unknown fields, conflict/retry/idempotence, cancellation/stale responses, consent, exact DOI mismatch, rate limiting, PDF evidence, old backups, historical citation identity and atomic rollback. Browser script `scripts/check-bibliography-browser.mjs` uses system Chromium and an externally installed Playwright harness; external network and real AI calls are blocked. Independent backend/UI/parser and review agents examined the changes. A synthetic thousand-entry import stored one raw batch and completed in approximately 4.4 seconds in the independent review run.

Run `npm run build`, `npm run test:all`, then `PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node --import tsx scripts/check-bibliography-browser.mjs`. Existing editor and Inbox browser harnesses provide additional regression checks.

## Recorded validation

- Final committed-code full suite: 1,278 passed, 7 platform skips, zero failures. Focused metadata/HTTP run: 8/8, including the current DataCite object-publisher fixture.
- Phase snapshots: phase 1 typechecks + 6 focused tests; phase 2 typechecks + 10 tests; phase 3 typechecks + 13 tests; phase 4 typechecks + 7 tests all passed independently of later phases.
- Build/style/source and test types/server compile/Vite passed. Vite reports its existing large-chunk advisory.
- Independent final security/backend/backup/reference review: 14/14 passed before the additional metadata fixture; no blocking finding.
- Chromium 154 bibliography workflow passed cancellation, repeat import, consent/selected-field review, mobile layout, publication citation save/reload, source association and CSL style selection. Existing editor and Inbox browser harnesses passed with no page errors.
- Evidence produced locally in `/tmp/noema-bibliography-evidence/validation.json` and screenshots alongside it; the reproducible browser harness is committed.

## Official references inspected

- Parser API and scanner representation: https://retorque.re/bibtex-parser/ (actual installed `@retorquere/bibtex-parser` 12.1.13 evaluated with synthetic inputs and shipped types).
- Crossref REST API: https://www.crossref.org/documentation/retrieve-metadata/rest-api/ (including its documented single-record endpoint); older https://github.com/CrossRef/rest-api-doc is deprecated.
- DataCite API: https://support.datacite.org/docs/api-queries and https://support.datacite.org/docs/api-get-doi .
- CSL specification: https://docs.citationstyles.org/en/stable/specification.html .
- citeproc-js: https://citeproc-js.readthedocs.io/en/latest/running.html (`citeproc` 2.4.63); bundled CSL style/locale attribution is retained in `src/shared/csl/README.md` and XML assets. No styles fetched at runtime.
