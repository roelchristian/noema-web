# Smart collections

Smart collections are a collection type in the existing **Collections** navigation and creation/edit flow. They calculate virtual page membership without changing canonical folders, page content, Subjects, entity references, or the memberships of manual collections. They do not add another sidebar hierarchy.

## Phase 1: deterministic rules

Rule collections use persisted, versioned rules with nested **ALL**, **ANY**, and **NONE** groups. Rules are validated and bounded before evaluation; saved definitions contain a typed JSON tree rather than SQL. Predicates use existing persisted metadata, disciplinary Subjects, folder ancestry, stable knowledge entity identities, and reading-note metadata. Unavailable derived classifications are not offered as working options.

Supported predicates are title (contains/equal), created/modified date (before/after), language, favourite, reading-note status, unfiled status, exact/ancestor folder, exact/descendant Subject with primary/secondary/any role, and stable entity mention or association. References use existing entity IDs, not names or aliases. Archived/inactive entities are unavailable rule targets. Dates compare timestamps; an unknown legacy creation date does not become an invented creation date.

Missing dates and language do not satisfy their positive predicates. **NONE** means that none of its child conditions match, so a page with unknown language satisfies `NONE(Language equals en)`. This is boolean nonmatching, not proof of a different language. An unavailable folder/entity rule target instead fails validation even inside **NONE**; it never quietly broadens the collection.

The server accepts at most 64 nodes, depth 8, 16 children per group, and 500 characters per value. Preview evaluates at most 250 active pages and returns at most 20 representative matches. The editor presents at most eight preview rows. Background evaluation yields between batches of 100 pages. A bounded change journal lets a page edit refresh only affected page IDs; folder/entity changes, permanent page deletion, and an explicit re-evaluation can require a full batched pass. Refresh begins when organization state is read. The collection view checks on entry, polls every second while work remains pending, and every five seconds otherwise to discover later changes.

The collection dialog previews a bounded sample after the draft has settled. Changing the rule or vault invalidates the previous request, including responses from transports that ignore cancellation. An unsuccessful preview is an error, not an empty match set. A bounded preview is not an exact whole-vault count.

Calculated membership is separate from existing manual memberships and linked folders. **Always include** and **Exclude** decisions persist independently of evaluation results; resetting a decision returns that item to calculated membership. A refresh must not overwrite either decision. Match explanations describe the deterministic evidence used for the evaluated result.

Evaluation is local and vault-scoped. Locked vaults cannot be previewed or refreshed. Refreshing works in bounded asynchronous batches, so editing and saving do not wait for a full scan. Unevaluated, stale, current, and failed evaluation states must remain distinct. Existing evaluated matches may remain visible while stale; a stale result is not presented as a current match.

Definitions and overrides participate in vault backups. Restoring a backup remaps collection, folder, and entity references to the restored vault. Legacy backups without smart collection sidecars remain supported; manual collection and physical folder semantics remain unchanged.

The membership cache is derived and starts unevaluated after restore, then rebuilds locally. A rule whose referenced entity or folder was deleted remains a saved definition with a clear evaluation error; restoring its backup preserves an unavailable reference under a new tombstone identity, so it cannot accidentally point to an unrelated item in another vault. Edit the rule to choose an available target or remove the condition; the tombstone does not create a replacement entity or folder.

Automatic matching initially covers pages. Entities can retain explicit collection membership; automatic mixed page/entity/Source research workspaces are deferred.

## Phase 2: semantic collections

Semantic matching is another matching method within a smart collection in the existing Collections flow. Describe the intended intellectual scope and explicitly evaluate it before saving. Typing or changing a description never calls an embedding provider. An evaluated description is bound to that vault and draft; editing it invalidates the previous preview. The rule builder remains available for deterministic collections. Semantic membership does not move pages or change Subjects, content, entity references, or explicit membership decisions.

The description is embedded once through the configured embedding service on an explicit user action. Membership refresh then compares that saved query vector with existing passage embeddings locally. Refresh does not generate missing page embeddings, make an LLM classification request, or send every page to a provider. An unchanged description reuses its saved vector. Synthetic validation supplies a fake query embedding provider and local vectors; no paid provider or private vault is used by the tests.

Descriptions are limited to 2,000 characters and 8,000 UTF-8 bytes. Draft evaluation tokens are vault- and description-bound, expire after 30 minutes, and are invalidated on vault locking. A lock/unlock cycle also rejects in-flight provider responses from the previous vault session. Tokens are temporary and excluded from backups. The saved definition retains its verified query vector, model, and dimensions; an incompatible saved model requires explicit evaluation rather than a hidden provider request.

Semantic evidence reports document-level relevance and supporting passages. Coverage across the document and support from multiple passages distinguish substantial topical relevance from a single incidental high-scoring passage in a long note. Threshold hysteresis keeps a previously included page from oscillating around the entry threshold on each refresh. These scores are retrieval evidence, not calibrated probabilities of correctness.

The initial relevance threshold is 0.55 and minimum text coverage is 50%. Relevance uses the token-weighted mean of passage similarities with overlapping windows discounted; coverage counts overlapping text positions once. Multi-passage pages need at least two supporting passages. Existing matches use an exit relevance threshold 0.04 below the entry threshold. A semantic preview examines at most eight active pages and returns at most 20 matches. Each page is limited to 512 saved passages per evaluation. A page that exceeds the limit reports an error, not a negative match.

Missing, partial, stale, invalid, and incompatible passage embeddings remain distinguishable from a fully evaluated nonmatch. Old membership may stay visible with a stale indicator while indexing catches up. Editing the query or page, changing models/dimensions, and gaining or losing indexed passages invalidate affected semantic results. Explicit Always include/Exclude decisions survive each operation.

Every passage must have a current embedding for the active model and dimensions before the page is evaluated. A partially indexed page stays unevaluated; a collection with such gaps reports partial evaluation. Missing embeddings are not treated as evidence against membership. Changed page candidates are coalesced behind a 300 ms local refresh delay and processed in batches of eight; query-vector generation is separate from this background work. The dialog checks existing-vector previews every five seconds and never generates a description vector from polling. Unchanged previews reuse a bounded vault-scoped cache keyed by input revision, query and settings; they do not reread candidate pages or vectors. Locking invalidates cached previews.

Semantic definitions and their query embeddings are included in vault backups; derived membership is rebuilt locally after import. Rule-only backups remain compatible. Automatic matching continues to cover pages rather than Source entities or other mixed-content records.

## Automated validation

`npm test` builds the client and server, checks styles and types, and runs the registered suites. The synthetic coverage is in `test/smart-collections.test.mjs`, `test/smart-collection-preview.test.mjs`, `test/semantic-collections.test.mjs`, and `test/semantic-collection-preview.test.mjs`. Run these files directly with `node --import tsx --test` for focused validation. Semantic tests inject a fake provider and local 1,536-dimensional vectors, including incompatible, missing, stale, and invalid examples.

`node --import tsx scripts/check-smart-collections-browser.mjs` exercises creation, live preview, evidence, overrides, automatic invalidation, manual membership and physical folder preservation, and mobile overflow in Chromium. It requires the optional `playwright-core` harness (or its module path in `PLAYWRIGHT_MODULE`) and Chromium (`CHROMIUM_PATH` may override `/usr/bin/chromium`). This fixture blocks external browser traffic, rejects provider generation, uses a disposable database, and takes no screenshots.

## Deferred phases

1. **Phase 3 — Hybrid and examples:** combine the existing rule AST as deterministic eligibility with semantic relevance, retaining independent rule and semantic evidence. Add representative example matching with coherent positive/negative examples, and translate natural language into editable rule definitions that the user confirms. Plan model/version fingerprinting, indexing gaps, threshold hysteresis, and override preservation for each mode. These methods are not offered as implemented options by Phase 2.
2. **Phase 4 — Advanced organisation:** opt-in collection discovery, LLM classification, bounded relationship traversal with direct versus inferred evidence, temporal interpretations, built-in suggested views, mixed page/entity/Source research workspaces, and assisted Inbox filing. Physical movement remains an explicit user action; this phase does not authorize autonomous filing or content rewriting.

These later phases are separate deliverables, not hidden dependencies of the rule-based foundation. This implementation does not automatically move, retag, reclassify, or rewrite vault content.
