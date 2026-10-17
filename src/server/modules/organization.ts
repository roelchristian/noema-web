import { randomUUID } from 'node:crypto';
import type { Collection, Folder, ItemKind, Organization } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, required } from '../validation.js';

export class Organizer {
  constructor(private store: Store) {}
  list(vault: string): Organization {
    return {
      collections: this.store.all('SELECT id,name FROM collections WHERE vault_id=? ORDER BY name,id', vault),
      folders: this.store.all('SELECT id,name,parent_id FROM folders WHERE vault_id=? ORDER BY name,id', vault),
      locations: this.store.all(`SELECT kind,item_id,folder_id FROM item_locations WHERE vault_id=? AND (kind='entity' OR EXISTS (SELECT 1 FROM pages WHERE pages.id=item_locations.item_id AND pages.vault_id=item_locations.vault_id AND pages.deleted_at IS NULL))`, vault),
      memberships: this.store.all(`SELECT kind,item_id,collection_id FROM collection_memberships WHERE vault_id=? AND (kind='entity' OR EXISTS (SELECT 1 FROM pages WHERE pages.id=collection_memberships.item_id AND pages.vault_id=collection_memberships.vault_id AND pages.deleted_at IS NULL))`, vault),
      favourites: this.store.all(`SELECT kind,item_id FROM favourites WHERE vault_id=? AND (kind IN ('entity','folder') OR EXISTS (SELECT 1 FROM pages WHERE pages.id=favourites.item_id AND pages.vault_id=favourites.vault_id AND pages.deleted_at IS NULL))`, vault),
    };
  }
  private collection(vault: string, id: string) {
    const row = this.store.get<Collection>('SELECT * FROM collections WHERE vault_id=? AND id=?', vault, id);
    if (!row) throw new HttpError(404, 'Collection not found');
    return row;
  }
  private folder(vault: string, id: string) {
    const row = this.store.get<Folder>('SELECT * FROM folders WHERE vault_id=? AND id=?', vault, id);
    if (!row) throw new HttpError(404, 'Folder not found');
    return row;
  }
  private nullable(value: unknown): string | null { return value === null || value === undefined ? null : required(value); }
  saveCollection(vault: string, body: Record<string, unknown>, id?: string) {
    if (body.parent_id != null || body.collection_id != null) throw new HttpError(400, 'Collections cannot be nested');
    const name = required(body.name);
    if (id) { this.collection(vault, id); this.store.run('UPDATE collections SET name=? WHERE id=?', name, id); }
    else this.store.run('INSERT INTO collections VALUES (?,?,?)', randomUUID(), vault, name);
    return this.list(vault);
  }
  saveFolder(vault: string, body: Record<string, unknown>, id?: string) {
    const existing = id ? this.folder(vault, id) : null;
    const name = required(body.name);
    if (body.collection_id != null) throw new HttpError(400, 'Folders are independent of collections');
    const parent = body.parent_id === undefined ? existing?.parent_id ?? null : this.nullable(body.parent_id);
    if (parent) {
      let ancestor: Folder | undefined = this.folder(vault, parent);
      while (ancestor) {
        if (ancestor.id === id) throw new HttpError(400, 'Folders cannot contain themselves');
        ancestor = ancestor.parent_id ? this.folder(vault, ancestor.parent_id) : undefined;
      }
    }
    if (id) this.store.run('UPDATE folders SET name=?,parent_id=? WHERE id=?', name, parent, id);
    else this.store.run('INSERT INTO folders VALUES (?,?,?,?)', randomUUID(), vault, name, parent);
    return this.list(vault);
  }
  remove(vault: string, type: 'collections' | 'folders', id: string) {
    if (type === 'collections') this.collection(vault, id); else this.folder(vault, id);
    // Removing containers preserves canonical content; deleted folders lose their own favourites.
    this.store.run(`DELETE FROM ${type} WHERE id=? AND vault_id=?`, id, vault);
    return this.list(vault);
  }
  private item(vault: string, body: Record<string, unknown>): {kind: ItemKind; id: string} {
    const kind = body.kind;
    if (kind !== 'page' && kind !== 'entity') throw new HttpError(400, 'Invalid item kind');
    const id = required(body.item_id);
    if (!this.store.get(`SELECT id FROM ${kind === 'page' ? 'pages' : 'entities'} WHERE id=? AND vault_id=?${kind === 'page' ? ' AND deleted_at IS NULL' : ''}`, id, vault)) throw new HttpError(404, 'Item not found');
    return {kind, id};
  }
  locate(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    if (body.collection_id != null) throw new HttpError(400, 'Use memberships to change collections');
    const folder = this.nullable(body.folder_id);
    if (folder) this.folder(vault, folder);
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if (body.remove || !folder) this.store.run('DELETE FROM item_locations WHERE vault_id=? AND kind=? AND item_id=?', vault, kind, id);
    else this.store.run('INSERT INTO item_locations VALUES (?,?,?,?) ON CONFLICT(vault_id,kind,item_id) DO UPDATE SET folder_id=excluded.folder_id', vault, kind, id, folder);
    return this.list(vault);
  }
  membership(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    const collection = required(body.collection_id);
    this.collection(vault, collection);
    if (body.folder_id != null) throw new HttpError(400, 'Collection membership cannot change a folder');
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if (body.remove) this.store.run('DELETE FROM collection_memberships WHERE vault_id=? AND kind=? AND item_id=? AND collection_id=?', vault, kind, id, collection);
    else this.store.run('INSERT OR IGNORE INTO collection_memberships VALUES (?,?,?,?)', vault, kind, id, collection);
    return this.list(vault);
  }
  favourite(vault: string, body: Record<string, unknown>) {
    const {kind, id} = body.kind === 'folder' ? {kind: 'folder' as const, id: this.folder(vault, required(body.item_id)).id} : this.item(vault, body);
    if (typeof body.favourite !== 'boolean') throw new HttpError(400, 'A favourite flag is required');
    if (body.favourite) this.store.run('INSERT OR IGNORE INTO favourites VALUES (?,?,?)', vault, kind, id);
    else this.store.run('DELETE FROM favourites WHERE vault_id=? AND kind=? AND item_id=?', vault, kind, id);
    return this.list(vault);
  }
}
