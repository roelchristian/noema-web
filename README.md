# Noema — local knowledge workspace

A local block editor organized into self-contained vaults, with reusable knowledge entities and a SQLite backend. The interface uses a black accent palette, bundled Inter, and SVG entity icons. No accounts or API keys are required for local editing. Optional AI summaries use your own OpenAI API key. React and the build tools are installed locally through npm.

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

Noema is a local-first modular monolith: one Node.js process serves a local SQLite database and the compiled frontend. Local editing has no cloud service dependencies. Optional AI summaries connect to OpenAI. Inter and all frontend assets are bundled locally.

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
- In the top toolbar’s **Sources** menu, attach an existing Source or create a new one. Remove a page source with **×**; the Source entity remains in the vault.
- Choose **Source** when creating an entity to represent a reference. Add URLs, authors, publication dates, or other metadata through properties. Sources support the same details, relationships, and inline `@` mentions as other entities.
- Type `@` to find an entity or create one inline. Entity mentions keep the entity's ID, so renaming an entity updates its displayed name across pages.
- Click a mention, or open **Knowledge entities**, to edit entity details, properties, and relationships.
- A property can hold **text** (`type = Book`) or an **entity reference** (`author = @Person`). Click **Edit** to change it.
- A relationship holds a free-form label and a target (`@Person → sibling → @Person`). Incoming connections appear on the target entity too. The arrow shows the stored direction; reciprocal relationships are not automatically inferred.
- Page edits autosave after a short delay. Entity details use **Save details**; property and relationship forms save when submitted. A failed page save stays pending; click the save status to retry.

The first run seeds a welcome page, a book, two people, and a place. Seeding only happens once per database.

## Organization

The page toolbar includes a favourite toggle, **Connected knowledge** for inline entity mentions, and **Sources** for attaching, creating, opening, and removing page-level references.

The sidebar groups **Favourites** and **Recent items** under **Quick Access**. Recent items remembers the last 50 opened pages and entities per vault in this browser. The separate **Folders & collections** group below lists collections and nested folders; click one to browse its contents.

Open **All content** in that group to organize pages and knowledge entities. **All content** lists canonical items across the vault. Use **Organize** on an item to choose its vault folder, add it to any number of collections, and choose a folder within each collection. Opening an item from any context edits the same underlying record.

- **Collections** are named, flat contexts. Collections cannot contain other collections. Rename or delete one using **Edit** or **Delete** in its toolbar.
- **Folders** can be nested within a vault or a collection. Choose a parent when creating or editing a folder. Each item has at most one folder per context; folder placement in one collection does not change placement elsewhere. Folders remain within their original context.
- **Collection membership** is many-to-many and never copies content. Untick a collection under **Organize** to remove only that membership.
- **Favourites** provide independent quick access. Use the star in a page’s top toolbar or beside an item and open **Favourites** in the sidebar. Moving items or removing collections does not change their favourite status.

Deleting a folder removes its nested folders and returns their items to the context root. Deleting a collection removes its folders and memberships. Both actions preserve canonical content and favourites. Organization is vault-scoped, persisted in SQLite, and unavailable while a vault is locked.

## Data model

| Table | Purpose |
| --- | --- |
| `vaults` | Workspace identity, persisted lock state, and passphrase hash |
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

## API

All routes are under `/api` and accept/return JSON. Send `X-Vault-Id` to select the vault for page and entity routes; omission selects the migrated default vault for compatibility. Locked vaults return HTTP 423. References to entities outside the selected vault are rejected. Page updates accept `sourceIds` alongside `title` and `blocks`; omitting `sourceIds` preserves existing page-level sources.

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/vaults` | List vaults / create with `{name}` |
| POST | `/vaults/:id/lock` | Lock; include `{passphrase}` on first use (minimum 4 characters) |
| POST | `/vaults/:id/unlock` | Unlock with `{passphrase}` |
| GET / POST | `/pages` | List / create pages |
| GET / PUT / DELETE | `/pages/:id` | Read / replace / delete a page |
| GET | `/organization` | Read collections, folders, placements, memberships, and favourites |
| POST | `/organization/collections` | Create with `{name}` |
| PUT / DELETE | `/organization/collections/:id` | Rename / remove a collection, preserving content |
| POST | `/organization/folders` | Create with `{name, collection_id?, parent_id?}` |
| PUT / DELETE | `/organization/folders/:id` | Rename/reparent within its context / remove folder tree |
| PUT | `/organization/locations` | Set `{kind, item_id, collection_id?, folder_id?, remove?}`; kind is `page` or `entity` |
| PUT | `/organization/favourites` | Set `{kind, item_id, favourite: boolean}` |
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

The integration test launches an isolated server on an available port and uses a temporary database. It covers page persistence across server restarts, entity edits, entity references, property and relationship edits/removals, incoming connections, invalid input, and rejection of cross-origin writes. It leaves your workspace data untouched. It also covers migration of populated pre-vault tables, vault isolation, Source attachments and inline mentions, lock enforcement, incorrect passphrases, and lock/source persistence across restarts. Organization tests cover shared membership, nested folder cycles, container deletion without content loss, favourites, vault isolation, cleanup, and restart persistence. Autosave unit tests cover edits during an in-flight write, failed-write retries, and vault-scoped snapshots. UI validation was skipped as requested.

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

Page summaries are the first optional AI enrichment feature; embeddings remain deferred. Stable entity IDs and separate property/relationship tables leave room for enrichment jobs, provenance, and an embedding table without changing how pages reference entities. Startup includes an additive migration for vault scoping and page source references.

The server has no user accounts and is intended for this computer only. Keep the loopback binding when running this version.

### Trash and note recovery

Use the page toolbar’s **Trash** action to move a note out of the workspace. Open **Trash** at the bottom of the sidebar to restore it or delete it permanently. Restoring a note preserves its blocks, source references, favourites, and surviving folder/collection memberships. Permanent deletion requires confirmation and cannot be undone.

Notes expire 30 days after being moved to Trash. The local server removes expired notes on startup, hourly while running, and before API access. If the app is closed, overdue notes are removed the next time its server starts. Trash belongs to each vault and is unavailable while that vault is locked.


## Intelligence and page summaries

Open **Settings → Intelligence** to save an OpenAI project API key. Keys are stored only in **macOS Keychain**, under a Noema service and a random account identifier per database. Other platforms fail closed until an OS credential-store adapter is implemented. SQLite stores only the random account identifier; database backups do not contain the credential. macOS may request Keychain access or require you to unlock your login keychain.

Noema provides no API or UI to reveal the saved key, including partial characters. The input clears on submission, and credentials are never placed in browser storage, process arguments, application logs, or provider error messages. The backend necessarily reads the credential into memory to authenticate HTTPS calls. Keychain protection depends on your macOS account and OS security: this is not protection against malware or an administrator controlling your computer. Local processes running as your user can access the local app; loopback access is not user authentication. Do not expose Noema through a reverse proxy or public tunnel.

The default lifetime is **30 days**, configurable from 1–365 days when saving or replacing a key. Expiry is checked before every AI use and a background sweep attempts removal every minute. When Noema is closed or Keychain is unavailable, physical removal waits until Noema can access Keychain again; expired credentials cannot be used through Noema. **Remove key** deletes the credential and aborts an active AI call. Replacement also invalidates active results. This lifetime is local to Noema: revoke a key in your OpenAI project to invalidate it at the provider. Keep a dedicated, restricted project key and configure project spending controls in OpenAI.

Use **Validate connection** to send a small test request without page content. This checks actual Responses API/model access and can incur a small charge. The existing default model remains `gpt-5-mini`, with reasoning effort defaulting to **low**. **Model** and **Reasoning effort** selectors offer a curated set of Responses API text models: GPT-6 Luna/Sol/Astra, GPT-6.1 Sol, GPT-5.6 Luna/Terra/Sol, and GPT-5 Mini. This catalog was checked against [official OpenAI model and reasoning documentation](https://developers.openai.com/api/docs/guides/latest-model) on October 16, 2026; it is not a live account-specific model list. Only compatible efforts appear, and the server rejects unsupported combinations. If changing models makes the current effort unsupported, the selector resets to low.

Choose **Save AI preferences** to persist model and effort across server restarts without reading, replacing, or extending the saved credential. Non-secret preferences are stored in SQLite; the API key remains in Keychain. Validation and summaries both use the saved selection; summary results display the model and effort used. Saving preferences aborts any active AI request and discards its result. Model availability depends on your OpenAI API project. Requests have a bounded output budget (2,048 tokens for validation; 8,192 for summaries, including reasoning) and the existing 45-second timeout. High effort may need more time or tokens than these limits permit; reduce effort or shorten the page if a response is incomplete.

On a page, choose **AI → Send page & summarize**. Noema first saves pending edits, then sends only that saved page’s title, block text, and names of inline entity mentions. It excludes source bodies, entity properties, and other pages. Summaries appear as escaped plain text, are not automatically saved, and disappear when the sidebar closes or the page/vault changes. A locked vault, deleted page, changed revision, or removed/expired key prevents returning the result. Closing the sidebar hides the result but does not cancel an already transmitted request or its provider charge.

Security controls include loopback binding and peer-address checks; localhost/127.0.0.1 Host validation; same-origin checks; a custom request header and JSON requirement on AI endpoints; no cross-origin access; no response caching; a fixed HTTPS OpenAI endpoint with redirects disabled; no model tools; 40,000 input characters; bounded provider responses and output tokens; a 45-second timeout; one active AI call and five attempts per minute per server process; and sanitized errors. Rate limits are local safeguards, not a billing cap. Page content is treated as untrusted input, and output is never executed.

The summary prompt keeps Noema’s fixed instructions separate from note text. Titles, body text, and mentioned entity names are serialized into a JSON `untrusted_note` string inside a single lower-priority user message. No note text is interpolated into trusted instructions or used to construct roles, tools, model settings, or conversation history. Noema explicitly directs the model to summarize embedded instructions as document content rather than obeying them, including fake roles, delimiter escapes, encoded commands, and authorization claims. Requests explicitly set `tools: []` and `tool_choice: "none"`; results remain inert plain text.

This follows [OpenAI’s guidance on separating untrusted input from trusted instructions](https://developers.openai.com/api/docs/guides/agent-builder-safety). It reduces prompt-injection risk but cannot guarantee model-level immunity. Regression tests use malicious note fixtures to verify request isolation, not to claim live-model robustness; no live attack evaluation was run with a billable API key.

Requests use the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) with `store: false`. This does not guarantee zero provider retention; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) for applicable processing and retention policies.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/intelligence` | Configuration status, expiry and model only |
| PUT | `/api/intelligence` | Save/replace `{apiKey, days?: 30}` |
| PUT | `/api/intelligence/preferences` | Save `{model, reasoningEffort}` independently of the key |
| DELETE | `/api/intelligence` | Remove saved credential |
| POST | `/api/intelligence/validate` | Test the saved key and model access |
| POST | `/api/pages/:id/summary` | Summarize a saved page with `{revision}` and `X-Vault-Id` |

All intelligence routes require `X-Noema-Request: 1`; writes require `Content-Type: application/json`. Tests use an injected credential store and mock provider, never your Keychain or a billable API key. They cover expiry, replacement/removal, request redaction, fixed destinations, storage controls, concurrency, rate limits, host/origin checks, vault isolation, stale revisions, and locking during a request. A native Keychain save/read/remove round-trip was also verified using a unique synthetic credential and then cleaned up. A live OpenAI connection still needs your real key and **Validate connection** on your Mac.
