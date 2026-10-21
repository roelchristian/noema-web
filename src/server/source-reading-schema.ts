import type {DatabaseSync} from 'node:sqlite';
export function setupSourceReadingSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_reading_locations (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  id TEXT NOT NULL, label TEXT NOT NULL, anchor_json TEXT NOT NULL,
  PRIMARY KEY(vault_id,file_id,id)
 );
 CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
  excerpt TEXT NOT NULL, color TEXT NOT NULL CHECK(color IN ('yellow','green','blue','pink','purple')),
  reference_json TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK(start_offset>=0 AND end_offset>start_offset)
 );
 CREATE INDEX IF NOT EXISTS highlights_file ON highlights(vault_id,file_id,start_offset);
 CREATE TABLE IF NOT EXISTS page_reading_notes (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL,
  source_hash TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
  excerpt TEXT NOT NULL, reference_json TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK(start_offset>=0 AND end_offset>start_offset)
 );
 CREATE INDEX IF NOT EXISTS page_reading_notes_source ON page_reading_notes(vault_id,source_id);`);
}
