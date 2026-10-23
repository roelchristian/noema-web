# Phase 3: schema and reference governance

This checkpoint extends Phase 2 without rewriting authored values or changing property IDs. All nine types and existing 50 subtype IDs remain; recommendations cover those existing classifications only. There are no speculative future types/subtypes. Concept disciplinary fields remain existing Domain IDs; Culture:Language identity remains separate from display-language metadata.

## Delivered

- An additive curated main/subtype catalogue, deterministic suggestions, stable-key deduplication and core precedence for compatible inheritance. Incompatible inherited semantics, including validation constraints, remain explicit conflicts. A legacy custom field does not suppress an incompatible new recommendation or lose its original binding.
- Vault-scoped custom-definition creation and editing in Manage Types. IDs, keys, stored names and scopes are stable; builtins are protected. Labels, guidance, types, cardinality, constraints, allowed target types/subtypes, order and suggestion status are editable. Display labels are used in property surfaces, administration and connection descriptions.
- Read-only definition impact previews with stale fingerprints and explicit compatibility confirmation for populated incompatible changes. Existing duplicates and incompatible values remain intact. Cardinality groups use stable keys and compatible definition semantics, rather than just shared names. Historical overlapping names/bindings survive restore; new ambiguous stored-name creation is rejected, with guidance to reuse an existing definition or choose a unique name.
- Read-only entity reclassification impact previews cover outgoing fields and incoming references, including archived owners/targets. Unsafe changes require a fresh preview and explicit retain-legacy path. Values and reference targets keep their IDs; out-of-scope original bindings remain explicit compatibility cases. Source attachment/page-reference constraints block converting consulted Sources into Works or unrelated entity types.
- Hierarchical reference guards detect cycles across typed and legacy links, semantic aliases and archived paths. New/changed cyclic links are rejected; unchanged historical links remain readable and flagged for review. Same-vault integrity is retained.
- Custom and recommended date definitions reuse authoritative temporal dates, evidence, precision, calendar semantics and unresolved uncertainty. Canonical custom dates use the existing generic `discusses` relation when no named temporal kind exists. Unsupported datetime precision/calendars remain validated or preserved as compatibility cases; no second date registry or day precision is invented.
- Backup restore recognizes catalogue builtins and restores all explicit definition bindings before mirror validation. Tests cover legacy overlapping definitions, archived incoming/outgoing references, reclassification, custom dates and original strings. Old clients retain their no-definition compatibility payloads.
- Identity discovery receives the compact name/subtype schema instead of the full typed-definition catalogue, keeping its existing input budget without additional provider requests.

## Validation and ownership

Build, styles, application/server and test-helper typechecks passed. Full non-browser suite: **938 tests, 932 passed, 0 failed, 6 macOS-native skips**. Focused checks include custom definition/server/DOM tests, classification and hierarchy tests, legacy migration replay, backup fixtures, custom temporal authority, HTTP routes, shared labels/drafts and error recovery. Independent compatibility review contributed adversarial fixtures and found no remaining code blocker after corrections.

Four bounded agents owned the catalogue, custom-definition server/UI, classification/hierarchy module and independent compatibility review. Coordinator integrated storage, routes, property/identity surfaces, temporal authority, backups and full verification. A fifth agent independently verified Phase 1 and Phase 2 publication heads in detached worktrees.

UI/browser/visual validation and screenshots are **unrun by user instruction**. Automated DOM tests cover interaction logic only. No private vault access, provider spend, merge, force push, branch deletion, deployment or repository settings changes.

## Phase stack

- Phase 1: #48, `feat/entity-properties-phase1-main`, exact head `85e54edac0288b8fbed158ac139f6ee6728df279`; 880 passed, 6 skipped; GitHub CI run 39956804487 succeeded.
- Phase 2: #49, `feat/entity-properties-phase2-main`, exact head `878a54048610298f8a2a275a3a770834675e86c6`; 902 passed, 6 skipped. Targets Phase 1, so its diff contains only Phase 2.
- Phase 3: `feat/entity-properties-phase3`, targets Phase 2. The stack includes current main `a6c5faf` (Review Centre #44), Calendar #40, Overview #43, Inbox #42 and Review Centre #41.

Original drafts #46/#47 were superseded when main advanced during publication. Their branches were preserved, with replacement commits/PRs rather than a merge or force push. Automatic approval review rejected closing those original drafts because closing existing PRs was not explicitly authorized; approval was requested and no retry was attempted.

Repository CI filters PR bases to `main`, so stacked non-main-base phases are not scheduled by that workflow. Exact pushed heads receive full local non-browser verification; no workflow/settings changes are made to bypass the filter.

## Remaining

Phase 4: origin/evidence metadata, manual precedence in enrichment, stable system metadata evidence, source-author reconciliation and explicit conflict/stale-value review. Phase 5 remains deferred. Full history, multilingual labels, facets, canonical relationship definitions and advanced deduplication are outside this checkpoint. Drafts survive in-app navigation; process-restart draft persistence and a large calendar-builder widget remain outside the current contract. Arbitrary deleting/moving definitions is not offered: immutable keys/scopes protect references rather than permitting destructive administrative changes.
