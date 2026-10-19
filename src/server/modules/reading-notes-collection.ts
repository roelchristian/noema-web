import {randomUUID} from 'node:crypto';
import {Store} from '../store.js';

// Reading notes across all sources share one collection in each vault.
// Trashed notes retain their source metadata, but do not keep this collection alive.
export function syncReadingNotesCollection(store:Store,vault:string) {
 const collection=store.get<{id:string}>('SELECT id FROM collections WHERE vault_id=? AND name=? ORDER BY id LIMIT 1',vault,'Reading Notes');
 const hasNotes=store.get(`SELECT 1 FROM page_reading_notes n JOIN pages p ON p.id=n.page_id AND p.vault_id=n.vault_id
  WHERE n.vault_id=? AND p.deleted_at IS NULL LIMIT 1`,vault);
 if(!hasNotes) {
  if(collection)store.run('DELETE FROM collections WHERE vault_id=? AND id=?',vault,collection.id);
  return;
 }
 const id=collection?.id??randomUUID();
 if(!collection)store.run('INSERT INTO collections (id,vault_id,name) VALUES (?,?,?)',id,vault,'Reading Notes');
 store.run(`INSERT OR IGNORE INTO collection_memberships (vault_id,kind,item_id,collection_id)
  SELECT n.vault_id,'page',n.page_id,? FROM page_reading_notes n
  JOIN pages p ON p.id=n.page_id AND p.vault_id=n.vault_id WHERE n.vault_id=? AND p.deleted_at IS NULL`,id,vault);
}
