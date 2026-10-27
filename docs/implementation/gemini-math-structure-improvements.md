# Gemini mathematical PDF fidelity and structure

Implemented 27 October 2026 following the Chevalley and subgroup-counting live benchmarks. The implementation addresses response contracts, local checking and explicit recovery. It does not establish improved live-model accuracy: no additional paid generations were made during implementation.

## Provider and structure contracts

Gemini transcription responses declare `coordinateSystem: normalized_1000` and `origin: top-left` on every non-null approximate location. The adapter validates extent bounds and converts explicitly declared boxes to the core 0–1 format. Unspecified or unfamiliar units are never inferred from numeric ranges. Core/archived locations remain 0–1. Invalid hints retain source text and produce separate `layoutWarnings`.

The transcription and enrichment prompts share relation directions. `continues` points backwards to the preceding same-kind block, while a `continuation` relation goes earlier-to-later. Proof continuations are supported consistently. Redundant equivalent links are deduplicated; conflicting fresh proposals remain uncertain. Strict version-1 restore retains historical non-table continuation DAG compatibility.

Figures may include an optional diagram graph: source-quoted node labels, bounded local IDs, explicit directed/undirected edges and uncertainty. Validation rejects unknown endpoints, unsupported labels and duplicate connections; it does not claim optical or mathematical verification. Malformed optional provider graphs are omitted without replacing source text. Enrichment applies supported graphs to existing figure blocks only. Original page images and approximate placement remain the visual evidence.

## Mathematical fidelity and local annotations

The shared mathematical prompt explicitly distinguishes bars, hats, primes, accents, signs, subscripts and source punctuation. Printed errors are preserved; suspected source errors belong in review notes, not OCR corrections. The initial user payload no longer repeats the full system prompt.

Derived reading metadata records exact block-relative UTF-16 formula spans, inline/display role, explicitly printed equation tags, piecewise rows/conditions and decorated identifiers. KaTeX syntax status is separate from source fidelity. Review findings cover unreadable placeholders, malformed syntax, likely undelimited notation, bounded processing limits and a set-declaration/cardinality decoration mismatch. These are advisory source-review flags and never edits or proofs of a mathematical error. Scans and output collections are bounded. Source text, immutable IDs, citation ranges and authoritative content hashes remain unchanged. The derived document builder version is 8.

Offline replay over the retained Gemini benchmark outputs found 304 block formulas in the Chevalley result and 218 in the subgroup result. It identified the subgroup page-2 H/overline-H mismatch documented by the independent correctness review; the original KaTeX-only check accepted that formula. The subgroup result exposes 36 piecewise rows for inspection. These replay counts exclude synopsis formulas.

## Explicit repair and evidence

Fresh initial-transcription and targeted repair responses quote `original`, immediately adjacent `prefix`/`suffix`, replacement, category and reason. The server resolves a unique exact occurrence in the complete frozen block, verifies that quote and anchors fall inside the submitted snippet, and computes UTF-16 offsets locally. Repeats, ambiguous matches, malformed/split-surrogate strings, overlapping edits and unsupported categories fail closed. Retained legacy offset candidates retain strict exact-span validation.

An explicit published-source repair can prepare at most four owned-page visual crops. Each selected PDF page retains full-page context at left and a magnified approximate region at right. Other physical pages and their mapping remain unchanged. Missing geometry, unavailable rendering or a cropped PDF exceeding provider preflight limits use the original PDF as fallback. Pixel/byte bounds and cancellation apply.

The scheduler prepares the final PDF before budget checking and attempt creation. Its existing exact transmitted-PDF SHA256 therefore covers both context and crops. A versioned `evidence_json` manifest records page mapping, owned scope, crop rectangles, block IDs, algorithm and fallback before dispatch. Backup export/restore preserves and validates it. New repairs use `pdf-repair-2`; new extraction/enrichment prompts use `pdf-transcription-7` and `pdf-enrichment-2`. Clean initial ingestion still has no automatic second provider pass.

## Review presentation and compatibility

Page evidence and the comparison UI distinguish layout notes from transcription notes. A read-only projection separates the exact old machine coordinate warning in historical benchmark outputs while retaining any genuine glyph uncertainty; no stored extraction is migrated or rewritten. Layout warnings require structural review without triggering transcription repair. Mathematical review findings affect the math completion ledger. Legacy IR can omit the new optional diagram/layout fields.

Safari validation opened the existing subgroup benchmark and its PDF evidence panel, confirming the full source reading remained available and old coordinate warnings appeared under Layout notes. API/DOM tests cover separation, scope, deduplication and zero generation during inspection.

## Validation

- Production build: styles, application and test TypeScript, server compilation and Vite pass. Existing large-bundle warning remains.
- Focused checks cover geometry units/bounds, graph validity, direction/legacy restore, quotation ambiguity and Unicode, math annotation bounds, exact crop provenance and backup restore.
- Final complete suite: **2,297 tests; 2,289 passed, 8 platform/capability skips, 0 failed**, 189.8 seconds. `/tmp/noema-gemini-improvements-all-final.log`. The production build passed at the same final code state (`/tmp/noema-gemini-improvements-build-final.log`).
- Independent final focused review: 74 tests passed. These overlap the complete suite and are not additional totals.
- One existing Gemini HTTP test fixture was corrected to read the stable `user_input` content envelope used by the adapter; the rechecked initial-import/explicit-enrichment behavior passes.

The test manifest also registers two existing previously ungrouped tests (`document-provider-diagnostics` and `source-reader-math`) so the strict suite discovery gate runs them rather than failing before execution.
