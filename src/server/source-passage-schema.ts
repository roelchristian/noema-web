import type {DatabaseSync} from 'node:sqlite';

/** Extraction writes enqueue durable work, so unchanged books never need polling/hashing. */
export function setupSourcePassageSchema(db:DatabaseSync):void {
  db.exec('SAVEPOINT source_passage_schema');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_passages (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, heading TEXT, text TEXT NOT NULL,
        start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
        start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
        source_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
        start_page INTEGER, end_page INTEGER, token_count INTEGER NOT NULL,
        UNIQUE(file_id,ordinal)
      );
      CREATE INDEX IF NOT EXISTS source_passages_vault ON source_passages(vault_id,source_id,ordinal);
      CREATE TABLE IF NOT EXISTS source_passage_state (
        file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL DEFAULT '', chunk_version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', error TEXT, updated_at TEXT NOT NULL DEFAULT '',
        context_hash TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS source_passage_dirty (
        file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS source_passage_dirty_vault ON source_passage_dirty(vault_id,queued_at);
      CREATE TABLE IF NOT EXISTS source_passage_generations (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL, context_hash TEXT NOT NULL,
        chunk_version INTEGER NOT NULL, passage_count INTEGER NOT NULL,
        passages TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS source_passage_generations_file ON source_passage_generations(file_id,created_at);
    `);
    const passageColumns=new Set((db.prepare('PRAGMA table_info(source_passages)').all() as {name:string}[]).map(row=>row.name));
    for(const [name,definition] of Object.entries({generation_id:"TEXT NOT NULL DEFAULT 'legacy'",stable_id:"TEXT NOT NULL DEFAULT ''",estimated_token_count:'INTEGER',actual_token_count:'INTEGER'}))
      if(!passageColumns.has(name))db.exec(`ALTER TABLE source_passages ADD COLUMN ${name} ${definition}`);
    db.exec("UPDATE source_passages SET stable_id=id WHERE stable_id=''; UPDATE source_passages SET estimated_token_count=token_count WHERE estimated_token_count IS NULL; UPDATE source_passages SET generation_id='legacy:'||file_id WHERE generation_id='legacy'");
    const stateColumns=new Set((db.prepare('PRAGMA table_info(source_passage_state)').all() as {name:string}[]).map(row=>row.name));
    if(!stateColumns.has('active_generation_id'))db.exec("ALTER TABLE source_passage_state ADD COLUMN active_generation_id TEXT");
    // Always replace the original destructive trigger when upgrading an existing vault.
    db.exec(`
      DROP TRIGGER IF EXISTS source_passages_file_update;
      CREATE TRIGGER IF NOT EXISTS source_passages_file_insert AFTER INSERT ON source_files BEGIN
        INSERT OR IGNORE INTO source_passage_dirty(file_id,vault_id) VALUES (NEW.id,NEW.vault_id);
      END;
      CREATE TRIGGER source_passages_file_update AFTER UPDATE OF text,status,admitted,entity_id,page_start_lines,vault_id,format,pages,structural_nodes ON source_files
      WHEN NEW.text IS NOT OLD.text OR NEW.status IS NOT OLD.status OR NEW.admitted IS NOT OLD.admitted
        OR NEW.entity_id IS NOT OLD.entity_id OR NEW.page_start_lines IS NOT OLD.page_start_lines
        OR NEW.vault_id IS NOT OLD.vault_id OR NEW.format IS NOT OLD.format OR NEW.pages IS NOT OLD.pages
        OR NEW.structural_nodes IS NOT OLD.structural_nodes
      BEGIN
        INSERT OR REPLACE INTO source_passage_dirty(file_id,vault_id) VALUES (NEW.id,NEW.vault_id);
        UPDATE source_passage_state SET status='preparing',error=NULL WHERE file_id=NEW.id;
      END;
    `);
    if(!db.prepare("SELECT 1 FROM metadata WHERE key='source-passages-v2-backfill'").get()) {
      db.exec(`INSERT OR IGNORE INTO source_passage_dirty(file_id,vault_id)
        SELECT id,vault_id FROM source_files WHERE status='ready' AND admitted=1 AND entity_id IS NOT NULL;
        INSERT INTO metadata(key,value) VALUES ('source-passages-v2-backfill','queued');`);
    }
    db.exec('RELEASE source_passage_schema');
  } catch(error) {db.exec('ROLLBACK TO source_passage_schema; RELEASE source_passage_schema');throw error;}
}
