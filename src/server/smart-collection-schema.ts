import type {DatabaseSync} from 'node:sqlite';
/** Sidecars preserve the legacy three-column collections table and existing memberships. */
export function setupSmartCollectionSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS smart_collection_revisions(vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS smart_collection_changes(vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,revision INTEGER NOT NULL,item_id TEXT,PRIMARY KEY(vault_id,revision));
 CREATE INDEX IF NOT EXISTS smart_pages_candidates ON pages(vault_id,deleted_at,id);
 CREATE TABLE IF NOT EXISTS smart_collection_definitions(vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,rule_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'unevaluated',evaluated INTEGER NOT NULL DEFAULT 0,matched INTEGER NOT NULL DEFAULT 0,error TEXT,evaluated_revision INTEGER NOT NULL DEFAULT -1);
 CREATE TABLE IF NOT EXISTS smart_collection_overrides(vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('page','entity')),item_id TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('include','exclude')),PRIMARY KEY(vault_id,collection_id,kind,item_id));
 CREATE TABLE IF NOT EXISTS smart_collection_cache(vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,item_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,matched INTEGER NOT NULL,evidence_json TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(vault_id,collection_id,item_id));
 CREATE INDEX IF NOT EXISTS smart_collection_cache_matches ON smart_collection_cache(vault_id,collection_id,matched);
 CREATE TRIGGER IF NOT EXISTS smart_override_page_cleanup AFTER DELETE ON pages BEGIN DELETE FROM smart_collection_overrides WHERE kind='page' AND item_id=OLD.id AND vault_id=OLD.vault_id; END;
 CREATE TRIGGER IF NOT EXISTS smart_override_entity_cleanup AFTER DELETE ON entities BEGIN DELETE FROM smart_collection_overrides WHERE kind='entity' AND item_id=OLD.id AND vault_id=OLD.vault_id; END;`);
 // Permanent deletion cascades cached rows before a dirty-item refresh can read
 // their former counts. Recount through the bounded full-refresh path instead.
 db.exec('DROP TRIGGER IF EXISTS smart_dirty_pages_delete');
 for(const [column,type] of [['matching',"TEXT NOT NULL DEFAULT 'rules'"],['semantic_json','TEXT'],['query_vector','TEXT'],['query_model','TEXT'],['query_dimensions','INTEGER'],['unevaluated','INTEGER NOT NULL DEFAULT 0'],['errors','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(smart_collection_definitions)').all().some(c=>c.name===column))db.exec(`ALTER TABLE smart_collection_definitions ADD COLUMN ${column} ${type}`);
 for(const [column,type] of [['state',"TEXT NOT NULL DEFAULT 'evaluated'"],['score','REAL'],['fingerprint',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(smart_collection_cache)').all().some(c=>c.name===column))db.exec(`ALTER TABLE smart_collection_cache ADD COLUMN ${column} ${type}`);
 db.exec(`CREATE TABLE IF NOT EXISTS smart_collection_queries(token TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,description_hash TEXT NOT NULL,vector TEXT NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS smart_collection_vault_epochs(vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,epoch INTEGER NOT NULL);
 CREATE TRIGGER IF NOT EXISTS smart_collection_lock_epoch AFTER UPDATE OF locked ON vaults WHEN NEW.locked<>OLD.locked BEGIN INSERT INTO smart_collection_vault_epochs VALUES(NEW.id,1) ON CONFLICT(vault_id) DO UPDATE SET epoch=epoch+1; DELETE FROM smart_collection_queries WHERE vault_id=NEW.id; END;
 CREATE INDEX IF NOT EXISTS smart_collection_queries_vault ON smart_collection_queries(vault_id,description_hash);`);
 // Index arrival, removal, dirty preparation and policy changes are local saved-data
 // inputs. They invalidate semantic results without scheduling provider requests.
 for(const table of ['page_segment_embeddings','page_segments','page_index_state','page_index_dirty','embedding_settings'])for(const event of ['INSERT','UPDATE','DELETE']) {
  const prefix=event==='DELETE'?'OLD':'NEW',item=table==='embedding_settings'?'NULL':table==='page_segment_embeddings'?`(SELECT page_id FROM page_segments WHERE id=${prefix}.segment_id)`:`${prefix}.page_id`;
  const vault=table==='page_segment_embeddings'?`(SELECT vault_id FROM page_segments WHERE id=${prefix}.segment_id)`:`${prefix}.vault_id`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS smart_semantic_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN
   INSERT INTO smart_collection_revisions(vault_id,revision) SELECT ${vault},1 WHERE ${vault} IS NOT NULL ON CONFLICT(vault_id) DO UPDATE SET revision=revision+1;
   INSERT INTO smart_collection_changes SELECT ${vault},revision,${item} FROM smart_collection_revisions WHERE vault_id=${vault};
   DELETE FROM smart_collection_changes WHERE vault_id=${vault} AND revision<(SELECT revision-10000 FROM smart_collection_revisions WHERE vault_id=${vault}); END;`);
 }
 const scopes:Record<string,(prefix:string)=>string>={pages:p=>`${p}.vault_id`,entities:p=>`${p}.vault_id`,folders:p=>`${p}.vault_id`,item_locations:p=>`${p}.vault_id`,favourites:p=>`${p}.vault_id`,page_reading_notes:p=>`${p}.vault_id`,page_domains:p=>`(SELECT vault_id FROM pages WHERE id=${p}.page_id)`,entity_page_associations:p=>`(SELECT vault_id FROM pages WHERE id=${p}.page_id)`};
 for(const [table,scope] of Object.entries(scopes))for(const event of ['INSERT','UPDATE','DELETE']) {
  const prefix=event==='DELETE'?'OLD':'NEW';
  const item=table==='pages'?(event==='DELETE'?'NULL':`${prefix}.id`):['entities','folders'].includes(table)?'NULL':table==='favourites'||table==='item_locations'?`CASE WHEN ${prefix}.kind='page' THEN ${prefix}.item_id ELSE NULL END`:`${prefix}.page_id`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS smart_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN INSERT INTO smart_collection_revisions(vault_id,revision) SELECT ${scope(prefix)},1 WHERE ${scope(prefix)} IS NOT NULL ON CONFLICT(vault_id) DO UPDATE SET revision=revision+1; INSERT INTO smart_collection_changes SELECT ${scope(prefix)},revision,${item} FROM smart_collection_revisions WHERE vault_id=${scope(prefix)}; DELETE FROM smart_collection_changes WHERE vault_id=${scope(prefix)} AND revision<(SELECT revision-10000 FROM smart_collection_revisions WHERE vault_id=${scope(prefix)}); END;`);
 }
}
