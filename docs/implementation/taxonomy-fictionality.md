# Thing and referent identity

Implemented from the delegated taxonomy/fictionality scope on `codex/taxonomy-fictionality`, based on current `origin/main` at `0d5239b`. The original Library brief could not be materialized: the supported resolved-reference helper failed to download on the initial attempt and one bounded retry. The supplied detailed scope was used. The parent subsequently confirmed it had read the entire original attachment and that its supplied scope was faithful; no further transfer retry is needed.

## Model and compatibility

- Thing is the tenth type: Food, Ingredient, Dish, Beverage, Material, Substance and Artefact. Multiple subtype selection uses the existing model. Organism retains its six biological subtypes and adds Fictional Taxon.
- Added Person Fictional Character, Concept Folkloric Archetype / Mythological Creature / Role, and Creative Work Recipe. Person includes individual nonhuman narrative agents. Existing Cultural Tradition, taxonomic properties, subtype IDs, custom collisions and property bindings remain intact.
- `referentStatus` is independent of entity type: actual, fictional, mythological, legendary, hypothetical, unspecified. The additive SQLite column `referent_status` defaults to unspecified, including legacy records and legacy archives. API omission retains authored status on update. Invalid status values are rejected. There is no inference from names.
- Common typed references use the existing property architecture: setting targets Creative Work or Place; originating work targets Creative Work; tradition/belief context targets Culture or Concept; attested in targets Source or Creative Work. Concept's existing originating-work definition is reused. References and status round-trip in vault backups with remapped target IDs. No new top-level universe type was added.
- Thing fields include derived from (Organism or Thing), made of, source organism, ingredients, recipe and resulting dish, plus concise subtype metadata. Biological taxa and culinary products are separate identities only when the text warrants them. No blanket duplication or existing-data conversion runs.
- Domains remain Concept-only using unchanged Domain IDs. A Concept with domains cannot change type until the user explicitly reviews and removes those assignments on the Concept. Classification-impact preview exposes the blocker and fingerprints domains. Existing property-impact confirmation preserves authored values and incoming references during supported deliberate changes. No automatic food-Concept migration is provided.

## Scanning and review

Prompts distinguish object kind / individual / taxon / culinary product / narrative role and status. Ambiguous status defaults to unspecified. Prompts explicitly prohibit name-only fictionality inference and automatic mythological labeling of living beliefs or contested figures; authored contextual references remain optional. Status is visible in both scanner review layouts and editable before creating a new identity. Existing linked identity status is authoritative.

Narrative names and aliases require explicit automatic-mention review, including unique matches and page-context matches. Their reciprocal aliases do not merge proposals. Match caches include status. Scanner variants require distinct text-supported qualified canonical names; unresolved same-name collisions fail for deliberate identity review rather than silently discarding a variant. Existing explicit IDs safely deduplicate. This applies across continuation batches, including a saved identity in an earlier batch. Same-name variants can also be deliberately created in entity creation; scanner acceptance requires choosing or disambiguating saved identities.

Discovery receives authored subtypes, status and context reference IDs. Context reference changes invalidate proposals even when the entity timestamp is unchanged.

## Parallel integration boundaries

- **Library Views:** no Library implementation files changed. Shared `EntityType`, labels and schema now contain ten types. Any fixed nine-type lists/counts must use `entityTypes` or equivalent metadata. Do not drop existing domains when exposing type changes.
- **Calendar/date workflows:** no Calendar or temporal implementation files changed. Shared entity unions and new catalogue date fields (for example artefact created date) use existing typed temporal handling. Merge additive `database.ts` and `vault-backups.ts` edits alongside Calendar migrations/archive changes; retain both sets of columns and validation.
- **Source reprocessing:** no reprocessing pipeline files changed. `database.ts` and `vault-backups.ts` overlap structurally. Preserve the new entity status column/export/import and existing source asset, evidence and page-source remapping. The attested-in regression verifies restored references still target restored Sources.
- **Settings icon color fix:** no global icon override was added. Thing has an icon plus mention/entity-icon and scanner classes consuming `--thing-bg`, `--thing-text`, `--thing-border`. Appearance defaults, settings navigation and token generation already iterate `entityTypes`. Extend the parallel branch's nine-type-specific selectors/tests to Thing and preserve token colors. The Settings browser count now derives from `entityTypes`.
- Prompt contract fixtures change only the entity discovery/scan/stream entries; provider policies remain unchanged.

## Validation and review

Final verification: `npm run build` passed (style contracts, application/test typechecks, server compilation and Vite build); `npm run test:all` passed **1,200 tests, zero failures, seven skips** (1,207 total). `git diff --check` passed. Logs: `/tmp/taxonomy-build-verified.log` and `/tmp/taxonomy-tests-verified.log`. The build retains its bundle-size advisory.

All provider activity in tests uses mocked transports; no paid AI, credentials, or real vault data was used. Dependencies were installed using `npm ci --ignore-scripts --cache /tmp/taxonomy-npm-cache` after the speech runtime's optional install-time GitHub download failed DNS resolution. Native speech runtime validation was not performed.

Final independent review confirmed no remaining review blockers. Independent read-only review examined migrations, uncertainty/religious context, domains, source-reference integrity and narrative matching. Findings fixed: omitted scanner status input, automatic narrative matching, hidden context-mode status, insufficient discovery context, discovery reference fingerprinting, and new/saved narrative continuation collisions. Focused regressions cover those paths, taxonomy compatibility, backups, source target remapping, explicit ID deduplication and legacy defaults.

Synthetic Chromium checks pass for Thing/status/reference controls, scanner review (including visible Hypothetical status), and existing entity Overview behavior. Evidence is in `/tmp/noema-taxonomy-evidence`, `/tmp/noema-taxonomy-scan-evidence`, and `/tmp/noema-taxonomy-overview-evidence` on this executor.

The broader Settings browser timeout was investigated against unchanged base `0d5239b` and this branch. The original base check reproduced the same final mobile-dark checkbox timeout (`/tmp/taxonomy-settings-base-repro.log`); the original branch check passed on rerun (`/tmp/taxonomy-settings-branch-repro.log`). The failed preview retained cardinality `many`, with two affected values and zero incompatible values, so the confirmation checkbox was correctly absent. This is a pre-existing harness focus race, not a taxonomy/product regression: type and definition selection schedule inspector focus with `requestAnimationFrame`, while the harness immediately asserts focus or sends cardinality keys without waiting for that handoff. A diagnostic branch run also reproduced the earlier immediate type-focus assertion failure.

The harness now waits for the scheduled inspector focus before asserting it or focusing the cardinality control. It retains keyboard interaction and every existing confirmation assertion, and adds final-step checks for displayed/native single cardinality, exactly two incompatible values, and disabled Apply before confirmation. The corrected harness passes against unchanged base product code (`/tmp/taxonomy-settings-base-fixed.log`); three consecutive branch runs passed (`/tmp/taxonomy-settings-branch-fixed-{1,2,3}.log`), each covering all four desktop/mobile and light/dark scenarios, with no page errors or external requests. `node --check scripts/check-entity-settings-browser.mjs` and `git diff --check` also passed. The original build/full-suite results above remain applicable because no application code changed during this follow-up. Independent review confirmed the focus waits preserve and strengthen the checks. No product code changed for this diagnosis. Temporary diagnostic scripts are excluded from the branch.

No PR, push, merge, publication or deployment was performed. No real vault was reclassified or modified.

## Integration with current main

PR #85 integrates main `16af1f997a4afd9914b2af3d7929a1d0fbd765f3` using a normal merge commit, including merged Settings color PR #82 and Library Views PR #83. All four original taxonomy/harness commits remain in history.

The only content conflict was the Settings browser script's result list. Resolution preserves the Settings palette/persistence assertions and taxonomy's inspector-focus waits and compatibility assertions. Duplicate `entityTypes` imports were reconciled. Both the count assertion and palette initialization now derive from `entityTypes`, so the test exercises Thing alongside all nine earlier types. The imported scoped Settings color rules were extended with Thing's existing tokens; global neutral icon behavior is unchanged. Independent integration review confirmed Library views use extensible type metadata and found no remaining blockers.

Integrated browser checks pass for Settings (all ten category palettes plus subtype/custom icons, color changes, reopen/reload persistence, focus and compatibility governance across desktop/mobile and light/dark), taxonomy/status/reference controls, scanner review, and Library layout/preview/range-selection behavior on 2,500 synthetic items. Evidence directories: `/tmp/taxonomy-integrated-{settings,taxonomy,scan,library}-evidence`. The integrated build, including style/type checks, passes (`/tmp/taxonomy-integration-build.log`). No real vault or paid provider was used.

Integrated full suite: **1,203 passed, zero failures, seven explicit skips** (1,210 total; `/tmp/taxonomy-integration-tests.log`). Script syntax and staged whitespace checks passed. PR remains draft and unmerged; remote exact-head CI is checked after publishing the integration commit.

## Final integration after source reprocessing

The serial merge slot integrates main `8d274abb27a487a5f8c25beb36ff3e56847d9200`, including reprocessing PR #84 and its Library preview-focus browser fix, with a normal merge. No content conflicts or additional implementation changes were required. The entity referent-status migration, contextual/source-reference backup remapping, reprocessing summary projection, generation contracts, Settings colors/focus waits and Library workflows remain intact. Independent review found no in-scope integration regressions.

Build/style/type checks and all five affected synthetic browser checks pass: Settings, taxonomy/status/reference controls, scanner review, Library views (2,500 items), and source reprocessing recovery/review/configuration preview. Logs: `/tmp/taxonomy-finalintegration-build.log` and `/tmp/taxonomy-final-{settings,taxonomy,scan,library,reprocessing}.log`. No real vault data or paid provider calls were used. PR readiness and merge are authorized for this slot after exact-head CI succeeds; no other PR is in scope.

Final integrated full suite: **1,225 passed, zero failures, seven explicit skips** (1,232 total; `/tmp/taxonomy-finalintegration-tests.log`). Whitespace checks passed. Exact-head PR CI and subsequent main CI are verified separately after publication/merge.
