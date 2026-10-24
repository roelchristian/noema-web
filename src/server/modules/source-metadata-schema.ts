import type {DatabaseSync} from 'node:sqlite';

/** Candidate decisions extend, rather than duplicate, the existing proposal store. */
export function setupSourceMetadataSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_metadata_candidates (
 proposal_id TEXT PRIMARY KEY REFERENCES property_proposals(id) ON DELETE CASCADE,
 field_key TEXT NOT NULL,target_fingerprint TEXT NOT NULL,evidence_json TEXT NOT NULL,decision_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','corroborated','superseded')));
 CREATE INDEX IF NOT EXISTS source_metadata_candidates_field ON source_metadata_candidates(field_key,status);
 CREATE TABLE IF NOT EXISTS source_metadata_policies (
 source_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
 vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 policy TEXT NOT NULL CHECK(policy IN ('review','fill_validated_empty')));
 CREATE TABLE IF NOT EXISTS source_metadata_extraction_cache (
 vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
 evidence_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(vault_id,file_id,evidence_hash));
 CREATE TRIGGER IF NOT EXISTS source_metadata_policy_owner_insert BEFORE INSERT ON source_metadata_policies WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.source_id AND vault_id=NEW.vault_id AND type='source') BEGIN SELECT RAISE(ABORT,'Metadata policy requires a Source in this vault'); END;
 CREATE TRIGGER IF NOT EXISTS source_metadata_policy_owner_update BEFORE UPDATE ON source_metadata_policies WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.source_id AND vault_id=NEW.vault_id AND type='source') BEGIN SELECT RAISE(ABORT,'Metadata policy requires a Source in this vault'); END;
 CREATE TRIGGER IF NOT EXISTS source_metadata_cache_owner_insert BEFORE INSERT ON source_metadata_extraction_cache WHEN NOT EXISTS(SELECT 1 FROM source_files WHERE id=NEW.file_id AND vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Metadata cache requires a file in this vault'); END;
 CREATE TRIGGER IF NOT EXISTS source_metadata_cache_owner_update BEFORE UPDATE ON source_metadata_extraction_cache WHEN NOT EXISTS(SELECT 1 FROM source_files WHERE id=NEW.file_id AND vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Metadata cache requires a file in this vault'); END;`);
 if(!(db.prepare('PRAGMA table_info(source_metadata_candidates)').all() as {name:string}[]).some(column=>column.name==='decision_json'))db.exec("ALTER TABLE source_metadata_candidates ADD COLUMN decision_json TEXT NOT NULL DEFAULT '{}'");
}
