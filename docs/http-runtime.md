# HTTP runtime ownership

`http.ts` preserves `createApp(store, clientRoot, intelligence?, network?, access?)` and its `http.Server` return value. It is the server composition entrypoint: build one runtime, connect one transport handler and peer boundary, and attach lifecycle hooks. `runtime.ts` constructs services once, adapts background enrichment, and owns `start()` / `close()`.

Construction intentionally still writes before listening: source-file recovery, activity recovery and pruning in service constructors, page retention and image cleanup retain their original order. Workers and vault-deletion cleanup begin on `listening`, at the existing intervals; `close` clears intervals and disposes the same services. Moving recovery into `start()` would let callers observe unrecovered state after `createApp()` and was deliberately avoided.

`transport.ts` owns peer and network checks, same-origin/client headers, body limits, route matching, JSON/static response contracts and the remaining route families. Activity response classification is encapsulated by `AIActivityLog.finishResponse`, so JSON adaptation no longer inspects activity tables. Other families remain inline for incremental extraction; this introduces no router registry.

`routes/source-pages.ts` is the first extracted family. It receives explicit services plus the parsed request and validated vault scope. It owns JSON/NDJSON adaptation, stream headers, the disconnect signal, heartbeats and errors after headers. Preparation still runs before stream headers. Heartbeats begin after the initial thinking event only for new work, and stop in `finally`; cached drafts/pages do not start one.

`modules/source-page-generation.ts` owns preparation, math processing, duration estimates, preliminary/final parsers, named provider requests, staging, activity and notifications. Its typed callbacks and `AbortSignal` have no HTTP dependency. The adapter checks access before each event; the service rechecks after provider work before finishing/staging. Preliminary records can reset the preview but cannot be saved as final blocks. Completion is persisted before emitting the review event, so a lost terminal write leaves a replayable draft and completed activity. Acceptance and restart recovery retain their existing idempotency.

Lock/unlock and credential routes retain their existing sequencing, including enrichment pauses and query-cache invalidation. Provider admission/redaction, editor, autosave and reading implementations are unchanged. Tests use synthetic sources and stub generation only.
