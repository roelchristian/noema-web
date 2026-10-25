# Enrichment evidence, freshness, retries and multilingual candidates

This work is on `codex/enrichment-evidence-freshness`, based on main
`abd7d840e83972b8a139f5aa6abcabc0d52865dc`. It incorporates all three commits
through `753021cb71709b508f28686386903624564481fb` from
`fix/read-assessment-polling`. Following explicit publication approval, the branch
is published as draft PR [#120](https://github.com/roelchristian/noema-web/pull/120),
stacked on that dependency. No PR was merged or deployment performed. CI accepts
stacked PR bases with unchanged permissions and build/test steps.

## Changed-passage evidence

Each generated artifact retains block fingerprints. Summary refreshes compare
against the summary's own generation; classification uses its own baseline.
Combined requests take their union inside the immutable prepared snapshot.
Fingerprints preserve ordering, multiplicity, mathematical text and case.
Changed excerpts have priority over general excerpts, with heading/neighbour
context and explicit deletion, legacy-unknown and incomplete-coverage metadata.
Internal evidence remains outside the public enrichment projection.

The controlled 100-block fixture contains exactly 87,999 input characters. The
former sampled-body containment method selected 12 passages containing **zero**
distinctive edits, and also falsely selected 12 passages from the unchanged page.
The new method detects and represents **all 21** modified blocks; unchanged input
has zero changed passages. The 15,990-character prompt contains 13,923 of 18,438
changed characters and explicitly reports incomplete changed-content coverage.
Tests also cover additions, deletions, moves, repeated text, regenerated IDs,
legacy baselines, independent artifact histories and budgets exceeding 500 edits.
These are fixture-specific measurements.

## Summary provenance

A histogram remains one signal; an ordered semantic fingerprint additionally
checks word order, quantities, negation, mathematical operators/grouping,
superscripts and case-sensitive mathematical roles. Uncertain edits request a
refresh; the previous summary stays visible. `generatedContentHash` remains
immutable until generation, while local adequacy records its own assessed hash
and policy. Whitespace and ordinary sentence punctuation fixtures remain harmless.
Malformed or previously advanced legacy provenance remains visibly stale, even
through save-time hash migration. This is a conservative local heuristic, not a
proof of semantic equivalence.

Snapshot checks follow the requested artifacts: an independent classification
refresh preserves summary-only work; replacing the summary's own baseline rejects
its obsolete result. Existing content, entity-name, ownership and vault checks
remain in place.

## Retry policy

Provider status and safe typed categories are preserved. Configuration failures
wait for changed configuration; deterministic request failures wait for relevant
input/configuration changes. Transient failures use bounded backoff and
Retry-After. Output-limit failures stop with the actual budget and a terminal
explanation, rather than repeating the identical request. Local admission consumes
no dispatched attempts. Durable embedding blocks cover regenerated segment IDs;
recovery respects locked vaults and disabled automatic indexing. Provider error
messages are excluded from full and compact diagnostic traces, including SSE.

Mocked generation 400/401/output-limit cases each dispatched **once at 768 tokens**
despite four queue drains/enqueues. Embedding 400/401/403 each dispatched once.
Generation capacity respected 50,000 ms Retry-After; embedding 429/503 respected
120,000 ms. Admission consumed zero attempts. Editing a page with rejected
credentials stayed at one embedding dispatch; replacing credentials allowed the
second. In-flight credential replacement recovered without poisoning the new key.

## Multilingual shortlist

Spanish and Chinese aliases cover all 142 descendant subjects. Matching is
language-aware and content-first; existing assignments add context without
excluding new subjects. Fifteen equivalent English/Spanish/Chinese mocked notes
selected the expected detailed subjects with exactly one request each. Example
abstract-algebra shortlist sizes are 35/23/22 candidates respectively. Ambiguous
everyday words retain the broad hierarchy. Unknown wording uses all 162 validated
canonical subjects (15,264 JSON characters), trading prompt size for first-request
coverage. Curated aliases remain finite.

## Validation

Run `npm run build`, `npm run test:all`, and
`node --import tsx scripts/benchmark-page-reads.mjs --assert`.

Browser fixtures use disposable databases and mocked providers:

- `scripts/check-enrichment-browser.mjs`: previous summary and refresh-needed
  status at 1280/390 pixels in light/dark modes; four combinations, no errors.
- `scripts/check-knowledge-polling-browser.mjs`: seven cadence, privacy, refresh,
  navigation and cleanup checks; no provider calls or browser errors.

Integrated read measurements retain zero writes, changed rows, assessments,
vector loads and provider calls on page, metadata, enrichment and status reads.
Their read counts are 11/7/3/7 and payloads are 34,623/1,032/397/73 bytes. Ten
enrichment reads use 30 reads with zero writes. The fixture's internal stored
state is 59,496 bytes and remains private. Full mocked summary generation uses
one provider call and no full entity catalogue reads.

Initial integrated code validation at `b764e85`: build/types/styles passed; the full suite
completed with **1,833 tests: 1,825 passed, eight platform/optional skips,
zero failures**. Independent review found no remaining P1/P2 issues after the
artifact-scoped concurrency fix. The local working tree was clean before adding
this validation report.
