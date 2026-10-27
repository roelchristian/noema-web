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

Combined evidence is in `/tmp/noema-combined-testall.log`, `/tmp/noema-combined-build.log`, `/tmp/noema-combined-*-browser.log`, `/tmp/noema-combined-bibliography-evidence/`, `/tmp/noema-combined-metadata-evidence/` and `/tmp/noema-combined-reading-evidence/`. No representative-device performance, native macOS execution, live provider work or deployment was performed. Final sign-off is pending the parent-verified updated optimization head that reconciles intervening main changes; these results apply to the exact `87684867` integration above.
