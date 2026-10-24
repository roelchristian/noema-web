import type {DatabaseSync} from 'node:sqlite';
import {temporalExtractorVersion,temporalDate,temporalBounds} from '../shared/temporal.js';

/** SQLite's documented table rebuild keeps references and original row IDs intact. */
function expandCheck(db:DatabaseSync,table:string,old:string,replacement:string) {
 const row=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
 if(!row||typeof row.sql!=='string'||!row.sql.includes(old))return;
 const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
 const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(column=>String(column.name)).join(',');
 db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
 try {
  db.exec(row.sql.replace(/^CREATE TABLE (?:IF NOT EXISTS )?(?:"[^"]+"|\w+)/i,`CREATE TABLE ${table}_expanded`).replace(old,replacement));
  db.exec(`INSERT INTO ${table}_expanded (${columns}) SELECT ${columns} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_expanded RENAME TO ${table}`);
  for(const index of indexes)db.exec(String(index.sql));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON');}
}
export function setupTemporalSchema(db:DatabaseSync) {
 // Deterministic calendar-local keys support indexed bounded historical queries.
 for(const [name,edge] of [['temporal_lower','from'],['temporal_upper','to']] as const)db.function(name,{deterministic:true},(value,calendar)=>{
  const date=typeof value==='string'&&(calendar==='gregorian'||calendar==='julian')?temporalDate(value,calendar):null;
  return date?temporalBounds(date)?.[edge]??null:null;
 });
 expandCheck(db,'temporal_dates',"precision IN ('day','month','year')","precision IN ('day','month','year','interval','century')");
 expandCheck(db,'temporal_relations',"kind IN ('occurs_on','born_on','published_on','deadline','discusses')","kind IN ('occurs_on','born_on','published_on','deadline','discusses','ends_on','died_on','founded_on','accessed_on')");
 db.exec(`CREATE TABLE IF NOT EXISTS temporal_dates (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,id TEXT NOT NULL,value TEXT NOT NULL,
  precision TEXT NOT NULL CHECK(precision IN ('day','month','year','interval','century')),calendar TEXT NOT NULL CHECK(calendar IN ('gregorian','julian')),
  PRIMARY KEY(vault_id,id));
 CREATE INDEX IF NOT EXISTS temporal_dates_range ON temporal_dates(vault_id,calendar,value);
 CREATE INDEX IF NOT EXISTS temporal_dates_historical_range ON temporal_dates(vault_id,calendar,temporal_lower(value,calendar),temporal_upper(value,calendar));
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
  kind TEXT NOT NULL CHECK(kind IN ('occurs_on','born_on','published_on','deadline','discusses','ends_on','died_on','founded_on','accessed_on')),
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
 if(!db.prepare('PRAGMA table_info(temporal_curation)').all().some(column=>column.name==='layer'))db.exec("ALTER TABLE temporal_curation ADD COLUMN layer TEXT NOT NULL DEFAULT 'knowledge' CHECK(layer IN ('personal','knowledge','historical'))");
 if(!db.prepare('PRAGMA table_info(temporal_relations)').all().some(column=>column.name==='layer'))db.exec("ALTER TABLE temporal_relations ADD COLUMN layer TEXT CHECK(layer IN ('personal','knowledge','historical'))");
 const version=db.prepare("SELECT value FROM metadata WHERE key='temporal-extractor'").get()?.value;
 if(version!==temporalExtractorVersion) {
  db.exec('INSERT OR REPLACE INTO temporal_dirty SELECT id,vault_id FROM pages');
  db.prepare("INSERT OR REPLACE INTO metadata VALUES('temporal-extractor',?)").run(temporalExtractorVersion);
 }
}
