# Narration expansion implementation checkpoint

Implemented on local branch `codex/narration-expansion`, based on merged main `2b20aaa7024377b249c3c94426f3bf6c4aeb9fe0`. Feature and Settings work is arranged into dependent draft PR branches: `codex/section-playback` (complete TTS expansion) → `codex/settings-voice-rail` (Settings follow-on). The original local branch and commits listed below are preserved; cherry-picked publication commits have different IDs. The user authorized creation and merge in dependency order after exact-head build/full-suite CI and sound review. No deployment, branch deletion, force push, real credential operation, or live/paid synthesis was performed.

## PR70 review and merge

Reviewed all 11 changed files for bounded opaque key handling, complete WAV/C2PA normalization, seven-day cache expiry, vault paths and default delivery. No merge-blocking finding. Merged PR70 with an expected-head guard for `85c7aadb48be242e4d5c22f5fbca372a3b1d199e`.

- Exact PR head: [CI run 40002673988](https://github.com/roelchristian/noema-web/actions/runs/40002673988), successful `noema/core`, including install, build/styles/types and full suite.
- Merged main: [CI run 40003096741](https://github.com/roelchristian/noema-web/actions/runs/40003096741), successful `noema/core`, including build and full suite.
- Merge: [PR70](https://github.com/roelchristian/noema-web/pull/70), commit `2b20aaa7024377b249c3c94426f3bf6c4aeb9fe0`.

## Local phases

| Phase | Commits | Result |
| --- | --- | --- |
| Shared rules and provider contract | `e3cca17`, `be7f6ff` | Validated persisted narration preferences; deterministic nonrecursive dictionary/rules; protected content; native Kokoro/OpenAI pace; Gemini guidance; exact bounded PCM pauses and complete cache identity. |
| Pronunciation and narration controls | `6abf7c8`, `2dca046` | Presets, generated pace, pauses, accent/tone/expression, locale/rules, dictionary editor and explicit cancellable Listen previews. |
| Sections, playback and resume | `de2b135`, `dc7cc00`, `ca960cb`, `d4887cd` | Stable section metadata, unary generation with two-section lookahead, early playback, partial failures and explicit retries, complete-download preparation, paragraph navigation and revision-validated scoped resume. |
| Integration guards and evidence | `c4bd2c1`, `432ef44`, `0178e48`, `9382464`, `4955a77` | Cache/preview isolation, stale saved-setting rejection, exact response contracts, source validation before synthesis/media activation, paused-source invalidation and honest section controls. |
| Separate Settings follow-on | `dadb471` | 900px bounded pane, compact internal spacing, responsive left icon rail, Voice tab, credentials grouped in AI, persistent drafts, accessible vertical keyboard navigation. Started after the TTS full-suite checkpoint passed. |

## Validation

Original combined implementation checkpoint (before publication review added two regression tests):

- `npm run build`: passed, including style checks, application/test type checks and production bundle.
- `npm run test:all`: **1,179 total; 1,172 passed; zero failed; seven explicitly skipped**.
- Focused playback tests passed, including backpressure, full download integrity, partial retry, resume, source edits/deletion, selection/provider/vault cancellation and no stale future autoplay.
- Focused Settings/provider/calendar run: 33/33 passed.
- `git diff --check`: clean.

The seven suite skips are the macOS Keychain adapter, local Kokoro model integration (model absent), and five macOS PDFKit/Vision/Swift/sandbox native tests. All new synthesis validation uses synthetic content and injected/mocked providers.

Official API references checked: [Google speech generation and metadata](https://ai.google.dev/gemini-api/docs/speech-generation), [OpenAI Realtime session speed and instructions](https://developers.openai.com/api/reference/resources/realtime/subresources/sessions/methods/create).

## Publication review

Review identified two related P2 gaps: code/math segments in table/column cells were not protected, and inline protected content lost its structural pause category. Commit `159bbcb` fixes both, keeps protection separate from pause metadata, updates resume revision identity and adds regression coverage. Focused editor speech tests pass 34/34. The complete TTS phase is PR #71; the dependent Settings phase is PR #72. The earlier controls-only boundary remains local because it lacked the editor safety plumbing. Exact published-head and final main CI evidence is recorded in those PRs.

## Remaining validation and deliberate limits

Live provider behavior/quality, native Keychain and real-browser playback/layout were not validated. No screenshots were requested or taken. Cloud accent/tone/presets remain approximate guidance. Date conversion is intentionally limited to valid ISO dates; abbreviation expansion uses a small language-specific allowlist. Blocks containing inline code/math conservatively bypass transformations. Excessive expansion fails explicitly.

Resume can regenerate earlier uncached sections before reaching a far-ahead boundary, preserving complete-download behavior. A retry after an ambiguous provider failure may incur additional usage; completed sections are retained and never regenerated by the retry. Selections are bounded to 256 sections and 128 MB of generated audio.

See [intelligence documentation](../intelligence.md) for behavior and security details. No remaining implementation blocker. PR creation and merge are approved, subject to successful review and exact-head CI. Each phase head is validated separately before publication.
