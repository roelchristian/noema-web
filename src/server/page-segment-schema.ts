import type {DatabaseSync} from 'node:sqlite';

export function setupPageSegmentSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS page_index_state (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,projection_hash TEXT NOT NULL,strategy TEXT NOT NULL,policy_hash TEXT NOT NULL,token_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,error TEXT
 );
 CREATE TABLE IF NOT EXISTS page_segments (
  id TEXT PRIMARY KEY,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,projection_hash TEXT NOT NULL,ordinal INTEGER NOT NULL,heading TEXT NOT NULL,text TEXT NOT NULL,input TEXT NOT NULL,
  content_hash TEXT NOT NULL,block_ids TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,token_count INTEGER NOT NULL,
  UNIQUE(page_id,ordinal)
 );
 CREATE INDEX IF NOT EXISTS page_segments_vault ON page_segments(vault_id,page_id);
 CREATE TABLE IF NOT EXISTS page_segment_embeddings (
  segment_id TEXT NOT NULL REFERENCES page_segments(id) ON DELETE CASCADE,model TEXT NOT NULL,dimensions INTEGER NOT NULL,
  content_hash TEXT NOT NULL,vector TEXT NOT NULL,tokens INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(segment_id,model,dimensions)
 );
 CREATE TABLE IF NOT EXISTS page_segment_cache (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,
  vector TEXT NOT NULL,tokens INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(page_id,content_hash,model,dimensions)
 );
 CREATE TABLE IF NOT EXISTS page_index_dirty (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  next_attempt_at TEXT NOT NULL DEFAULT '',error TEXT
 );
 CREATE TABLE IF NOT EXISTS page_mentioned_entities (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,entity_id TEXT NOT NULL,PRIMARY KEY(page_id,entity_id)
 );
 CREATE INDEX IF NOT EXISTS page_mentioned_entities_entity ON page_mentioned_entities(entity_id,page_id);
 CREATE VIRTUAL TABLE IF NOT EXISTS page_segments_fts USING fts5(heading,text,tokenize='unicode61 remove_diacritics 2');
 CREATE TRIGGER IF NOT EXISTS page_segments_fts_insert AFTER INSERT ON page_segments BEGIN
  INSERT INTO page_segments_fts(rowid,heading,text) VALUES(NEW.rowid,NEW.heading,NEW.text); END;
 CREATE TRIGGER IF NOT EXISTS page_segments_fts_update AFTER UPDATE OF heading,text ON page_segments BEGIN
  DELETE FROM page_segments_fts WHERE rowid=OLD.rowid; INSERT INTO page_segments_fts(rowid,heading,text) VALUES(NEW.rowid,NEW.heading,NEW.text); END;
 CREATE TRIGGER IF NOT EXISTS page_segments_fts_delete AFTER DELETE ON page_segments BEGIN DELETE FROM page_segments_fts WHERE rowid=OLD.rowid; END;
 DROP TRIGGER IF EXISTS page_index_insert;
 CREATE TRIGGER page_index_insert AFTER INSERT ON pages BEGIN
  INSERT OR REPLACE INTO page_index_dirty(page_id,vault_id) VALUES(NEW.id,NEW.vault_id); END;
 DROP TRIGGER IF EXISTS page_index_update;
 CREATE TRIGGER page_index_update AFTER UPDATE OF title,blocks,revision,deleted_at,vault_id ON pages
 WHEN OLD.title IS NOT NEW.title OR OLD.blocks IS NOT NEW.blocks OR OLD.revision IS NOT NEW.revision OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.vault_id IS NOT NEW.vault_id BEGIN
  INSERT OR REPLACE INTO page_index_dirty(page_id,vault_id) VALUES(NEW.id,NEW.vault_id);
  UPDATE embedding_jobs SET status='skipped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error='Page unavailable.' WHERE page_id=NEW.id AND status IN ('queued','running') AND (NEW.deleted_at IS NOT NULL OR OLD.vault_id IS NOT NEW.vault_id);
  DELETE FROM page_segments WHERE page_id=NEW.id AND NEW.deleted_at IS NOT NULL;
  DELETE FROM page_segment_cache WHERE page_id=NEW.id AND NEW.deleted_at IS NOT NULL; END;`);
 // Keep dependencies current in the page write transaction, even before indexing.
 // Entity IDs deliberately have no FK: unresolved and deleted mentions must survive.
 db.exec(`DROP TRIGGER IF EXISTS page_mentioned_entities_insert;
 CREATE TRIGGER page_mentioned_entities_insert AFTER INSERT ON pages BEGIN
  INSERT OR IGNORE INTO page_mentioned_entities(page_id,entity_id)
   SELECT NEW.id,value FROM json_tree(CASE WHEN json_valid(NEW.blocks) THEN NEW.blocks ELSE '[]' END)
   WHERE key='entityId' AND type='text' AND length(value)>0; END;
 DROP TRIGGER IF EXISTS page_mentioned_entities_update;
 CREATE TRIGGER page_mentioned_entities_update AFTER UPDATE OF blocks ON pages WHEN OLD.blocks IS NOT NEW.blocks BEGIN
  DELETE FROM page_mentioned_entities WHERE page_id=NEW.id;
  INSERT OR IGNORE INTO page_mentioned_entities(page_id,entity_id)
   SELECT NEW.id,value FROM json_tree(CASE WHEN json_valid(NEW.blocks) THEN NEW.blocks ELSE '[]' END)
   WHERE key='entityId' AND type='text' AND length(value)>0; END;`);
 for(const event of ['INSERT','UPDATE OF name,mention_case,vault_id','DELETE']) {
  const suffix=event.startsWith('UPDATE')?'update':event.toLowerCase();
  const vaultMatch=event==='INSERT'?'p.vault_id=NEW.vault_id':event==='DELETE'?'p.vault_id=OLD.vault_id':'(p.vault_id=OLD.vault_id OR p.vault_id=NEW.vault_id)';
  const entityMatch=event==='DELETE'?'OLD.id':'NEW.id';
  const guard=event.startsWith('UPDATE')?'WHEN OLD.name IS NOT NEW.name OR OLD.mention_case IS NOT NEW.mention_case OR OLD.vault_id IS NOT NEW.vault_id':'';
  db.exec(`DROP TRIGGER IF EXISTS page_index_entity_${suffix};
   CREATE TRIGGER page_index_entity_${suffix} AFTER ${event} ON entities ${guard} BEGIN
   INSERT OR REPLACE INTO page_index_dirty(page_id,vault_id)
    SELECT p.id,p.vault_id FROM page_mentioned_entities d JOIN pages p ON p.id=d.page_id
    WHERE d.entity_id=${entityMatch} AND ${vaultMatch} AND p.deleted_at IS NULL; END;`);
 }
 if(!db.prepare("SELECT 1 FROM metadata WHERE key='page-mentioned-entities-v1'").get())db.exec(`
  INSERT OR IGNORE INTO page_mentioned_entities(page_id,entity_id)
   SELECT p.id,j.value FROM pages p,json_tree(CASE WHEN json_valid(p.blocks) THEN p.blocks ELSE '[]' END) j
   WHERE j.key='entityId' AND j.type='text' AND length(j.value)>0;
  INSERT INTO metadata(key,value) VALUES('page-mentioned-entities-v1','ready');`);
 if(!db.prepare('PRAGMA table_info(page_index_state)').all().some(c=>c.name==='body_characters'))db.exec('ALTER TABLE page_index_state ADD COLUMN body_characters INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(embedding_settings)').all().some(c=>c.name==='page_policy'))db.exec("ALTER TABLE embedding_settings ADD COLUMN page_policy TEXT");
 if(!db.prepare('PRAGMA table_info(embedding_jobs)').all().some(c=>c.name==='segment_id'))db.exec('ALTER TABLE embedding_jobs ADD COLUMN segment_id TEXT');
 for(const [column,type] of [['model','TEXT'],['dimensions','INTEGER']])if(!db.prepare('PRAGMA table_info(embedding_jobs)').all().some(c=>c.name===column))db.exec(`ALTER TABLE embedding_jobs ADD COLUMN ${column} ${type}`);
 db.exec(`CREATE INDEX IF NOT EXISTS embedding_jobs_segment_history ON embedding_jobs(segment_id,content_hash,created_at);
 DROP INDEX IF EXISTS embedding_jobs_active;
 CREATE UNIQUE INDEX IF NOT EXISTS embedding_jobs_page_active ON embedding_jobs(page_id) WHERE segment_id IS NULL AND status IN ('queued','running');
 CREATE UNIQUE INDEX IF NOT EXISTS embedding_jobs_segment_active ON embedding_jobs(segment_id) WHERE segment_id IS NOT NULL AND status IN ('queued','running');`);
 if(!db.prepare("SELECT 1 FROM metadata WHERE key='page-segments-v1'").get())db.exec(`INSERT OR IGNORE INTO page_index_dirty(page_id,vault_id) SELECT id,vault_id FROM pages WHERE deleted_at IS NULL;
  INSERT INTO metadata(key,value) VALUES('page-segments-v1','queued');`);
}
