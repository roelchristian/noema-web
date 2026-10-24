# Bibliographic intelligence: implementation and review

Local implementation branch: `codex/bibliographic-intelligence`. This branch is prepared for draft review; no deployment or live user-data migration was performed. Inbox Activity #90 (`ce6101786de7a31c61cff0ad846681d369e255a7`) is included. The final integration incorporates #91 source-page language and draft-navigation changes and upstream Source Viewer #92 at main `8159f83d76138e6003c61eab25c14a8b6a659c4d`. Existing #89 and Settings #88 changes are preserved. The supplied Library text was used directly; it was not downloaded.

## Delivered phases

| Phase | Usable behavior | Limits |
| --- | --- | --- |
| 1 | Sources import BibTeX/BibLaTeX through an explicit per-field review table; metadata-only Sources; ordered creator parsing; stable keys; editor; field provenance and prior authored-value history; unknown fields; exact original batches; deterministic export; scoped identifier matching and atomic idempotent merge; canonical read-only property projections with fingerprinted legacy reconciliation | New-source modal still expects a document; metadata-only creation uses bibliography import. Canonical bibliography fields expose managed property projections; pre-existing authored rows remain immutable evidence. Fields outside the supported projection map remain ordinary properties. |
| 2 | DOI-only, explicitly consented Crossref then DataCite verification; selected-field acceptance; stale revision checks; bounded response/cache/concurrency/timeouts/backoff; activity events in existing Inbox Activity; attach PDF directly to the same Source; inspect local matching evidence | Per-request consent, not a persistent remote lookup policy. DOI proposals are source-local, not Inbox review rows (attempts appear in Activity). No ISBN/arXiv resolver, fuzzy title search, OpenAlex graph lookup, or reassignment of another Source's attachment. Existing Source processing settings apply to uploaded PDFs. |
| 3 | On-demand scholarly synopsis, separately reviewed canonical discipline assignments, existing concept links and work relationship proposals; existing provider, activity, notifications and property review; consent, document/target freshness, exact quote validation, deduplication by document/metadata/model fingerprint | Requires processed document; no metadata-only intellectual synopsis. Synopsis acceptance never implies taxonomy acceptance: separate Domain-ID proposals apply additively after fresh review. No automatic bulk enrichment or metadata recovery request. |
| 4 | Separate file-free `/cite` publication citations with page/chapter/section locators; editor DOM/save/reload/history/backup preservation; one bibliography entry per Source; live local citeproc APA7 author-date/IEEE numerical inline citations and bibliographies, retroactive disambiguation, per-note style preference and local metadata-refresh events; CSL JSON, LaTeX and Pandoc copy tools; reviewed annotated BibLaTeX and enriched JSON sidecar | No footnote rendering or Chicago/MLA selector. BibTeX/BibLaTeX preserve canonical fields rather than performing destructive type/field conversion. CSL field mapping is intentionally limited; complex TeX publication titles and uncommon entry/date semantics require further fidelity work. |
| 5 | Local extraction from explicitly headed reference lists; original text/line evidence; exact DOI candidates; user-verified title before provisional Source import; deterministic retry identity; explicit reviewed cites/translation/edition/commentary/response/influence links; existing Source navigation | Conservative heuristic extraction, not automatic reference identification. No footnote extraction, remote discovery, automatic editions/work creation, concept-driven scholarly graph ranking, or full-text inference about cited works. |

These are five bounded implementations, not completion of every ambition in the brief. Standard exports carry canonical bibliographic facts only. AI synopsis does not become a publication abstract. The version-2 JSON sidecar carries bibliographic facts, provenance/history, reviewed scholarly proposals, accepted properties, canonical versus suggested classifications, work relationships and deduplicated raw batches. Annotated export includes only current accepted scholarly text in a clearly labelled annotation, with canonical reviewed disciplinary keywords; publication abstracts and authored annotations remain distinct.

## Storage and compatibility

`bibliographic_records` belongs to an existing Source ID. `bibliographic_import_batches` stores an exact batch once per SHA-256/vault, avoiding amplification on thousand-entry imports. `bibliographic_proposals` holds revision-bound DOI proposals. Migrations are additive. Backup export/restore validates batch hashes, source scope, provenance and review revisions; older archives omit these tables safely. Raw imports remain immutable evidence; canonical exports normalize field order and resolve macros/crossrefs, so use original-data evidence for byte-exact archival recovery.

`TextStyle.bibliographicReference` is additive: `{id, sourceId, locator?, label?}`. Existing `sourceReference` file/hash/range anchors are unchanged. Current and historical backup remapping preserves the two citation kinds independently. No SourceDocumentView, reader version selection, editorial autoacceptance, or unrelated reprocessing design was changed; those belong to the separate Source Viewer task.

## Privacy and validation

Import/export/local extraction perform no remote lookup. A DOI lookup discloses only its normalized DOI to fixed HTTPS provider origins, with redirects rejected. Scholarly context explicitly discloses document excerpts, bibliography and existing concept/work names to the configured provider; this may cost money when the user invokes it. Development tests use synthetic in-memory/disposable databases and mocked services. No credentials or live vaults are required.

Focused follow-ups preserved the original five commits: canonical property projection and field-level conflict review; reviewed scholarly exports; canonical Source taxonomy; and live inline CSL rendering.

Build includes style ownership, source/test TypeScript, server compile and Vite. Focused tests cover parser round-trips, macros/corporate creators/historical dates/unknown fields, conflict/retry/idempotence, cancellation/stale responses, consent, exact DOI mismatch, rate limiting, PDF evidence, old backups, historical citation identity and atomic rollback. Browser script `scripts/check-bibliography-browser.mjs` uses system Chromium and an externally installed Playwright harness; external network and real AI calls are blocked. Independent backend/UI/parser and review agents examined the changes. A synthetic thousand-entry import stored one raw batch and completed in approximately 4.4 seconds in the independent review run.

Run `npm run build`, `npm run test:all`, then `PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node --import tsx scripts/check-bibliography-browser.mjs`. Existing editor and Inbox browser harnesses provide additional regression checks.

## Recorded validation

- Original five-phase committed-code full suite: 1,278 passed, 7 platform skips, zero failures. Focused metadata/HTTP run: 8/8, including the current DataCite object-publisher fixture.
- Publication integration on main including #92: **1,307 passed, 7 platform skips, zero failures**; build/style/type checks and both bibliography/Source Viewer browser workflows passed.
- Latest-main follow-up full suite: **1,293 passed, 7 platform skips, zero failures** after incorporating #91. Final build/style/type checks passed.
- Follow-up commits: `8dc4d92` canonical projections/conflict review, `a8629bf` canonical taxonomy, `f792103` scholarly exports, `f1d53d0` live inline CSL. The original five commits remain unchanged.
- Independent follow-up review: 34 focused adversarial tests passed; final review found no concrete blockers.
- Phase snapshots: phase 1 typechecks + 6 focused tests; phase 2 typechecks + 10 tests; phase 3 typechecks + 13 tests; phase 4 typechecks + 7 tests all passed independently of later phases.
- Build/style/source and test types/server compile/Vite passed. Vite reports its existing large-chunk advisory.
- Independent final security/backend/backup/reference review: 14/14 passed before the additional metadata fixture; no blocking finding.
- Chromium 154 bibliography workflow passed cancellation, repeat import, per-field conflicts, authored-property reconciliation, consent/selected-field review, mobile layout, publication citation save/reload, live inline CSL/style persistence, source association, canonical taxonomy acceptance with stale-preview refresh, and reviewed scholarly export. The Inbox browser harness passed with no page errors. The editor harness timed out during initial fixture loading under concurrent validation, then passed unchanged when rerun alone (typing/caret, undo/redo, split/merge, paste, selection, IME and entity changes).
- Evidence produced locally in `/tmp/noema-bibliography-evidence/validation.json` and screenshots alongside it; the reproducible browser harness is committed.

## Source Viewer task compatibility

PR #92 was merged upstream by its owner at `8159f83d76138e6003c61eab25c14a8b6a659c4d`, then incorporated into this feature branch without rewriting its five original phase commits. No action here merged or modified that PR. The common reader navigation test retains bibliography's `/api/bibliography/source` null fixture and the reader's optional inspector expectations. The combined build, full suite, bibliography browser workflow and Source Viewer redesign browser all pass. Independent integration review passed 61 focused tests covering Info access, metadata-only Sources, canonical passage identity and backup compatibility. Bibliographic citations remain independent of the canonical/editorial passage identity contract.

## Official references inspected

- Parser API and scanner representation: https://retorque.re/bibtex-parser/ (actual installed `@retorquere/bibtex-parser` 12.1.13 evaluated with synthetic inputs and shipped types).
- Crossref REST API: https://www.crossref.org/documentation/retrieve-metadata/rest-api/ (including its documented single-record endpoint); older https://github.com/CrossRef/rest-api-doc is deprecated.
- DataCite API: https://support.datacite.org/docs/api-queries and https://support.datacite.org/docs/api-get-doi .
- CSL specification: https://docs.citationstyles.org/en/stable/specification.html .
- citeproc-js: https://citeproc-js.readthedocs.io/en/latest/running.html (`citeproc` 2.4.63); bundled CSL style/locale attribution is retained in `src/shared/csl/README.md` and XML assets. No styles fetched at runtime.
