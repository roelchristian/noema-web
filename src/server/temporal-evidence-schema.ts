import {temporalExtractorVersion} from '../shared/temporal.js';
import type {DatabaseSync} from 'node:sqlite';
export function setupTemporalEvidenceSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS temporal_source_mentions (
  id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  passage_id TEXT NOT NULL,generation_id TEXT NOT NULL,source_hash TEXT NOT NULL,passage_hash TEXT NOT NULL,
  start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,start_line INTEGER NOT NULL,end_line INTEGER NOT NULL,
  original_text TEXT NOT NULL,date_id TEXT,reason TEXT,stale INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(vault_id,date_id) REFERENCES temporal_dates(vault_id,id));
 CREATE INDEX IF NOT EXISTS temporal_source_mentions_date ON temporal_source_mentions(vault_id,date_id,stale);
 CREATE INDEX IF NOT EXISTS temporal_source_mentions_file ON temporal_source_mentions(file_id,generation_id,start_offset,end_offset);
 CREATE TABLE IF NOT EXISTS temporal_source_cache (
  file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,extractor_version TEXT NOT NULL,expressions TEXT NOT NULL,PRIMARY KEY(file_id,content_hash,extractor_version));
 CREATE TABLE IF NOT EXISTS temporal_source_state (
  file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,extractor_version TEXT NOT NULL,cursor INTEGER NOT NULL,complete INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS temporal_source_dirty (
  file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS temporal_property_values (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,date_id TEXT,raw_hash TEXT NOT NULL,reason TEXT,
  FOREIGN KEY(vault_id,date_id) REFERENCES temporal_dates(vault_id,id));
 CREATE INDEX IF NOT EXISTS temporal_property_dates ON temporal_property_values(vault_id,date_id);
 CREATE TABLE IF NOT EXISTS temporal_property_dirty (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE);
 CREATE TRIGGER IF NOT EXISTS temporal_source_file_insert AFTER INSERT ON source_files BEGIN INSERT INTO temporal_source_dirty VALUES(NEW.id,NEW.vault_id) ON CONFLICT(file_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_source_file_update AFTER UPDATE OF text,status,admitted,entity_id,vault_id,page_start_lines,structural_nodes ON source_files BEGIN INSERT INTO temporal_source_dirty VALUES(NEW.id,NEW.vault_id) ON CONFLICT(file_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_source_generation_insert AFTER INSERT ON source_passage_state BEGIN INSERT INTO temporal_source_dirty SELECT id,vault_id FROM source_files WHERE id=NEW.file_id ON CONFLICT(file_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_source_generation_update AFTER UPDATE ON source_passage_state BEGIN INSERT INTO temporal_source_dirty SELECT id,vault_id FROM source_files WHERE id=NEW.file_id ON CONFLICT(file_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_source_entity_update AFTER UPDATE OF archived_at,inactive,type,vault_id ON entities BEGIN INSERT INTO temporal_source_dirty SELECT id,vault_id FROM source_files WHERE entity_id=NEW.id ON CONFLICT(file_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_property_insert AFTER INSERT ON properties BEGIN INSERT INTO temporal_property_dirty SELECT NEW.id,vault_id FROM entities WHERE id=NEW.entity_id ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_property_update AFTER UPDATE ON properties BEGIN INSERT INTO temporal_property_dirty SELECT NEW.id,vault_id FROM entities WHERE id=NEW.entity_id ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS temporal_property_entity_update AFTER UPDATE OF type,vault_id ON entities BEGIN INSERT INTO temporal_property_dirty SELECT id,NEW.vault_id FROM properties WHERE entity_id=NEW.id ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id; END;`);
 const columns=new Set(db.prepare('PRAGMA table_info(temporal_relations)').all().map(row=>row.name));
 for(const [name,definition] of [['source_mention_id','TEXT REFERENCES temporal_source_mentions(id) ON DELETE SET NULL'],['property_id','TEXT REFERENCES properties(id) ON DELETE SET NULL'],['property_hash','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE temporal_relations ADD COLUMN ${name} ${definition}`);
 if(db.prepare("SELECT value FROM metadata WHERE key='temporal-evidence-v1'").get()?.value!==temporalExtractorVersion)db.exec(`INSERT OR REPLACE INTO temporal_source_dirty SELECT id,vault_id FROM source_files;
  INSERT OR REPLACE INTO temporal_property_dirty SELECT p.id,e.vault_id FROM properties p JOIN entities e ON e.id=p.entity_id;
  INSERT OR REPLACE INTO metadata VALUES('temporal-evidence-v1','${temporalExtractorVersion}');`);
}
