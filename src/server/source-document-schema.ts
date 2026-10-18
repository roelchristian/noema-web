import type {DatabaseSync} from 'node:sqlite';

/** Derived documents can be rebuilt from source_files after restore or schema changes. */
export function setupSourceDocumentSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_documents (
  file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
  builder_version INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
 )`);
 db.exec(`CREATE TABLE IF NOT EXISTS source_math_documents (
  file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
  raw_hash TEXT NOT NULL, algorithm_version INTEGER NOT NULL DEFAULT 1, cleaned_text TEXT NOT NULL, uncertainty_json TEXT NOT NULL, updated_at TEXT NOT NULL
 )`);
 if(!(db.prepare('PRAGMA table_info(source_math_documents)').all() as {name:string}[]).some(column=>column.name==='algorithm_version'))
  db.exec('ALTER TABLE source_math_documents ADD COLUMN algorithm_version INTEGER NOT NULL DEFAULT 1');
 db.exec(`CREATE TABLE IF NOT EXISTS source_math_batches (
  file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  PRIMARY KEY(file_id,input_hash)
 )`);
}

