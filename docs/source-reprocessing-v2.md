# Source Reprocessing V2 implementation record

Based on the supplied 161-line design brief dated 25 October 2026. The linked 471-line specification remains unavailable and has not been read. The six original phases started at main `9b6fecc` (#92, #95–97) and remain unchanged. The publication branch integrates authoritative main through `a0667a7`, including #98 pricing, #99 connections, #100 toolbar, merged Source Metadata #101 (`82c8f21`), settings refresh #103 and Source view #102. V2 is draft-review work; no V2 merge or deployment is requested.

## Phase commits and dependencies

| Phase | Commit |
| --- | --- |
| 1: independent depth/review contracts | `c8a9881` |
| 2: durable chunks, passes, backups | `0ef2411` |
| 3: mandatory multi-pass execution | `1e47637` |
| 4: evidence gates and restore recovery | `547518f` |
| 5: scholarly groups and reversible furniture | `a3841b4` |
| 6: reader/review UI and synthetic validation | `60329e3` |

`97f6ee5` adds supported original-page/OCR adapters, consent, provenance and geometry validation. Publication branch `feat/source-reprocessing-v2` starts from that V2 history and integrates actual main in `1ccacef` and `e192ef7`; `a183b14` retains the final V2 metadata lifecycle/progress changes. Source Metadata owner commits `0ee9502`, `5e7a378`, `f9d863f` are inherited through merged #101. Temporary local dependency cherry-picks remain only on the retained local integration branch `source-reprocessing-v2`; they are absent from publication history. The PR diff contains no duplicate metadata-owner modules, UI, schema, cache or canonical-store changes. No metadata branch was modified.

## Execution and recovery

- Balanced Reconstruction and Verified are separate defaults. Light needs one successful model request per eligible chunk, Balanced exactly two even when unchanged, Deep two or three with a persisted third-pass reason. Local validation never counts as a model pass.
- Noema owns canonical block IDs and computes UTF-16 differences. Models return complete blocks in canonical order. Missing/reordered/unknown blocks fail closed. This implementation preserves block boundaries; cross-block rearrangement is limited.
- Canonical extraction, page coordinates and citation anchors are immutable. Accepted changes create a derivative. Linked scholarly apparatus changes form atomic decision groups; furniture visibility uses reversible presentation controls retaining canonical DOM anchors.
- Requests are reserved before dispatch. Actual results, configuration, prompt version and usage are durable before parsing or the next pass. A failed Pass 2 never publishes Pass 1. Successful caches are reused; invalid successful output stays durable and is not charged again. Uncertain requests cannot silently resume or repeat.
- Prompt version `source-reconstruction-v2-2` records the expanded evidence input contract; older incompatible V2 requests fail closed. V1 revisions and policies keep their historical behavior.

## Supported original-source evidence

The implemented adapter connects `SourceFiles.reprocessingEvidenceBinding`, `SourcePageImages`, and separate native PDFKit layout and Vision raster OCR workers. It checks actual preserved-original/admitted byte hashes, canonical normalization maps, page identity, extractor provenance, OCR configuration/confidence/alternatives and geometry. Hashes are checked during collection and before/after paid stages and publication. Missing or changed mappings fail closed.

Local OCR defaults on when that admitted source/device supports it; explicit optout is preserved. Original-page comparison remains opt-in. Supplemental OCR text and images are omitted from provider requests without explicit per-run transmission consent. Images use a separate multimodal provider input and are redacted from full debug traces. Image capability is explicit, currently verified for GPT-5 Mini; structured JSON support alone never enables images. [Model capability source](https://developers.openai.com/api/docs/models/gpt-5-mini).

Fresh evidence is collected and checkpointed for all chunks before paid requests. Restart and backup/import reuse the exact snapshot without rerunning native OCR. PNGs are capped at 2 MiB each; serialized evidence at 24 MiB per revision, checked before paid execution. Native/cache concurrency and cache memory are bounded; cancellation and shutdown stop workers or settle shared-render waits promptly. Local preparation progress is visible.

Verified may accept narrow ligature/rn-to-m extraction repairs or soft wraps only with exact contextual mapping, trusted initial native extraction, current extractor provenance, and matching unrotated admitted-page PDFKit/OCR regions with strong overlap. High confidence or another AI approval alone is insufficient. Quotations, mathematics, bibliography contexts, substantive rewrites, ambiguous alternatives, repeated/incorrect regions, rotated/raster-only layouts and same-engine OCR stay pending. Imported proofs are explicitly untrusted for new automatic acceptance without changing the evidence/request hashes; existing saved reading decisions survive restoration.

The native execution dependency is **macOS with PDFKit, AppKit, Vision, Swift Command Line Tools and sandbox-exec**. This Linux environment cannot compile or execute those frameworks. TXT/MD, legacy PDFs missing preserved evidence, and cleaned-math snapshots without exact normalization mapping report their specific unavailable capability. Supported native code paths are implemented and exercised through synthetic injected backends; actual macOS execution remains **UNRUN**, rather than missing adapter code.

## Shared metadata owner

V2 reuses `SourceMetadataExtraction.process(vault,sourceId,revision,version)` and `SourceMetadata.registerCandidate(...)` from the dependency. No competing store or per-chunk metadata extraction is introduced. Canonical extraction uses the owner's version/title/evidence-region cache once per document/revision. Editorial reconciliation runs only after validated accepted derivative evidence is saved to `source_reprocessing`; synchronous hooks are preceded by cancellation guards. The owner's separate metadata policy, field/value/run-evidence deduplication, target fingerprints, freshness, provenance/history and backup validation remain authoritative. Textual bibliography patches do not directly update canonical bibliographic properties.

## Validation and remaining quality gate

The original six-phase tree passed builds and focused suites independently, then **1,348 full-suite tests passed, 7 skipped, 0 failed**. Final adapter/main/metadata integration: **1,415 passed, 7 skipped, 0 failed** (1,422 total). `npm run build` passed styles, application/test types, server compilation and Vite. Focused integration: **124 passed, 1 platform skip** (125 total). Synthetic Chromium reprocessing (1200px/390px), Source Metadata and bibliography checks all passed with external traffic/providers blocked. Independent combined review reported no remaining blockers after 70 focused and 32 combined checks, types and whitespace checks. Logs: `/tmp/noema-v2-integrated-{build,full,focused,browser,metadata-browser,bibliography-browser}.log`; browser evidence: `/tmp/noema-source-metadata-evidence` and `/tmp/noema-bibliography-evidence`. Local evidence preparation is now reported separately from model progress, and Source activity/cost history links use the owning Source entity ID. Publication reconciliation against merged #101 and settings #103 passed build/styles/types and 71 focused affected-code tests. V2 runtime/shared core is byte-identical to the earlier combined validated tree; independent publication review verified phase ancestry, authoritative main ancestry, no temporary metadata-copy commits and no duplicate metadata-owner changes. Source-view #102 integration additionally passed build/styles/types, 54 affected reader/metadata tests and synthetic Chromium reprocessing, metadata and bibliography checks; the bibliography browser fixture now follows the explicit Edit bibliography control. Exact publication-head CI is reported in the draft PR. Tests use synthetic content, injected native adapters and mocked provider HTTP only. No actual source files, credentials or live paid services were used.

Native macOS execution and real-provider academic-PDF evaluation are **UNRUN**. The latter requires separate authorization. Synthetic reliability checks do not establish transcription accuracy or editorial quality, and quality-release completion is not claimed.
