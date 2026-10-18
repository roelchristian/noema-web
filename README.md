# Noema — local knowledge workspace

A local block editor organized into self-contained vaults, with reusable knowledge entities and a SQLite backend. The interface uses a black accent palette, locally bundled Geist Sans for titles, native system typography (SF on Apple devices) for the interface, and SVG entity icons. No accounts or API keys are required for local editing. Optional AI summaries, entity scans, and semantic search use your own OpenAI API key. React and the build tools are installed locally through npm.

## Run

Requires **Node.js 22.13 or newer** with `node:sqlite` support (tested with Node 25.8).

```sh
npm install
npm start
```

Open **http://localhost:3000**. LAN access is enabled by default. Turn it off in **Settings → Security** to accept connections only from this computer. Stop it with Ctrl+C. For development, use `npm run dev`: the Node server runs on port 3000 and Vite serves the frontend on http://127.0.0.1:5173, proxying API requests to Node. `npm start` type-checks and builds the app, then serves the frontend and API together from Node. `npm run build` creates production output in `dist/`; `npm run typecheck` checks TypeScript separately.

To use another port or database:

```sh
PORT=3001 DB_PATH=./data/another.sqlite npm start
```

### Access from other devices on your local network

LAN access defaults to on (`LAN=1`) for the built app and API on port 3000:

```sh
npm start
```

For development, expose the Vite frontend on port 5173 and the Node API together:

```sh
npm run dev
```

Keep the terminal running and open `http://<your-Mac-LAN-IP>:3000` (built app) or `http://<your-Mac-LAN-IP>:5173` (development) on a device connected to the same network. The terminal prints available LAN addresses. Allow incoming Node connections if macOS asks. A guest Wi-Fi network may block connections between devices.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LAN` | `1` | Initial private IPv4 LAN access (`1`/`true` or `0`/`false`). A saved Settings → Security choice takes precedence. |
| `NOEMA_LAN` | Unset | Legacy alias for `LAN`; if supplied, takes precedence over `LAN` for the initial setting. |
| `NOEMA_LAN_HOST` | `0.0.0.0` | Restrict LAN access to a specific private IPv4 interface. Localhost remains available for managing settings. |
| `NOEMA_ALLOWED_HOSTS` | Detected private IPv4 addresses and the machine hostname, including its `.local` name | Replace automatic LAN host detection with a comma-separated list of hostnames/IPs that clients may use. Use bare names without schemes, ports, paths, or wildcards. Localhost and a specific bind address remain allowed. Requires LAN mode. |
| `PORT` | `3000` | Node API/built-app port. The development proxy follows this setting; Vite normally uses 5173 and prints its actual port. |

For example, to allow LAN access only through your Mac's current LAN address:

```sh
NOEMA_LAN=1 NOEMA_LAN_HOST=192.168.1.25 npm run dev
```

Use your own address in place of `192.168.1.25`. Restart after changing environment variables or the Mac's IP. **Settings → Security → Allow LAN connections** applies immediately to the built server and development frontend, and persists across restarts in `<database-path>.network.json`. Turning it off rejects new remote connections and closes existing remote connections; `http://localhost:3000` (or `http://localhost:5173` in development) remains available on the host computer to turn it back on. Pending note edits are saved before the UI changes LAN access. The listeners retain their interface capacity so toggling does not require restarting the server. Before a preference has been saved, start with `LAN=0 npm start` for local-only access.

LAN mode keeps peer-address restrictions, an explicit Host allowlist, and same-origin API checks. It does **not** add user accounts or HTTPS: devices on the allowed network can read and change unlocked vaults, vault locks are shared across devices, and optional AI features use the host Mac's configured credentials. Use it on a trusted network and do not forward these ports through your router. Plain HTTP LAN editing uses cryptographically generated UUIDs even when the browser's HTTPS-only `randomUUID` API is unavailable.

## Images

Paste an image into a page or type `/image` in a text block. The block add menu also includes **Image**. PNG, JPEG, GIF, and WebP files up to 20 MB are supported. Each image becomes a block and follows normal page autosave. Click an image, then press Backspace or Delete to remove it, or choose **Delete block** from its gutter menu. A small image icon below the image toggles its caption field; saved captions remain hidden until opened. An inline loading card shows optimization and saving progress.

**Settings → Images → Automatically compress images** defaults to on. Static images are encoded as WebP (or PNG if WebP encoding is unavailable), with the longest side capped at 2,560 pixels; the original is kept when encoding would make the file larger or cannot decode it. GIF, animated PNG, and animated WebP files keep their animation. Turn compression off to upload the original bytes and dimensions. This setting applies to new uploads and is saved in this browser.

Noema stores image files beside the SQLite database in `assets/<vault-id>/images/<uuid>.<extension>`. Image references belong to that vault, and locked vaults block image reads and uploads. Include this `assets/` folder with the database in backups (the default `data/` folder contains both). Automatic cleanup removes images after their last saved reference is removed or their last referencing note is permanently deleted. Notes in Trash retain their images until permanent deletion, including the normal 30-day expiry. Abandoned uploads get a 24-hour grace period before cleanup on startup or the hourly sweep.

Structured source documents are persisted in the derived `source_documents` table. Downloads and page generation share this representation; a builder version and input fingerprint refresh it when source text, markers, page positions, or metadata change. Originals and citation coordinates are not rewritten. The cache can be rebuilt after backup restore.

To migrate existing ready sources in one unlocked vault without AI requests:

```sh
node --import tsx scripts/migrate-source-documents.ts --vault <vault-id> --db data/noema.sqlite
```

The migration is idempotent and reports migrated, current, and skipped sources. It requires an explicit vault ID and leaves unrelated vaults alone.

## Page editing locks

Use **More page actions → Lock editing** in the page toolbar to keep a page readable while preventing changes. Choose **Without a password** in the submenu for a simple editing lock or **With a password…** to require a password when unlocking. Pending edits are saved before locking. Titles, blocks, page sources, featured images, and deletion are protected until editing is unlocked; favourites and reading remain available. Passwords are stored only as salted hashes. Editing locks and their password protection survive app restarts and vault backup/restore.

## Folders and collections

Main list screens offer **List**, **Compact**, and **Grid** layouts. Compact keeps each item on one line; Grid uses small icon cards with local note excerpts, entity descriptions, or folder/collection previews where available. Layout choices are remembered per screen in this browser. Library (including folders, collections, Inbox, and Favourites), Knowledge entities, Recent items, and Trash support these controls. Switching layouts keeps sorting, selection, navigation, and item actions available. Trash cards retain restore and permanent-delete actions rather than opening deleted notes.

**Library** shows folders and notes together in one content table. The root contains top-level folders and unfiled notes; each folder shows only its immediate subfolders and notes. Open notes show their absolute location in breadcrumbs, starting with **Pages**, followed by ancestor folders and the note title. Collection membership and the route used to open a note do not change this path. Star folders from the table or sidebar to open them from **Favourites**, alongside starred notes and entities. Removing a folder clears its own favourite and those of deleted subfolders while preserving note favourites.

Folders define storage location within a vault. A note has one folder, or is unfiled in **Inbox**. Folders can contain subfolders. Moving a note replaces its location; moving it to Inbox clears the folder. Drag a folder onto another folder in the Library table or sidebar to move its entire subtree. Notes keep their folder IDs, collection memberships, and favourites; their breadcrumb paths follow the new ancestry. Self and descendant drops are rejected. Removing a folder also removes its subfolders and returns their notes to Inbox. Notes, collection memberships, and favourites are kept.

Collections curate notes across folder locations. A note can belong to multiple collections. Collections are flat and can include links to existing folders. Adding or removing a membership never moves the note. Removing a collection removes only its memberships. Use **Organize** for a note or a selection of notes; dropping onto a folder in the Library table or sidebar moves a note from its current location, while dropping onto a collection adds membership. A note in collections remains in Inbox until filed into a folder. Use **Add to collection…** on a folder, **Add folder…** in collection options, or drag a folder onto a sidebar collection. **Linked folder (Suggested)** keeps a live reference to the folder and its subfolders, including future additions. **Current pages only** adds individual memberships for the current non-trashed pages in the folder subtree; future additions are not included automatically. Unlinking a folder preserves the folder and its contents. Folder links are included in vault backups.

The API exposes `organization.locations` separately from `organization.memberships`. `PUT /api/organization/locations` accepts `{kind, item_id, folder_id}` (null means Inbox); `PUT /api/organization/memberships` accepts `{kind, item_id, collection_id, remove?}`. SQLite enforces one location per vault/item and unique memberships per vault/item/collection. Both operations validate vault scope and preserve canonical note content. Trash hides organization until restore; permanent deletion clears both relations.

Existing databases migrate transactionally on startup. Folder IDs, nesting, and all collection memberships survive, while folders become independent of collections. If a legacy note has multiple folder assignments, the migration selects its first non-null folder ordered by collection ID, then folder ID. This is deterministic across restarts. Notes with no folder stay unfiled. The former combined location API is replaced by the two operations above.

## Smart quotes

Straight single and double quotes become curly quotes as you type in notes, table cells, and note titles. Opening and closing quotes follow the surrounding text, and contractions use a curly apostrophe. Pasted text, existing content, undo/redo, code, links, and equations retain their literal characters. Entity matching treats straight and curly quotes as equivalent.

## Automatic entity links

After an idle pause (about 1.2 seconds) and before saves, Noema matches note text against existing entities in the current vault and converts whole-name matches into entity references. Matching is local and case insensitive, prefers longer names, and leaves ambiguous duplicate names as text. It also scans table cells while preserving the surrounding formatting. Formatting (including code and link styling) does not affect matching, even when a name spans differently styled segments. Existing references, explicitly excluded text, inline equations, and equation/image blocks are skipped. Both the local matcher and AI entity scanning use these same text eligibility rules. This utility creates no new entities and makes no AI requests; the separate AI entity review remains available.

Add aliases when creating an entity or in its details, one per line. Aliases can be shared: if Donald Trump and Ivanka Trump both have the alias “Trump,” the matcher prefers a candidate only when exactly one is already linked in the page (including table cells). If none or multiple candidates are linked, those occurrences stay as text and are flagged for review. Choose an entity and link one instance or all matching instances on the current page. Unique aliases link automatically. Alias links retain the original wording; highlighting text and choosing **Annotate → Link to existing entity** also saves the selected wording as an alias, refreshes the matcher immediately, and preserves that wording in the link. Alias saving errors stay visible in the annotation menu so you can retry. Removing a tag from its hover card keeps its text and excludes that occurrence from future automatic matching.

Ambiguity review items are stored in the backend's disposable `page_entity_match_cache` table, keyed by note revision, body, and entity names/aliases. Empty results are cached too. Edits invalidate the note's cache, catalog changes replace stale results on retrieval, and deleted pages lose their cache. Opening a page loads its body and current cache together, so review notices and highlights are present on the first paint. After typing, the editor refreshes these records following the typing buffer and renders the supplied highlight offsets; it does not rescan text to build review items. Resolutions are validated against the cache key and revision, then saved through the normal autosave queue. The cache is safe to rebuild and survives server restarts.

Identification defers while text is selected, a menu or dialog is open, or IME composition is active. Matched references are saved through the existing revision-aware autosave queue; newer edits made during a write remain intact. A small footer beneath the editor shows **Identifying entities…**, **Saving…**, and **Automatically saved**, with **Retry** if saving fails.

## Knowledge entity subtypes

Knowledge entities keep a main type (Person, Place, Event, Creative work, Organization, Source, or Concept) and can have multiple subtypes under that main type, such as a Person who is both an Actor and a Writer. Built-in subtypes include Actor, Writer, City, Book, Film, Company, and Website. Concept starts with Mathematics, Science, Social Sciences, Technology, and Philosophy subtypes. AI entity scanning includes inline and display formulas as context while tagging only eligible text. Evidence matching treats spaces, nonbreaking spaces, tabs, and line breaks equivalently and preserves the original surrounding text and formulas. Create custom subtypes under **Knowledge entities → Manage types & subtypes**.

Property names belong to the main type. Built-in fields and any new fields added to the main type are available to every subtype; values remain specific to each entity. Subtypes cannot define new fields. Add fields in the type manager or on an entity without a subtype. Existing entity fields are preserved and imported into their main type’s shared fields. Existing single-subtype selections migrate automatically. Custom subtypes and fields stay within their vault.

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

## Vaults

Use the sidebar vault selector to switch workspaces, or **New vault** to create one. Each vault contains its own pages, entities, properties, relationships, and source references. Existing databases migrate automatically into **Personal vault** without losing content. New vaults start empty, and the browser remembers the last selected vault and the current location in each vault. Refreshing restores the open folder, collection, note, or library view. Locations are saved by ID, so moved or renamed folders retain their address; deleted locations fall back to the Library root. Locked vaults restore their last address only after unlocking.

Use **Lock** to set a passphrase the first time; subsequent locks reuse that passphrase. Unlocking requires the passphrase. **Settings → Security → Vault passphrase** lets you add, change, or remove a passphrase without leaving the current note. Changes and removal require the current passphrase; the vault must be unlocked. Adding or changing a passphrase keeps the vault open until you choose Lock. Locks persist across server restarts and block API reads and writes for that vault while allowing access to other vaults. Passphrases are stored as salted scrypt hashes. This is an app access lock, not encryption of the SQLite file; there is no passphrase recovery flow. Lock state is shared by all tabs using this local server. Already rendered content in another tab is not remotely erased.

Use **Vault options → Export vault backup…** to save the current unlocked vault as a single compressed `.noemabkp` file. Pending edits are saved first. Backups include notes (including Trash), images, entities and their aliases/connections, custom categories and fields, folders, collections, memberships, favourites, attached sources, saved AI results, and search embeddings/settings. They exclude API credentials, vault passphrases, activity logs/notifications, queued jobs, browser appearance, and browser recent-history settings. Backups contain readable content after decompression; they are not password encrypted.

Choose **Vault options → Import vault…**, or **Import a .noemabkp backup instead** in the new-vault dialog, then select the file and optionally name the restored vault. Import always creates a separate unlocked vault with fresh identifiers, preserving internal references and leaving existing vaults intact. You can import the same backup more than once. Invalid/damaged files and unsupported versions are rejected; failed imports roll back database records and newly written image files. The format is gzip-compressed JSON with a `noema-vault-backup` manifest and version `1`; limits are 128 MB compressed and 256 MB expanded. Derived matching caches are rebuilt. For a complete installation backup including local configuration, stop the server and copy the `data/` folder.

## Try it

- Create a page using the sidebar **+**. Rename it by editing its title.
- Choose **Add icon** above a page title to pick from 50 Noema line symbols. Search by symbol name or group, click a symbol to autosave, or choose **Reset to default**. Your choice appears in the sidebar, collections, favourites, recent items, and Trash, and follows the app’s light or dark appearance.
- Type `/` at the beginning of a block to choose text, heading, bullet list, quote, or to-do. Use arrow keys and Enter in the menu.
- Press Enter to add a block; Shift+Enter inserts a line break. Hover over a block and click its handle to change its type or delete it.
- In the top toolbar’s **Sources** menu, attach an existing Source or create a new one. Remove a page source with **×**; the Source entity remains in the vault.
- Choose **Source** when creating an entity to represent a reference. Attach at least one original **TXT, MD, or PDF** file before creating it (up to 20 initial files; 50 MB per file). Sources keep the same properties, relationships, subtypes, aliases, and inline `@` mentions as other knowledge entities.
- Each original is stored with a UUID filename at `assets/<vault-id>/sources/<uuid>.<extension>` beside the database. The original name and extracted text are stored in `source_files`. Text sources must be UTF-8. HTML uploads and extraction are disabled. Existing HTML originals remain available for download or replacement.
- Extraction runs in a local background queue. The source panel shows waiting, extraction progress, ready, or failure states. You can read extracted text, download the original, retry failed extraction, or attach replacement files. The last attached file cannot be removed. The original remains available even when extraction fails. Interrupted jobs resume on restart; locked vaults do not start new extraction jobs. Unattached uploads expire after 24 hours during startup/hourly cleanup.
- On **macOS**, PDFKit reads embedded PDF text and Apple Vision OCR reads pages with little or no embedded text, including mixed scanned/digital PDFs. Nothing is sent to an AI provider. The first PDF extraction compiles `scripts/extract-source.swift` using the macOS Command Line Tools (`xcode-select --install` if needed), then caches the executable beside the assets. PDFs support up to 1,000 pages, 16 MB of extracted text, and a 10-minute extraction timeout. Password-protected, damaged, empty, or unreadable PDFs show a retryable error. Other operating systems currently support TXT and MD extraction; PDF originals can still be saved and downloaded but PDF extraction reports the macOS requirement.
- Existing Source entities remain intact and show an attachment prompt if they have no original. New sources require attachments through the API as well as the UI. To preserve file ownership, file-backed sources cannot change entity type. AI entity scans can link existing sources; create new sources manually with their original files first.
- Vault backups include attached originals and their extracted text/status, remapping file UUIDs when imported. Older backups without file attachments remain importable.

Long-source progress distinguishes extraction, math preparation, AI planning, streaming, and reference checks. Extraction estimates use observed progress; math preparation reports completed batches and estimates remaining uncached work from measured batch durations. Page generation shows elapsed time and, when at least three similar completed requests exist for the same model and reasoning effort, a historical duration estimate. Estimates are approximate, never fabricated percentages, and overdue estimates become a still-working message. Source extraction/enrichment continues after leaving its panel; closing page generation cancels that request while retaining completed math checkpoints.

Math-heavy sources receive an additional span-preparation pass during enrichment (and before page generation for older sources). A local detector skips ordinary prose. AI returns compact replacements for mathematical spans using `$...$` or `$$...$$`, while surrounding prose stays intact. The application verifies exact span locations and KaTeX syntax, preserves line counts and physical page mappings, and records ambiguous OCR in `processing.math.uncertain` using one-based line numbers. This is notation preparation, not a guarantee that damaged OCR can be reconstructed.

The cleaned text is saved separately from the original extraction and becomes the input for processed JSON, passage indexing, page generation, and new citation excerpts/verification. The citation viewer selects the version matching each citation's hash, so older references still open their original extraction. Cleaned text is included in vault backups. Math preparation shares the page-generation limit of 160 KB of extracted text; larger sources must be split. Small batches are checkpointed and the completed cleaned source is reused until the extraction changes; unchanged prose is not echoed in model output.

**Download processed JSON** appears beside the original in both Overview and Edit after extraction. The versioned `*.processed.json` document has two independent structures: `physical.pages` records physical page ranges, while `semantic.children` nests chapters, sections, subsections, and labelled theorem, lemma, proposition, corollary, definition, proof, example, and remark blocks. Content leaves contain paragraphs, lists, equations, code, tables, or quotes. A semantic block can span multiple physical pages; a page is never its semantic parent. Each node includes extracted-line and UTF-16 offset ranges plus physical page positions when available. Line/page numbers are one-based; offsets are zero-based with an exclusive end. Missing page maps remain unknown.

The document is assembled locally from stored text and markers, including for older sources. AI enrichment requests only compact marker kinds and line ranges in the same response as source metadata, without echoing source text. Long inputs retain bounded excerpts, so local detection covers the remaining text and the JSON does not imply exhaustive AI classification. Statement/proof extents inferred by local rules are marked `inferred`; AI-provided end lines are marked `explicit`. OCR content is preserved rather than silently repaired, and exporting never changes citation coordinates or starts an AI request. Source-to-page generation consumes the nested document itself: each paragraph or block body is included once, with its kind and original line range. Physical pages remain separate. Leaves spanning more than 30 source lines are split locally to fit the citation limit. No duplicate raw-text copy or truncated outline is sent.
- Type `@` to find an entity or create one inline. Entity mentions keep the entity's ID, so renaming an entity updates its displayed name across pages.
- Click a mention, or open **Knowledge entities**, to edit entity details, properties, and relationships.
- A property can hold **text** (`type = Book`) or an **entity reference** (`author = @Person`). Click **Edit** to change it.
- A relationship holds a free-form label and a target (`@Person → sibling → @Person`). Incoming connections appear on the target entity too. The arrow shows the stored direction; reciprocal relationships are not automatically inferred.
- Page edits autosave after a short delay. Entity details use **Save details**; property and relationship forms save when submitted. A failed page save stays pending; click the save status to retry.

The first run seeds a welcome page, a book, two people, and a place. Seeding only happens once per database.

## Organization

The page toolbar includes a favourite toggle, **Connected knowledge** for inline entity mentions, and **Sources** for attaching, creating, opening, and removing page-level references.

The sidebar groups **Favourites** and **Recent items** under **Quick Access**. Recent items remembers the last 50 opened pages and entities per vault in this browser. The separate **Folders & collections** group below lists collections and nested folders; click one to browse its contents.

Open **All content** in that group to organize pages and knowledge entities. **All content** lists canonical items across the vault. Use **Organize** on an item to choose its vault folder, add it to any number of collections, or include a folder as a live link or a one-time set of current pages. Opening an item from any context edits the same underlying record.

- **Collections** are named, flat contexts. Collections cannot contain other collections. Rename or delete one using **Edit** or **Delete** in its toolbar.
- **Folders** are nested within a vault. Each item has one folder location. Collections can link to a folder without moving it; the link reflects current contents and future additions.
- **Collection membership** is many-to-many and never copies content. Untick a collection under **Organize** to remove only that membership.
- **Favourites** provide independent quick access. Use the star in a page’s top toolbar or beside an item and open **Favourites** in the sidebar. Moving items or removing collections does not change their favourite status.

Deleting a folder removes its nested folders and returns their items to Inbox. Deleting a collection removes its folder links and memberships, preserving the original folders. Both actions preserve canonical content and favourites. Organization is vault-scoped, persisted in SQLite, and unavailable while a vault is locked.

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

## API

All routes are under `/api` and accept/return JSON. Send `X-Vault-Id` to select the vault for page and entity routes; omission selects the migrated default vault for compatibility. Locked vaults return HTTP 423. References to entities outside the selected vault are rejected. Page updates accept `sourceIds` alongside `title` and `blocks`; omitting `sourceIds` preserves existing page-level sources.

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/vaults` | List vaults / create with `{name}` |
| POST | `/vaults/:id/lock` | Lock; include `{passphrase}` on first use (minimum 4 characters) |
| POST | `/vaults/:id/unlock` | Unlock with `{passphrase}` |
| PUT | `/vaults/:id/passphrase` | Add/change with `{currentPassphrase, passphrase}` or remove with `passphrase: null`; requires an unlocked vault and the current passphrase when protected |
| GET / PUT | `/security/network` | Read network access or save `{lan: boolean}`; changes persist and apply immediately |
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

Page summaries, generated titles, reviewed entity suggestions, and note embeddings are optional AI features. Embeddings and their durable job queue use separate SQLite tables without changing how pages reference entities. Startup includes an additive migration for vault scoping and page source references.

The server has no user accounts. **Settings → Security** controls whether other devices on the local network can connect; turning LAN access off keeps access on the host computer.

### Trash and note recovery

Use the page toolbar’s **Trash** action to move a note out of the workspace. Open **Trash** at the bottom of the sidebar to restore it or delete it permanently. Restoring a note preserves its blocks, source references, favourites, and surviving folder/collection memberships. Permanent deletion requires confirmation and cannot be undone.

Notes expire 30 days after being moved to Trash. The local server removes expired notes on startup, hourly while running, and before API access. If the app is closed, overdue notes are removed the next time its server starts. Trash belongs to each vault and is unavailable while that vault is locked.


## Intelligence and page summaries

Open **Settings → Intelligence** to save an OpenAI project API key. Keys are stored only in **macOS Keychain**, under a Noema service and a random account identifier per database. Other platforms fail closed until an OS credential-store adapter is implemented. SQLite stores only the random account identifier; database backups do not contain the credential. macOS may request Keychain access or require you to unlock your login keychain.

Noema provides no API or UI to reveal the saved key, including partial characters. The input clears on submission, and credentials are never placed in browser storage, process arguments, application logs, or provider error messages. The backend necessarily reads the credential into memory to authenticate HTTPS calls. Keychain protection depends on your macOS account and OS security: this is not protection against malware or an administrator controlling your computer. Local processes running as your user can access the local app; loopback access is not user authentication. Do not expose Noema through a reverse proxy or public tunnel.

The default lifetime is **30 days**, configurable from 1–365 days when saving or replacing a key. Expiry is checked before every AI use and a background sweep attempts removal every minute. When Noema is closed or Keychain is unavailable, physical removal waits until Noema can access Keychain again; expired credentials cannot be used through Noema. **Remove key** deletes the credential and aborts an active AI call. Replacement also invalidates active results. This lifetime is local to Noema: revoke a key in your OpenAI project to invalidate it at the provider. Keep a dedicated, restricted project key and configure project spending controls in OpenAI.

Use **Validate connection** to send a small test request without page content. This checks actual Responses API/model access and can incur a small charge. The existing default model remains `gpt-5-mini`, with reasoning effort defaulting to **low**. **Model** and **Reasoning effort** selectors offer a curated set of Responses API text models: GPT-6 Luna/Sol/Astra, GPT-6.1 Sol, GPT-5.6 Luna/Terra/Sol, and GPT-5 Mini. This catalog was checked against [official OpenAI model and reasoning documentation](https://developers.openai.com/api/docs/guides/latest-model) on October 16, 2026; it is not a live account-specific model list. Only compatible efforts appear, and the server rejects unsupported combinations. If changing models makes the current effort unsupported, the selector resets to low.

Choose **Save AI preferences** to persist model and effort across server restarts without reading, replacing, or extending the saved credential. Non-secret preferences are stored in SQLite; the API key remains in Keychain. Validation and summaries both use the saved selection; summary results display the model and effort used. Saving preferences aborts any active AI request and discards its result. Model availability depends on your OpenAI API project. Requests have a bounded output budget (2,048 tokens for validation; 8,192 for summaries, including reasoning) and the existing 45-second timeout. High effort may need more time or tokens than these limits permit; reduce effort or shorten the page if a response is incomplete.

On a page, choose **Knowledge → Summarize page**. Noema first saves pending edits, then sends only that saved page’s title, block text, and names of inline entity mentions. It excludes source bodies, entity properties, and other pages. Successful summaries are saved in SQLite and loaded when the Knowledge panel reopens, including after a server restart. Long summaries show three lines with a Show more / Show less toggle. Failed refreshes retain the previous saved summary. A locked vault, deleted page, changed revision, or removed/expired key prevents saving a new result. Closing the sidebar does not cancel an already transmitted request: a successful result is still saved, and provider charges may apply.

Choose **Knowledge → Scan for entities** to find potential knowledge entities in a note. Scanning saves pending edits and uses the configured model and reasoning effort. It sends the saved title and body text runs, current main types and subtype IDs, and this vault’s entity names, descriptions, and categories to OpenAI. Other notes and entity properties are excluded. Notes are limited to 40,000 body characters, and the full note/schema/catalog input to 80,000 characters.

Review up to 20 suggestions in a dedicated modal table with their category, matching phrase, and reason. Use the pencil action to expand one row and edit its name, category and subtypes, or match it to an existing vault entity. Matching uses the saved entity’s details without modifying it. Edits apply on individual or bulk acceptance, while the original evidence phrase stays unchanged. Search or filter All/Pending/Reviewed, select rows (or all pending), and use **Accept selected** or **Reject selected** for bulk review. Bulk decisions save atomically and update the note without reloading it. Successful decisions show a subtle confirmation and a saved status badge, with review progress above the table. After the final pending suggestion is accepted or rejected, the modal briefly confirms completion and closes automatically. Failed decisions keep the modal open for retry. **Accept** links an existing entity or creates a new one, replacing the first matching phrase with an inline mention; surrounding text and formatting are retained, including inside tables. **Reject** records the decision without changing the note or creating an entity. Scans and decisions persist with the note. A note edit makes pending suggestions stale and requires a fresh scan. **Scan again** replaces the previous review. Failed scans retain the previous result. No entities are created until accepted. Scan attempts appear as **Entity scan** in the AI activity log.

Page AI results use the shared `page_ai_enrichments` table, with one latest result per page and enrichment kind. Each result stores a JSON payload, source page revision, model, reasoning effort, and timestamp. Summary and generated-title results use this storage; future enrichment handlers can use the same service. Saving an enrichment does not change the editor revision. Later page edits retain results and the summary shows when its source revision is older. Vault scoping and locks protect retrieval; Trash retains results for restoration, and permanent page deletion cascades to them. Clearing the AI activity log does not erase enrichments.

Untitled pages automatically receive a title after a successful save and **three seconds without edits**, once their body contains at least **20 characters**. Opening an existing untitled page resumes this workflow after a reload or vault switch. The title utility sends only that page's text and inline entity names, and uses reasoning effort fixed to **none**, independently of the reasoning preference. It uses the selected model when the existing model catalog supports `none`, otherwise GPT-6 Luna, with a 256-token output budget. The prompt favors compact subject labels of 2–6 words, preferably within 50 characters, rather than summaries of every detail. Titles have a hard limit of 120 characters and are saved through autosave. Edits, manual titles, deletion, and vault changes discard outstanding results. Empty pages and pages with a title are excluded. Temporary provider, rate-limit, and network failures retry up to twice, after 15 seconds and then 60 seconds; edits or a vault switch invalidate pending retries. Missing credentials and permanent failures stay quiet; another saved edit or reopening the page can try again. Automatic title generation can incur API charges and appears as **Page title** in the activity log.

Security controls include private IPv4 LAN access enabled by default with a persisted localhost-only toggle in Settings → Security; peer-address checks and an explicit Host allowlist; same-origin checks; a custom request header and JSON requirement on AI endpoints; no cross-origin access; no response caching; a fixed HTTPS OpenAI endpoint with redirects disabled; no model tools; 40,000 input characters; bounded provider responses and output tokens; a 45-second timeout; one active AI call and five attempts per minute per server process; and sanitized errors. Rate limits are local safeguards, not a billing cap. Page content is treated as untrusted input, and output is never executed.

The summary prompt keeps Noema’s fixed instructions separate from note text. Titles, body text, and mentioned entity names are serialized into a JSON `untrusted_note` string inside a single lower-priority user message. No note text is interpolated into trusted instructions or used to construct roles, tools, model settings, or conversation history. Noema explicitly directs the model to summarize embedded instructions as document content rather than obeying them, including fake roles, delimiter escapes, encoded commands, and authorization claims. Requests explicitly set `tools: []` and `tool_choice: "none"`; results remain inert plain text.

This follows [OpenAI’s guidance on separating untrusted input from trusted instructions](https://developers.openai.com/api/docs/guides/agent-builder-safety). It reduces prompt-injection risk but cannot guarantee model-level immunity. Regression tests use malicious note fixtures to verify request isolation, not to claim live-model robustness; no live attack evaluation was run with a billable API key.

Requests use the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) with `store: false`. This does not guarantee zero provider retention; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) for applicable processing and retention policies.

**Settings → Intelligence → AI debug mode** enables local payload capture for new requests. It is off by default and applies across vaults. Debug traces include the complete request body, provider response body and final JSON, selected response metadata, errors, and timestamped [Responses API stream events](https://developers.openai.com/api/docs/guides/streaming-responses). Authorization headers are excluded and recognizable API keys are redacted. Generation requests use streaming while debug capture is enabled; embedding responses retain their JSON bodies. Existing response-size and timeout safeguards still apply, and failed or interrupted requests retain any received data.

In **AI activity log**, choose **Open payload** to see live output and raw events, refreshed every second, or download the trace as JSON. CSV export contains activity metadata only. Debug payloads include note text and remain stored until their activity rows are cleared or pruned by the existing 1,000-action retention policy. Turning debug mode off stops capture for subsequent requests without deleting previous traces. Vault locks hide payloads; clearing activity and deleting a vault also remove their associated traces. Debug settings and traces are excluded from vault exports.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/intelligence` | Configuration status, expiry and model only |
| PUT | `/api/intelligence` | Save/replace `{apiKey, days?: 30}` |
| PUT | `/api/intelligence/preferences` | Save `{model, reasoningEffort}` independently of the key |
| DELETE | `/api/intelligence` | Remove saved credential |
| POST | `/api/intelligence/validate` | Test the saved key and model access |
| POST | `/api/pages/:id/title` | Generate a title for an untitled saved page with `{revision}` and `X-Vault-Id` |
| POST | `/api/pages/:id/summary` | Generate and persist a summary with `{revision}` and `X-Vault-Id` |
| POST | `/api/pages/:id/entity-scan` | Generate and save entity suggestions with `{revision}` and `X-Vault-Id` |
| POST | `/api/pages/:id/entity-review` | Review one pending suggestion with `{revision, scanId, suggestionId, decision}` (or `suggestionIds` for a bulk decision) (`accepted` or `rejected`) |
| GET | `/api/pages/:id/enrichments` | Load saved AI results for an active page using `X-Vault-Id` |

All intelligence routes require `X-Noema-Request: 1`; writes require `Content-Type: application/json`. Tests use an injected credential store and mock provider, never your Keychain or a billable API key. They cover expiry, replacement/removal, request redaction, fixed destinations, storage controls, concurrency, rate limits, host/origin checks, vault isolation, stale revisions, and locking during a request. A native Keychain save/read/remove round-trip was also verified using a unique synthetic credential and then cleaned up. A live OpenAI connection still needs your real key and **Validate connection** on your Mac.

### AI activity notifications

The toolbar bell uses a small theme-colored dot for unread enrichment updates and work in progress across unlocked vaults, with no numeric badge. Manual summaries and entity scans, automatic titles, and background producers using the shared enrichment service all feed the same local queue. A title notification appears only after the generated title is actually applied to the note. Summaries and scans notify after their result is saved. Failed or interrupted provider attempts appear too; routine indexing successes, search queries, and connection tests remain in the full activity log.

Open a notification to visit its note and mark it read, dismiss its unread dot, or choose **Mark all read**. Read state persists in SQLite across reloads and restarts. Opening the menu alone does not mark anything read. **Recent** includes read updates, and **View full activity log** opens the detailed history. The queue refreshes every five seconds while the app is visible and after local enrichment results or saves. Notifications contain references and status, without copies of note text, generated output, or titles. Locked vaults are hidden; permanent note deletion removes its notifications. The latest 1,000 notifications are retained. Unsaved and failed save indicators remain visible separately, with click-to-retry on failure.

### AI activity log

Settings → AI activity log shows page summaries, entity scans, automatic titles, note embedding attempts, semantic-search embeddings, and connection tests, backed by the local SQLite `ai_activity` table. Each entry records status, start/finish time, duration, HTTP outcome, model and reasoning effort, the page/vault ID and revision (when available), and prompt size in UTF-8 bytes. The size includes instructions and input text, including the note wrapper; it is not a token count. Prompt text, generated text, credentials, and provider error bodies are never stored in the log. Embedding entries use the fixed embedding model and input size, with no reasoning setting. Note embeddings link to the source note and revision; search embeddings show the vault without retaining the query. Each actual indexing attempt, including retries, has a separate record. Queued jobs remain in embedding settings; skipped local jobs that never request an embedding do not create activity. Results discarded after a note edit or cancellation are marked skipped, and shutdown marks active attempts interrupted.

The backend retains the latest 1,000 entries, preserving running requests until they finish. Requests left running after a server restart become interrupted. Settings loads 50 entries at a time, offers older activity and manual refresh, and links to available source pages. Page titles are resolved from the current page rather than copied into the log; deleted pages retain only their reference. Activity in locked vaults stays hidden until the vault is unlocked.

`GET /api/intelligence/activity` returns `{items, nextCursor}`; pass `?before=<nextCursor>` for the next page. It uses the same local-origin and `X-Noema-Request: 1` protections as other Intelligence endpoints. Authorized action attempts include local failures such as stale revisions, missing credentials, and rate limits; requests rejected by origin/client checks are not logged.


## Semantic search and note embeddings

Source passages publish as revisioned generations. Extraction and segmentation build and validate the full replacement before one transaction archives its snapshot, replaces the active rows, restores matching cached vectors, and switches `active_generation_id`. A failed extraction or segmentation keeps the previous generation searchable while the source remains admitted in the same vault and attached to the same active source entity. These fallback references carry `stale: true`; removing admission or changing source identity prevents retrieval. Activation means passage preparation is complete, rather than that every new passage has an embedding: changed passages become available to semantic retrieval as indexing finishes, while unchanged passages recover cached embeddings immediately. Generation snapshots and cached vectors are retained locally until their source file/entity is deleted; embedding job identity snapshots survive passage and source deletion until the vault is deleted.

Passage identity uses content and duplicate occurrence independently of ordinal position, preserving existing IDs for unchanged text and heading pairs during replacement. Citation anchors retain their original source hash and become explicitly stale when the source changes. Extracted structure includes HTML headings, anchored PDF outline labels, Markdown headings, and conservative book chapter/section markers. The chunker consumes these nodes, with inference for older imports. Passage `estimated_token_count` (also exposed as legacy `token_count`) retains the three-byte estimate and byte safety cap; `actual_token_count` uses the local `cl100k_base` tokenizer for passage body text. Provider usage remains separate and includes heading context.

The internal `Embeddings.retrievePassages(vault, {query, limit})` API returns multiple passages per source and fuses lexical BM25 and semantic ranks using equal-weight reciprocal-rank fusion (`k=60`). Navigation search retains its grouped results. The vector adapter caches normalized vectors; Page projections and segments are invalidated by saved revisions and entity mention names. This remains an exact scan; an indexed vector adapter can replace it if measurements warrant one.

Source indexing notes expose `indexingStatus` (`preparing`, `indexing`, `partial`, `ready`, `failed`, or `disabled`) and explicit `totalPassages`, `indexedPassages`, `failedPassages`, and `pendingPassages`. Transient passage embedding failures get three immediate attempts, then remain in history and become eligible for automatic rediscovery after fifteen minutes. Permanent failures require an explicit retry. Superseded queued/running jobs become skipped, and workers recheck generation identity before accepting a response.

Open **Settings → Intelligence → Semantic search & embeddings** to manage indexing, eligibility, and queue history. The backend uses OpenAI’s `text-embedding-3-small` model with 1,536 dimensions, independently of the text-generation model preference. Embedding requests have separate safeguards of 30 attempts per minute and two simultaneous requests per server process. It shares the saved OpenAI credential and its expiry/removal protections described above; no separate key is needed. Indexing and searches send text to OpenAI and can incur API charges. Vectors, eligibility settings, and job history persist locally in SQLite.

Automatic indexing is enabled by default. After a successful note save or restoration, the backend queues eligible content. The default minimum is 20 body-text characters; change the threshold (20–2,000 characters) or disable automatic indexing in Settings. Empty, too-short, and trashed Pages are excluded. Pages have no whole-document embedding size limit: up to 800 tokens uses one embedding, 801–3,000 tokens uses heading-aware sections, and larger Pages use passages targeting 700 tokens with up to 80 tokens of overlap. Oversized sections also split into bounded passages. These defaults, threshold hysteresis (100 tokens), and save debounce (5–15 seconds) are configurable in Embedding Settings. Each provider request remains within the 8,000-byte API input boundary. FTS, snippets, and embeddings consume a shared canonical block projection including tables, mathematics, image descriptions, and inline entity names. Heading hierarchy supplies segment context. Stable content hashes reuse unaffected segment vectors after edits. In-flight results survive subject-only revisions and edits to other segments when their exact input remains current; content-hash, model/dimension, vault-access, and cancellation checks reject stale responses. Legacy note embeddings are retained and adopted when their exact input matches a new short-Page segment. Existing Pages automatically enter the derived-index preparation queue. Indexing never changes Page content or creates entities.

Use **Queue missing** to queue eligible existing notes without an embedding, or **Queue eligible / stale** to include stale embeddings. These actions also work with automatic indexing disabled. Automatic indexing uses the configured 5–15 second debounce; another save cancels superseded segment jobs. The persistent queue processes one note at a time and retries temporary failures up to three attempts with 30/60-second backoff. History shows queued, running, completed, failed, skipped, and interrupted jobs, attempt counts, timing, usage, and sanitized failure messages. Failed and interrupted jobs can be retried. History displays the latest 100 jobs. Note text, vectors, provider error bodies, and credentials are excluded from job logs. Closing the app preserves queued work for the next startup; an interrupted request remains in history and resumes automatically with its remaining attempts after restart. Locked vault jobs wait for unlock; exhausted attempts can be retried manually.

The main **All content** search combines immediate page-title and entity-name matches with semantic note results after a 600 ms typing pause. Text matches appear first, semantic-only notes follow in similarity order, and each item appears once with a match label. Results show plain-text note excerpts of up to 240 characters, selected near the query phrase or literal query terms when present. Matching title and excerpt text is highlighted without interpreting note content as HTML. Semantic-only notes are labelled “Related by meaning”; when there is no literal overlap, the excerpt gives note context without artificial highlights. Name matches can load local excerpts even without an embedding or OpenAI credential. Collection, folder, and favourites filters apply to both kinds of result. If semantic search is unavailable, text matching remains usable.

Choose **Search** in the sidebar (or press **⌘K / Ctrl+K**) to open a centered Spotlight-style search overlay from any workspace view. Use ↑/↓ to navigate results, Enter to open, and Escape or a click outside to dismiss. Recently updated pages appear before you type. The Knowledge panel’s **Search this vault** button opens the same overlay. Page passage results open the correct Page and temporarily highlight their anchored text or blocks; source passages open the source viewer. Navigation groups matches by Page, while the internal evidence retrieval API can return multiple Page or source passages. Clearing a query, closing the overlay, or switching vaults cancels pending client requests and discards late results. Semantic queries are sent to OpenAI and may incur charges.

Semantic search embeds the query and ranks current note vectors with cosine similarity. Trimmed query vectors are cached in memory for five minutes, scoped by vault, model and dimensions, with at most 128 entries. Concurrent identical requests share one provider call, including requests from passage retrieval. Results are recomputed against current indexes each time. Failed requests are evicted; locking a vault, changing or removing credentials, and closing the worker clear the relevant cache. Results belong to the selected unlocked vault and include the note ID, title, score, and update timestamp. A score describes vector similarity rather than a calibrated probability. Edited content is excluded until its embedding is current; trashed notes disappear immediately. Locked vaults cannot be searched or indexed. Permanent deletion removes the note’s saved vector; history can retain a job without its deleted page reference. The existing name filter in All content remains available while embeddings are missing or unavailable.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/embeddings` | Read settings, model, eligibility/index counts, note status, and recent queue history |
| PUT | `/api/embeddings/settings` | Save `{automatic: boolean, minCharacters: number}` for the vault |
| POST | `/api/embeddings/enqueue` | Queue existing notes with `{mode: "missing"}` or `{mode: "eligible"}` |
| POST | `/api/embeddings/jobs/:id/retry` | Retry a failed/interrupted/skipped job in the selected vault |
| POST | `/api/embeddings/search` | Search with `{query, limit?}`; returns `{results: [{id, title, score, updated_at, snippet}], model}` |
| POST | `/api/search/snippets` | Read local excerpts for `{query, pageIds}` (up to 100 active notes in the selected vault); returns `{snippets: {pageId: text}}` without an AI request |

All embedding endpoints require `X-Noema-Request: 1` and select the vault with `X-Vault-Id` (default: `default`). Writes require JSON and the same origin/host checks as Intelligence endpoints. Tests inject a fake credential store and embedding provider; no real API key or billable requests are used.


Source file API: `POST /api/source-files?name=<filename>[&entity=<source-id>]` accepts the original binary body with `X-Noema-Request: 1` and `X-Vault-Id`. For new sources, upload files first and pass their IDs as `attachmentIds` to `POST /api/entities` with `type: "source"`. Existing-source uploads use the `entity` query parameter. `GET /api/source-files/:id` returns extraction state and text; `GET /api/source-files/:id/download?vault=<vault-id>` downloads the original safely as an attachment; `POST /api/source-files/:id/retry` retries failed extraction; `DELETE /api/source-files/:id` removes a file while enforcing the last-file rule. All actions enforce vault scope and locks.

Math delimiters: type or paste `\(x^2\)` (or `$x^2$`) for inline equations. Paste standalone `\[x^2\]` (or `$$x^2$$`) for display equations, including multiline LaTeX. Completing a standalone display equation while typing converts its paragraph into an equation block. Code spans and fenced code retain literal delimiters.

Select text across blocks by dragging or Shift-clicking; Shift+Left/Right can extend a selection across block boundaries. In the editor, press **⌘A** (or **Ctrl+A**) once to select the current block, then again to select the document body. Clicking or moving the caret resets this sequence. Cross-block selections support copy, cut, paste, typing, deletion, and the selection formatting toolbar; editor controls are excluded from copied text.

Reorder any block by dragging its gutter handle. A drop line marks the insertion point; release to save the new order. The page scrolls near the viewport edges during dragging. Press Escape or release outside the document to cancel. A short click still opens block options. Keyboard: focus the handle, press Space to pick up, Up/Down (or Home/End) to choose a position, then Space/Enter to drop or Escape to cancel.


Semantic blocks give content a function independently of its formatting: **Question, Definition, Example, Claim, Evidence, Insight, Summary, or Warning**. Open a block’s handle menu → **Semantic function…**, or use `/question`, `/definition`, etc. The function appears as a colored gutter icon and a subtle matching left accent. Hover or focus the block to replace its icon with the drag handle.

Select text in one block and choose **Semantic** on the selection toolbar to tag that block. Select across multiple blocks and choose a function to put them under one semantic parent. Child blocks retain their types, formatting, references, and any individual functions. The parent’s handle moves the group together; its menu changes the function or **Ungroup blocks** preserves the children and removes the parent. Enter and new blocks inside a group continue within that parent. Copy/paste, autosave, reload, and vault backups preserve semantic metadata. Groups are stored as contiguous child blocks sharing `semanticGroup: {id, kind}`; individual tags use `semantic`. No schema migration is needed for existing pages.

### Links between notes

Type `[[` in the editor to choose a note from the current vault, or type/paste `[[Page title]]` directly. Use `[[Page title|Display alias]]` to show a different label. Click a link or focus it and press Enter to open the note. Links resolve by title within the current vault; duplicate titles offer a choice, and missing titles show a message. Link syntax is preserved when saving and copying. Inline code keeps the syntax literal.

The Knowledge panel lists outgoing links from the current draft and backlinks from other saved notes in the same vault. Outgoing links include display aliases and missing destinations. Repeated links are grouped; trashed notes and syntax inside code or formulas are excluded. Links resolve by title, so duplicate titles may appear as multiple outgoing destinations and share backlinks.

Page titles and inferred Subjects share one background utility request. The fixed disciplinary registry (`src/shared/noema-domains-v1.json`, version 1.0.0) contains 162 domains under 20 roots. Requests include roots and locally relevant descendants rather than the full registry. Subjects use their own content fingerprint, taxonomy version and assignment revision; historical Concept subtype classifications remain readable.

Choose a primary Subject and up to two secondary Subjects in Knowledge, or leave a page unclassified. Manual selections survive content changes and background classification. Manual edits flush pending note saves, check the page revision, and invalidate domain-sensitive matching without requesting a title or embedding. Concept entities have a separate Disciplines field; Subtypes and inherited Properties keep their existing meaning. Registry and manual assignments are available through `GET /api/domains` and `PUT /api/pages/:id/domains` (with `revision`, `primaryDomainId` and `secondaryDomainIds`). Vault backups include assignments and preserve their origins.

Known-entity matching runs locally across all disciplines. Unique single-word Concept aliases still require review; ordinary phrases such as “field of research” are excluded conservatively. A page subject provides context without excluding interdisciplinary mentions. Existing mentions and excluded text remain protected. Explicit AI scans separately propose entities for review, supply lexically relevant existing candidates, validate all domain IDs, and anchor evidence to a specific block, cell and occurrence. Matching and scan caches include domain, taxonomy, alias and policy dependencies. Unchanged scans reuse saved results; edits made during generation or before acceptance reject stale outputs.

AI activity records and CSV exports include provider-reported cached-input and cache-write tokens independently of optional debug traces. Missing values stay unknown; reported zeros remain zero. Existing debug responses backfill available counts on startup. Local query-cache hits do not create provider-request records.

AI discovery retains the existing limit of 40,000 text characters and 80,000 serialized input characters per explicit scan. Incremental discovery for longer documents and per-block AI result caching are future work. Existing AI activity logging records request usage and timing; dedicated recognition-quality benchmarks are not yet included.

### Delete a vault

Open an unlocked vault and choose **Vault options → Delete vault…**. Review its notes (including Trash), entities, original files, uploads, images, folders, and collections; download a backup if needed. Type the exact vault name, acknowledge permanent loss, and re-enter the passphrase for a protected vault. Deletion has no Undo; recovery requires importing a backup as a new vault. The last vault can be deleted; active extraction/embedding jobs must finish first. Changed contents require a refreshed summary and confirmation.

Pending edits are saved before deletion. Database removal is transactional; original files are removed only after the transaction commits, with failed cleanup retried after restart and during maintenance. The app opens another vault when one exists, or shows an empty workspace with create/import options after the last vault is deleted. Deleted vaults stay deleted after restart. The deleted vault’s local navigation history is cleared. Global API credentials and app preferences are kept. No vaults are deleted simply by opening the confirmation dialog.

Page and note titles support LaTeX math with `$...$` or `\(...\)` (also `$$...$$` and `\[...\]`, rendered inline). Focus the title to edit its notation; press Enter or leave the field to see the rendered title. Math also renders in page lists, breadcrumbs, search results, and note links. Titles remain plain text in storage and exports.
