# Smart collections

Smart collections are a collection type in the existing **Collections** navigation and creation/edit flow. They calculate virtual page membership without changing canonical folders, page content, Subjects, entity references, or the memberships of manual collections. They do not add another sidebar hierarchy.

## Phase 1: deterministic rules

This release uses persisted, versioned rules with nested **ALL**, **ANY**, and **NONE** groups. Rules are validated and bounded before evaluation; saved definitions contain a typed JSON tree rather than SQL. Predicates use existing persisted metadata, disciplinary Subjects, folder ancestry, stable knowledge entity identities, and reading-note metadata. Unavailable derived classifications and AI matching are not offered as working options.

Supported predicates are title (contains/equal), created/modified date (before/after), language, favourite, reading-note status, unfiled status, exact/ancestor folder, exact/descendant Subject with primary/secondary/any role, and stable entity mention or association. References use existing entity IDs, not names or aliases. Archived/inactive entities are unavailable rule targets. Dates compare timestamps; an unknown legacy creation date does not become an invented creation date.

Missing dates and language do not satisfy their positive predicates. **NONE** means that none of its child conditions match, so a page with unknown language satisfies `NONE(Language equals en)`. This is boolean nonmatching, not proof of a different language. An unavailable folder/entity rule target instead fails validation even inside **NONE**; it never quietly broadens the collection.

The server accepts at most 64 nodes, depth 8, 16 children per group, and 500 characters per value. Preview evaluates at most 250 active pages and returns at most 20 representative matches. The editor presents at most eight preview rows. Background evaluation yields between batches of 100 pages. A bounded change journal lets a page edit refresh only affected page IDs; folder/entity changes and an explicit re-evaluation can require a full batched pass. Refresh begins when organization state is read and the client polls while work remains pending.

The collection dialog previews a bounded sample after the draft has settled. Changing the rule or vault invalidates the previous request, including responses from transports that ignore cancellation. An unsuccessful preview is an error, not an empty match set. A bounded preview is not an exact whole-vault count.

Calculated membership is separate from existing manual memberships and linked folders. **Always include** and **Exclude** decisions persist independently of evaluation results; resetting a decision returns that item to calculated membership. A refresh must not overwrite either decision. Match explanations describe the deterministic evidence used for the evaluated result.

Evaluation is local and vault-scoped. Locked vaults cannot be previewed or refreshed. Refreshing works in bounded asynchronous batches, so editing and saving do not wait for a full scan. Unevaluated, stale, current, and failed evaluation states must remain distinct. Existing evaluated matches may remain visible while stale; a stale result is not presented as a current match.

Definitions and overrides participate in vault backups. Restoring a backup remaps collection, folder, and entity references to the restored vault. Legacy backups without smart collection sidecars remain supported; manual collection and physical folder semantics remain unchanged.

The membership cache is derived and starts unevaluated after restore, then rebuilds locally. A rule whose referenced entity or folder was deleted remains a saved definition with a clear evaluation error; restoring its backup preserves an unavailable reference under a new tombstone identity, so it cannot accidentally point to an unrelated item in another vault. Edit the rule to choose an available target or remove the condition; the tombstone does not create a replacement entity or folder.

Automatic matching initially covers pages. Entities can retain explicit collection membership; automatic mixed page/entity/Source research workspaces are deferred.

## Deferred phases

1. **Semantic collections:** use existing embeddings with document-level relevance evidence, coverage controls, indexing-gap states, and stable explicit overrides. No paid provider calls are required or made by Phase 1.
2. **Hybrid and examples:** combine deterministic eligibility with semantic evaluation, add representative example matching, and translate natural language into editable, confirmed rule definitions.
3. **Advanced organisation:** opt-in collection discovery, LLM classification, relationship traversal, temporal interpretations, built-in suggested views, and assisted Inbox filing. Physical movement remains an explicit user action.

These later phases are separate deliverables, not hidden dependencies of the rule-based foundation. This implementation does not automatically move, retag, reclassify, or rewrite vault content.
