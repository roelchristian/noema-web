import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BlockType, Segment } from '../shared/domain.js';
import { now } from './validation.js';

export function openDatabase(filename: string): DatabaseSync {
 if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
 const db = new DatabaseSync(filename);
 db.exec('PRAGMA busy_timeout=5000');
 try {
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, blocks TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, name TEXT NOT NULL, value TEXT, target_id TEXT REFERENCES entities(id) ON DELETE CASCADE, CHECK ((value IS NULL) != (target_id IS NULL)));
 CREATE TABLE IF NOT EXISTS relationships (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, label TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS properties_entity ON properties(entity_id);
 CREATE INDEX IF NOT EXISTS relationships_source ON relationships(source_id);
 CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`);
// Additive migration preserves existing notebooks in the default vault.
db.exec(`CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, name TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, password_hash TEXT, salt TEXT, updated_at TEXT NOT NULL);
 INSERT INTO vaults (id,name,updated_at) SELECT 'default','Personal vault',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM vaults) AND NOT EXISTS (SELECT 1 FROM metadata WHERE key='seeded');`);
db.exec(`CREATE TABLE IF NOT EXISTS vault_deletion_cleanup (vault_id TEXT PRIMARY KEY,created_at TEXT NOT NULL);`);
db.exec('PRAGMA foreign_keys=OFF; BEGIN');
try {
for (const table of ['pages','entities']) {
 if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'vault_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN vault_id TEXT NOT NULL DEFAULT 'default' REFERENCES vaults(id)`);
 db.exec(`CREATE INDEX IF NOT EXISTS ${table}_vault ON ${table}(vault_id)`);
}
db.exec('COMMIT');
} catch(e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys=ON'); }
db.exec(`CREATE TABLE IF NOT EXISTS page_sources (page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(page_id,source_id));`);

db.exec(`
 CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS item_locations (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, PRIMARY KEY(vault_id,kind,item_id));
 CREATE TABLE IF NOT EXISTS collection_memberships (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(vault_id,kind,item_id,collection_id));
 CREATE TABLE IF NOT EXISTS favourites (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity','folder')), item_id TEXT NOT NULL, PRIMARY KEY(vault_id,kind,item_id));
 CREATE INDEX IF NOT EXISTS folders_vault ON folders(vault_id);
 CREATE INDEX IF NOT EXISTS collections_vault ON collections(vault_id);
`);

// Split storage from curation once. Retain every collection membership; when a
// legacy item has several folders, choose the first folder by collection ID then
// folder ID. Folder IDs and nesting survive unchanged, including unfiled folders.
if (db.prepare('PRAGMA table_info(folders)').all().some(c => c.name === 'collection_id')) {
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try {
  db.exec(`DROP TRIGGER IF EXISTS folder_requires_collection_insert;
   DROP TRIGGER IF EXISTS folder_requires_collection_update;
   DROP TRIGGER IF EXISTS collection_cleanup;
   DROP TRIGGER IF EXISTS page_organization_cleanup;
   DROP TRIGGER IF EXISTS entity_organization_cleanup;
   INSERT INTO collection_memberships SELECT vault_id,kind,item_id,collection_id FROM item_locations WHERE collection_id<>'';
   CREATE TABLE folders_new (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
   INSERT INTO folders_new SELECT id,vault_id,name,parent_id FROM folders;
   CREATE TABLE locations_new (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, PRIMARY KEY(vault_id,kind,item_id));
   INSERT INTO locations_new SELECT vault_id,kind,item_id,folder_id FROM (
    SELECT *,row_number() OVER (PARTITION BY vault_id,kind,item_id ORDER BY collection_id,folder_id) AS rank FROM item_locations WHERE folder_id IS NOT NULL
   ) WHERE rank=1;
   DROP TABLE item_locations;
   DROP TABLE folders;
   ALTER TABLE folders_new RENAME TO folders;
   ALTER TABLE locations_new RENAME TO item_locations;
   CREATE INDEX folders_vault ON folders(vault_id);
   COMMIT;`);
 } catch (error) { db.exec('ROLLBACK'); throw error; }
 finally { db.exec('PRAGMA foreign_keys=ON'); }
}
// Widen favourites without changing existing page/entity favourites.
if (!String(db.prepare("SELECT sql FROM sqlite_master WHERE name='favourites'").get()?.sql).includes("'folder'")) {
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`DROP TRIGGER IF EXISTS folder_favourite_cleanup;
   DROP TRIGGER IF EXISTS page_organization_cleanup;
   DROP TRIGGER IF EXISTS entity_organization_cleanup;
   CREATE TABLE favourites_new (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity','folder')), item_id TEXT NOT NULL, PRIMARY KEY(vault_id,kind,item_id));
   INSERT INTO favourites_new SELECT * FROM favourites;
   DROP TABLE favourites;
   ALTER TABLE favourites_new RENAME TO favourites;
   COMMIT;`);
 } catch (error) { db.exec('ROLLBACK'); throw error; }
}
db.exec(`CREATE TRIGGER IF NOT EXISTS page_organization_cleanup AFTER DELETE ON pages BEGIN DELETE FROM item_locations WHERE kind='page' AND item_id=OLD.id; DELETE FROM collection_memberships WHERE kind='page' AND item_id=OLD.id; DELETE FROM favourites WHERE kind='page' AND item_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS folder_favourite_cleanup AFTER DELETE ON folders BEGIN DELETE FROM favourites WHERE kind='folder' AND item_id=OLD.id AND vault_id=OLD.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS entity_organization_cleanup AFTER DELETE ON entities BEGIN DELETE FROM item_locations WHERE kind='entity' AND item_id=OLD.id; DELETE FROM collection_memberships WHERE kind='entity' AND item_id=OLD.id; DELETE FROM favourites WHERE kind='entity' AND item_id=OLD.id; END;
`);

db.exec(`CREATE TABLE IF NOT EXISTS ai_activity (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, status TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, http_status INTEGER,
 vault_id TEXT, object_kind TEXT, object_id TEXT, revision INTEGER,
 model TEXT NOT NULL, reasoning_effort TEXT NOT NULL, prompt_bytes INTEGER
);
 CREATE INDEX IF NOT EXISTS ai_activity_started ON ai_activity(started_at DESC);`);

// Notifications store references and read state, never generated content or title snapshots.
db.exec(`CREATE TABLE IF NOT EXISTS ai_notifications (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 vault_id TEXT NOT NULL REFERENCES vaults(id), page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 action TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
 CREATE INDEX IF NOT EXISTS ai_notifications_unread ON ai_notifications(read_at,seq DESC);`);

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'icon')) db.exec('ALTER TABLE pages ADD COLUMN icon TEXT');
// Keep generated content separate from page edits and activity-log retention.
db.exec(`CREATE TABLE IF NOT EXISTS page_ai_enrichments (
 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL,
 model TEXT NOT NULL, reasoning_effort TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(page_id,kind)
);`);

// Summary freshness is compared by content, independently of editor revisions.
if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'summary_content_hash')) db.exec('ALTER TABLE pages ADD COLUMN summary_content_hash TEXT');
if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'summary_hash_version')) db.exec('ALTER TABLE pages ADD COLUMN summary_hash_version INTEGER NOT NULL DEFAULT 1');
if (!db.prepare('PRAGMA table_info(page_ai_enrichments)').all().some(c => c.name === 'content_hash')) db.exec('ALTER TABLE page_ai_enrichments ADD COLUMN content_hash TEXT');
db.exec(`CREATE TRIGGER IF NOT EXISTS page_summary_hash_invalidate AFTER UPDATE OF title,blocks ON pages
 WHEN OLD.title<>NEW.title OR OLD.blocks<>NEW.blocks BEGIN
 UPDATE pages SET summary_content_hash=NULL WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS entity_summary_hash_invalidate AFTER UPDATE OF name ON entities
 WHEN OLD.name<>NEW.name BEGIN
 UPDATE pages SET summary_content_hash=NULL WHERE vault_id=NEW.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS entity_summary_hash_delete AFTER DELETE ON entities BEGIN
 UPDATE pages SET summary_content_hash=NULL WHERE vault_id=OLD.vault_id; END;`);

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'deleted_at')) db.exec('ALTER TABLE pages ADD COLUMN deleted_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS pages_deleted_at ON pages(deleted_at)');

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'revision')) db.exec('ALTER TABLE pages ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
db.exec(`CREATE TABLE IF NOT EXISTS page_entity_match_cache (
 page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
 vault_id TEXT NOT NULL REFERENCES vaults(id), cache_key TEXT NOT NULL, matches TEXT NOT NULL
);
 CREATE INDEX IF NOT EXISTS page_entity_match_cache_vault ON page_entity_match_cache(vault_id);
 CREATE TRIGGER IF NOT EXISTS page_entity_match_cache_invalidate AFTER UPDATE ON pages BEGIN
 DELETE FROM page_entity_match_cache WHERE page_id=NEW.id; END;`);
// Embedding content is kept in SQLite; queue logs deliberately contain no note text or provider errors.
db.exec(`CREATE TABLE IF NOT EXISTS embedding_settings (
 vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
 automatic INTEGER NOT NULL DEFAULT 1, min_characters INTEGER NOT NULL DEFAULT 20
);
 CREATE TABLE IF NOT EXISTS note_embeddings (
 page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
 model TEXT NOT NULL, dimensions INTEGER NOT NULL, content_hash TEXT NOT NULL,
 revision INTEGER NOT NULL, vector TEXT NOT NULL, tokens INTEGER NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS embedding_jobs (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, content_hash TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_attempt_at TEXT NOT NULL,
 error TEXT, tokens INTEGER
 );
 CREATE INDEX IF NOT EXISTS embedding_jobs_queue ON embedding_jobs(status,next_attempt_at);
 CREATE INDEX IF NOT EXISTS embedding_jobs_vault ON embedding_jobs(vault_id,created_at DESC);
 CREATE UNIQUE INDEX IF NOT EXISTS embedding_jobs_active ON embedding_jobs(page_id) WHERE status IN ('queued','running');`);
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'subtype')) db.exec('ALTER TABLE entities ADD COLUMN subtype TEXT');
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'aliases')) db.exec("ALTER TABLE entities ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
// Import the former single selection exactly once; an empty array remains cleared on restart.
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'subtypes')) {
 db.exec(`ALTER TABLE entities ADD COLUMN subtypes TEXT NOT NULL DEFAULT '[]';
 UPDATE entities SET subtypes=json_array(subtype) WHERE subtype IS NOT NULL;`);
}
db.exec(`CREATE TABLE IF NOT EXISTS entity_subtypes (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), type TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
 UNIQUE(vault_id,type,name)
);
 CREATE TABLE IF NOT EXISTS entity_type_properties (
 vault_id TEXT NOT NULL REFERENCES vaults(id), type TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
 PRIMARY KEY(vault_id,type,name)
);
 CREATE TABLE IF NOT EXISTS entity_subtype_properties (
 vault_id TEXT NOT NULL REFERENCES vaults(id), subtype_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
 PRIMARY KEY(vault_id,subtype_id,name)
);`);
db.exec(`CREATE TABLE IF NOT EXISTS source_files (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
 name TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 text TEXT NOT NULL DEFAULT '', error TEXT, progress INTEGER NOT NULL DEFAULT 0,
 pages INTEGER NOT NULL DEFAULT 0, ocr_pages INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
 CREATE INDEX IF NOT EXISTS source_files_entity ON source_files(vault_id,entity_id);`);
if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) {
 db.exec('BEGIN');
 try {
 const add = db.prepare('INSERT INTO entities (id,name,type,description,updated_at) VALUES (?,?,?,?,?)');
 add.run('ursula', 'Ursula K. Le Guin', 'person', 'American author of speculative fiction, poetry, and essays.', now());
 add.run('earthsea', 'A Wizard of Earthsea', 'creativework', 'A coming-of-age novel about language, balance, and the power of names.', now());
 add.run('berkeley', 'Berkeley', 'place', 'A city in California, on the eastern shore of San Francisco Bay.', now());
 add.run('theodora', 'Theodora Kroeber', 'person', 'American writer and anthropologist; mother of Ursula K. Le Guin.', now());
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'earthsea', 'type', 'Book', null);
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'earthsea', 'author', null, 'ursula');
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'ursula', 'birthplace', null, 'berkeley');
 db.prepare('INSERT INTO relationships VALUES (?,?,?,?)').run(randomUUID(), 'ursula', 'child of', 'theodora');
 const block = (type: BlockType, content: string | Segment[]) => ({ id: randomUUID(), type, content: typeof content === 'string' ? [{ text: content }] : content });
 const blocks = [block('paragraph', 'A small space for connected thinking. Write freely, collect ideas, and give the people, places, and works in your notes a life of their own.'), block('heading2', 'Everything starts with a connection'), block('paragraph', [{text:'I’m reading '},{entityId:'earthsea'},{text:' by '},{entityId:'ursula'},{text:'. There’s something compelling about a world in which knowing a true name means understanding its nature.'}]), block('quote', 'To light a candle is to cast a shadow.'), block('heading2', 'A few things to try'), block('bullet', 'Type / on an empty line to choose a block: heading, list, quote, or to-do.'), block('bullet', 'Type @ to reference a knowledge entity, or create a new one.'), block('bullet', 'Click a highlighted entity to explore its properties and connections.'), block('todo', 'Add a connection of your own'), block('paragraph', [])];
 db.prepare('INSERT INTO pages (id,title,blocks,updated_at) VALUES (?,?,?,?)').run('welcome', 'A place for connected ideas', JSON.stringify(blocks), now());
 db.prepare("INSERT INTO metadata VALUES ('seeded','1')").run();
 db.exec('COMMIT');
 } catch(e) { db.exec('ROLLBACK'); throw e; }
}

 db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
 INSERT OR IGNORE INTO schema_migrations VALUES (1,datetime('now'));`);
 // Preserve legacy fields once; instance writes must never create new definitions.
 if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) {
   db.exec(`BEGIN IMMEDIATE;
   INSERT OR IGNORE INTO entity_type_properties (vault_id,type,name)
   SELECT e.vault_id,e.type,trim(p.name) FROM properties p JOIN entities e ON e.id=p.entity_id;
   INSERT INTO schema_migrations VALUES (2,datetime('now'));
   COMMIT;`);
 }
 if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database contains invalid references');
 return db;
 } catch(error) { db.close(); throw error; }
}
