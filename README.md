# Noema — local knowledge workspace

A local block editor organized into self-contained vaults, with reusable knowledge entities and a SQLite backend. The interface uses a black accent palette, bundled Inter, and SVG entity icons. No accounts or API keys are required. React and the build tools are installed locally through npm.

## Run

Requires **Node.js 22.13 or newer** with `node:sqlite` support (tested with Node 25.8).

```sh
npm install
npm start
```

Open **http://localhost:3000**. The server binds to `127.0.0.1`. Stop it with Ctrl+C. For development, use `npm run dev`: the Node server runs on port 3000 and Vite serves the frontend on http://127.0.0.1:5173, proxying API requests to Node. `npm start` type-checks and builds the app, then serves the frontend and API together from Node. `npm run build` creates production output in `dist/`; `npm run typecheck` checks TypeScript separately.

To use another port or database:

```sh
PORT=3001 DB_PATH=./data/another.sqlite npm start
```

## Architecture

Noema is a local-first modular monolith: one Node.js process serves a local SQLite database and the compiled frontend. There are no cloud service dependencies at runtime. Inter and all frontend assets are bundled locally.

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

## Vaults

Use the sidebar vault selector to switch workspaces, or **New vault** to create one. Each vault contains its own pages, entities, properties, relationships, and source references. Existing databases migrate automatically into **Personal vault** without losing content. New vaults start empty, and the browser remembers the last selected vault.

Use **Lock** to set a passphrase the first time; subsequent locks reuse that passphrase. Unlocking requires the passphrase. Locks persist across server restarts and block API reads and writes for that vault while allowing access to other vaults. Passphrases are stored as salted scrypt hashes. This is an app access lock, not encryption of the SQLite file; there is no passphrase recovery flow. Lock state is shared by all tabs using this local server. Already rendered content in another tab is not remotely erased.

Vault export/import is planned and is not implemented yet. For a full backup, stop the server and copy the `data/` folder.

## Try it

- Create a page using the sidebar **+**. Rename it by editing its title.
- Type `/` at the beginning of a block to choose text, heading, bullet list, quote, or to-do. Use arrow keys and Enter in the menu.
- Press Enter to add a block; Shift+Enter inserts a line break. Hover over a block and click its handle to change its type or delete it.
- In a page’s **Sources** section, attach an existing Source or create a new one. Remove a page source with **×**; the Source entity remains in the vault.
- Choose **Source** when creating an entity to represent a reference. Add URLs, authors, publication dates, or other metadata through properties. Sources support the same details, relationships, and inline `@` mentions as other entities.
- Type `@` to find an entity or create one inline. Entity mentions keep the entity's ID, so renaming an entity updates its displayed name across pages.
- Click a mention, or open **Knowledge entities**, to edit entity details, properties, and relationships.
- A property can hold **text** (`type = Book`) or an **entity reference** (`author = @Person`). Click **Edit** to change it.
- A relationship holds a free-form label and a target (`@Person → sibling → @Person`). Incoming connections appear on the target entity too. The arrow shows the stored direction; reciprocal relationships are not automatically inferred.
- Page edits autosave after a short delay. Entity details use **Save details**; property and relationship forms save when submitted. A failed page save stays pending; click the save status to retry.

The first run seeds a welcome page, a book, two people, and a place. Seeding only happens once per database.

## Data model

| Table | Purpose |
| --- | --- |
| `vaults` | Workspace identity, persisted lock state, and passphrase hash |
| `page_sources` | Page-level references to Source entities |
| `pages` | Vault-scoped page title and ordered blocks, serialized as JSON |
| `entities` | Vault-scoped person, place, event, creative work, organization, or source |
| `properties` | Named scalar text value or foreign-key entity reference |
| `relationships` | Directed, labeled entity-to-entity connection |
| `metadata` | Database initialization state |

Block contents are structured text and entity-ID segments, not arbitrary HTML. SQLite foreign keys validate property and relationship targets. Page mention IDs are validated when saved. Data lives in **`data/noema.sqlite`**, with SQLite WAL companion files while running. To back up by copying, stop the server first and copy the `data/` folder.

## API

All routes are under `/api` and accept/return JSON. Send `X-Vault-Id` to select the vault for page and entity routes; omission selects the migrated default vault for compatibility. Locked vaults return HTTP 423. References to entities outside the selected vault are rejected. Page updates accept `sourceIds` alongside `title` and `blocks`; omitting `sourceIds` preserves existing page-level sources.

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/vaults` | List vaults / create with `{name}` |
| POST | `/vaults/:id/lock` | Lock; include `{passphrase}` on first use (minimum 4 characters) |
| POST | `/vaults/:id/unlock` | Unlock with `{passphrase}` |
| GET / POST | `/pages` | List / create pages |
| GET / PUT / DELETE | `/pages/:id` | Read / replace / delete a page |
| GET / POST | `/entities` | List / create entities |
| GET / PUT | `/entities/:id` | Read connections / update entity details |
| POST | `/entities/:id/properties` | Add `{name, value}` or `{name, target_id}` |
| PUT / DELETE | `/entities/:id/properties/:propertyId` | Edit / remove a property |
| POST | `/entities/:id/relationships` | Add `{label, target_id}` |
| PUT / DELETE | `/entities/:id/relationships/:relationshipId` | Edit / remove an outgoing relationship |

## Validation

```sh
npm test
```

The integration test launches an isolated server on an available port and uses a temporary database. It covers page persistence across server restarts, entity edits, entity references, property and relationship edits/removals, incoming connections, invalid input, and rejection of cross-origin writes. It leaves your workspace data untouched. It also covers migration of populated pre-vault tables, vault isolation, Source attachments and inline mentions, lock enforcement, incorrect passphrases, and lock/source persistence across restarts. Autosave unit tests cover edits during an in-flight write, failed-write retries, and vault-scoped snapshots. UI validation was skipped as requested.

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

AI enrichment and embeddings are intentionally deferred. Stable entity IDs and separate property/relationship tables leave room for enrichment jobs, provenance, and an embedding table without changing how pages reference entities. Startup includes an additive migration for vault scoping and page source references.

The server has no user accounts and is intended for this computer only. Keep the loopback binding when running this version.
