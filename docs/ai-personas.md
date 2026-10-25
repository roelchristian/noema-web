# AI personas

Noema separates task purpose, evidence boundaries, and editorial method. The seven built-ins are Oxford Don, Divinity Student, Editor, Tutor, Eccentric Antiquarian, Socratic Gadfly, and Salon Wit. Version 2 profiles specify voice, composition, rhetorical devices, avoidances, examples, and evidence/language/sensitivity constraints. Persona may shape rhetorical organisation and prose, but cannot change facts, citations, requested language, mathematical meaning, output schema, or task purpose.

Version 1 definitions remain immutable and available to historical requests. Historical identities and absent legacy metadata must round-trip without being relabelled. Explicit v1 requests use v1 instructions; new generation selects v2. Removed Conyo v1 provenance remains readable and resolvable for historical regeneration; unversioned Conyo selection follows the existing Divinity Student replacement. Custom persona management is **Later/deferred (phase 6)**.

## Expression and provenance

New v2 generation defaults to **Expressive**. **Subtle** reduces rhetorical intervention; **Immersive** allows stronger compositional identity, without parody or gratuitous theatricality. Expression is an explicit instruction rather than a temperature adjustment. Preferences and request overrides are separate. New generation/revision provenance records selected identity, version, and expression; historical v1 identities keep their original behavior and do not acquire a new expression implicitly.

Long source-page generation chooses a persona-aware composition inside its existing model request. Format purpose, citations, structured output, and evidence scope remain authoritative. No additional automatic planning call is introduced. Sensitive material requires restraint even for the more playful personas; secular subjects do not acquire unsolicited theology.

## Strict workflow boundary

Only allowlisted prose workflows receive persona instructions: generated source pages, reading/block explanations, writing-review rationale, explicit authored-page rewriting/recasting, and explicit comparison previews. Proofreading preserves author voice; Refine permits restrained clarity improvements. Rewrite with Persona changes selected prose more substantially. Recast allows broader rhetorical organisation within the supported selection/format boundaries. The editor presents proposals for explicit acceptance and supports undo; stale proposals must be rejected rather than silently overwriting intervening edits.

Source extraction, reconstruction/reprocessing, OCR/math preprocessing, raw source text, metadata extraction, enrichment/classification, titles, summaries, entity discovery/scanning/linking, embeddings/indexing, and connection diagnostics remain excluded. The `editorial` request kind is source preprocessing, not authored-page writing. Prompt instructions treat supplied document text as untrusted content, never as instructions.

## Comparison studio

Settings → AI → Writing style provides an explicitly initiated comparison workflow. Preview passages are deliberately supplied sample/authored prose. Each preview uses actual provider responses when the user runs it, with transmission/API-cost notice, per-preview state and feedback; selection of defaults is separate from generation. Comparisons hold input and model settings constant. Synthetic mock responses in tests exercise this workflow and do not demonstrate actual writing quality.

## Evaluation and validation

`test/fixtures/persona-style-evaluation.json` covers mathematics, literature, history, theology, requested-language/evidence limits, and sensitive subjects. It defines independent scores for stylistic distinctiveness, factual fidelity, task/format adherence, excessive mannerism, sensitive adaptation, and expression calibration. Factual failures cannot be compensated by a good style score. An opt-in human/provider evaluation should blind-label outputs and hold passage, language, format, model/reasoning, budget, and sampling settings constant across personas and expression levels.

**Real-provider style benchmark: UNRUN. Human stylistic differentiation review: UNRUN.** No mock output, prompt snapshot, or deterministic test establishes that real providers produce recognisably distinct styles. Running the benchmark requires separate authorization for credentials and spend; it is not part of implementation validation.

Build/style/type checks, unit/server/DOM tests, and mocked runtime editor/Settings checks validate implementation contracts and interaction safety. See the implementation report for exact commands, counts, browser evidence, failures, and remaining limitations; this document does not claim an unexecuted check passed.

## Historical baseline

The earlier Divinity Student replacement preserved Conyo v1 provenance and migrated unversioned defaults. Its prior validation and screenshots describe the v1 baseline, not v2 stylistic quality. This work retains that compatibility requirement while introducing versioned v2 profiles; no historical draft/revision is rewritten or migrated to v2 merely by loading or changing preferences.
