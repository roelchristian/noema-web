# Noema Chat

Chat is a read-only research view of the current vault. Open it from the sidebar, or use **Ask about this** on a Page, Source, or Entity. A contextual scope stays bounded when evidence is missing. Resolved `@` mentions identify entities; they do not expand a selected scope.

## Implementation sequence

1. **Foundations and scoped retrieval:** shared contracts, validated object IDs, normalized lexical OR queries, existing hybrid reciprocal-rank fusion, scope filtering before truncation, immutable evidence snapshots.
2. **Workspace:** sidebar and contextual entry points, composer, resolved mentions, evidence events separate from answer events, compact citation controls, evidence panel and mobile bottom sheet, original-document navigation.
3. **Structured knowledge:** bounded names/aliases, authored overviews, descriptions, properties, incoming properties, relationships, directly associated/mentioning notes, connected Sources. Ambiguous names retain separate identities; explicit mentions disambiguate structured roots.
4. **Synthesis:** automatic comparison/disagreement detection or **Search more thoroughly**, up to three deterministic retrieval passes, document diversity and separate structured-evidence budgets. No model-directed planning loop or retrieval tools.
5. **History and refinement:** vault-isolated SQLite threads, temporary chats, rename/delete, cancellation and replay protection, stale/deleted evidence checks, usage/cost reporting, backup restoration, accessible keyboard and touch interactions.

## Evidence and answer boundaries

Evidence kinds distinguish imported text, notes, structured facts and entity overviews. Note origin additionally distinguishes recorded authored, generated and mixed contributions. Generated material is secondary evidence; a stored relationship reports what the vault records, not historical proof. Claims carry supported, inferred, or unestablished attribution.

Source evidence cites the canonical original extraction, not editorial reprocessing derivatives. The current source reader keeps those derivatives separate; a failed editorial pass cannot promote its partial text into Chat evidence. Source hash, passage generation and readiness changes invalidate recorded original-extraction evidence.

The server creates evidence IDs and exact locators. It validates the complete provider response and rechecks evidence before publishing any answer. The SSE transport sends evidence metadata and the validated answer as separate events. Provider token deltas are deliberately buffered: unvalidated partial claims are never displayed. Citation validation proves registry membership and anchor freshness; it cannot prove semantic entailment or a model's attribution judgment.

Every turn retrieves again. A small number of prior user questions may resolve conversational context; prior assistant answers never enter the evidence registry. Evidence text, titles, mention text and questions are untrusted data in the prompt. Chat has no SQL generation, tools, web access, autonomous agents, imports, tasks, metadata editing, or knowledge write endpoints. Thread CRUD changes conversation storage only. Chat tables have no FTS/vector index or knowledge-corpus triggers.

Retrieval currently bounds each standard/deep answer to 12/20 evidence items and 48 KB of excerpt bytes. Entity roots, facts and direct graph expansion also have fixed limits. Results are partial retrieval, so lack of a match does not establish absence from the whole vault. Optional model reranking is not enabled; deterministic fusion and diversity avoid an additional provider call.

Existing Intelligence admission, credential handling, usage accounting and cancellation apply. Chat is a distinct neutral request kind outside the persona allowlist. Questions and evidence bypass content diagnostics, including full debug mode. Numeric retrieval diagnostics contain only depth, pass count and evidence count. UI navigation/unmount cancels foreground work; post-await checks reject locked/changed vaults and revised evidence. Cancellation cannot prove whether already dispatched provider work was billed.

## Storage and compatibility

`setupChatSchema` is additive and idempotent; it adds `chat_threads`, `chat_messages`, `chat_evidence`, and `chat_requests` without consuming a historical numeric migration slot. Vault and thread foreign keys cascade. Evidence snapshots are inserted once and are never rewritten when content changes; validation returns current/stale/deleted views.

Temporary conversations write none of these tables and disappear on close. Saved history preserves failed/interrupted markers. Request IDs prevent re-dispatch of completed or interrupted persistent operations; a fresh request performs fresh retrieval. Portable vault backups include optional thread/message/evidence arrays, accept older archives without those arrays, remap identities on each import, and conservatively mark restored evidence stale. Local request deduplication state is not portable. Restore never resumes generation.

## API

All Chat routes require `X-Noema-Request: 1`, the selected vault's `X-Vault-Id`, same-origin access, and JSON for POST/PUT. Locked vaults return 423.

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/api/chat/threads` | List history / create a conversation with a validated scope |
| GET / PUT / DELETE | `/api/chat/threads/:id` | Read history with current evidence status / rename / delete conversation storage |
| POST | `/api/chat/messages` | Submit `ChatSubmit`; SSE evidence metadata followed by a completely validated answer |
| POST | `/api/chat/cancel` | Abort a request using `{requestId}` |
| POST | `/api/chat/evidence` | Revalidate up to 24 saved evidence snapshots before inspection or navigation |

## Parallel Personas v2 integration

This branch starts at main `23815d292f1215267957ff0b79218efb513a27eb`. No unpublished Personas v2 commits were incorporated. Shared overlap requiring merge review: `src/server/transport.ts`, `src/server/modules/generation-request.ts`, `src/server/modules/intelligence.ts`, `src/shared/intelligence.ts`, `test/groups.json`, `test/helpers/generation-contract.ts`, and `test/fixtures/generation-contract.json`. Chat also changes App navigation, but uses its own `src/client/chat/api.ts` and leaves persona settings untouched. Preserve the distinct `chat` policy outside all persona injection allowlists when combining work. Neither task claims a numeric migration slot.

During final validation, main advanced to `7bb44b7c0b1fb95af44d34be0d4f72761aabc1b5` (PR 115). It was fetched read-only and has **not** been integrated or tested with Chat. Its changed-path intersection with Chat is `src/server/database.ts`, `src/server/modules/generation-request.ts`, `src/server/modules/intelligence.ts`, `src/server/modules/vault-backups.ts`, `src/server/transport.ts`, `test/groups.json`, and `test/intelligence.test.mjs`. Shared paths require integration review; path overlap alone does not prove a textual conflict. Further Personas merges likewise require explicit integration validation.

## Validation

The normal test registry includes synthetic Chat retrieval, orchestration, HTTP/security, backup and tagline regressions. The corpus contains ambiguous entities, conflicting sources/notes, structured facts, revisions, missing embeddings and stale references. Mock provider transports exercise admission, errors, cancellation, prompt data boundaries, usage-only diagnostics, interrupted/repeated requests and validated citation publication. They do not demonstrate live answer quality.

Run:

```sh
npm run build
npm run test:all
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs npm run test:chat-browser
```

The browser harness uses temporary synthetic storage and mocked provider transport. It exercises Chromium light/dark and desktop/touch views without reading credentials or calling a paid service.

Selection-based entry and **Save excerpt as note** remain deferred as requested. External knowledge and autonomous actions remain excluded.
