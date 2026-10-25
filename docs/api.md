# API reference

[Documentation index](README.md) · [Noema home](../README.md)

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
| GET | `/pages/:id/suggestion-version` | Cheap saved-input version for related notes and source suggestions |
| GET | `/pages/:id/related-notes` | Saved-vector ranking; optional `state=1` and up to five `previous` IDs return pending/retained eligibility ([contract](related-notes-refresh.md#behavior-and-api)) |
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

## Feature-specific endpoints

- [Organization locations and memberships](organization.md#folders-and-collections)
- [Source files](sources.md#source-file-api)
- [Intelligence and page enrichments](intelligence.md#intelligence-and-page-summaries)
- [Knowledge Chat](noema-chat.md#api)
- [Search and embeddings](search.md#semantic-search-and-note-embeddings)
- [Subjects and disciplines](knowledge-entities.md#subjects-and-disciplines)
