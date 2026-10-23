# Higher-risk follow-up review: deterministic embedding timing and prompt contracts

Reviewed `roelchristian/noema-web` at `965c3fb98253ba565eaf9109d1aa34d0c9aab1b8`, using `git show origin/main` and diffs. Read `AGENTS.md`. No worktree changes, tests, benchmarks, installs or provider calls. The completed paired performance comparison remains pinned separately to `14f6e07`; integration validation at `965c3fb` must not be presented as that benchmark.

## Recommendation

Prefer existing runtime/transport exports for deterministic HTTP fixtures; retain a real scheduler smoke. Keep prompt digests until per-mode invariants/negative controls prove replacement. Preserve production delays, limits and acceptance. No savings measured here.

## 1. Embedding timing and the preferred seam

`test/embedding-api.test.mjs:16–44` constructs `createApp`, whose listening handler starts runtime workers (`http.ts:10–16`, `runtime.ts:97–108`). Its HTTP helper polls every 25 ms for up to 15 seconds, accommodating five-second discovery/page debounce plus one-second worker ticks. It repeats those waits while testing routes, persistence, logs, search and isolation. The injected Intelligence clock advances 61 seconds per read to avoid admission throttling, but does not advance scheduler Date time.

`Embeddings.tick()` is already public/awaitable (`embeddings.ts:182`) with busy/closed guards. Discovery uses `Date.now()`; SQL due comparisons use `now()` (`validation.ts`, backed by `new Date()`). Page indexing and source embeddings also use both representations. Partial time injection is unsafe. Batch tests already manually tick/reopen and set retry dates to the past; retain their write audit, reversed response indexes, stable IDs, split limits and uniqueness, while adding exact 30/60-second retry boundaries.

Prefer a **test-only manual runtime HTTP fixture**: construct `createRuntime`, `createTransportHandler(runtime,clientRoot,sockets)` and `trackConnections`, with a real HTTP listener but without calling `runtime.start()`. Drive `runtime.embeddings.tick()` explicitly and retain real HTTP writes/security. Keep this wiring in one helper and retain one real-clock `createApp` automatic-save smoke to detect drift.

Verify controlled Date advances both `Date.now()` and `new Date()`. Avoid global timer mocks around live HTTP: provider timeouts, sockets and deadlines also use them. Stop bounded ticks on durable state, with queue diagnostics on failure. Use deferred provider start/release barriers for races. Close connections/runtime/database in failure-safe teardown; the PR56 semantic scheduling caveat below also applies.

Production clock injection across embedding discovery/indexing/source retries is a broader alternative, not the first cleanup. Avoid application-wide `now()` changes, shortened production debounce, HTTP tick endpoints, artificial completed queue state, or simultaneous manual/automatic tick owners.

## 2. Required invariant / negative-control map

Controls below are proposed, unexecuted temporary mutations; never commit them.

| Surviving invariant | Control that must fail |
| --- | --- |
| Real `createApp` automatic-save smoke | Disable embedding interval/save scheduling |
| Zero calls before debounce due, one at boundary | Ignore due date/use inconsistent clocks |
| No duplicate discovery enqueue | Remove gate or deduplication |
| Durable 30/60-second backoff across restart | Retry immediately/reset persisted due date |
| Batch counts 9/16/17/32, audit writes, reversed provider indexes, stable job IDs | Duplicate write/map vector by response position |
| Durable split sequence `[16,8,8,4,4,4,4]` for page/source | Lose reduced limit on restart |
| Deferred stale/lock/delete/disable results cannot attach | Remove eligibility/content guard |
| Real HTTP origin/CSRF/vault/lock/privacy checks | Remove guard/leak upstream error or note body |
| Reopen preserves indexes/activity without provider call | Lose persisted state/re-request work |
| Fixture quiescence before close | Omit awaited work or closed guard |

Require unchanged logical coverage/skips, no production behavior changes, matched repeated before/after runs and no post-teardown work. Measure residual scheduler smoke separately; savings are bounded by measured critical-path contributions, not sums of case durations.

## 3. Prompt snapshot replacement

`intelligence.test.mjs:273–287` snapshots `{policy,promptDigest,bytes}` for 18 modes. Digest covers instructions, input **and schema**: trust separation, source policy, required fields and payloads as well as prose. Nonempty-text/model/token checks alone are insufficient replacements.

Keep typed exhaustive `generation-contract.ts` and intentional compile failures. Existing explicit trust/language/schema/persona tests (`intelligence.test.mjs:186,213`, `source-page-options-ui.test.mjs:99`, `page-enrichment-generation.test.mjs:12`, `ai-personas.test.mjs:42`) cover selected modes, not the entire snapshot contract.

Retain exact policy/schema expectations. Independently assert observer UTF-8 bytes of instructions plus flattened input text (`intelligence.ts:304–305`), **not** JSON envelope/schema bytes; include non-ASCII input. Add independent per-mode role/input, schema/strictness, tools/budget, persona and trust-placement assertions. Keep meaningful policy passages. Remove each digest only after controls prove replacement coverage. Expected schemas must not import production builders. Never normalize away entire instructions/input, numbers, fields or tools; mocked tests do not establish model adherence.

| Contract | Negative control |
| --- | --- |
| Validation excludes note data | Inject note sentinel |
| Source/note remains untrusted data | Move sentinel into trusted policy/drop input |
| Language/evidence outrank style/user focus | Remove priority clause |
| Structured schema fields/strictness | Drop required field/allow extra fields |
| Utility/preprocessing excludes personas | Add persona to title/sourceMath/editorial/collectionRules |
| Streaming/admission/timeout/output bounds remain | Keep independent existing mode matrix; inject faulty bound/channel |
| Request policy and bytes | Enable tools/storage/change budget/miscount multibyte input |

## 4. Current collection seams

Manual-runtime HTTP wiring remains valid: `http.ts` is unchanged; transport exports retain signatures (`transport.ts:46,558`). Construction wires query embeddings **and rule generation** before `start()` (`runtime.ts:71–76`). Rule generation uses real Intelligence admission, activity success/failure and request-byte observers. Example evaluation uses local saved vectors; no separate example provider or periodic collection worker was introduced. Do not replace runtime callbacks with direct canned output in HTTP contract tests.

**Without `start()`, background tasks still run.** `SmartCollections.decorate()` schedules collections (`smart-collections.ts:151`); batches use `setImmediate` (`:119`) and non-rule incremental work uses a 300 ms timeout (`:125`). Batch sizes are rules=100, semantic/hybrid=8, examples=2 (`:86`). Keep ordinary embedding fixtures collection-free. Collection fixtures must await all batches before teardown. `runtime.close()` (`runtime.ts:110–112`) still has no smart-collection disposal/cancellation hook; close alone does not prove callback quiescence. A cancellation seam needs separate product review.

Preserve real vector writes and `smart_semantic_dirty_*` triggers (`smart-collection-schema.ts:24–30`), including index/settings changes and example edits. Semantic/hybrid preview keys now also include the parsed deterministic rule (`semantic-collections.ts:72–85`); the same description/vector with different hard filters must not share results. Description tokens remain vault/hash/model/dimension bound, expire after 30 minutes, and lock epochs invalidate tokens/pending results. Saved vectors can be reused locally, so token expiry need not imply provider spend.

HTTP lock now calls `organizer.smart.clearCaches()` **and** `embeddings.clearQueryCache()` (`transport.ts:303`). Smart clearing covers semantic preview, Store-scoped example query vectors and example previews (`smart-collections.ts:20`); example caches also key vault epoch/revision/config. Test each cache boundary. Positive/negative example identities, coherent current vectors, contrast, overlap weighting and fingerprints are independent contracts, not redundant semantic cases.

Retain `semantic-collections.test.mjs:37` (fingerprints), `:41` (deduplication), `:48,84` (lock/pending), `:70` (expiry/model), `:101` (indexing gap), `:107` (cache), `:121` (yielding). Add negative controls for disabled dirty triggers, omitted epoch/cache clearing, changed-vector cache reuse and provider-spending refresh. Retain `intelligent-collections.test.mjs:16,23,32,61,70` for hard-filter-first reads, valid examples, vector-change fingerprints, full refresh/overrides and backup/no-spend. Disable hard filters or an example fingerprint input and require these tests to fail.

### New eighteenth generation mode

The exact kind is **`collectionRules`**, label `collection rules`; `generation-contract.ts` now has 18 entries and rejects personas at compile time. `generation-request.ts:94–95` sets exclusive/manual admission, standard model with reasoning none, 4096 output tokens, 32768-character output and default 45-second timeout. Keep generic payload/admission/timeout/output/cancellation tests for this mode.

Its generic snapshot uses synthetic instructions; it does **not** cover `buildCollectionRulePrompt` policy. Preserve independent builder/service assertions for metadata-only bounded vault context, untrusted description/names, supplied stable IDs only, supported AST vocabulary/limits, unsupported-criteria rejection, UTC relative-date interpretation, no automatic save and explicit confirmation. `intelligent-collections.test.mjs:42,49,57` covers proposals, malformed/invented output and lock/unlock races; DOM tests in `collection-rule-generation.test.mjs:19,25,30,34` cover explicit generation, stale responses, retry and example draft evaluation. Negative controls: put a page body in context, admit a foreign/invented ID, accept SQL/unsupported AST, omit the post-provider epoch check, allow persona, or auto-save the proposal. Each must fail a surviving independent assertion before removing its digest.

PR59/60 reconciliation: runtime, Intelligence, embeddings, generation contracts and collection-rule context are unchanged. Folder/collection descriptions are separate human metadata, not new prompt input. `Organizer.matchingUnchanged` preserves existing matching state on metadata edits (`organization.ts:42–92`); retain `organization-descriptions.test.mjs:30` across all smart methods. Keep real schema/backup/deletion paths. Inbox/temporal route edits leave transport exports and cache-lock anchors unchanged (`:46,303,558`).

## Cost, risk and sequencing

1. Deterministic HTTP fixture: estimated 1–2 days; medium risk. Verify clocks, HTTP wiring, races/teardown; keep a real scheduler smoke.
2. Production clocks: 2–4 days; medium/high risk. Defer unless test-only seams fail.
3. Prompt contracts: 2–3 days plus review; medium/high coverage risk, negligible runtime saving. Keep digests until replacement is proved.

Estimates only; no validation or blockers. The paired benchmark uses `14f6e07`; final `965c3fb` integration checks are separate.


PR62 integration addendum (2026-10-23): the implementation branch was reconciled separately onto `ee4d8f3af9d2f51c52526bb45e299a25b0cc6eef`. The higher-risk source review above remains explicitly pinned to `965c3fb`; PR62 adds history routes and backup evidence remapping, without changing the runtime/embedding/generation modules underpinning the preferred seam. Current full discovery retains the new history regressions. No higher-risk recommendation was implemented or savings extrapolated.
