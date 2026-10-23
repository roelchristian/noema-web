# Noema

A local knowledge workspace for writing, reading, and connecting ideas. Keep notes, original sources, and reusable knowledge entities together in self-contained vaults backed by SQLite.

No accounts or API keys are required for local editing. Optional writing/search features use your own OpenAI API key; remote Gemini speech uses a separate Gemini API key.

## Make room for connected thinking

- **Write freely.** A block editor with slash commands, tables, images, LaTeX mathematics, semantic blocks, and automatic saving.
- **Connect your knowledge.** Link pages and reference people, places, works, and concepts with reusable entities, aliases, properties, and relationships.
- **Read alongside your notes.** Import TXT, Markdown, and PDF sources; highlight passages, add reading notes, and keep citations attached to their originals.
- **Organize your workspace.** Keep separate vaults, nested folders, collections, favourites, and recent items. Export and restore vault backups.
- **Add intelligence when you need it.** Use optional AI summaries, generated titles, reviewed entity suggestions, and semantic search.

## Get started

Requires **Node.js 22.13 or newer** with `node:sqlite` support.

```sh
npm install
npm start
```

Open [localhost:3000](http://localhost:3000). Stop the server with Ctrl+C.

LAN access is enabled by default. Use **Settings → Security** to limit access to this computer, or start with `LAN=0 npm start`. LAN mode has no user accounts or HTTPS; use it only on a trusted network.

For development, run `npm run dev`. See [Getting started](docs/getting-started.md) for ports, environment variables, and access from other devices.

Read-aloud defaults to Kokoro 82M on the backend CPU with Puck, Echo, Lewis, and Daniel voices. Enable it in **Settings → Intelligence**, where the **TTS provider** setting also offers OpenAI as an explicit opt-in using your saved API key and OpenAI voices (API charges apply). If the model is missing, the UI offers **Download Kokoro model**, or run `npm run tts:download`. The verified model and voices (about 95 MB) are saved in ignored `data/models/kokoro/` and never committed. Only initial setup needs internet access; narration runs locally without an API key. Set `NOEMA_KOKORO_MODEL_DIR` to use another local model directory.

PDF text extraction and OCR currently require macOS. AI credentials are stored in macOS Keychain; other platforms need a credential-store adapter. See the [Sources](docs/sources.md) and [Intelligence](docs/intelligence.md) guides for details.

## Documentation

- [Writing and editing](docs/editing.md) — blocks, images, mathematics, page links, and Trash.
- [Organization](docs/organization.md) — folders, collections, favourites, and navigation.
- [Knowledge entities](docs/knowledge-entities.md) — mentions, aliases, properties, relationships, and subjects.
- [Sources and citations](docs/sources.md) — imports, reading, annotations, and processing.
- [Vaults and backups](docs/vaults.md) — workspaces, access locks, export, restore, and deletion.
- [Intelligence](docs/intelligence.md) — API key setup, AI features, and activity logs.
- [Search and embeddings](docs/search.md) — text search, semantic search, and indexing.
- [Development](docs/development.md) — architecture, data model, validation, and extension points.
- [API reference](docs/api.md) — routes and feature-specific endpoints.

Browse the [full documentation index](docs/README.md), including the [page classification drift policy](docs/page-classification-drift-policy.md).
