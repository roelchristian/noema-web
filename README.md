# Noema — local knowledge workspace

A minimal block editor with reusable knowledge entities and a SQLite backend. No third-party packages, accounts, or API keys are required.

## Run

Requires **Node.js 22.13 or newer** with `node:sqlite` support (tested with Node 25.8).

```sh
npm start
```

Open **http://localhost:3000**. The server binds to `127.0.0.1`. Stop it with Ctrl+C. For server development with automatic restarts, use `npm run dev`; refresh the browser after frontend changes. There is no build or install step.

To use another port or database:

```sh
PORT=3001 DB_PATH=./data/another.sqlite npm start
```

## Try it

- Create a page using the sidebar **+**. Rename it by editing its title.
- Type `/` at the beginning of a block to choose text, heading, bullet list, quote, or to-do. Use arrow keys and Enter in the menu.
- Press Enter to add a block; Shift+Enter inserts a line break. Hover over a block and click its handle to change its type or delete it.
- Type `@` to find an entity or create one inline. Entity mentions keep the entity's ID, so renaming an entity updates its displayed name across pages.
- Click a mention, or open **Knowledge entities**, to edit entity details, properties, and relationships.
- A property can hold **text** (`type = Book`) or an **entity reference** (`author = @Person`). Click **Edit** to change it.
- A relationship holds a free-form label and a target (`@Person → sibling → @Person`). Incoming connections appear on the target entity too. The arrow shows the stored direction; reciprocal relationships are not automatically inferred.
- Page edits autosave after a short delay. Entity details use **Save details**; property and relationship forms save when submitted. A failed page save stays pending; click the save status to retry.

The first run seeds a welcome page, a book, two people, and a place. Seeding only happens once per database.

## Data model

| Table | Purpose |
| --- | --- |
| `pages` | Page title and ordered blocks, serialized as JSON |
| `entities` | Reusable person, place, event, creative work, or organization |
| `properties` | Named scalar text value or foreign-key entity reference |
| `relationships` | Directed, labeled entity-to-entity connection |
| `metadata` | Database initialization state |

Block contents are structured text and entity-ID segments, not arbitrary HTML. SQLite foreign keys validate property and relationship targets. Page mention IDs are validated when saved. Data lives in **`data/noema.sqlite`**, with SQLite WAL companion files while running. To back up by copying, stop the server first and copy the `data/` folder.

## API

All routes are under `/api` and accept/return JSON.

| Method | Route | Purpose |
| --- | --- | --- |
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

The integration test launches an isolated server on an available port and uses a temporary database. It covers page persistence across server restarts, entity edits, entity references, property and relationship edits/removals, incoming connections, invalid input, and rejection of cross-origin writes. It leaves your workspace data untouched. Browser UI validation is manual.

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

This is a single-user local prototype. Editing the same page in multiple tabs uses last-write-wins behavior. Page deletion is permanent. Entity deletion, drag-and-drop block ordering, rich text formatting, nested blocks, custom entity types, and automatic inverse/symmetric relationship rules are not implemented.

AI enrichment and embeddings are intentionally deferred. Stable entity IDs and separate property/relationship tables leave room for enrichment jobs, provenance, and an embedding table without changing how pages reference entities. Add schema migrations before evolving a database that contains valuable data.

The server has no user authentication and is intended for this computer only. Keep the loopback binding when running this version.
