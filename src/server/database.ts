import {DOMAINS,TAXONOMY_VERSION,validateDomainRegistry} from '../shared/domains.js';
import {linkSourceReferences,syncSourceReferences} from './modules/source-references.js';
import {Store} from './store.js';
import {createHash} from 'node:crypto';
import type {SourceFile} from '../shared/domain.js';
import {isAIExplanation} from '../shared/semantic-blocks.js';
import type {Block} from '../shared/domain.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BlockType, Segment } from '../shared/domain.js';
import { now } from './validation.js';
import {setupSuggestionVersionSchema} from './suggestion-version-schema.js';
import {setupPageSegmentSchema} from './page-segment-schema.js';
import {setupSourceAuthorSchema} from './source-author-schema.js';
import {setupSourcePassageSchema} from './source-passage-schema.js';
import {setupSourceReadingSchema} from './source-reading-schema.js';
import {setupSourceDocumentSchema} from './source-document-schema.js';
import {setupSourcePassageEmbeddingSchema} from './source-passage-embedding-schema.js';
import {setupTextSearchSchema} from './text-search-schema.js';
import {setupPageEnrichmentSchedulerSchema} from './page-enrichment-schema.js';

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
if (!db.prepare('PRAGMA table_info(entities)').all().some(column=>column.name==='archived_at')) db.exec('ALTER TABLE entities ADD COLUMN archived_at TEXT');
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
if (!db.prepare('PRAGMA table_info(entities)').all().some(column=>column.name==='inactive')) db.exec('ALTER TABLE entities ADD COLUMN inactive INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS entity_overviews (
 entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
 content TEXT NOT NULL DEFAULT '' CHECK(length(content)<=100000),revision INTEGER NOT NULL CHECK(revision>=1));
 CREATE TABLE IF NOT EXISTS entity_page_associations (
 entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),annotation TEXT NOT NULL DEFAULT '' CHECK(length(annotation)<=2000),created_at TEXT NOT NULL,
 PRIMARY KEY(entity_id,page_id));
 CREATE INDEX IF NOT EXISTS entity_page_associations_page ON entity_page_associations(page_id);`);
db.exec(`CREATE TABLE IF NOT EXISTS entity_discoveries (
 id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,created_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS entity_discoveries_entity ON entity_discoveries(entity_id,created_at DESC);`);
db.exec(`CREATE TABLE IF NOT EXISTS page_sources (page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(page_id,source_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS page_source_dismissals (page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(page_id,source_id));`);

db.exec(`
 CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id), name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS item_locations (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, PRIMARY KEY(vault_id,kind,item_id));
 CREATE TABLE IF NOT EXISTS collection_memberships (vault_id TEXT NOT NULL REFERENCES vaults(id), kind TEXT NOT NULL CHECK(kind IN ('page','entity')), item_id TEXT NOT NULL, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(vault_id,kind,item_id,collection_id));
 CREATE TABLE IF NOT EXISTS collection_folders (vault_id TEXT NOT NULL REFERENCES vaults(id), folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(vault_id,folder_id,collection_id));
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
for(const column of ['input_tokens','output_tokens','cached_input_tokens','cache_write_tokens','reasoning_tokens']) {
 if(!db.prepare('PRAGMA table_info(ai_activity)').all().some(field=>field.name===column))db.exec(`ALTER TABLE ai_activity ADD COLUMN ${column} INTEGER CHECK(${column}>=0)`);
}
if(!db.prepare('PRAGMA table_info(ai_activity)').all().some(field=>field.name==='estimated_cost'))db.exec('ALTER TABLE ai_activity ADD COLUMN estimated_cost REAL CHECK(estimated_cost>=0)');
if(!db.prepare('PRAGMA table_info(ai_activity)').all().some(field=>field.name==='pricing_version'))db.exec('ALTER TABLE ai_activity ADD COLUMN pricing_version TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS ai_activity_debug (
 activity_id TEXT PRIMARY KEY REFERENCES ai_activity(id) ON DELETE CASCADE,
 endpoint TEXT, request TEXT, response_body TEXT NOT NULL DEFAULT '', response TEXT,
 response_status INTEGER, response_headers TEXT, error TEXT, updated_at TEXT NOT NULL
);
 CREATE TABLE IF NOT EXISTS ai_activity_debug_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 activity_id TEXT NOT NULL REFERENCES ai_activity_debug(activity_id) ON DELETE CASCADE,
 received_at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
);
 CREATE INDEX IF NOT EXISTS ai_activity_debug_event_lookup ON ai_activity_debug_events(activity_id,sequence);`);

// New traces carry independent retention and accounting; historical payloads stay readable.
for (const [name,definition] of Object.entries({mode:"TEXT NOT NULL DEFAULT 'legacy'",revision:'INTEGER NOT NULL DEFAULT 0',retained_bytes:'INTEGER NOT NULL DEFAULT 0',truncated:'INTEGER NOT NULL DEFAULT 0'})) {
 if(!db.prepare('PRAGMA table_info(ai_activity_debug)').all().some(field=>field.name===name))db.exec(`ALTER TABLE ai_activity_debug ADD COLUMN ${name} ${definition}`);
}

// Notifications store references and read state, never generated content or title snapshots.
db.exec(`CREATE TABLE IF NOT EXISTS ai_notifications (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 vault_id TEXT NOT NULL REFERENCES vaults(id), page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
 entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
 action TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
 CHECK ((page_id IS NULL) != (entity_id IS NULL))
);
 CREATE INDEX IF NOT EXISTS ai_notifications_unread ON ai_notifications(read_at,seq DESC);`);

// Allow bell updates to point to either a note or a source entity.
if (!db.prepare('PRAGMA table_info(ai_notifications)').all().some(column=>column.name==='entity_id')) {
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`ALTER TABLE ai_notifications RENAME TO old_ai_notifications;
   CREATE TABLE ai_notifications (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    vault_id TEXT NOT NULL REFERENCES vaults(id), page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
    entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
    action TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
    CHECK ((page_id IS NULL) != (entity_id IS NULL))
   );
   INSERT INTO ai_notifications (seq,id,vault_id,page_id,action,status,created_at,read_at)
    SELECT seq,id,vault_id,page_id,action,status,created_at,read_at FROM old_ai_notifications;
   DROP TABLE old_ai_notifications;
   CREATE INDEX ai_notifications_unread ON ai_notifications(read_at,seq DESC);`);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}

if (!db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'featured_image_id')) db.exec('ALTER TABLE pages ADD COLUMN featured_image_id TEXT');
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

db.exec(`CREATE TABLE IF NOT EXISTS page_edit_locks (
 page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
 vault_id TEXT NOT NULL REFERENCES vaults(id), password_hash TEXT, salt TEXT
);`);

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
`);
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'subtype')) db.exec('ALTER TABLE entities ADD COLUMN subtype TEXT');
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'aliases')) db.exec("ALTER TABLE entities ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
if (!db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'mention_case')) db.exec("ALTER TABLE entities ADD COLUMN mention_case TEXT NOT NULL DEFAULT 'canonical' CHECK (mention_case IN ('canonical','lowercase')); UPDATE pages SET summary_content_hash=NULL;");
db.exec(`CREATE TRIGGER IF NOT EXISTS entity_mention_case_hash_invalidate AFTER UPDATE OF mention_case ON entities
 WHEN NEW.mention_case<>OLD.mention_case BEGIN UPDATE pages SET summary_content_hash=NULL WHERE vault_id=NEW.vault_id; END;`);
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
db.exec(`CREATE TABLE IF NOT EXISTS source_reprocessing (
 id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
 vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, status TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS source_reprocessing_file ON source_reprocessing(file_id,created_at);
 CREATE UNIQUE INDEX IF NOT EXISTS source_reprocessing_active ON source_reprocessing(file_id) WHERE status IN ('queued','running');`);
const sourceColumns = db.prepare('PRAGMA table_info(source_files)').all() as {name:string}[];
for (const [column, definition] of Object.entries({
 contains_math:"INTEGER NOT NULL DEFAULT 0 CHECK (contains_math IN (0,1))",
 original_filename:"TEXT NOT NULL DEFAULT ''", language:'TEXT', summary:'TEXT', generated_name:'TEXT',
 enrichment_status:"TEXT NOT NULL DEFAULT 'pending'", enrichment_error:'TEXT',
 enrichment_attempts:'INTEGER NOT NULL DEFAULT 0', enrichment_next_attempt_at:"TEXT NOT NULL DEFAULT ''",
})) if (!sourceColumns.some(item=>item.name===column)) db.exec(`ALTER TABLE source_files ADD COLUMN ${column} ${definition}`);
db.exec("UPDATE source_files SET original_filename=name WHERE original_filename=''");
if (!db.prepare('PRAGMA table_info(embedding_jobs)').all().some(column=>column.name==='source_id')) db.exec('ALTER TABLE embedding_jobs ADD COLUMN source_id TEXT REFERENCES entities(id) ON DELETE SET NULL');
db.exec(`CREATE TABLE IF NOT EXISTS source_embeddings (
 source_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
 model TEXT NOT NULL, dimensions INTEGER NOT NULL, content_hash TEXT NOT NULL,
 vector TEXT NOT NULL, tokens INTEGER NOT NULL, updated_at TEXT NOT NULL
);
 CREATE UNIQUE INDEX IF NOT EXISTS embedding_jobs_source_active ON embedding_jobs(source_id) WHERE status IN ('queued','running');`);
if (!sourceColumns.some(column=>column.name==='structural_nodes')) db.exec("ALTER TABLE source_files ADD COLUMN structural_nodes TEXT NOT NULL DEFAULT '[]'");
if (!sourceColumns.some(column=>column.name==='page_start_lines')) db.exec("ALTER TABLE source_files ADD COLUMN page_start_lines TEXT NOT NULL DEFAULT '[]'");
setupSourceDocumentSchema(db);
setupSourceReadingSchema(db);
if (!sourceColumns.some(column=>column.name==='import_method')) db.exec("ALTER TABLE source_files ADD COLUMN import_method TEXT NOT NULL DEFAULT 'upload'");
if (!sourceColumns.some(column=>column.name==='pdf_flattened')) db.exec('ALTER TABLE source_files ADD COLUMN pdf_flattened INTEGER NOT NULL DEFAULT 0');
if (!sourceColumns.some(column=>column.name==='source_url')) db.exec('ALTER TABLE source_files ADD COLUMN source_url TEXT');
if (!sourceColumns.some(column=>column.name==='admitted')) db.exec('ALTER TABLE source_files ADD COLUMN admitted INTEGER NOT NULL DEFAULT 1');
if (!sourceColumns.some(column=>column.name==='format')) {
 db.exec("ALTER TABLE source_files ADD COLUMN format TEXT NOT NULL DEFAULT 'txt'");
 db.exec("UPDATE source_files SET format=CASE WHEN name LIKE '%.pdf' THEN 'pdf' WHEN name LIKE '%.md' THEN 'md' WHEN id LIKE '%.html' THEN 'html' ELSE 'txt' END");
}
db.exec(`CREATE TABLE IF NOT EXISTS source_page_creations (
 request_id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,
 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,created_at TEXT NOT NULL
);`);
db.exec(`CREATE TABLE IF NOT EXISTS source_page_drafts (
 request_id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,
 source_hash TEXT NOT NULL,focus TEXT NOT NULL,title TEXT NOT NULL,blocks TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
 activity_id TEXT REFERENCES ai_activity(id) ON DELETE SET NULL,created_at TEXT NOT NULL
);
 CREATE INDEX IF NOT EXISTS source_page_drafts_source ON source_page_drafts(vault_id,source_id,status,created_at);`);
if (!db.prepare('PRAGMA table_info(source_page_drafts)').all().some(column=>column.name==='notification_id')) db.exec('ALTER TABLE source_page_drafts ADD COLUMN notification_id TEXT REFERENCES ai_notifications(id) ON DELETE SET NULL');
if (!db.prepare('PRAGMA table_info(source_page_drafts)').all().some(column=>column.name==='options')) db.exec("ALTER TABLE source_page_drafts ADD COLUMN options TEXT NOT NULL DEFAULT '{}'");
// Record future generations only; historical pages and drafts remain unknown.
for(const table of ['pages','source_page_drafts'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='generation_metadata'))db.exec(`ALTER TABLE ${table} ADD COLUMN generation_metadata TEXT`);
// Older pages have no recorded creation time; leave it unknown.
if (!db.prepare('PRAGMA table_info(pages)').all().some(column=>column.name==='created_at')) db.exec('ALTER TABLE pages ADD COLUMN created_at TEXT');
// Older pages and pending drafts have no recorded language.
if (!db.prepare('PRAGMA table_info(pages)').all().some(column=>column.name==='language')) db.exec('ALTER TABLE pages ADD COLUMN language TEXT');
if (!db.prepare('PRAGMA table_info(source_page_drafts)').all().some(column=>column.name==='language')) db.exec('ALTER TABLE source_page_drafts ADD COLUMN language TEXT');
// Acceptance is a durable authorship fact, separate from generated-page origin.
if (!db.prepare('PRAGMA table_info(pages)').all().some(column=>column.name==='ai_review_accepted')) {
 db.exec("ALTER TABLE pages ADD COLUMN ai_review_accepted INTEGER NOT NULL DEFAULT 0 CHECK(ai_review_accepted IN (0,1))");
}
// Backfill provenance once; future saves preserve generated origin even after edits.
if (!db.prepare('PRAGMA table_info(pages)').all().some(column=>column.name==='ai_status')) {
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec("ALTER TABLE pages ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'regular' CHECK(ai_status IN ('regular','regular_with_ai_explanations','ai_generated','ai_generated_edited'))");
  for (const page of db.prepare('SELECT id,blocks FROM pages').all()) {
   if ((JSON.parse(String(page.blocks)) as Block[]).some(isAIExplanation)) db.prepare("UPDATE pages SET ai_status='regular_with_ai_explanations' WHERE id=?").run(page.id);
  }
  db.exec("UPDATE pages SET ai_status='ai_generated' WHERE id IN (SELECT page_id FROM source_page_creations)");
  db.exec('COMMIT');
 } catch(error) {db.exec('ROLLBACK');throw error;}
}
// Preserve older multi-file sources by separating their extra files into sources.
if(!db.prepare("SELECT 1 FROM metadata WHERE key='single-file-sources'").get()) {
db.exec('BEGIN IMMEDIATE');
try {
 const extras=db.prepare(`SELECT f.id,f.entity_id,f.vault_id,f.name,f.status,e.subtypes,e.description FROM source_files f JOIN entities e ON e.id=f.entity_id
  WHERE f.id NOT IN (SELECT first.id FROM source_files first WHERE first.entity_id=f.entity_id ORDER BY first.created_at,first.id LIMIT 1)`).all();
 for(const file of extras) {
  const id=randomUUID();
  db.prepare(`INSERT INTO entities (id,vault_id,name,type,subtypes,description,updated_at,inactive) VALUES (?,?,?,'source',?,?,?,?)`).run(id,file.vault_id,String(file.name).slice(0,200),file.subtypes,file.description,now(),file.status==='failed'?1:0);
  db.prepare('UPDATE source_files SET entity_id=? WHERE id=?').run(id,file.id);
  db.prepare('INSERT OR IGNORE INTO page_sources SELECT page_id,? FROM page_sources WHERE source_id=?').run(id,file.entity_id);
  for(const property of db.prepare("SELECT name,value,target_id FROM properties WHERE entity_id=? AND name NOT IN ('Import method','Source URL')").all(file.entity_id))db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(),id,property.name,property.value,property.target_id);
 }
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS source_files_one_per_entity ON source_files(entity_id) WHERE entity_id IS NOT NULL");
 db.exec("UPDATE entities SET inactive=CASE WHEN EXISTS (SELECT 1 FROM source_files f WHERE f.entity_id=entities.id AND f.status='failed') THEN 1 ELSE 0 END WHERE type='source'");
 // Rebuild derived provenance for the sources affected by the split, too.
 for(const entity of db.prepare("SELECT id FROM entities WHERE type='source'").all()) {
  db.prepare("DELETE FROM properties WHERE entity_id=? AND name IN ('Import method','Source URL')").run(entity.id);
  for(const file of db.prepare('SELECT import_method,source_url FROM source_files WHERE entity_id=?').all(entity.id)) {
   db.prepare('INSERT INTO properties VALUES (?,?,?,?,NULL)').run(randomUUID(),entity.id,'Import method',file.import_method);
   if(file.source_url)db.prepare('INSERT INTO properties VALUES (?,?,?,?,NULL)').run(randomUUID(),entity.id,'Source URL',file.source_url);
  }
 }
 db.prepare("INSERT INTO metadata (key,value) VALUES ('single-file-sources','1')").run();
 db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}
}

// Pending imports are processing, not inactive. Repair the former pending flag once.
if(!db.prepare("SELECT 1 FROM metadata WHERE key='source-inactive-on-failure'").get()) {
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec("UPDATE entities SET inactive=CASE WHEN EXISTS (SELECT 1 FROM source_files f WHERE f.entity_id=entities.id AND f.status='failed') THEN 1 ELSE 0 END WHERE type='source'");
  db.prepare("INSERT INTO metadata (key,value) VALUES ('source-inactive-on-failure','1')").run();
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}

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
 const createdAt=now();
 db.prepare('INSERT INTO pages (id,title,blocks,updated_at,created_at) VALUES (?,?,?,?,?)').run('welcome', 'A place for connected ideas', JSON.stringify(blocks), createdAt, createdAt);
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
 db.exec(`CREATE TABLE IF NOT EXISTS note_source_files (
 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
 number INTEGER NOT NULL CHECK(number>=1), PRIMARY KEY(page_id,file_id), UNIQUE(page_id,number));
 CREATE TABLE IF NOT EXISTS note_source_references (
 id TEXT NOT NULL, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
 block_id TEXT NOT NULL, row_index INTEGER NOT NULL DEFAULT -1, col_index INTEGER NOT NULL DEFAULT -1,
 start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
 start_line INTEGER NOT NULL CHECK(start_line>=1), end_line INTEGER NOT NULL CHECK(end_line>=start_line),
 source_hash TEXT NOT NULL, excerpt TEXT NOT NULL, PRIMARY KEY(page_id,id));
 CREATE INDEX IF NOT EXISTS note_source_references_source ON note_source_references(source_id,start_line,end_line);`);
 if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) {
  const store=new Store(db);
  store.transaction(()=>{
   const notes=store.all<{id:string;blocks:string;source_id:string;source_hash:string|null}>(`SELECT p.id,p.blocks,c.source_id,d.source_hash FROM pages p
    JOIN source_page_creations c ON c.page_id=p.id LEFT JOIN source_page_drafts d ON d.request_id=c.request_id`);
   for(const note of notes) {
    const file=store.get<SourceFile>('SELECT f.* FROM source_files f JOIN pages p ON p.vault_id=f.vault_id WHERE p.id=? AND f.entity_id=?',note.id,note.source_id);
    if(!file||file.status!=='ready'||!file.admitted||!note.source_hash||createHash('sha256').update(file.text).digest('hex')!==note.source_hash)continue;
    const blocks=linkSourceReferences(JSON.parse(note.blocks) as Block[],file);
    syncSourceReferences(store,note.id,blocks);
    store.run('UPDATE pages SET blocks=?,revision=revision+1 WHERE id=?',JSON.stringify(blocks),note.id);
   }
   store.run("INSERT INTO schema_migrations VALUES (3,datetime('now'))");
  });
 }
 if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) {
  const store=new Store(db);
  store.transaction(()=>{
   for(const note of store.all<{id:string;blocks:string}>("SELECT id,blocks FROM pages WHERE instr(blocks,'sourceReference')>0")) {
    const blocks=JSON.parse(note.blocks) as Block[];
    syncSourceReferences(store,note.id,blocks);
    store.run('UPDATE pages SET blocks=?,revision=revision+1 WHERE id=?',JSON.stringify(blocks),note.id);
   }
   store.run("INSERT INTO schema_migrations VALUES (4,datetime('now'))");
  });
 }
 validateDomainRegistry();
 db.exec(`CREATE TABLE IF NOT EXISTS domains (id TEXT PRIMARY KEY,parent_id TEXT REFERENCES domains(id),label TEXT NOT NULL,lcc_refs_json TEXT NOT NULL DEFAULT '[]',scope_note TEXT,sort_order INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS page_domains (page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,domain_id TEXT NOT NULL REFERENCES domains(id),role TEXT NOT NULL CHECK(role IN ('primary','secondary')),origin TEXT NOT NULL CHECK(origin IN ('manual','inferred')),updated_at TEXT NOT NULL,PRIMARY KEY(page_id,domain_id));
 CREATE UNIQUE INDEX IF NOT EXISTS page_domains_primary ON page_domains(page_id) WHERE role='primary';
 CREATE INDEX IF NOT EXISTS page_domains_domain ON page_domains(domain_id);
 CREATE TABLE IF NOT EXISTS page_domain_state (page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,origin TEXT NOT NULL CHECK(origin IN ('manual','inferred')),content_hash TEXT,taxonomy_version TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS entity_domains (entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,domain_id TEXT NOT NULL REFERENCES domains(id),origin TEXT NOT NULL CHECK(origin IN ('manual','scan','inferred')),PRIMARY KEY(entity_id,domain_id));
 CREATE INDEX IF NOT EXISTS entity_domains_domain ON entity_domains(domain_id);`);
 new Store(db).transaction(()=>{
  const remaining=new Map(DOMAINS.map(domain=>[domain.id,domain]));const inserted=new Set<string>();
  while(remaining.size)for(const [id,domain] of remaining)if(!domain.parent_id||inserted.has(domain.parent_id)){
   db.prepare('INSERT INTO domains (id,parent_id,label,lcc_refs_json,scope_note,sort_order) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,label=excluded.label,lcc_refs_json=excluded.lcc_refs_json,scope_note=excluded.scope_note,sort_order=excluded.sort_order').run(id,domain.parent_id,domain.label,JSON.stringify(domain.lcc_refs??[]),domain.scope_note??null,domain.sort_order);
   inserted.add(id);remaining.delete(id);
  }
  db.prepare("INSERT INTO metadata (key,value) VALUES ('domain_taxonomy_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(TAXONOMY_VERSION);
 });
 setupPageSegmentSchema(db);
 setupSourceAuthorSchema(db);
 setupSourcePassageSchema(db);
 setupSourcePassageEmbeddingSchema(db);
 setupTextSearchSchema(db);
 setupPageEnrichmentSchedulerSchema(db);
 setupSuggestionVersionSchema(db);
 if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database contains invalid references');
 return db;
 } catch(error) { db.close(); throw error; }
}
