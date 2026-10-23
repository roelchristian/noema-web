import type {DatabaseSync} from 'node:sqlite';
export function setupPageHistorySchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS page_versions (
 id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,page_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL,kind TEXT NOT NULL,name TEXT,pinned INTEGER NOT NULL DEFAULT 0,
 content_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,restored_from_version_id TEXT);
 CREATE INDEX IF NOT EXISTS page_versions_timeline ON page_versions(vault_id,page_id,created_at DESC,id);
 CREATE TABLE IF NOT EXISTS page_version_images (version_id TEXT NOT NULL REFERENCES page_versions(id) ON DELETE CASCADE,image_id TEXT NOT NULL,PRIMARY KEY(version_id,image_id));
 CREATE INDEX IF NOT EXISTS page_version_images_asset ON page_version_images(image_id);`);
}
