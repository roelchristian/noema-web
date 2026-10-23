import type {DatabaseSync} from 'node:sqlite';
/** Keep legacy folder/collection row shapes intact; descriptions are human metadata. */
export function setupOrganizationDescriptionSchema(db:DatabaseSync) {
 for(const [table,parent,key] of [['folder_descriptions','folders','folder_id'],['collection_descriptions','collections','collection_id']] as const) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
   vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
   ${key} TEXT PRIMARY KEY REFERENCES ${parent}(id) ON DELETE CASCADE,
   description TEXT NOT NULL CHECK(length(description)>0 AND length(description)<=2000)
  );
  CREATE INDEX IF NOT EXISTS ${table}_vault ON ${table}(vault_id);`);
  for(const event of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_scope_${event.toLowerCase()} BEFORE ${event} ON ${table}
   WHEN NOT EXISTS(SELECT 1 FROM ${parent} WHERE id=NEW.${key} AND vault_id=NEW.vault_id)
   BEGIN SELECT RAISE(ABORT,'Description owner is outside this vault'); END;`);
 }
}
