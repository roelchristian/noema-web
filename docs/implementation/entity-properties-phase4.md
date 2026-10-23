# Phase 4: provenance and source review

This checkpoint builds on Phase 3 (#50), without changing existing property IDs, the five-column legacy property table, authored values, or reference semantics. The additive migration is replay-safe and classifies existing authorship conservatively as `legacy_unknown`.

## Delivered

- Property and canonical-name provenance records identify manual, imported, AI, derived and unknown origins, with timestamps, optional source-file foreign keys and content hashes. Raw updates and evidence changes retain previous attribution as stale evidence. Same-vault guards cover sources, owners and targets.
- Stable, idempotent proposals preserve extracted evidence and rejected decisions. Author extraction does not split authored literals, rewrite credits, delete rows, create canonical entities or link ambiguous/archived identities automatically. Source and Creative Work remain separate.
- Source enrichment respects explicit manual and unknown canonical names, including edits during requests. Generated file metadata remains separate from entity language identity. Source metadata synchronisation keeps unchanged imported IDs, retains stale evidence, and proposes conflicts rather than replacing authored values.
- Homepage and inspector expose evidence review and origin/staleness information. Read-only previews fingerprint current values, definitions and source state; decisions apply transactionally. Accept/reject is explicit, and single-value conflicts require retain-both, preserving original IDs and values as compatibility cases. Typed target restrictions, hierarchy guards and temporal authority still apply. Approving a canonical name records manual authority. Uncertain writes require status reconciliation before retry; refresh failure cannot replay a committed decision.
- Manual and legacy-unknown reserved source values remain editable through the existing explicit compatibility path. Imported managed fields remain read-only. Identity Save/Discard and shared property drafts retain their existing contract.
- Backup/restore preserves definitions, bindings, exact values, provenance, evidence, review decisions, archived references and completed author receipts with remapped vault/entity/file IDs. Legacy backups retain unknown authorship. Restored source files receive durable automation pauses, so queued processing cannot trigger paid enrichment/backfill; explicit retry releases the pause. Malformed sidecars roll back atomically.

## Validation and ownership

Five bounded agents owned provenance/migration/contracts, source workflows, backup compatibility, review backend/UI, and independent compatibility review. The coordinator integrated HTTP routes, knowledge CRUD/manual attribution, homepage/inspector review, advanced editor compatibility, documentation and suite registration. Independent review identified and resolved retained-reference validation, null-hash metadata evidence, custom-date refresh and URL download naming gaps.

Final build, styles, application/server/test-helper typechecks passed. Full non-browser suite: **962 tests, 956 passed, 0 failed, 6 macOS-native skips**. Publication head is recorded in the phase PR. Focused synthetic fixtures cover pre-migration databases and replay, exact old API literals and IDs, typed references/custom dates, source-title races, rejected-proposal deduplication, archive preservation, backup round trips, automation pauses and malformed restore rollback. Mocked intelligence never calls a provider. No real/private vault was accessed.

UI/browser/visual validation and screenshots are **unrun by user instruction**. Automated DOM tests exercise interaction logic only.

## Boundaries and remaining work

The review list is bounded to 100 proposals per view; history pagination is not implemented. A canonical-only reference proposal has no invented fallback literal; uncertain identities require an actual literal proposal or ordinary property edit. Evidence is the supplied workflow/file/hash, without fabricated quotes or locations. Rejected receipts prevent identical proposals recurring, but this is not full historical versioning. Existing unknown authorship is never retroactively inferred. Draft retention covers in-app navigation rather than process restarts. Date uncertainty and unsupported datetime precision retain the earlier explicit compatibility contracts.

Phase 5 remains deferred: typed facets/filter UI, canonical relationship definitions and inverses, full field history, multilingual property labels, advanced resolution/deduplication and completeness diagnostics. No merges, auto-merge, force pushes, branch deletion, deployment or repository settings changes were performed.

## Publication dependencies

Phase 1 [#48](https://github.com/roelchristian/noema-web/pull/48) targets main; Phase 2 [#49](https://github.com/roelchristian/noema-web/pull/49) targets Phase 1; Phase 3 [#50](https://github.com/roelchristian/noema-web/pull/50) targets Phase 2. Phase 4 targets Phase 3, so each PR contains its own phase diff. The stack includes current main `a6c5faf` (fetched again before Phase 4 publication), including concurrent Overview/Inbox/Review Centre work.

Main-base Phase 1 CI passed on its exact pushed head. The repository workflow filters PR bases to main, so stacked PRs have no scheduled CI; local exact-head checks provide their validation. Original superseded drafts #46/#47 and branches remain intact. Automatic approval review denied closing them because closing existing drafts was outside explicit authorization; approval was requested and no retry occurred.
