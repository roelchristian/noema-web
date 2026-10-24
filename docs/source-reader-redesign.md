# Source reader and editorial review redesign

Built from `ce6101786de7a31c61cff0ad846681d369e255a7` (Inbox AI Activity #90), on `codex/source-reader-redesign`. This work changes source presentation, reprocessing review and deterministic acceptance policy. It adds no bibliographic models, enrichment providers, imports or exports.

## Presentation and integration contracts

`SourceDocumentView` renders canonical and complete editorial snapshots in one article with identical typography and printed headings. `SourceReprocessing` controls workflow, dated version selection and the opt-in review drawer, and reports its selected snapshot through `onReadingRevision`. Selection is explicit and stored per vault/file; incomplete or stale revisions cannot become current reading. Display settings are retained separately.

`SourceReader.onToggleInspector` opens the existing Source Inspector. Metadata and future bibliography fields should continue through that inspector rather than introducing a second store. Shared integration files are `src/client/App.tsx`, `src/client/sources/SourceReader.tsx` and `src/client/styles/features/sources.css`. The workflow contract additionally uses `canonicalVersion` for request invalidation and `onReviewOpenChange` to reserve desktop reading space.

The source's processed text remains canonical for citations, highlights and reading notes. A unique recorded semantic link offers an original-passage citation; it never converts editorial offsets into original coordinates. Canonical selection/highlight/bookmark/note tools are unavailable on editorial text, with explanatory copy. Missing links disable the citation action. The original snapshot must exactly match the current loaded text before an editorial snapshot can render. Text fingerprints and full snapshot fingerprints are deliberately different contracts.

Version changes restore a unique canonical semantic node or a recorded physical page. Missing mappings receive no fabricated percentage/offset conversion. Inline correction events carry both revision and patch identity so older revisions open the matching correction.

## Acceptance and audit

New starts use Balanced. Review everything, Balanced and Minimal review are explicit choices; legacy policies remain readable and resumable. Confidence is only a threshold gate. Exact canonical substring, unchanged tokens/punctuation/order, a single exact prose node, known physical page and protected-content checks provide deterministic validation.

**Safety limitation:** the current source schema has no independently verified passage-language evidence. An English document label cannot prove an ASCII Latin or other foreign passage is English. Balanced and Minimal review therefore keep proposals pending until such evidence can be supplied. They currently do not broaden automatic acceptance. OCR and dehyphenation also remain manual because independent source corroboration is unavailable. Another AI judgment, model reasoning and confidence never supply that evidence. The explicitly selected legacy safe-formatting policy retains its narrow validated behavior.

Automatic applications retain validator/check provenance and append-only decision history. User edits and reversal append history without destroying original evidence. Applied history is outside the pending count; effective automatic/manual attribution uses the latest decision actor. Backup restoration validates new fields without rejecting legacy revisions.

## Review and performance

Review is an opt-in master/detail drawer with one expanded card, compact unified comparison, Details disclosure, explicit Edit and bulk modes, separate applied/rejected history, and twenty-row incremental rendering. Keyboard list navigation preserves focus; Escape returns focus to the opener. Desktop reserves space beside the document and narrow screens use a drawer. Revision summaries remain lightweight; full historical documents are fetched only as selected. The existing server retains its latest-100 summary bound; unlimited historical pagination is not introduced.

Existing reprocessing retry, checkpoint, uncertain-provider outcome and explicit resume semantics remain intact. No provider request is triggered by switching versions.

## Validation commands

```sh
npm run build
npm run test:all
node --import tsx --test test/source-reader-refresh.test.mjs test/source-reprocessing.test.mjs test/source-reprocessing-ui.test.mjs test/source-reprocessing-summary.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-source-redesign-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node --import tsx scripts/check-reading-continuity-browser.mjs
```

Browser fixtures are synthetic and local. The redesign harness intercepts all API calls and does not call a model. The continuity harness uses a temporary synthetic database. No live vault, paid call, destructive migration or publication is required.

Validated in this executor: production build/style/application and test typechecks passed; full suite **1,264 passed, 7 skipped, 0 failed** (1,271 total); focused source suite **53 passed**. The synthetic redesign browser passed one renderer, explicit review, printed headings, distinct snapshot/text fingerprints, version switching without AI requests, keyboard focus, document/drawer separation, edited decisions/reversal, canonical immutability and mobile dark mode. The existing continuity browser passed synthetic database restart persistence, bookmarks, citation return, source ambiguity, save failures, reload flush and mobile/end-of-source reopening.

Independent review identified and resolved snapshot/text hash confusion, stale reading refresh, reverse-switch position capture, revision-aware indicators, drawer closure/focus, unknown-policy acceptance, foreign-language evidence, applied-history attribution and ambiguous legacy CRLF presentation. Final changes also select the narrowest verified original passage for review navigation rather than its containing chapter. Build retains the existing Vite large-chunk advisory. Native Safari and live provider quality remain untested.

Local validation logs are `/tmp/noema-source-final-{build,all-tests,focused,browser}.log`; screenshots are `/workspace/noema-source-redesign-evidence/` and `/workspace/noema-reading-redesign-evidence/`. No publication, merge or deployment occurred.
