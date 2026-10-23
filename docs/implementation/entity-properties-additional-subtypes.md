# Entity properties follow-up: additional built-in subtypes

Separate follow-up to Phases 1–4, based on main `e756d55` (including smart collections #52 and `a66c8af` / calendar #45). Branch: `codex/additional-entity-subtypes`. The repository and workspace have no additional `.agents` skills; root `AGENTS.md` supplies browser guidance. Screenshots are skipped by request.

## Scope and catalogue

Adds only the 19 explicitly requested classifications: 69 total subtype IDs under the existing nine types. A synthetic comparison against main confirms that the previous 50 subtype IDs, names and groups and all 211 native property definitions are preserved exactly. Each addition has a curated subtype description and three optional suggested definitions (57 definitions total, before compatible stable-key inheritance deduplication). IDs use the existing `type:hyphenated-name` and `builtin:<subtype-id>:<property_key>` conventions.

All new references use stable entity targets with permitted main types; narrower subtype targets appear below. Dates use existing precision/calendar/uncertainty handling. Identifiers preserve strings and leading zeros. Quantities preserve their units; descriptions guide unit entry without introducing another measurement registry. Existing main-type fields continue to be inherited, so Paper includes DOI, authors, publication date and subject; Concept includes introduced-by and originating-work references.

| Type | Subtype / ID suffix | Suggested fields |
| --- | --- | --- |
| Place | Building / `building` | Architect / Designer → Person (many); Established (date); Architectural Style → Concept (many) |
| Place | Natural Feature / `natural-feature` | Feature Kind → Concept; Elevation (quantity, unit/datum guidance); Length (quantity, unit guidance) |
| Place | Historical Place / `historical-place` | Associated Events → Event (many); Established (date); Abandoned (date) |
| Creative Work | Album / `album` | Performer → Person/Organization (many); Composer → Person (many); Duration (quantity, unit guidance) |
| Creative Work | Journal / `journal` | ISSN (identifier); First Published (date); Publisher → Organization |
| Creative Work | Painting / `painting` | Medium (brief text); Height and Width (quantities, unit guidance) |
| Creative Work | Poem / `poem` | Poetic Form → Concept; Meter (brief text); Composed (date) |
| Creative Work | Software / `software` | Version (identifier); Repository (URL); License (brief text) |
| Creative Work | Academic Paper / `academic-paper` | Journal → Creative Work:Journal; arXiv ID (identifier); DOI (identifier, compatible core key) |
| Organization | Government Body / `government-body` | Jurisdiction → Place (many); Responsibilities → Concept (many); Established (date) |
| Organization | Religious Institution / `religious-institution` | Religious Tradition → Culture/Concept; Affiliation → Organization (many); Established (date) |
| Organization | Research Institute / `research-institute` | Research Areas → Concept (many); Affiliation → Organization (many); Established (date) |
| Organization | Association / `association` | Focus Areas → Concept (many); Affiliation → Organization (many); Established (date) |
| Culture | Cultural Tradition / `cultural-tradition` | Associated Communities → Culture (many); Origin Place → Place (many); Associated Events → Event (many) |
| Concept | Theory / `theory` | Proponents → Person (many); Related Theories → Concept:Theory (many); Proposed (date) |
| Concept | Theorem / `theorem` | Assumptions → Concept (many); Depends On Theorems → Concept:Theorem (many); Proven (date) |
| Concept | Method / `method` | Applications → Concept (many); Related Methods → Concept:Method (many); Introduced (date) |
| Concept | Principle / `principle` | Applications → Concept (many); Related Principles → Concept:Principle (many); Introduced (date) |
| Concept | Framework / `framework` | Components → Concept (many); Based On Theories → Concept:Theory (many); Introduced (date) |

Functional Concept subtypes can combine with existing subtype selections; Disciplines still use independent Domain IDs. Full definitions, proofs, procedures and content belong in overviews/pages. Academic Paper and Journal describe works; Source:Journal article remains a consulted source with attachments. Existing imported sources are never reclassified. The existing work-type enum and all existing target constraints remain unchanged for old-backup compatibility.

## Persistence and collisions

No new SQL migration or backup version is required. Existing idempotent per-vault definition seeding fills missing catalogue definitions on schema access; it creates no entities, classification assignments or property values. Existing property IDs, strings, bindings, selections and provenance remain intact. Built-in definition metadata remains read-only through governance; authored values remain editable through the existing controls.

A custom subtype with the same name keeps its original ID, fields and selections alongside the new native subtype. The picker and type-manager choices mark a same-name custom choice with `(custom)` without renaming the stored subtype. New duplicate-name creation remains rejected. For a historical exact ID collision (possible in old imported/raw data), the custom identity takes precedence in the vault registry. Scoped native recommendations and native references to the occupied ID are withheld rather than changing its meaning. Storage, schema, hierarchy and governance use the same registry merge. Backup import resolves archived custom ownership first, then consistently remaps custom selections, field scopes, target restrictions and explicit value bindings using the existing restore identity policy. Both legacy sidecarless and modern backups are covered.

The picker and Manage Types expose descriptions, Culture guidance includes Cultural Tradition, and scan guidance preserves Work/Source and Concept/Discipline boundaries. Discovery consumes the same compact registry and creates nothing until explicit acceptance.

## Validation

Synthetic-only validation; no private vault or provider requests/spend. Focused fixtures extend existing test files rather than introducing a separate test harness. Coverage includes all new IDs/grouping, descriptions, stable key compatibility, native target search/validation, read-only governance, exact identifiers/units, uncertain and year-only dates, deterministic seeding/restarts, unchanged authored rows/domain assignments, custom-name and exact-ID collisions, multi-subtype unions, old/new backups, and scanning/acceptance.

Build (including style checks and application/server/test-helper typechecks) passed. The existing Vite large-bundle advisory remains. Final `npm run test:all`: **996 tests, 990 passed, 0 failed, 6 platform skips** (macOS native Keychain/PDFKit/Vision/sandbox facilities unavailable on Linux). Focused final schema/typed-value/property DOM/governance set: **31 passed**; scan/backup compatibility set: **17 passed**. Updated only the two scan-prompt digests/byte counts in the generation contract fixture for the intentional guidance change; all other provider contracts remain unchanged. An earlier concurrent build interrupted one static-image test; the stable-build full rerun passed it. `git diff --check` passed. Independent compatibility review found no remaining blocker. Browser/visual checks and screenshots are unrun. No push, PR, merge or deployment is authorized or performed. Phase 5 facets, multilingual work, taxon/individual redesign and additional ontology expansion remain outside scope.


Ready for review as a separate locally committed follow-up; publication still requires authorization. No outstanding execution blockers, denied actions or uncertain external writes remain. Existing smart collections, dark-theme styling and page/property provenance changes are preserved by branching from current main and leaving their implementations intact.
