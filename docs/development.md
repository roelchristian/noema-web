# Development and architecture

[Documentation index](README.md) · [Noema home](../README.md)

## Overview

A local block editor organized into self-contained vaults, with reusable knowledge entities and a SQLite backend. The interface uses a black accent palette, locally bundled Geist Sans for titles, native system typography (SF on Apple devices) for the interface, and SVG entity icons. No accounts or API keys are required for local editing. Optional AI summaries, entity scans, and semantic search use your own OpenAI API key. React and the build tools are installed locally through npm.

## Architecture

Noema is a local-first modular monolith: one Node.js process serves a local SQLite database and the compiled frontend. Local editing has no cloud service dependencies. Optional AI summaries, entity scans, and embeddings connect to OpenAI. Geist Sans, the Inter fallback, and all frontend assets are bundled locally. Geist is distributed under the SIL Open Font License in `public/Geist-OFL.txt`.

- `src/server/modules/`: vault access, page persistence, and knowledge operations, each with a separate service boundary.
- `src/server/database.ts`: schema initialization, backward-compatible migrations, and seed data.
- `src/server/store.ts`: SQLite row mapping and transaction boundary.
- `src/server/http.ts`: HTTP routing, request validation, origin/host checks, and static assets.
- `src/shared/domain.ts`: shared TypeScript domain and API types.
- `src/client/main.tsx`: React application entry point.
- `src/client/App.tsx`: native React workspace shell, navigation, and screen composition.
- `src/client/editor/`: page Sources, block editing, slash commands, and inline entity references.
- `src/client/knowledge/` and `src/client/vaults/`: typed React screens, forms, and dialogs.
- `src/client/state/`: workspace state and a serialized autosave queue that keeps each write tied to its vault and revision.

The frontend is entirely TypeScript. React owns the screens and block structure; a small DOM boundary handles browser-owned `contenteditable` text, serialization, and caret ranges. React escapes text and mention markup before it enters that editable surface.

Page responses include a `revision`. Clients send that revision on updates to detect stale writes (HTTP 409). The bundled client does so automatically. Older API clients that omit the revision retain the previous update behavior. SQLite uses WAL, foreign keys, a busy timeout, and transactions for page/source updates. Shutdown signals close the HTTP server and database cleanly.

## Data model

| Table | Purpose |
| --- | --- |
| `vaults` | Workspace identity, persisted lock state, and passphrase hash |
| `source_files` | UUID file metadata, source ownership, extracted text and local extraction status |
| `page_sources` | Page-level references to Source entities |
| `pages` | Vault-scoped page title and ordered blocks, serialized as JSON |
| `entities` | Vault-scoped person, place, event, creative work, organization, or source |
| `properties` | Named scalar text value or foreign-key entity reference |
| `relationships` | Directed, labeled entity-to-entity connection |
| `collections` | Flat vault-scoped named contexts |
| `folders` | Nested folders within a vault or collection |
| `item_locations` | Canonical item folder placement and many-to-many collection membership |
| `favourites` | Independent quick access to pages and entities |
| `metadata` | Database initialization state |

Block contents are structured text and entity-ID segments, not arbitrary HTML. SQLite foreign keys validate property and relationship targets. Page mention IDs are validated when saved. Data lives in **`data/noema.sqlite`**, with SQLite WAL companion files while running. To back up by copying, stop the server first and copy the `data/` folder.

## Validation

```sh
npm test
```

The integration test launches an isolated server on an available port and uses a temporary database. It covers page persistence across server restarts, entity edits, entity references, property and relationship edits/removals, incoming connections, invalid input, and rejection of cross-origin writes. It leaves your workspace data untouched. It also covers migration of populated pre-vault tables, vault isolation, Source attachments and inline mentions, lock enforcement, incorrect passphrases, and lock/source persistence across restarts. Organization tests cover shared membership, nested folder cycles, container deletion without content loss, favourites, vault isolation, cleanup, and restart persistence. Autosave unit tests cover edits during an in-flight write, failed-write retries, and vault-scoped snapshots.

The default command builds and discovers all nested `test/**/*.test.mjs` files. Run `npm run test:all` for only the test phase, or `test:unit`, `test:dom`, and `test:server` for boundary groups. `npm run test:list` prints the exact discovery list; `test/groups.json` must cover every file exactly once. Browser, performance and native integration requirements, current results, reduction mapping and remaining failures are in the [test reliability report](test-reliability/README.md). The supported default suite passes with explicit platform skips; consult the report for the measured scope and native requirements.


## Git

The project is initialized on `main`. Runtime databases and dependencies are ignored. Useful commands:

```sh
git status
git log --oneline
git diff
```

No remote is configured. To connect a repository later:

```sh
git remote add origin <your-repository-url>
git push -u origin main
```

## Prototype boundaries and extension points

This is a single-user local prototype. Editing the same page in multiple tabs is guarded by revision checks in the bundled client. If a save reports a conflict, keep a copy of your unsaved text before reloading the latest page; automatic conflict merging is deferred. Page deletion is permanent. Entity deletion, drag-and-drop block ordering, rich text formatting, nested blocks, custom entity types, and automatic inverse/symmetric relationship rules are not implemented.

Page summaries, generated titles, reviewed entity suggestions, and note embeddings are optional AI features. Embeddings and their durable job queue use separate SQLite tables without changing how pages reference entities. Startup includes an additive migration for vault scoping and page source references.

The server has no user accounts. **Settings → Security** controls whether other devices on the local network can connect; turning LAN access off keeps access on the host computer.

For development commands and environment variables, see [Getting started](getting-started.md). For HTTP routes, see the [API reference](api.md).
