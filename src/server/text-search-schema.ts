import type {DatabaseSync} from 'node:sqlite';

/** SQL triggers cover every write path, including imports and background jobs.
 * The durable queue is consumed transactionally before a vault is searched. */
export function setupTextSearchSchema(db: DatabaseSync): void {
  db.exec('SAVEPOINT text_search_schema_setup');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS text_search_documents (
        rowid INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('page','entity')),
        id TEXT NOT NULL, vault_id TEXT NOT NULL, UNIQUE(kind,id)
      );
      CREATE INDEX IF NOT EXISTS text_search_documents_vault ON text_search_documents(vault_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS text_search_fts USING fts5(
        name, body, aliases, tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
      );
      CREATE TABLE IF NOT EXISTS text_search_dirty (
        kind TEXT NOT NULL CHECK(kind IN ('page','entity','vault-pages')),
        id TEXT NOT NULL, vault_id TEXT NOT NULL, PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS text_search_dirty_vault ON text_search_dirty(vault_id);
      CREATE TRIGGER IF NOT EXISTS pages_text_search_insert AFTER INSERT ON pages BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='page' AND id=NEW.id);
        DELETE FROM text_search_documents WHERE kind='page' AND id=NEW.id;
        INSERT OR REPLACE INTO text_search_dirty VALUES ('page',NEW.id,NEW.vault_id);
      END;
      CREATE TRIGGER IF NOT EXISTS pages_text_search_update AFTER UPDATE OF title,blocks,vault_id,deleted_at ON pages BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='page' AND id=OLD.id)
          AND (NEW.deleted_at IS NOT NULL OR NEW.vault_id<>OLD.vault_id);
        DELETE FROM text_search_documents WHERE kind='page' AND id=OLD.id
          AND (NEW.deleted_at IS NOT NULL OR NEW.vault_id<>OLD.vault_id);
        INSERT OR REPLACE INTO text_search_dirty VALUES ('page',NEW.id,NEW.vault_id);
      END;
      CREATE TRIGGER IF NOT EXISTS pages_text_search_delete AFTER DELETE ON pages BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='page' AND id=OLD.id);
        DELETE FROM text_search_documents WHERE kind='page' AND id=OLD.id;
        DELETE FROM text_search_dirty WHERE kind='page' AND id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS entities_text_search_insert AFTER INSERT ON entities BEGIN
        INSERT OR REPLACE INTO text_search_dirty SELECT 'vault-pages',vault_id,vault_id FROM text_search_documents WHERE kind='entity' AND id=NEW.id;
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='entity' AND id=NEW.id);
        DELETE FROM text_search_documents WHERE kind='entity' AND id=NEW.id;
        INSERT OR REPLACE INTO text_search_dirty VALUES ('entity',NEW.id,NEW.vault_id);
        INSERT OR REPLACE INTO text_search_dirty VALUES ('vault-pages',NEW.vault_id,NEW.vault_id);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_text_search_update AFTER UPDATE OF name,aliases,mention_case,vault_id ON entities BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='entity' AND id=OLD.id) AND NEW.vault_id<>OLD.vault_id;
        DELETE FROM text_search_documents WHERE kind='entity' AND id=OLD.id AND NEW.vault_id<>OLD.vault_id;
        INSERT OR REPLACE INTO text_search_dirty VALUES ('entity',NEW.id,NEW.vault_id);
        INSERT OR REPLACE INTO text_search_dirty VALUES ('vault-pages',OLD.vault_id,OLD.vault_id);
        INSERT OR REPLACE INTO text_search_dirty VALUES ('vault-pages',NEW.vault_id,NEW.vault_id);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_text_search_delete AFTER DELETE ON entities BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind='entity' AND id=OLD.id);
        DELETE FROM text_search_documents WHERE kind='entity' AND id=OLD.id;
        DELETE FROM text_search_dirty WHERE kind='entity' AND id=OLD.id;
        INSERT OR REPLACE INTO text_search_dirty VALUES ('vault-pages',OLD.vault_id,OLD.vault_id);
      END;
      CREATE TRIGGER IF NOT EXISTS vaults_text_search_delete AFTER DELETE ON vaults BEGIN
        DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE vault_id=OLD.id);
        DELETE FROM text_search_documents WHERE vault_id=OLD.id;
        DELETE FROM text_search_dirty WHERE vault_id=OLD.id;
      END;
    `);
    if (!db.prepare("SELECT 1 FROM metadata WHERE key='text-search-v1-backfill'").get()) {
      db.exec(`
        INSERT OR REPLACE INTO text_search_dirty SELECT 'page',id,vault_id FROM pages WHERE deleted_at IS NULL;
        INSERT OR REPLACE INTO text_search_dirty SELECT 'entity',id,vault_id FROM entities;
        INSERT INTO metadata(key,value) VALUES ('text-search-v1-backfill','queued');
      `);
    }
    db.exec('RELEASE text_search_schema_setup');
  } catch (error) {
    db.exec('ROLLBACK TO text_search_schema_setup; RELEASE text_search_schema_setup');
    throw error;
  }
}
