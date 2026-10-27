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

## Local validation, 2026-10-27

Based on verified `main` `9a40c63` including PR #125, on local branch `codex/source-bibliography`. No push, PR, merge or deployment was performed.

- Full test suite: 2,116 passed, eight platform skips, zero failures. The last DOI refresh correction was subsequently checked in the final affected suite: 40/40 passed, with an additional independent delayed-refresh reproduction passing.
- Build includes styles, source/test TypeScript, server compilation and Vite; all passed. Vite retains its large-chunk advisory.
- Chromium 154 bibliography workflow passed keyboard overflow/modal focus, source switching during a delayed preview, single-entry creation and rejection, scoped conflict cancellation/acceptance/stale revision, source-only export requests, copy, real local acceptance of mocked DOI proposals, Cited works navigation, desktop/mobile light/dark, `/cite` save/reload and APA/IEEE persistence, browser binary backup/restore, canonical taxonomy review and scholarly exports. No page errors or external provider calls.
- The Source Metadata browser workflow passed canonical edits, separate display-name ownership, evidence/history, run filters, repeated navigation, no idle polling and desktop/mobile/dark layouts.
- Independent review found and verified fixes for alias conflict bypass, idempotence, stale views and pending-write/refresh races. No remaining concrete code blocker was found.
- Source Reader redesign browser validation remains failing at its existing editorial-version continuity assertion. The identical failure was reproduced on unmodified `main` `9a40c63` using corrected custom-Select interaction; no reader product code was changed here.

Local evidence: `/tmp/noema-bibliography-evidence/validation.json`, `/tmp/noema-source-metadata-evidence/validation.json`, screenshots in those directories, `/tmp/noema-testall-final-validation.log`, and `/tmp/noema-source-main-browser-validation.log`. Integration with the separate optimization task is pending publication of its branch; the checks above do not claim combined-branch coverage.
