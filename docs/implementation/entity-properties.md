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

## Checkpoint implementation and remaining work

The shared `EntityPropertyList` now serves homepage, compact inspector and source inspector, with curated labels, inline scalar/reference editing, keyboard save/discard, failure recovery, navigation-retained drafts, explicit removal confirmation and inferred target filtering. The homepage keeps four populated properties initially with an expand action; it waits for complete property data before offering unset suggestions. Identity fields retain their existing Save/Discard contract. Property writes are serialized per entity. Source Import Method/Source URL metadata is distinguished as managed.

The schema API includes additive `propertyDefinitions` while retaining every legacy name array. Builtin IDs/keys are deterministic; custom IDs are explicitly derived legacy adapter identities, not persisted bindings. Incompatible inherited metadata is retained and available through conflict reporting. All definition constraints remain advisory in this checkpoint.

Run the inventory only against an explicitly selected synthetic/exported fixture:

```sh
node --import tsx scripts/property-inventory.mjs /path/to/fixture.sqlite vault-id
```

This command opens SQLite read-only and does not run migrations. Its report declares the limitations of advisory native checks, unavailable typed custom constraints and temporal mappings. The tests exercise synthetic current and legacy databases; no private vault inventory was run.

Remaining Phase 1 refinement: create-an-entity-and-return flow, server-paginated reference search (current picker searches the supplied entity list and renders at most 50 matches), and drafts for the retained advanced bulk editor. Ordinary inline drafts survive in-app navigation, not full process restart. Homepage property editing currently fetches full detail after the initial bounded preview; a dedicated paginated property endpoint is future scale work. General overview excerpts and connection previews remain bounded.

Phase 2 is **foundation only**, not complete: there are no database columns/bindings/backfills, typed write enforcement, scalar-specific controls or backup-format changes. Existing authored text remains editable including dates and unresolved literals. Date evidence remains authoritative. Strict constraints, cardinality enforcement, reclassification impact paths, custom definition editing and cycle/deletion policy require Phases 2–3 compatibility work. Source synchronizer metadata identity churn and the existing target deletion cascade require later Phase 3–4 work; archiving itself preserves references. Phase 5 remains deferred.

Four subagents contributed registry implementation, inventory implementation, inline UI implementation, and an independent compatibility review; coordinator integrated schema API, type-manager labels, docs, group registration and validation. Review findings corrected source cardinality, legacy subtype inventory, keyboard behavior, preview completeness and mutation ordering.

## Validation record

Final frozen-code verification:

- `npm run build`: passed (includes styles, application/server TypeScript, test-helper typecheck and production bundle). Existing large-bundle advisory remains.
- `npm run test:all`: 871 tests, 865 passed, 0 failed, 6 platform skips (macOS Keychain/PDFKit/Vision/sandbox native coverage unavailable on Linux).
- Focused definition/inventory coverage: 6 passed. Focused UI/home/panel coverage: 27 passed; final uncertainty safeguard property-list suite: 6 passed. The complete final suite includes all of these tests.
- `git diff --check`: passed. Latest main fetched again before final integration: still `27bd9b49d045063dccdbff2e5bc2f313bece9fdf`.
- No private vault access, provider calls/spend, push, PR, merge, deployment or repository-setting changes.

Commits: inventory/phase plan `81edb28`; additive definitions/read-only tooling `5c8b254`; inline UI `386b418`. Branch: `feat/entity-properties-foundation`.

No execution blocker remains for this checkpoint. The remaining programme and deliberate checkpoint limitations are listed above. UI/browser validation and screenshots are **unrun by user instruction**, never reported as passed.
