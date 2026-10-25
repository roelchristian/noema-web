import type {DatabaseSync} from 'node:sqlite';

export function setupSourcePassageEmbeddingSchema(db:DatabaseSync) {
 db.exec('SAVEPOINT source_passage_embedding_schema');
 try {
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
 passage_id TEXT NOT NULL, file_id TEXT, generation_id TEXT NOT NULL DEFAULT '',
 source_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_attempt_at TEXT NOT NULL,
 error TEXT, tokens INTEGER
 );
 `);
 // Job history keeps its identity snapshots when active passages or sources are deleted.
 const columns=db.prepare('PRAGMA table_info(source_passage_embedding_jobs)').all() as {name:string}[];
 const foreignKeys=db.prepare('PRAGMA foreign_key_list(source_passage_embedding_jobs)').all() as {table:string}[];
 if(!columns.some(column=>column.name==='generation_id')||foreignKeys.some(key=>key.table==='source_passages'||key.table==='entities')) {
  db.exec(`DROP INDEX IF EXISTS source_passage_jobs_queue;
   DROP INDEX IF EXISTS source_passage_jobs_source;
   DROP INDEX IF EXISTS source_passage_jobs_active;
   ALTER TABLE source_passage_embedding_jobs RENAME TO source_passage_embedding_jobs_legacy;
   CREATE TABLE source_passage_embedding_jobs (
    id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    passage_id TEXT NOT NULL, file_id TEXT, generation_id TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
    status TEXT NOT NULL, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_attempt_at TEXT NOT NULL,
    error TEXT, tokens INTEGER
   );
   INSERT INTO source_passage_embedding_jobs
    SELECT j.id,j.vault_id,j.passage_id,p.file_id,coalesce(p.generation_id,''),j.source_id,j.content_hash,j.model,j.dimensions,
     j.status,j.reason,j.attempts,j.created_at,j.started_at,j.finished_at,j.next_attempt_at,j.error,j.tokens
    FROM source_passage_embedding_jobs_legacy j LEFT JOIN source_passages p ON p.id=j.passage_id;
   DROP TABLE source_passage_embedding_jobs_legacy;`);
 }
 if(!db.prepare('PRAGMA table_info(source_passage_embedding_jobs)').all().some(c=>c.name==='batch_max_inputs'))db.exec('ALTER TABLE source_passage_embedding_jobs ADD COLUMN batch_max_inputs INTEGER NOT NULL DEFAULT 16 CHECK(batch_max_inputs BETWEEN 1 AND 16)');
 db.exec(`CREATE INDEX IF NOT EXISTS source_passage_jobs_queue ON source_passage_embedding_jobs(status,next_attempt_at);
 CREATE INDEX IF NOT EXISTS source_passage_jobs_source ON source_passage_embedding_jobs(source_id,created_at DESC);
 /* Automatic discovery checks failed history per passage and its latest matching
    attempt. Bound both correlated lookups instead of scanning all job history. */
 CREATE INDEX IF NOT EXISTS source_passage_jobs_history ON source_passage_embedding_jobs(passage_id,generation_id,content_hash,model,dimensions,created_at DESC);
 CREATE UNIQUE INDEX IF NOT EXISTS source_passage_jobs_active ON source_passage_embedding_jobs(passage_id) WHERE status IN ('queued','running');
 UPDATE embedding_jobs SET status='skipped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error='Replaced by passage indexing.' WHERE source_id IS NOT NULL AND status IN ('queued','running');`);
 db.exec('RELEASE source_passage_embedding_schema');
 } catch(error) {db.exec('ROLLBACK TO source_passage_embedding_schema; RELEASE source_passage_embedding_schema');throw error;}
}
