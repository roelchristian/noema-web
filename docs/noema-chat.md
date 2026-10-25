# Noema Chat

Chat is a read-only research view of the current vault. Open it from the sidebar, or use **Ask about this** on a Page, Source, or Entity. A contextual scope stays bounded when evidence is missing. Resolved entity `@` mentions identify subjects; they do not expand a selected scope.

## Implementation sequence

1. **Foundations and scoped retrieval:** shared contracts, validated object IDs, normalized lexical OR queries, existing hybrid reciprocal-rank fusion, scope filtering before truncation, immutable evidence snapshots.
2. **Workspace:** sidebar and contextual entry points, composer, resolved mentions, evidence events separate from answer events, compact citation controls, evidence panel and mobile bottom sheet, original-document navigation.
3. **Structured knowledge:** bounded names/aliases, authored overviews, descriptions, properties, incoming properties, relationships, directly associated/mentioning notes, connected Sources. Ambiguous names retain separate identities; explicit mentions disambiguate structured roots.
4. **Synthesis:** automatic comparison/disagreement detection or **Search more thoroughly**, up to three deterministic retrieval passes, bounded adjacent/chapter context, document diversity and separate structured-evidence budgets. No model-directed planning loop or retrieval tools.
5. **History and refinement:** vault-isolated SQLite threads, temporary chats, rename/delete, cancellation and replay protection, stale/deleted evidence checks, usage/cost reporting, backup restoration, accessible keyboard and touch interactions.

## Selected context

Type **@** in the composer to search notes, sources, folders, and knowledge entities in the current vault. Selecting a note, source, or folder sets the conversation context; selecting another entity adds the existing resolved subject reference. Choosing a note or source limits retrieval to that object. Choosing a folder includes its notes and sources, including nested folders; linked material elsewhere does not expand that context. The selected context stays visible in a removable chip and survives reopening a saved conversation or refreshing the tab. With no selection, Chat searches the current vault.

Changing or clearing context after a conversation starts opens a fresh conversation and preserves the unsent draft. Existing saved conversations retain their original context and history. Context controls are unavailable while a request or conversation load is in progress.

Folder membership is resolved and enforced on the server. Empty folders return no evidence, and deleted or foreign-vault folders are rejected instead of falling back to a vault-wide search. Content moved outside the selected folder invalidates an in-progress answer. Folder context supports up to 200 notes and 200 sources; larger selections must be narrowed to a smaller folder or a single object rather than silently truncated. Backup imports remap folder context identities alongside other vault objects.

## Conversation inbox

While Chat is open, a wider searchable inbox on the left lists saved conversations in date groups, with the active conversation highlighted. Titles use the regular main UI font size on a single line, truncating with an ellipsis; the complete title remains available on hover and to screen readers. History has no horizontal scrolling. Swipe or drag a row right to reveal Delete, or use its action button with a mouse or keyboard. Swiping alone never deletes a conversation. Deleting a different conversation preserves the active chat and unsent draft. The inbox can be collapsed and restored from the toolbar, and this preference survives refresh. Each inbox row occupies one line. Hover or keyboard focus opens a popover containing the full title, non-default retrieval scope, relative time (just now, 2m, 1h, 2d), and exact date and time. Relative times refresh while the inbox is open. New conversations begin as **New chat** and receive a short topic title from the first completed answer, in the same provider request. The name reveals progressively in the header and inbox, respecting reduced motion. Later answers and concurrent manual renames preserve chosen names; a bounded question-based fallback handles missing or unusable generated titles. Click the conversation title to rename it inline, save with Enter or the checkmark, and cancel with Escape. New chat, rename and delete remain available; temporary conversations stay out of history. On narrow screens, **Show conversations** opens the inbox in a modal drawer with keyboard focus management. Inbox visibility, new-chat navigation and the editable conversation title occupy the existing app toolbar. The Chat shell fills the remaining viewport height, so the app document does not create a competing outer scrollbar. Conversation messages scroll independently from history, and incoming replies follow the conversation only while the reader stays near the bottom. A **Latest messages** button returns to the end without moving readers who have scrolled up. The messaging layout uses theme-derived conversation bubbles and selection surfaces, including dark mode; attribution labels stay visible for interpretations and unestablished claims. Message, evidence and drawer transitions respect reduced-motion preferences.

Completed answers have compact Copy and Regenerate icons. Regeneration applies to the latest completed answer, repeats its original question with fresh retrieval and a new request ID, then atomically replaces that answer and its evidence. It never duplicates the question or uses previous assistant prose as evidence. Failed or cancelled regeneration preserves the old answer and the current composer draft.

## Refresh continuity

For saved chats, this browser tab remembers whether Chat was open, the selected thread and scope, unsent draft, resolved mentions, search depth and message scroll position. Refresh reloads the transcript from the server before restoring the reading position. Session data is isolated by vault and cleared on explicit Chat dismissal or vault lock. Temporary chats never write session content. A refreshed in-flight answer is not automatically sent again; incomplete provider text is discarded and the persisted conversation remains available. Browser storage failures leave Chat usable.

## Evidence and answer boundaries

Evidence kinds distinguish imported text, notes, structured facts and entity overviews. Note origin additionally distinguishes recorded authored, generated and mixed contributions. Generated material is secondary evidence; a stored relationship reports what the vault records, not historical proof. Claims carry supported, inferred, or unestablished attribution.

Source evidence cites the canonical original extraction (including its stable math normalization), not editorial reprocessing derivatives. The current source reader keeps those derivatives separate; a failed editorial pass cannot promote its partial text into Chat evidence. Source hash, passage generation and readiness changes invalidate recorded original-extraction evidence.

The server creates evidence IDs and exact locators. It streams provider output and publishes each complete claim after validating its citation IDs and rechecking evidence freshness. The SSE transport sends the saved thread identity before retrieval, evidence metadata after retrieval, then claim events during generation, followed by the completely validated answer. Incomplete JSON and unvalidated claims stay on the server. The UI shows an animated three-dot typing bubble during retrieval and generation, keeping partial claims hidden. A quiet status label alongside it changes from searching sources to preparing an answer with the retrieved reference count; deeper search is labeled explicitly. Fast replies wait for a minimum 800 ms typing beat. The indicator then fades out over 140 ms and the completed reply fades in with a slight upward movement; response text never scales. The buffer is cancellable and closes with the conversation. Sent messages also ease into place; both animations respect reduced motion. Interruption, invalid output or changed evidence removes the typing indicator without displaying a partial answer. During regeneration, the previous answer stays visible until a completed replacement arrives. Only a fully completed, validated answer is saved to history. Citation validation proves registry membership and anchor freshness; it cannot prove semantic entailment or a model's attribution judgment.

Every turn retrieves again. A small number of prior user questions may resolve conversational context; prior assistant answers never enter the evidence registry. Evidence text, titles, mention text and questions are untrusted data in the prompt. Chat has no SQL generation, tools, web access, autonomous agents, imports, tasks, metadata editing, or knowledge write endpoints. Thread CRUD changes conversation storage only. Chat tables have no FTS/vector index or knowledge-corpus triggers.

Standard retrieval expands up to two distinct seed documents by one adjacent passage in each direction, with at most two added passages total, inside the seed's actual section. Deep retrieval expands up to three seed documents by at most two passages in either direction, with at most six added passages total, inside the enclosing chapter; this can include sibling sections. Source boundaries use structural marker positions and canonical extracted text. Page boundaries use heading block positions. When no chapter is established, expansion stays within the nearest section. Missing ordinals or changed versions stop expansion. Identical titles never merge distinct chapters. Every neighbor keeps its own exact reference and provenance; seeds and context have reserved evidence budget. Expansion is nonrecursive and provides a partial chapter window, not the entire chapter.

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
| POST | `/api/chat/messages` | Submit `ChatSubmit`; SSE saved thread identity, evidence metadata, validated claim events during generation, then a completed answer |
| POST | `/api/chat/cancel` | Abort a request using `{requestId}` |
| POST | `/api/chat/evidence` | Revalidate up to 24 saved evidence snapshots before inspection or navigation |

## Parallel Personas v2 integration

This branch starts at main `23815d292f1215267957ff0b79218efb513a27eb`. No unpublished Personas v2 commits were incorporated. Shared overlap requiring merge review: `src/server/transport.ts`, `src/server/modules/generation-request.ts`, `src/server/modules/intelligence.ts`, `src/shared/intelligence.ts`, `test/groups.json`, `test/helpers/generation-contract.ts`, and `test/fixtures/generation-contract.json`. Chat-specific changes use dedicated App navigation and `src/client/chat/api.ts`; Persona settings changes enter only through the separately published Persona integration. Preserve the distinct `chat` policy outside all persona injection allowlists when combining work. Neither task claims a numeric migration slot.

Main `7bb44b7c0b1fb95af44d34be0d4f72761aabc1b5` (PR 115) is integrated by merge commit `2fc9fd6`, preserving the original Chat commits. The only textual conflict was `test/groups.json`, resolved by retaining both test sets. Shared database, provider policy, Intelligence, backup and transport changes were reviewed together. The merged build and Chat browser matrix pass. After the context addition, the full normal suite passed 1,744 tests with 8 platform/optional skips and no failures; the focused Chat suite passed 50/50. No unpublished Persona code was imported. The published-head integration below is separate from PR 115.

The exact published Persona PR 116 head `2398e28a94efb74dd9fae9ada685608db47f0a98` is integrated locally by merge commit `a31311e`. This first recorded the published PR head independently of its remote merge status. Parent subsequently supplied verified merged main `66095df0339653492a92fe385ed3387b1a45a9f1`, which is now integrated by local merge `11e64c8`. The tree of `66095df` equals the published Persona head tree, and `11e64c8` has the exact same tree as its first parent `554a255` (`3a51fa622143c922929393a45b394e33b9d0186b`): this final main integration records ancestry without changing combined code. Five textual conflicts were resolved in generation policy, transport imports, shared activity types, provider-contract fixtures, and the test registry, preserving both features. Chat stays outside the persona injection allowlist (`explanation`, `review`, `sourcePage`, `personaPreview`) and shares central foreground admission with Persona comparisons. Persona expressions never enter Chat prompts, including when a caller supplies stray override fields. No Persona migration number was introduced. Parent-owned readiness, approval and remote merge actions were not attempted here. The final combined normal suite passed 1,763 tests with 8 platform/optional skips and zero failures. Independent security/persona/context review passed 54/54 and the expanded security suite passed 9/9, including all persona expressions and mutual foreground admission. All 14 combined browser scenarios passed with zero errors: Chat (4), published Personas (2), Persona Studio (4), and writing actions (4). Browser fixtures use isolated temporary Vite caches and in-memory credentials; no live provider calls or actual credential reads were used.

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
