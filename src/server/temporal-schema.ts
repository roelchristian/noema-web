import type {DatabaseSync} from 'node:sqlite';
import {temporalExtractorVersion} from '../shared/temporal.js';

export function setupTemporalSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS temporal_dates (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,id TEXT NOT NULL,value TEXT NOT NULL,
  precision TEXT NOT NULL CHECK(precision IN ('day','month','year')),calendar TEXT NOT NULL CHECK(calendar IN ('gregorian','julian')),
  PRIMARY KEY(vault_id,id));
 CREATE TABLE IF NOT EXISTS temporal_curation (
  vault_id TEXT NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,annotation TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),importance TEXT NOT NULL CHECK(importance IN ('ordinary','notable','important')),
  personal_priority TEXT NOT NULL CHECK(personal_priority IN ('ordinary','important')),
  PRIMARY KEY(vault_id,id),FOREIGN KEY(vault_id,id) REFERENCES temporal_dates(vault_id,id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS temporal_mentions (
  id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,block_id TEXT NOT NULL,
  block_hash TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,original_text TEXT NOT NULL,
  date_id TEXT,reason TEXT,revision INTEGER NOT NULL,stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  FOREIGN KEY(vault_id,date_id) REFERENCES temporal_dates(vault_id,id));
 CREATE INDEX IF NOT EXISTS temporal_mentions_page ON temporal_mentions(vault_id,page_id,block_id);
 CREATE INDEX IF NOT EXISTS temporal_mentions_date ON temporal_mentions(vault_id,date_id,stale);
 CREATE TABLE IF NOT EXISTS temporal_relations (
  id TEXT PRIMARY KEY,vault_id TEXT NOT NULL, date_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  mention_id TEXT REFERENCES temporal_mentions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('occurs_on','born_on','published_on','deadline','discusses')),
  origin TEXT NOT NULL CHECK(origin IN ('manual','inferred')),status TEXT NOT NULL CHECK(status IN ('accepted','pending','rejected')),
  confidence REAL CHECK(confidence>=0 AND confidence<=1),
  FOREIGN KEY(vault_id,date_id) REFERENCES temporal_dates(vault_id,id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS temporal_relations_date ON temporal_relations(vault_id,date_id);
 CREATE TABLE IF NOT EXISTS temporal_index_state (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,extractor_version TEXT NOT NULL,projection_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS temporal_block_state (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,block_id TEXT NOT NULL,block_hash TEXT NOT NULL,
  PRIMARY KEY(page_id,block_id));
 CREATE TABLE IF NOT EXISTS temporal_dirty (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE);
 CREATE TRIGGER IF NOT EXISTS temporal_page_insert AFTER INSERT ON pages BEGIN
  INSERT OR REPLACE INTO temporal_dirty VALUES(NEW.id,NEW.vault_id); END;
 CREATE TRIGGER IF NOT EXISTS temporal_page_update AFTER UPDATE OF blocks,revision,deleted_at,vault_id ON pages BEGIN
  INSERT OR REPLACE INTO temporal_dirty VALUES(NEW.id,NEW.vault_id); END;`);
 // Names affect canonical page text. Dirty evidence is immediately ineligible.
 for(const event of ['UPDATE OF name,mention_case','DELETE']) {
  const suffix=event.startsWith('UPDATE')?'update':'delete';
  db.exec(`CREATE TRIGGER IF NOT EXISTS temporal_entity_${suffix} AFTER ${event} ON entities BEGIN
   INSERT OR REPLACE INTO temporal_dirty SELECT p.id,p.vault_id FROM pages p JOIN page_mentioned_entities m ON m.page_id=p.id WHERE m.entity_id=OLD.id; END;`);
 }
 const version=db.prepare("SELECT value FROM metadata WHERE key='temporal-extractor'").get()?.value;
 if(version!==temporalExtractorVersion) {
  db.exec('INSERT OR REPLACE INTO temporal_dirty SELECT id,vault_id FROM pages');
  db.prepare("INSERT OR REPLACE INTO metadata VALUES('temporal-extractor',?)").run(temporalExtractorVersion);
 }
}
