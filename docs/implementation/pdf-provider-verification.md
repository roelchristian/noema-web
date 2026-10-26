# PDF provider verification — 2026-10-26

Verified using current official documentation, before adapter implementation. No authenticated requests or paid evaluations were made. Published capabilities do not establish account access or transcription quality.

| Model | Context / ordinary maximum output | Standard input / output USD per million |
| --- | --- | --- |
| [gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 1,050,000 / 128,000 | 2 / 10 |
| [gpt-6-astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 1,050,000 / 128,000 | 10 / 50 |
| [gemini-3.8-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) | 1,048,576 input / 65,536 | .75 / 3.75 through 2026-12-31; 1.50 / 7.50 from 2027-01-01 |
| [gemini-4-argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon) | 1,048,576 unified / 65,536 | 2 / 10 through 2026-11-30; 4 / 20 from 2026-12-01 |

All four IDs, PDF/vision and structured-output capabilities verified. No invented snapshots or historical aliases added. Effective prices, cache prices, date and registry version live in `src/shared/document-models.ts`. Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Thinking and cache usage are retained separately; inference caching is never assumed from file reuse.

## Request contracts

OpenAI: [PDF file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [strict structured output](https://developers.openai.com/api/docs/guides/structured-outputs), [Files creation](https://developers.openai.com/api/reference/resources/files/methods/create). Files purpose `user_data`, one-hour expiry, Responses `input_file` and strict `text.format` schema, stateless `store:false`. Enforce under 50,000,000 bytes independently of application MiB limit. Check refusal/incomplete state before parsing; delete remote file after each attempt.

Google: [Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview), [API versions](https://ai.google.dev/gemini-api/docs/api-versions), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [PDF processing](https://ai.google.dev/gemini-api/docs/document-processing), [Files](https://ai.google.dev/gemini-api/docs/files), [Interactions reference](https://ai.google.dev/api/interactions-api). Use stable `/v1/interactions`, PDF `document` part, `store:false`, JSON `response_format`, normalize `steps/model_output/content` and usage. No tools, explicit caching or long decode. Enforce 50 MB / 1000 pages, poll processing uploads, detect expiry, retain originals.

Discrepancy: some Google guide/reference REST examples still show `/v1beta/interactions`. The API-versions page explicitly documents GA Interactions in `v1` and supplies a stable REST example; implementation follows that authoritative version statement.

Unverified detail: the brief's OpenAI long-input threshold/surcharge was not recoverable from the accessible official pricing text. Do not assert invented surcharge multipliers. Initial OpenAI document requests conservatively stay within a 272,000-token application bound pending separate tariff verification. This bound is an application restriction, not a claim about the model's published capacity.

Stateless synchronous requests cannot promise provider retrieval/cancellation after connection loss. Capability metadata advertises those as unavailable; dispatched transport interruption is an unknown paid outcome and must require explicit recovery. Upload transport failure before generation has no generation charge claim. Mocks establish envelope/durability behavior, not provider quality or actual billing.

## Portable PDF and credentials

Official packages pinned from npm registry: [pdf-lib](https://pdf-lib.js.org/) 1.17.1 (page construction/splitting), [PDF.js](https://mozilla.github.io/pdf.js/) / pdfjs-dist 6.4.299 (text inspection/rendering), @napi-rs/canvas 1.0.13 (PNG canvas). Install used `--ignore-scripts`. These libraries do not replace `scanSourcePDF` admission.

Scanner-admitted bytes are parsed in bounded child workers. Rejected originals require passive raster reconstruction inside a read-only, network-isolated bubblewrap sandbox; output is scanned again. In this workspace the harmless bubblewrap capability probe failed with `setting up uid map: Read-only file system`; that path remains explicitly unavailable and fails closed. It was not retried with weaker isolation. No macOS extraction fallback is invoked by portable operations.

ServerSecretStore implements the existing abstraction using explicitly supplied environment fields `NOEMA_OPENAI_ACCOUNT`, `NOEMA_OPENAI_API_KEY`, `NOEMA_OPENAI_EXPIRES_AT` (likewise GEMINI). The account must match the existing vault intelligence account UUID; keys are never cross-account defaults. Browser writes/removal report server configuration requirements. macOS keeps Keychain. No credentials were configured or persisted during implementation.
