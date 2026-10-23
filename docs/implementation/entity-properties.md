# Knowledge entity properties: phased implementation

## Baseline and code inventory (before persistence changes)

Work starts from main `27bd9b49d045063dccdbff2e5bc2f313bece9fdf` (23 October 2026). This includes Overview #43, Inbox #42, and Review Centre #41. No other worker branch is modified. No private vault or provider is accessed. Repository AGENTS.md contains browser guidance; the explicit user instruction skips all browser validation and screenshots. There are no repository or workspace .agents skills installed.

| Module | Existing contract and integration responsibility |
| --- | --- |
| `src/shared/entity-schema.ts` | Nine types, fifty subtype IDs, legacy name arrays, inheritance; preserve these contracts and add optional definition metadata. |
| `src/shared/domain.ts` | Property IDs and exclusive literal/target representation; entity display-language metadata remains separate from Culture:Language identity. |
| `src/server/modules/knowledge.ts` | Vault-scoped property CRUD, inherited-name checking, reclassification rejection; extend schema response additively. |
| `src/server/database.ts` | Five-column properties table, real target FK, subtype schema migrations; no migration in checkpoint 1. Existing target deletion cascades need later explicit impact protection. |
| `src/client/knowledge/EntityDetails.tsx` | Advanced identity Save/Discard and property editor; preserve identity draft behavior. |
| `src/client/knowledge/EntityHome.tsx`, `EntityPanel.tsx` | Overview and inspector integration; preserve PR43 bounded contextual sections and existing navigation. |
| `src/client/knowledge/entity-drafts.ts` | Existing draft store and unload protection; property drafts must not be discarded with identity fields. |
| `src/client/knowledge/EntityTypeManager.tsx` | Subtype field creation exists; labels use shared adapter. |
| `src/shared/temporal-properties.ts`, `src/server/modules/temporal-properties.ts` | Existing canonical temporal parsing/evidence remains authoritative; no new date registry. |
| `src/server/modules/source-provenance.ts`, `source-authors.ts` | Background source properties and author resolution; do not alter authored values or source identities in this checkpoint. |
| `src/server/modules/vault-backups.ts` | Existing backup contracts; persistence additions require legacy and new round-trip tests before migration. |
| `scripts/test.mjs`, `test/groups.json` | Existing unit/DOM/server test groups; browser scripts are separate and intentionally unrun. |

## Checkpoints and exit conditions

1. **Phase 1 plus minimum Phase 2 foundation (current checkpoint):** reusable read-only inventory with synthetic/legacy fixtures; curated labels; shared inline homepage/inspector surface with save/retry, draft recovery, safe removal, and constrained searchable reference discovery; additive definition metadata for current built-ins and scoped custom fields. Preserve current database, IDs, API name arrays, literals and target IDs. Metadata is advisory until versioned typed-write compatibility is implemented. Validate using focused automated tests, styles, typecheck, build and full non-browser suite.
2. **Complete Phase 2:** first run read-only inventory against an explicitly supplied nonprivate fixture; design and test additive definitions/value columns and backup/restore with pre-migration databases; preserve property IDs and authored strings; add explicit legacy compatibility states, typed write validation and scalar controls; integrate dates with temporal evidence. Do not enforce strict typed writes against all old API callers or strand historical edits.
3. **Phase 3:** implement the recommended catalogue for existing subtypes only, stable-key conflict reporting, custom definition editing, explicit cardinality compatibility/impact handling, unresolved literal reconciliation, hierarchical cycle checks, vault-aware references and safe reclassification impact previews. Preserve archived references and distinguish Source from Creative Work.
4. **Phase 4:** stable system metadata identities, provenance and source attribution, manual-value precedence, conflict review and source-author reconciliation. No automatic overwrite of authored knowledge.
5. **Phase 5 deferred:** typed filters/facets, canonical relationship definitions, history, multilingual labels and advanced resolution/quality diagnostics. These are not prerequisites for checkpoints 1–4.

## Migration gate

No persistence migration is authorized by completion of this document alone. The implementation must first have reusable read-only inventory tooling and synthetic/legacy-fixture validation covering names/counts, case/synonyms, text/reference proportions, prospective incompatibilities and cardinality, dangling/cross-vault/archived references, temporal evidence, system-managed source metadata, custom fields and subtype conflicts. Never coerce ambiguous dates, nationality, identifiers or unresolved references. A future migration must preserve backup/restore and stable property IDs and supply explicit review states for incompatible legacy values.

## Validation record

Pending integration checks. UI/browser validation and screenshots are **unrun by user instruction**, never reported as passed.
