import type {DatabaseSync} from 'node:sqlite';

export function setupSourceAuthorSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_author_jobs (
  file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', content_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT '',
  error TEXT, updated_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS source_author_jobs_queue ON source_author_jobs(status,next_attempt_at);
 CREATE TRIGGER IF NOT EXISTS source_authors_file_update AFTER UPDATE OF text,entity_id,vault_id ON source_files
 WHEN NEW.text IS NOT OLD.text OR NEW.entity_id IS NOT OLD.entity_id OR NEW.vault_id IS NOT OLD.vault_id
 BEGIN DELETE FROM source_author_jobs WHERE file_id=OLD.id; END;`);
}
