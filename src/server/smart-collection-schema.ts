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
 const scopes:Record<string,(prefix:string)=>string>={pages:p=>`${p}.vault_id`,entities:p=>`${p}.vault_id`,folders:p=>`${p}.vault_id`,item_locations:p=>`${p}.vault_id`,favourites:p=>`${p}.vault_id`,page_reading_notes:p=>`${p}.vault_id`,page_domains:p=>`(SELECT vault_id FROM pages WHERE id=${p}.page_id)`,entity_page_associations:p=>`(SELECT vault_id FROM pages WHERE id=${p}.page_id)`};
 for(const [table,scope] of Object.entries(scopes))for(const event of ['INSERT','UPDATE','DELETE']) {
  const prefix=event==='DELETE'?'OLD':'NEW';
  const item=table==='pages'?`${prefix}.id`:['entities','folders'].includes(table)?'NULL':table==='favourites'||table==='item_locations'?`CASE WHEN ${prefix}.kind='page' THEN ${prefix}.item_id ELSE NULL END`:`${prefix}.page_id`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS smart_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN INSERT INTO smart_collection_revisions(vault_id,revision) SELECT ${scope(prefix)},1 WHERE ${scope(prefix)} IS NOT NULL ON CONFLICT(vault_id) DO UPDATE SET revision=revision+1; INSERT INTO smart_collection_changes SELECT ${scope(prefix)},revision,${item} FROM smart_collection_revisions WHERE vault_id=${scope(prefix)}; DELETE FROM smart_collection_changes WHERE vault_id=${scope(prefix)} AND revision<(SELECT revision-10000 FROM smart_collection_revisions WHERE vault_id=${scope(prefix)}); END;`);
 }
}
