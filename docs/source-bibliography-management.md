# Source-centred bibliography management

Publication identity belongs to a Source. The Sources Library keeps bulk bibliography import/export in More, while New source offers a single-entry BibTeX path alongside document creation. Both use the established parser, explicit duplicate decisions and legacy-property reconciliation.

Overview shows publication details and everyday citation actions. More citation options exposes locators and LaTeX, Pandoc and CSL representations. BibTeX and advanced controls expose source-scoped import/export, original data and field provenance, document matching and scholarly enrichment. Publication editing and DOI proposal review belong to the shared Source Metadata workspace. Connections → Cited works reviews references extracted from the work; those references do not become its publication identity.

## Scoped exchange contract

- `POST /api/bibliography/:sourceId/import-preview` takes `{raw}` and returns the explicit Source ID, current bibliography revision, raw batch fingerprint, parsed entry, field conflicts, preserved-property conflicts and parser warnings. Exactly one entry is required. Preview performs no canonical write or remote lookup.
- `POST /api/bibliography/:sourceId/import` takes the reviewed raw text, batch fingerprint, revision, explicit current/incoming choices for conflicting fields and fingerprinted authored-property approvals. It cannot create a Source or select a different match. It fills empty fields and changes conflicting values only after explicit review. Existing citation key and entry type are retained. Changed raw text, stale revisions, inaccessible Sources and unreviewed conflicts fail closed. Original imports and previous value provenance remain stored.
- `GET /api/bibliography/:sourceId/export` reads only the selected Source's canonical record and associated evidence. It returns the supported BibTeX, BibLaTeX, annotated and sidecar formats without listing the vault bibliography. A shared original bulk batch may contain unrelated entries; source-scoped sidecars omit that batch and report its omission. Full original evidence remains available in the vault, bulk export and backups.

These operations reuse canonical bibliography ownership, access checks, reconciliation and export formatting. There is no new database migration or second publication metadata store. DOI provider calls still require deliberate consent; local imports, exports and citation formatting perform no remote lookup.

Conflict review follows the Metadata field owner, including publication aliases such as date/year, journal/journaltitle and issue/number. An imported alias must not bypass a manual value by appearing to be a separate empty field. Scoped imports conservatively reject different values for two aliases in the same entry, including a full date paired with a year; correct the entry to one publication value before importing. Bulk import behavior is unchanged. DOI acceptance likewise updates the reviewed canonical field and records provider provenance and prior-value history.

## Compatibility

File-free `/cite`, bundled APA 7 and IEEE formatting, metadata-only Sources, stable citation keys, unknown imported fields, DOI proposals, authored-value history, scholarly review and backup identity remapping remain supported. Source switching aborts preview reads and rejects stale responses. Writes retain revision protection and must be refreshed after an uncertain result.

Validation uses disposable synthetic databases and mocked providers. The bibliography browser script exercises the redesigned entry points as well as persisted `/cite` and citation style changes. Backup tests include a reviewed scoped import, original raw evidence, provenance and remapped Source identity.

## Bibliography-only validation, 2026-10-27

Based on verified `main` `9a40c63` including PR #125, on local branch `codex/source-bibliography`. No push, PR, merge or deployment was performed.

- Full test suite: 2,116 passed, eight platform skips, zero failures. The last DOI refresh correction was subsequently checked in the final affected suite: 40/40 passed, with an additional independent delayed-refresh reproduction passing.
- Build includes styles, source/test TypeScript, server compilation and Vite; all passed. Vite retains its large-chunk advisory.
- Chromium 154 bibliography workflow passed keyboard overflow/modal focus, source switching during a delayed preview, single-entry creation and rejection, scoped conflict cancellation/acceptance/stale revision, source-only export requests, copy, real local acceptance of mocked DOI proposals, Cited works navigation, desktop/mobile light/dark, `/cite` save/reload and APA/IEEE persistence, browser binary backup/restore, canonical taxonomy review and scholarly exports. No page errors or external provider calls.
- The Source Metadata browser workflow passed canonical edits, separate display-name ownership, evidence/history, run filters, repeated navigation, no idle polling and desktop/mobile/dark layouts.
- Independent review found and verified fixes for alias conflict bypass, idempotence, stale views and pending-write/refresh races. No remaining concrete code blocker was found.
- Source Reader redesign browser validation remains failing at its existing editorial-version continuity assertion. The identical failure was reproduced on unmodified `main` `9a40c63` using corrected custom-Select interaction; no reader product code was changed here.

Local evidence: `/tmp/noema-bibliography-evidence/validation.json`, `/tmp/noema-source-metadata-evidence/validation.json`, screenshots in those directories, `/tmp/noema-testall-final-validation.log`, and `/tmp/noema-source-main-browser-validation.log`. This was the pre-integration checkpoint; combined results follow.

## Combined optimization checkpoint

Optimization head `87684867a2be3be801bf1716e0d3d4e166f2e0e0` was fetched, verified and locally merged as `4e5589a`. The only conflict was an EntityPanel import block; both imports were retained. Pending request/cache access epochs, compact status reads, lazy boundaries, bounded-then-full EntityHome loading and reading-version/Review separation were preserved. No source-reader production fixes were made here.

- Combined full suite: **2,163 tests; 2,155 passed, zero failed, eight skipped**, 257,747 ms. Build/style/type/server/Vite checks passed.
- Independent combined review: **106/106** focused tests passed; no concrete integration blocker found.
- Bibliography and Metadata browser workflows passed again on the merged product, including all documented source-scoped exchange, DOI, citation, focus, mobile/theme and browser backup/restore checks.
- Navigation probe passed protected startup, cached return, bounded overview, locked vault switching, selected editorial reading-version reload through its compact endpoint without another full comparison fetch, and mobile/error/external-request checks. Evidence: `output/navigation-loading/combined/`.
- Dedicated reading continuity passed all 11 behavior categories, including exact anchors across backend/browser restart, retries, flush and mobile. Reprocessing passed all six viewport/theme combinations.
- Editor, entity-linking, selection-toolbar, entity-scan, Document Find, Calendar, Chat and Chat research browser scripts passed individually. The first broad runner retained three failures: selection attempted before the editor became editable; Document Find compared transient unrelated enrichment status; Calendar used obsolete inline presentation buttons. Corrections wait for actual editor/fixture readiness and use the current menu roles while preserving full equality, selection, geometry, evidence, focus and Escape assertions. Successful reruns do not retroactively make that initial broad invocation green.
- The older Source Reader redesign fixture was aligned with compact inventory and reading endpoints. Its original editorial-continuity assertion still fails identically to baseline main; it remains a failure, despite the dedicated continuity suite passing.

Combined evidence is in `/tmp/noema-combined-testall.log`, `/tmp/noema-combined-build.log`, `/tmp/noema-combined-*-browser.log`, `/tmp/noema-combined-bibliography-evidence/`, `/tmp/noema-combined-metadata-evidence/` and `/tmp/noema-combined-reading-evidence/`. These checkpoint results apply to `87684867`; the final updated-head integration is recorded below.

## Final updated-head integration and verification

Exact published optimization head **`75a792bc8d7e1abec420886e7cba6324c2aef150`**, including main **`f08df4a`**, was verified and locally merged as `7ee60c8`. Both are verified ancestors. Source creation retains immediate PDF provider controls alongside BibTeX creation. Metadata retains main's explicit non-conflicting bulk review alongside canonical DOI review and pending/uncertain-write guards. Reader, review, compact transport, shared request cache and sidebar production files remain identical to the final optimization head.

The final publication-editor preservation fix, `ad2eab2`, restores multiline abstract textareas for manual editing and suggestion corrections. Exact paragraph breaks are verified through the form, HTTP payload, canonical response, database and reopening; provenance, fingerprints and write guards are unchanged.

- **Full suite after the final production correction: 2,363 tests; 2,353 passed, zero failed, ten skipped**, 191,969 ms. Skips cover macOS Keychain/PDF/native admission paths and model-dependent Kokoro synthesis. Log: `/tmp/noema-verified-testall.log`.
- **Build passed:** CSS ownership, source/test TypeScript, server compile and Vite. Log: `/tmp/noema-verified-build.log`. The existing large-entry advisory remains.
- **Independent review:** 156 integration checks passed, followed by 22 affected Metadata/bibliography UI checks after the abstract fix. These sets overlap and are not an additional aggregate test count. No remaining concrete production blocker was found. The corrected Chat research transport also passed its four isolation/counting tests independently.
- **Complete bibliography functional matrix:** all 24 categories passed separately at 1440×1000 light, 1440×1000 dark, 390×844 light and 390×844 dark. Mobile runs use mobile/touch contexts; assertions verify actual viewport and theme. Each run exercises overflow import/export, single-entry creation/rejection, scoped conflict cancel/accept/stale revision, canonical Metadata and multiline editing, DOI selected acceptance, copy/export, Cited works, `/cite` save/reload and styles, browser binary backup/restore, keyboard focus and source switching during preview. Each error list is empty.
- **Other browser checks:** Metadata, navigation/loading, all 11 reading-continuity categories, all six reprocessing viewport/theme combinations, and 32 PDF-ingestion checks passed. PDF checks cover mocked OpenAI/Gemini at desktop/mobile sizes with 12 mocked generation calls and zero live calls. Dedicated reader checks preserve exact persisted anchors and selected-version restoration without full comparison fetches.
- **Broad browser coverage:** editor, continuity, entity-linking, selection-toolbar, entity-scan, Document Find, Calendar, Chat and Chat research all passed on the final production code through recorded segmented runs. The last broad invocation passed through Calendar, then stopped at Chat's stale mock prefix. Chat and Chat research subsequently passed all four of their viewport/theme variants after their mocks were aligned with current main's Meno prompt; all neutrality, evidence, untrusted-input, no-tools/no-storage and unexpected-dispatch checks remain. There is **no claim of one uninterrupted green `npm run test:browser` invocation**.

Browser fixture corrections retain the original behavioral assertions. They use current provider radios and anchored proposal quotations, catch only the known closed-page diagnostic teardown, wait for editable startup state, use current presentation-menu roles, and isolate automatic enrichment in the disposable Document Find fixture. Both its JavaScript scheduler and SQLite-triggered queue are isolated; real HTTP handlers, authored updates, index cleanup and exact whole-record equality assertions remain. Interrupted runs and timeout screenshots are retained. No production deadline, protection or source-reader contract was relaxed to make tests pass.

**Remaining baseline failure:** the extra `check-source-redesign-browser.mjs` still fails its preserved assertion that editorial reading continuity tools are absent (actual one, expected zero). This was reproduced on unmodified main `9a40c63` and persists after final integration. It is not counted as a pass; the dedicated current continuity suite passes independently. No bibliography-specific fix was made to this reader behavior.

Functional matrix evidence: `/tmp/noema-bib-matrix-{1440-light,1440-dark,390-light,390-dark}/validation.json`, screenshots in those directories and corresponding `.log` files. Additional final evidence: `/tmp/noema-verified-bibliography-evidence/`, `/tmp/noema-verified-metadata-evidence/`, `/tmp/noema-final-*-browser.log`, `/tmp/noema-verified-browser-suite-final.log`, `/tmp/noema-verified-chat-aligned.log`, `/tmp/noema-verified-chat-research-aligned.log`, `output/navigation-loading/`, and `output/pdf-ingestion-browser/validation.json`.

No live user vault, credentials, paid provider, external DOI lookup, representative-device performance or macOS native execution was used for validation. All work remains in local commits; no bibliography push, PR creation, remote merge or deployment was performed. Final integration is complete; the earlier pending-head checkpoint is superseded by this section.
