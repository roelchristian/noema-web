import { randomUUID } from 'node:crypto';
import type { Collection, Folder, ItemKind, Organization } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, required } from '../validation.js';

export class Organizer {
  constructor(private store: Store) {}
  list(vault: string): Organization {
    return {
      collections: this.store.all('SELECT id,name FROM collections WHERE vault_id=? ORDER BY name,id', vault),
      folders: this.store.all('SELECT id,name,collection_id,parent_id FROM folders WHERE vault_id=? ORDER BY name,id', vault),
      locations: this.store.all('SELECT kind,item_id,collection_id,folder_id FROM item_locations WHERE vault_id=?', vault),
      favourites: this.store.all('SELECT kind,item_id FROM favourites WHERE vault_id=?', vault),
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
    const collection = body.collection_id === undefined ? existing?.collection_id ?? null : this.nullable(body.collection_id);
    const parent = body.parent_id === undefined ? existing?.parent_id ?? null : this.nullable(body.parent_id);
    if (collection) this.collection(vault, collection);
    if (existing && collection !== existing.collection_id) throw new HttpError(400, 'Folders must remain in their collection context');
    if (parent) {
      let ancestor: Folder | undefined = this.folder(vault, parent);
      if (ancestor.collection_id !== collection) throw new HttpError(400, 'Parent folder must be in the same context');
      while (ancestor) {
        if (ancestor.id === id) throw new HttpError(400, 'Folders cannot contain themselves');
        ancestor = ancestor.parent_id ? this.folder(vault, ancestor.parent_id) : undefined;
      }
    }
    if (id) this.store.run('UPDATE folders SET name=?,parent_id=? WHERE id=?', name, parent, id);
    else this.store.run('INSERT INTO folders VALUES (?,?,?,?,?)', randomUUID(), vault, name, collection, parent);
    return this.list(vault);
  }
  remove(vault: string, type: 'collections' | 'folders', id: string) {
    if (type === 'collections') this.collection(vault, id); else this.folder(vault, id);
    // Removing containers never removes canonical content or favourites.
    this.store.run(`DELETE FROM ${type} WHERE id=? AND vault_id=?`, id, vault);
    return this.list(vault);
  }
  private item(vault: string, body: Record<string, unknown>): {kind: ItemKind; id: string} {
    const kind = body.kind;
    if (kind !== 'page' && kind !== 'entity') throw new HttpError(400, 'Invalid item kind');
    const id = required(body.item_id);
    if (!this.store.get(`SELECT id FROM ${kind === 'page' ? 'pages' : 'entities'} WHERE id=? AND vault_id=?`, id, vault)) throw new HttpError(404, 'Item not found');
    return {kind, id};
  }
  locate(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    const collection = this.nullable(body.collection_id), folder = this.nullable(body.folder_id);
    if (collection) this.collection(vault, collection);
    if (folder && this.folder(vault, folder).collection_id !== collection) throw new HttpError(400, 'Folder must be in the selected context');
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if (body.remove || (!collection && !folder)) this.store.run('DELETE FROM item_locations WHERE vault_id=? AND kind=? AND item_id=? AND collection_id=?', vault, kind, id, collection || '');
    else this.store.run('INSERT INTO item_locations VALUES (?,?,?,?,?) ON CONFLICT(vault_id,kind,item_id,collection_id) DO UPDATE SET folder_id=excluded.folder_id', vault, kind, id, collection || '', folder);
    return this.list(vault);
  }
  favourite(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    if (typeof body.favourite !== 'boolean') throw new HttpError(400, 'A favourite flag is required');
    if (body.favourite) this.store.run('INSERT OR IGNORE INTO favourites VALUES (?,?,?)', vault, kind, id);
    else this.store.run('DELETE FROM favourites WHERE vault_id=? AND kind=? AND item_id=?', vault, kind, id);
    return this.list(vault);
  }
}
