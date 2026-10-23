# Entity properties checkpoint 2: persisted definitions and compatible typed values

This follows the inventory/Phase 1 checkpoint (`ee73347`). The read-only inventory tooling and synthetic/legacy validation were implemented before the persistence migration. No private vault is accessed. Main remains `27bd9b49d045063dccdbff2e5bc2f313bece9fdf`, including Overview #43, Inbox #42 and Review Centre #41.

## Storage and compatibility contract

Migration 5 preserves the existing five-column `properties` table, every property ID, name, exact authored string and reference target. It adds vault-scoped `property_definitions` and `property_value_metadata` sidecars. Definitions persist stable IDs and metadata; scalar mirrors use indexed integer, decimal, boolean, text and coordinate columns. Dates point to existing temporal authority rather than storing another date registry. Existing subtype fields stay scoped; orphan authored fields receive permissive fallback definitions so they remain represented.

The migration backfills compatibility without converting authored data. Metadata distinguishes valid, legacy incompatible, unresolved literal and explicit unknown values. Cardinality conflicts retain all authored rows and require review. Raw legacy SQL writes invalidate derived scalar mirrors; reads safely rebuild them. Definition bindings and multi-value positions survive subsequent synchronization. Same-vault reference constraints apply to new references; incompatible historical references remain identifiable without rewriting their original targets.

The API retains name arrays and the old property payload. `definition_id` opts into typed validation, inherited-definition identity, reference type/subtype checks, declared scalar constraints and duplicate/cardinality checks. Existing incompatible values can be edited with `compatibility_mode: 'legacy'`; no new required field is imposed on old clients. New typed values cannot use the legacy-edit exception. This intentional old-client compatibility means no-ID legacy writers do not yet receive strict typed enforcement.

Typed date writes refresh the specific property's existing temporal evidence. Partial year/month precision and Julian expressions keep their authored strings and canonical calendar identity. Recognized approximate or ambiguous dates can be captured as unresolved values, with no canonical date or invented precision; invalid civil dates and unsupported legacy literals are retained for review; they are never flattened into exact dates. Organization Founded now uses the existing temporal `occurs_on` relation. Historic evidence remains linked to stable property IDs.

Vault backups retain their version-1 contract with optional definitions, scalar metadata and temporal-property evidence/dirty tables. Restores remap IDs consistently into the new vault, validate scoped constraints and scalar mirrors, and derive missing sidecars for old archives. Original backup identity-remapping semantics remain intact. The new tables contain no credentials or provider state.

## Editing and reference completion

The shared property surface uses persisted definitions for contextual controls: URL, integer, quantity, boolean/unknown, enum, identifier, coordinates, date/time and text. Date controls provide precision/calendar-aware text entry and preserve author expressions rather than forcing an HTML day picker; a full calendar-builder widget is not implemented. Existing incompatible values expose an explicit compatibility route. The retained advanced editor uses the same property draft store and mutation queue; core entity details keep their separate Save/Discard contract.

Reference options now use a vault-scoped server endpoint with name/alias search, type/subtype filters, stable pagination and a maximum page size of 50. Existing selected archived references remain selectable with warnings. Creation returns the selected entity to the unfinished property draft without creating entities from unmatched typing. Uncertain creation outcomes retain intent and require reconciliation before another create attempt. Property drafts persist across in-app navigation and unmount/remount; process-restart persistence is outside this contract.

The source synchronizer reserves the exact keys `Import method` and `Source URL` as derived metadata, consistent with its existing policy. It preserves unchanged derived row IDs, removes stale derived literals when source attachments change, and preserves unexpected references for review. The user-authored lowercase `url` field stays separate. Full origin attribution and manual/automatic conflict governance remain Phase 4.

## Multi-agent ownership

- `typed_persistence`: migration, persisted definitions, typed scalar classification and storage regression fixtures.
- `phase2_ui`: paginated picker, create-and-return, typed controls and advanced draft consolidation.
- `backup_compat`: optional backup tables, restore validation/remapping and legacy archive coverage.
- `migration_review`: independent adversarial migration, scope, temporal, backup and UI review.
- Coordinator: typed-write API integration, reference endpoint, authoritative temporal integration, stable source IDs, integration tests, docs and final checks.

## Remaining programme

Imported/directly modified custom date definitions outside the native temporal field map retain and validate exact raw strings, but may have `temporal_date_id: null`; definition-aware custom temporal mapping belongs with Phase 3 custom-definition editing. This checkpoint does not claim arbitrary custom-date query/index coverage.

Phase 3 remains: recommended catalogue for existing subtypes, public custom-definition editing, explicit schema conflicts, broader cardinality/reclassification impact previews, hierarchical cycle rules, target reclassification governance and destructive-reference policy. No speculative future subtypes are added. Existing target-delete cascade semantics have not been replaced in this checkpoint.

Phase 4 remains: complete value origin/provenance, system/manual conflict review, stale-value reconciliation and richer source-author resolution. The stable source-ID fix does not claim complete provenance.

Phase 5 remains deferred: facets, canonical relationship definitions, field history, multilingual labels, advanced identity resolution and quality diagnostics.

## Verification

Final verification pending. UI/browser validation, visual QA and screenshots are unrun by explicit user instruction. Automated DOM tests validate interaction logic; they do not claim visual/browser coverage.
