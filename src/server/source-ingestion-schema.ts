import type {DatabaseSync} from 'node:sqlite';
/** Authoritative outputs have their own lifetime; deleting a run never deletes published IR. */
export function setupSourceIngestionSchema(db:DatabaseSync) {
 const columns=db.prepare('PRAGMA table_info(source_files)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='ingestion_origin'))db.exec("ALTER TABLE source_files ADD COLUMN ingestion_origin TEXT NOT NULL DEFAULT 'local'");
 if(!columns.some(c=>c.name==='staging_key'))db.exec('ALTER TABLE source_files ADD COLUMN staging_key TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS source_files_staging_key ON source_files(vault_id,staging_key) WHERE staging_key IS NOT NULL');
 if(!columns.some(c=>c.name==='active_ingestion_run'))db.exec('ALTER TABLE source_files ADD COLUMN active_ingestion_run TEXT');
 db.exec(`CREATE TABLE IF NOT EXISTS source_ingestion_runs (
 id TEXT PRIMARY KEY,file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL,config_json TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',stage TEXT NOT NULL DEFAULT 'preparation',
 page_count INTEGER NOT NULL DEFAULT 0,original_hash TEXT,admitted_hash TEXT,published_document_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(vault_id,idempotency_key));
 CREATE UNIQUE INDEX IF NOT EXISTS source_ingestion_source_lease ON source_ingestion_runs(file_id) WHERE state IN ('pending','running','paused','unknown');
 CREATE TABLE IF NOT EXISTS source_ingestion_windows (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES source_ingestion_runs(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,plan_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending',result_json TEXT,transmitted_hash TEXT,error TEXT,UNIQUE(run_id,ordinal));
 CREATE TABLE IF NOT EXISTS source_ingestion_attempts (
 id TEXT PRIMARY KEY,window_id TEXT NOT NULL REFERENCES source_ingestion_windows(id) ON DELETE CASCADE,state TEXT NOT NULL,
 request_id TEXT,usage_json TEXT,response_hash TEXT,returned_model TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_ingestion_documents (
 id TEXT PRIMARY KEY,file_id TEXT NOT NULL UNIQUE REFERENCES source_files(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 schema_version INTEGER NOT NULL,assembly_version INTEGER NOT NULL,content_hash TEXT NOT NULL,document_json TEXT NOT NULL,
 assembly_json TEXT NOT NULL,provenance_json TEXT NOT NULL,capabilities_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const attempts=db.prepare('PRAGMA table_info(source_ingestion_attempts)').all() as {name:string}[];
 if(!attempts.some(c=>c.name==='returned_model'))db.exec('ALTER TABLE source_ingestion_attempts ADD COLUMN returned_model TEXT');
}
