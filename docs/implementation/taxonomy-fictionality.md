# Thing and referent identity

Implemented from the delegated taxonomy/fictionality scope on `codex/taxonomy-fictionality`, based on current `origin/main` at `0d5239b`. The original Library brief could not be materialized: the supported resolved-reference helper failed to download on the initial attempt and one bounded retry. The supplied detailed scope was used; original-byte verification remains unavailable.

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

The broader `check-entity-settings-browser.mjs` passed its type-count/navigation steps but timed out at its final property-definition compatibility checkbox on the mobile dark-mode pass (line 77). This governance-step failure remains unresolved; the taxonomy-focused browser check passes. It was not treated as evidence of a baseline failure.

No PR, push, merge, publication or deployment was performed. No real vault was reclassified or modified.
