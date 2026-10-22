# Related-note refresh audit

Cloud implementation based on main `fdaea475def24f948b16e88a4d17c70a833152a5` (PR26), October 22, 2026. No provider/model changes, infrastructure, CI changes, or external AI calls were needed.

## Behavior and API

`RelatedNotes` owns its request/status/result state below the Knowledge panel. The inner component is keyed by vault and page even if a caller forgets a key. An inactive, previous-page panel does not display its related section. Each request captures the saved revision; responses and errors from obsolete revisions or aborted subscriptions cannot commit. The shared watcher serializes checks and schedules one follow-up when work is already running.

The existing `GET /api/pages/:id/related-notes` array response remains compatible. The client requests `?state=1&previous=<id>&previous=<id>` instead. At most five previous IDs, each at most 128 characters, are accepted. The response is:

```ts
{ notes: RelatedNote[]; pending: boolean; retainedPageIds: string[] }
```

`pending` means the query page's projection/current saved embeddings are incomplete, rather than a completed empty ranking. During that interval, previous results retain their order and displayed text; the server revalidates the supplied IDs against the selected vault and existing candidate eligibility rules. Partial ranking is skipped when there are previous results because the client cannot display it. An initial reader may still receive available partial matches. A completed empty ranking clears the old list. A page below the configured character minimum is a completed empty result, not an indexing gap.

The current workspace page list also filters deleted notes immediately, without waiting for the server poll. Server checks exclude deleted, foreign, dirty/stale or below-minimum candidates using the same SQL eligibility predicate as ranking. Pages have no archive flag; source archive/restore continues to invalidate and filter source suggestions through the existing rules. Access errors clear retained notes, while transient request/version failures keep them with a small polite message and Retry. A failed version read resets its listener's version so recovery with the same version can reload results.

While updating, a static 12px refresh glyph beside the heading provides a named polite status and tooltip. It introduces no animation or new motion requirement. Initial request loading, initial errors, and empty messages remain distinct from retained results. Only ordered IDs, displayed titles and excerpts determine result equality; invisible score changes reuse the previous array and objects. A memoized list and stable callback isolate rows from status and callback-identity churn. Rows keep their keys, focus and scroll through unchanged refreshes and reorder safely when results change.

## Calculation path and efficiency

- Typing changes local document state. The existing `PageSaver` coalesces saves for 400ms; unsaved keystrokes do not directly invoke similarity retrieval. Saved revision changes now schedule a 400ms version check without resubscribing RelatedNotes or forgetting its last version. PageSources still uses its existing revision subscription lifecycle; both sections share the version watcher.
- The watcher checks every 15 seconds while visible, immediately on becoming visible, and debounces focus/AI-activity hints. Repeated hints share one timer. In-flight version/result checks are serialized with a single pending follow-up. Identity changes, inactivity and unmount abort the old RelatedNotes request and unregister it. Revision changes allow current network work to finish but reject its result, then check again; aborting the browser would not stop synchronous server scoring already underway.
- Enrichment title/page revision changes, embedding insertion/deletion, settings, source lifecycle changes and corpus edits invalidate the existing durable vault suggestion version via SQLite triggers. These broad invalidations are intentionally conservative; no valid refresh was removed. Background embedding completion is detected by the next version poll; an AI-activity/focus/visibility hint can shorten that delay. Navigation starts a fresh identity-specific listener and no ranked-result cache is shared by the browser across identities.
- `suggestionVersion` uses page/vault metadata queries; it neither projects a document nor loads/scores corpus vectors. `relatedNotesState` synchronizes only the selected dirty query page, tests embedding completeness, revalidates up to five retained IDs, and uses the existing result cache when ranking is useful.
- The server's 128-entry vault/page/version cache preserves ranked-result references on a hit. Current hashes, model and dimensions govern saved-vector reuse. Ranking uses saved vectors exclusively and never asks an AI provider to embed a query. The separate text-search query-vector promise/TTL cache is already shared by semantic search and passage retrieval; it is not part of related-note retrieval and remains unchanged.
- The existing vector adapter caches parsed normalized candidates (capacity 4096) and normalized query arrays. A recomputation still reads current vectors and compares all eligible candidate segments against saved query segments, chooses each page's strongest pair, sorts, and limits to five. No ranking algorithm was changed.
- PageSources previously traversed all document blocks with `noteCitations` on local suggestion/loading updates and unrelated parent updates. That derivation is now memoized by the immutable `page.blocks` reference. RelatedNotes itself performs no whole-document computation and never updates editor or workspace state.

This is not O(1): changed dirty pages still require text projection/tokenization/segmentation; invalidated rankings still read candidate vectors and do roughly O(query segments × candidate segments × 1536) numeric work, plus result sorting. Metadata and eligibility checks also have SQL/index costs. Retained-ID validation is bounded to five pages, not necessarily five segments. Global vault invalidations can still cause unnecessary ranking when another item changes. The work deliberately preserves those safe invalidations rather than introducing a new index or narrower dependency model.

## Repeatable measurements

`node scripts/measure-related-notes.mjs [baseline-ref]` instruments disposable copies of baseline and current sources. It uses synthetic responses, including new array instances and changing callback identities; no production counters are added. Baseline defaults to `origin/main`.

| Scenario after the initial result | Before | After |
| --- | ---: | ---: |
| Three revision hints, unchanged durable version: version reads | 3 | 3 |
| Same hints: ranked API calls | 3 | 0 |
| Same hints: result-array commits | 3 | 0 |
| Same hints: list renders | 9 | 0 |
| Three changed-version refreshes with identical displayed results: ranked API calls | 3 | 3 |
| Same refreshes: result-array commits | 3 | 0 |
| Same refreshes: list renders | 3 | 0 |
| Editor sibling renders during either scenario | 0 | 0 |

These are operation counts, not timing or whole-app React profiling claims. Focused server instrumentation verifies 20 version polls cause zero projections/rankings; an initial snapshot plus 20 unchanged snapshots uses one ranking and identical cached result references. Ten retained-result reads during a partially embedded query use zero corpus rankings; completion uses one. Twenty AI-activity hints coalesce into one version read. Provider calls in those synthetic server fixtures are zero.

## Validation and evidence

Focused tests are consolidated in `related-notes-ui`, `source-suggestions`, and `embedding-efficiency`; existing panel tests mock the new response contract. Coverage includes delayed/pending results, meaningful and score-only changes, completed empty, initial loading/error/retry, transient failure and same-version recovery, rapid revisions, stale responses across revisions/page/vault switches, inactive panels, deleted/cross-vault/ineligible results, source archive/restore, and watcher sharing/coalescing. The standard full suite discovers the new DOM test through `test/groups.json`.

`npm test` passed on the final sources: build/style guard/application and test-helper typechecks, then 742 tests total, 736 passed, six platform skips, zero failures. Skips are the macOS Keychain and native PDFKit/Vision/Swift/sandbox checks. The existing large JavaScript chunk warning remains. `npm run test:browser` passed editor, reading continuity, entity linking, selection toolbar, and entity-scan browser checks. The PR26 hyperlink-paste browser check also passed. The dedicated related-notes check passed in Chromium 154.0.8037.57 at desktop/mobile widths with no page errors.

The dedicated actual-app browser check is:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
  node --import tsx scripts/check-related-notes-browser.mjs
```

It starts a disposable SQLite-backed real application, blocks nonlocal browser requests, seeds synthetic saved vectors, and checks Chromium at 1440px and 390px. It verifies delayed retained results/status, a real save's embedding gap, changed titles, deletion, no horizontal overflow, focus/scroll stability, zero editor DOM mutations during section updates, and zero list DOM mutations on an unchanged response. Screenshots use `caret: 'initial'` so Playwright's screenshot caret-hiding styles do not contaminate editor mutation measurements.

Four screenshots are written under `/workspace/shared/related-notes-evidence` by default: desktop/mobile retained-updating and changed-results PNGs. These are local cloud files, not uploaded screenshot IDs. Browser validation uses Chromium device emulation, not native mobile hardware or Safari.

Remaining limits: the 15-second visible-page poll bounds background embedding/corpus refresh latency when there is no event hint. If indexing is disabled, unconfigured or cannot finish, the query can remain pending and keep its last eligible suggestions; this feature does not retry provider jobs or trigger paid work. Existing embedding job controls/notifications remain responsible for those failures. Browser cancellation does not cancel synchronous backend SQL/vector scoring. Related lists are retained within the mounted identity, not persisted across closing/remounting the panel. None of the measurements establishes performance on a real large vault.
