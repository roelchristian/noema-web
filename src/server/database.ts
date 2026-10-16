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
 INSERT OR IGNORE INTO vaults (id,name,updated_at) VALUES ('default','Personal vault',datetime('now'));`);
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
 CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL, collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS item_locations (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, collection_id TEXT NOT NULL DEFAULT '', folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, PRIMARY KEY(vault_id,kind,item_id,collection_id));
 CREATE TABLE IF NOT EXISTS favourites (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, PRIMARY KEY(vault_id,kind,item_id));
 CREATE INDEX IF NOT EXISTS folders_vault ON folders(vault_id);
 CREATE INDEX IF NOT EXISTS collections_vault ON collections(vault_id);
 CREATE TRIGGER IF NOT EXISTS collection_cleanup AFTER DELETE ON collections BEGIN DELETE FROM item_locations WHERE collection_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS page_organization_cleanup AFTER DELETE ON pages BEGIN DELETE FROM item_locations WHERE kind='page' AND item_id=OLD.id; DELETE FROM favourites WHERE kind='page' AND item_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS entity_organization_cleanup AFTER DELETE ON entities BEGIN DELETE FROM item_locations WHERE kind='entity' AND item_id=OLD.id; DELETE FROM favourites WHERE kind='entity' AND item_id=OLD.id; END;
`);

db.exec(`CREATE TABLE IF NOT EXISTS ai_activity (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, status TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, http_status INTEGER,
 vault_id TEXT, object_kind TEXT, object_id TEXT, revision INTEGER,
 model TEXT NOT NULL, reasoning_effort TEXT NOT NULL, prompt_bytes INTEGER
);
 CREATE INDEX IF NOT EXISTS ai_activity_started ON ai_activity(started_at DESC);`);

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'deleted_at')) db.exec('ALTER TABLE pages ADD COLUMN deleted_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS pages_deleted_at ON pages(deleted_at)');

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'revision')) db.exec('ALTER TABLE pages ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
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
 if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database contains invalid references');
 return db;
 } catch(error) { db.close(); throw error; }
}
