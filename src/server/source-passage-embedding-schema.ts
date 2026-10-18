import type {DatabaseSync} from 'node:sqlite';

export function setupSourcePassageEmbeddingSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_passage_embedding_cache (
 vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
 vector TEXT NOT NULL, tokens INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(vault_id,source_id,content_hash,model,dimensions)
 );
 CREATE TABLE IF NOT EXISTS source_passage_embeddings (
 passage_id TEXT NOT NULL REFERENCES source_passages(id) ON DELETE CASCADE,
 model TEXT NOT NULL, dimensions INTEGER NOT NULL, content_hash TEXT NOT NULL,
 vector TEXT NOT NULL, tokens INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(passage_id,model,dimensions)
 );
 CREATE TABLE IF NOT EXISTS source_passage_embedding_jobs (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 passage_id TEXT NOT NULL REFERENCES source_passages(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_attempt_at TEXT NOT NULL,
 error TEXT, tokens INTEGER
 );
 CREATE INDEX IF NOT EXISTS source_passage_jobs_queue ON source_passage_embedding_jobs(status,next_attempt_at);
 CREATE INDEX IF NOT EXISTS source_passage_jobs_source ON source_passage_embedding_jobs(source_id,created_at DESC);
 CREATE UNIQUE INDEX IF NOT EXISTS source_passage_jobs_active ON source_passage_embedding_jobs(passage_id) WHERE status IN ('queued','running');
 UPDATE embedding_jobs SET status='skipped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error='Replaced by passage indexing.' WHERE source_id IS NOT NULL AND status IN ('queued','running');`);
}
