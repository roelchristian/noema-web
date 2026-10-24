# AI and Voice settings

AI and Voice remain separate left-hand Settings categories with independent mounted
client drafts and save operations. AI saves never include Voice fields, and Voice
saves never include AI fields. `/api/intelligence/preferences/ai` and `/voice`
whitelist their category and merge synchronously with current server state into the
existing unified preference record. The legacy full configuration endpoint remains
available for existing callers; the Settings interface does not use it.

AI has a compact writing overview, Writing style, Writing model, Page enrichment,
shared provider connections, vault-specific Search indexing, Activity & usage and
advanced diagnostics. Opening a secondary view keeps the AI draft. Indexing mounts
on first use, keeps its own vault draft across navigation, ignores stale refreshes,
and stops its five-second timer whenever the view or category is inactive.

Voice centers provider, suggested voices, auditioning, pace and supported delivery.
Browse all voices uses the existing allowlisted voice names and a small text filter;
the selected voice stays visible even outside the filter. Narration/pronunciation,
local setup and cache information are secondary views. Unsupported delivery controls
are omitted. Kokoro remains the local default. Merely visiting another Settings
category does not initialize AI, Voice, credentials, or local model status.

`ProviderConnection` is reused for OpenAI and Gemini, with ready, setup required,
checking and error states. Credentials remain write-only and transient in forms;
secure storage, expiry and provider-request sanitization are unchanged. Credential
management is global; indexing settings and records belong to the selected vault.
Saving credentials does not contact a provider. Explicit OpenAI validation retains
its existing short synthetic generation and charge disclosure; Gemini validation
checks model metadata without generating audio.

## Draft audition boundary

`POST /api/intelligence/speech/preview` accepts only text, provider, voice and narration.
It requires an unlocked vault and the existing request protections. The server
validates its allowlists, narration and credentials, enforces 500 characters before
and after narration transformation, at most five attempts per minute, one concurrent
speech operation, timeout and client/vault/credential cancellation. Cloud requests
also use the existing manual request budget. Auditions cannot modify persisted
preferences, credential values or normal audio cache entries. Responses use
`Cache-Control: no-store`. Cloud transmission and charges are disclosed before use.
Clients abort and revoke audio on draft changes, navigation or cancellation and reject
late responses. Provider selection, voice and narration are supplied explicitly;
saved enable/provider/voice values do not constrain an audition. Auditions appear
under Speak in the existing activity log with available cloud token usage, using
the draft model/provider. Diagnostics retain safe metadata, never audition text,
keys or audio, including in full debug mode.

## Scope and deferred work

The brief was supplied completely in the delegation after the authorized Library
transfer and one retry failed. No claim is made that the original file was locally
materialized.

Searchable voice browsing is included because the repository already defines a
bounded verified voice allowlist. Richer preview scenarios, automatic comparisons,
and AI performance/cost profiles are deferred: there is no established scenario or
profile configuration to reuse without inventing model or price assumptions. The
existing activity/usage and pricing behavior is preserved. There are no new cache
retention or delivery controls beyond capabilities already supported by the server.

Validation uses synthetic vaults and mocked providers; no paid requests, real vaults
or secrets are required. Real macOS Keychain and actual local/cloud synthesis remain
platform/integration checks. No publication, merge or deployment is part of this work.

## Verification

Validated on Linux/Node 24 after rebasing onto `f8542fb` (merged #85 Thing,
#86 Calendar and #87 favicon). Independent review found no remaining blocking
issues after fixes to lazy model checks, cloud disclosures and preview accounting.

- `npm ci --ignore-scripts --cache /tmp/noema-npm-cache` succeeded (same install
  mode as CI; real ONNX integration is not needed for mocked tests).
- `npm run build` passed style contracts, app and test typechecking, server
  compilation and production client build. Existing large-bundle warning remains.
- `npm run test:all`: 1,250 tests; 1,243 passed, seven skipped, zero failed.
  Skips cover macOS Keychain/native PDF tools and real Kokoro model integration.
- Focused speech, Voice, connection and category DOM suites: 28/28 passed.
- `scripts/check-ai-voice-settings-browser.mjs` passed in Chromium 154, light and
  dark: independent panels/payloads, retained drafts, draft audition cancellation,
  stale-response rejection, cloud disclosures, capability omission, searchable
  voices and computed 13px styling. All API responses are mocked.
- `scripts/check-entity-settings-browser.mjs` passed after integrating main.

The broad dark-mode browser harness initially failed on unchanged main because
Calendar's source-evidence link now belongs to the Evidence section. Its harness
now explicitly opens that section; no Calendar product behavior was changed.
The corrected broad dark-mode run passed all 12 desktop/mobile, light/dark and
accent cases with zero page errors (Chromium 154). Its preexisting out-of-month
light Calendar contrast limitation remains documented by that harness; no new
contrast exception was added.
