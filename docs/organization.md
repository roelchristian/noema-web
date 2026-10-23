# Folders, collections, and navigation

[Documentation index](README.md) · [Noema home](../README.md)

## Folders and collections

Main list screens offer **List**, **Compact**, and **Grid** layouts. Compact keeps each item on one line; Grid uses small icon cards with local note excerpts, entity descriptions, or folder/collection previews where available. Layout choices are remembered per screen in this browser. Library (including folders, collections, Inbox, and Favourites), Knowledge entities, Recent items, and Trash support these controls. Switching layouts keeps sorting, selection, navigation, and item actions available. Trash cards retain restore and permanent-delete actions rather than opening deleted notes.

**Library** shows folders and notes together in one content table. The root contains top-level folders and unfiled notes; each folder shows only its immediate subfolders and notes. Open notes show their absolute location in breadcrumbs, starting with **Pages**, followed by ancestor folders and the note title. Collection membership and the route used to open a note do not change this path. Star folders from the table or sidebar to open them from **Favourites**, alongside starred notes and entities. Removing a folder clears its own favourite and those of deleted subfolders while preserving note favourites.

Folders define storage location within a vault. A note has one folder, or is unfiled in **Inbox**. Folders can contain subfolders. Moving a note replaces its location; moving it to Inbox clears the folder. Drag a folder onto another folder in the Library table or sidebar to move its entire subtree. Notes keep their folder IDs, collection memberships, and favourites; their breadcrumb paths follow the new ancestry. Self and descendant drops are rejected. Removing a folder also removes its subfolders and returns their notes to Inbox. Notes, collection memberships, and favourites are kept.

Collections curate notes across folder locations. A note can belong to multiple collections. Collections are flat and can include links to existing folders. Adding or removing a membership never moves the note. Removing a collection removes only its memberships. Use **Organize** for a note or a selection of notes; dropping onto a folder in the Library table or sidebar moves a note from its current location, while dropping onto a collection adds membership. A note in collections remains in Inbox until filed into a folder. Use **Add to collection…** on a folder, **Add folder…** in collection options, or drag a folder onto a sidebar collection. **Linked folder (Suggested)** keeps a live reference to the folder and its subfolders, including future additions. **Current pages only** adds individual memberships for the current non-trashed pages in the folder subtree; future additions are not included automatically. Unlinking a folder preserves the folder and its contents. Folder links are included in vault backups.

Collections can also use deterministic **smart** rules, chosen in the same collection creation/edit flow and displayed in the same Collections navigation. Smart membership is virtual and supports persistent explicit inclusion/exclusion decisions. Physical folders and existing manual collections retain their behavior. See [Smart collections](smart-collections.md) for the Phase 1 scope, evaluation states, and deferred intelligence phases.

Folders and every collection type can have an optional **Description** explaining their human purpose. Edit it in the existing create/edit dialog. For smart collections this is separate from the **Matching description**, which defines semantic or hybrid matching. Human descriptions never change membership rules, query embeddings, example selections, overrides, or physical locations, and editing them makes no AI/provider request.

Descriptions accept up to 2,000 characters. The organization API accepts `description` on folder and collection create/update requests: omitting it preserves the existing value, while `null`, an empty string, or whitespace clears it. Values are trimmed and malformed/control-character input is rejected. Descriptions are vault-scoped, unavailable while locked, retained through restart and vault backup/import, and included in vault-deletion confirmation fingerprints. Additive sidecar tables preserve legacy folder/collection rows and backups without descriptions.

The API exposes `organization.locations` separately from `organization.memberships`. `PUT /api/organization/locations` accepts `{kind, item_id, folder_id}` (null means Inbox); `PUT /api/organization/memberships` accepts `{kind, item_id, collection_id, remove?}`. SQLite enforces one location per vault/item and unique memberships per vault/item/collection. Both operations validate vault scope and preserve canonical note content. Trash hides organization until restore; permanent deletion clears both relations.

Existing databases migrate transactionally on startup. Folder IDs, nesting, and all collection memberships survive, while folders become independent of collections. If a legacy note has multiple folder assignments, the migration selects its first non-null folder ordered by collection ID, then folder ID. This is deterministic across restarts. Notes with no folder stay unfiled. The former combined location API is replaced by the two operations above.

## Organization

The page toolbar includes a favourite toggle, **Connected knowledge** for inline entity mentions, and **Sources** for attaching, creating, opening, and removing page-level references.

The sidebar groups **Favourites** and **Recent items** under **Quick Access**. Recent items remembers the last 50 opened pages and entities per vault in this browser. The separate **Folders & collections** group below lists collections and nested folders; click one to browse its contents.

Open **All content** in that group to organize pages and knowledge entities. **All content** lists canonical items across the vault. Use **Organize** on an item to choose its vault folder, add it to any number of collections, or include a folder as a live link or a one-time set of current pages. Opening an item from any context edits the same underlying record.

- **Collections** are named, flat contexts. Collections cannot contain other collections. Rename or delete one using **Edit** or **Delete** in its toolbar.
- **Folders** are nested within a vault. Each item has one folder location. Collections can link to a folder without moving it; the link reflects current contents and future additions.
- **Collection membership** is many-to-many and never copies content. Untick a collection under **Organize** to remove only that membership.
- **Favourites** provide independent quick access. Use the star in a page’s top toolbar or beside an item and open **Favourites** in the sidebar. Moving items or removing collections does not change their favourite status.

Deleting a folder removes its nested folders and returns their items to Inbox. Deleting a collection removes its folder links and memberships, preserving the original folders. Both actions preserve canonical content and favourites. Organization is vault-scoped, persisted in SQLite, and unavailable while a vault is locked.
