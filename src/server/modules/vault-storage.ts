import {readdir, lstat} from 'node:fs/promises';
import path from 'node:path';
import type {VaultStorage, VaultStorageItem, StorageCategory} from '../../shared/vault-storage.js';
import {storageCategories} from '../../shared/vault-storage.js';
import {Store} from '../store.js';
import {Vaults} from './vaults.js';
import {HttpError} from '../validation.js';

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** File bytes plus logical SQLite values. Shared indexes and free pages cannot be attributed to a vault. */
export async function vaultStorage(store: Store, vault: string, categoryId?: string): Promise<VaultStorage> {
  new Vaults(store).requireOpen(vault);
  if (!/^(default|[0-9a-f-]{36})$/.test(vault)) throw new HttpError(400, 'Invalid vault ID');
  if (categoryId !== undefined && !storageCategories.includes(categoryId as StorageCategory)) throw new HttpError(400, 'Invalid storage category');
  const items = new Map<string, VaultStorageItem>();
  const names = new Map<string, {name: string; detail: string}>();
  function addItem(id: string, bytes: number, fallback: string, detail: string) {
    const existing = items.get(id);
    if (existing) existing.bytes += bytes;
    else items.set(id, {id, bytes, ...(names.get(id) ?? {name: fallback, detail})});
  }
  if (categoryId) {
    for (const row of store.all<{id: string; title: string; deleted_at: string | null}>('SELECT id,title,deleted_at FROM pages WHERE vault_id=?', vault)) {
      names.set('page:' + row.id, {name: row.title || 'Untitled note', detail: row.deleted_at ? 'Note in Trash' : 'Note'});
    }
    for (const row of store.all<{id: string; name: string; type: string}>('SELECT id,name,type FROM entities WHERE vault_id=?', vault)) {
      names.set('entity:' + row.id, {name: row.name, detail: row.type === 'source' ? 'Source' : 'Entity'});
    }
    for (const row of store.all<{id: string; name: string; entity_id: string | null}>('SELECT id,name,entity_id FROM source_files WHERE vault_id=?', vault)) {
      names.set('file:' + row.id, {name: row.name, detail: 'Source file'});
    }
  }
  const totals = Object.fromEntries(storageCategories.map(id => [id, 0])) as Record<StorageCategory, number>;
  const tables = store.all<{name: string}>("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%'");
  const columns = new Map(tables.map(({name}) => [name, store.all<{name: string}>(`PRAGMA table_info(${quote(name)})`).map(column => column.name)]));
  // Follow ownership foreign keys for child tables that do not carry vault_id themselves.
  function scope(table: string, seen: string[] = []): string | null {
    if (seen.includes(table) || !columns.has(table)) return null;
    if (columns.get(table)!.includes('vault_id')) return `${quote(table)}.vault_id=?`;
    const owners = ['entity_id', 'page_id', 'file_id', 'source_id', 'activity_id', 'segment_id'];
    const keys = store.all<{table: string; from: string; to: string}>(`PRAGMA foreign_key_list(${quote(table)})`);
    for (const fk of keys.filter(key => owners.includes(key.from)).sort((a, b) => owners.indexOf(a.from) - owners.indexOf(b.from))) {
      if (fk.table === 'vaults') continue;
      const parent = scope(fk.table, [...seen, table]);
      if (parent) return `${quote(table)}.${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(fk.table)} WHERE ${parent})`;
    }
    return null;
  }
  // A row's owner provides a useful item name without reading large text or vector payloads.
  function owner(table: string, seen: string[] = []): string | null {
    if (seen.includes(table) || !columns.has(table)) return null;
    if (table === 'pages') return "'page:' || id";
    if (table === 'entities') return "'entity:' || id";
    if (table === 'source_files') return "'file:' || id";
    const fields = columns.get(table)!;
    const references = ([['page_id', 'page:'], ['entity_id', 'entity:'], ['source_id', 'entity:'], ['file_id', 'file:']] as const)
      .filter(([column]) => fields.includes(column)).map(([column, prefix]) => `'${prefix}' || ${quote(column)}`);
    if (references.length) return `coalesce(${references.join(',')}, 'table:${table}')`;
    if (fields.includes('id') && fields.includes('name')) return `'record:${table}:' || id`;
    for (const fk of store.all<{table: string; from: string; to: string}>(`PRAGMA foreign_key_list(${quote(table)})`)) {
      if (!['segment_id', 'activity_id'].includes(fk.from)) continue;
      const parent = owner(fk.table, [...seen, table]);
      if (parent) return `(SELECT ${parent} FROM ${quote(fk.table)} WHERE ${quote(fk.table)}.${quote(fk.to)}=${quote(table)}.${quote(fk.from)})`;
    }
    return null;
  }
  for (const {name} of tables) {
    const where = scope(name);
    if (!where) continue;
    const category: StorageCategory = /embedding|segment|index|search|cache|passage/.test(name) ? 'indexes'
      : name === 'pages' || name.startsWith('page_ai_') ? 'notes'
      : /^(source_|highlights|page_reading_notes|note_source)/.test(name) ? 'sources'
      : /^(entit|properties$|relationships$)/.test(name) ? 'entities' : 'other';
    const sizes = columns.get(name)!.map(column => `coalesce(length(CAST(${quote(column)} AS BLOB)),0)`).join('+');
    if (categoryId === category) {
      const itemOwner = owner(name) ?? `'table:${name}'`;
      if (itemOwner.startsWith("'record:")) {
        for (const row of store.all<{id: string; name: string}>(`SELECT id,name FROM ${quote(name)} WHERE ${where}`, vault)) {
          names.set(`record:${name}:${row.id}`, {name: row.name, detail: name.replaceAll('_', ' ')});
        }
      }
      for (const row of store.all<{item: string | null; bytes: number}>(`SELECT ${itemOwner} AS item, sum(${sizes}) AS bytes FROM ${quote(name)} WHERE ${where} GROUP BY ${itemOwner}`, vault)) {
        addItem(row.item ?? 'table:' + name, row.bytes, name.replaceAll('_', ' '), 'Database content');
      }
    }
    totals[category] += store.get<{bytes: number}>(`SELECT coalesce(sum(${sizes}),0) AS bytes FROM ${quote(name)} WHERE ${where}`, vault)!.bytes;
  }
  const dataBytes = Object.values(totals).reduce((a, b) => a + b, 0);
  const database = store.all<{name: string; file: string}>('PRAGMA database_list').find(db => db.name === 'main');
  async function fileSize(filename: string, relative: string, category: StorageCategory): Promise<number> {
    try {
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) return 0;
      if (stat.isFile()) {
        if (categoryId === category) {
          const parts = relative.split(path.sep);
          const fileName = names.get('file:' + parts[1])?.name;
          addItem('asset:' + relative, stat.size, fileName ?? path.basename(filename), relative);
        }
        return stat.size;
      }
      if (!stat.isDirectory()) return 0;
      let bytes = 0;
      for (const entry of await readdir(filename)) bytes += await fileSize(path.join(filename, entry), path.join(relative, entry), category);
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }
  let fileBytes = 0;
  if (database?.file) {
    const root = path.join(path.dirname(database.file), 'assets', vault);
    // lstat at every level avoids following symlinks outside this vault.
    try {
      if ((await lstat(root)).isDirectory()) {
        for (const entry of await readdir(root)) {
          const category = ['images', 'sources', 'source-inbox', 'source-evidence'].includes(entry) ? 'attachments' : 'other';
          const bytes = await fileSize(path.join(root, entry), entry, category);
          totals[category] += bytes;
          fileBytes += bytes;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  new Vaults(store).requireOpen(vault);
  return {...(categoryId ? {items: [...items.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))} : {}), totalBytes: dataBytes + fileBytes, fileBytes, dataBytes, categories: storageCategories.map(id => ({id, bytes: totals[id]}))};
}
