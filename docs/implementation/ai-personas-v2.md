# Persona composition v2 implementation

Implemented on cloud branch `codex/persona-composition-v2`, starting from fresh
`origin/main` at `23815d292f1215267957ff0b79218efb513a27eb`. The initial working
tree was clean. Repository `AGENTS.md` was read; no repository `.agents/skills`
were present. Four agents materially owned contracts/profiles, editor actions,
comparison studio, and independent compatibility/security review. The coordinator
owned cross-workflow expression integration and final runtime validation.

## Scope

- Phase 1: seven structured, frozen v2 profiles with voice, composition, rhetorical
  devices, avoidances, examples, and evidence/language/sensitivity constraints.
  Original v1 server definitions and shared metadata are preserved exactly.
- Phase 2: Subtle, Expressive and Immersive; new generation defaults to Expressive.
  Preferences, request overrides, generation identities, revision snapshots,
  explanations and accepted writing proposals retain version/expression. Old
  metadata remains sparse; old request fingerprints remain compatible.
- Phase 3: Proofread, Refine, Rewrite with Persona and Recast are explicit proposal
  actions. Selected text, before/after, acceptance, edit selection, cancellation,
  errors, repeat flows and safe undo are supported. Requests and acceptance guard
  against stale content/context; server requests also check page revision.
  **Recast reorganises within formatted spans; it does not move text across block
  or protected reference/math/format boundaries.** The UI discloses this scope.
- Phase 4: source-page composition guidance runs inside the existing generation
  request. No extra automatic planning call is added.
- Phase 5: comparison studio uses explicitly requested provider responses, constant
  passage/model/effort/expression per run, sequential per-preview state, cancel,
  errors, repeat, local feedback and explicit saving of chosen defaults. UI states
  transmission/cost implications, including possible costs after cancellation.
- Phase 6: custom personas remain **Later/deferred**.

Source extraction/reprocessing/reconstruction, raw-source processing, math
preprocessing, metadata, enrichment, titles, summaries and entity utilities remain
outside the persona allowlist. The new comparison workflow accepts deliberately
supplied sample/authored prose and never loads source extraction storage.

## Verification

`npm run build` passes style checks, application/test typechecks, server TypeScript
compilation and Vite production build. Vite reports its existing large-chunk
warning. `git diff --check` passes.

`npm run test:all` passed across the final integrated repository: 1,588 tests,
1,580 passed, 0 failed, 8 skipped. The final focused persona/comparison/editor suite
passes 24 tests with no failures/skips, including the HTTP preview route,
expression transport and legacy reading-note metadata regression.

Mocked Chromium runtime checks pass with zero page errors:

- `scripts/check-persona-studio-browser.mjs`: light/dark at 1280/390px; explicit
  dispatch, identical input/settings, cancel/error/repeat, keyboard focus, saved
  defaults and overflow. Evidence: `/workspace/noema-studio-evidence`.
- `scripts/check-writing-actions-browser.mjs`: light/dark at 1280/390px; selected
  span preview, acceptance/undo, interrupted late response, error/repeat, stale
  acceptance blocking and overflow. Evidence: `/workspace/noema-writing-evidence`.
- `scripts/check-personas-browser.mjs`: actual app at 1440/390px; persisted persona
  defaults, source-page/reading/block explanation overrides and historical
  revision provenance. Evidence: `/workspace/noema-persona-evidence`.
- `scripts/check-selection-toolbar-browser.mjs`: existing desktop/mobile keyboard,
  selection, equation/citation/semantic actions, interrupted review and explanation
  regression checks, adapted for explicit proposal generation.
- `scripts/check-editor-browser.mjs`: native typing/caret, undo/redo, split/merge,
  clipboard, formatting, cross-block selection, IME and entity updates.

Independent review caught and fixed old fingerprint incompatibility, contradictory
rewrite restraint, expression-default inheritance and historical block-expression
transport. No blocking findings remained. The minor disabled v1 expression label
edge was also corrected during integration.

## Limits

No real provider requests or credential access were used. Providers were replaced
with deterministic synthetic transports. Mock output validates contracts and
interaction safety, **not factual fidelity or stylistic quality**. The expanded
math/literature/history/theology/sensitive-subject fixtures define independent
style, fidelity, format and excessive-mannerism evaluation. Real-provider style
benchmark and human differentiation assessment remain **UNRUN**, opt-in work.

Feedback is device-local and excludes the passage/output. Recast scope is bounded
as described above. Eight repository tests skip platform/native/model-dependent
checks in this Linux environment. Dependencies were installed with
`npm ci --ignore-scripts --cache /tmp/noema-npm-cache` after an ONNX installer
could not resolve GitHub; no native speech/PDF capability is claimed validated.
Initial implementation was local-only. Subsequent publication and integration were
authorized separately; deployment remains outside scope.


## Integration after PR #115

PR #115 was independently verified merged at
`7bb44b7c0b1fb95af44d34be0d4f72761aabc1b5`; its post-main CI succeeded. That
main revision was merged into the persona branch before PR #116 could proceed.
The six conflicted files were resolved by combining both features, not replacing
one side: source-version selection, canonical citation projection and reading
revision coordinates coexist with persona version/expression and historical retry
identity. The client retains sourceRevisionId as argument 10 and appends persona
expression as argument 11, with a direct transport regression. All test groups
from both branches remain registered.

Independent review also identified an existing draft-retention gap. Superseding,
accepting or rejecting a draft now changes status without erasing generated
content, source options or persona provenance. Exact snapshot regressions cover
v1-to-v2 supersession, acceptance and rejection; status guards still prevent reuse.
No new database migration is introduced by the persona integration.

The integrated build/style/types pass. The final full suite passes 1,710 tests
with zero failures and eight explicit platform/model skips (1,718 total).
The existing metadata test now asserts complete draft snapshot preservation
rather than deletion; all earlier page/provenance/restoration assertions remain. Integrated Settings/editor/selection-toolbar runtime checks use
only synthetic providers. Independent integration review passed 24 focused tests
with no unresolved findings. Chat remains separate and outside the persona
allowlist. Phase 6 and real-provider style evaluation remain deferred/unrun.
