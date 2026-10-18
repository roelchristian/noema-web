import type {DatabaseSync} from 'node:sqlite';

/** Jobs contain identifiers and policy only; authored content remains in the page tables. */
export function setupPageEnrichmentSchedulerSchema(db:DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS page_enrichment_jobs (
    page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    fields TEXT NOT NULL, explicit INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    generation INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS page_enrichment_jobs_due ON page_enrichment_jobs(due_at);
    CREATE TABLE IF NOT EXISTS page_enrichment_cooldowns (
    page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    last_classified_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS page_enrichment_settings (
    vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
    automatic_summaries INTEGER NOT NULL DEFAULT 1 CHECK(automatic_summaries IN (0,1)));
    CREATE TABLE IF NOT EXISTS page_enrichment_decisions (
    id INTEGER PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    reason TEXT NOT NULL, requested_fields TEXT NOT NULL, assessed_at TEXT NOT NULL,
    provider_requested INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS page_enrichment_decisions_vault ON page_enrichment_decisions(vault_id,assessed_at);`);
  // Move early per-vault settings out of global metadata, including cleanup of deleted vault keys.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'").get()) {
    db.exec(`INSERT OR IGNORE INTO page_enrichment_settings(vault_id,automatic_summaries)
      SELECT v.id,CASE WHEN m.value='true' THEN 1 ELSE 0 END FROM vaults v
      JOIN metadata m ON m.key='page_enrichment:'||v.id||':automatic_summaries';
      DELETE FROM metadata WHERE key GLOB 'page_enrichment:*:automatic_summaries';`);
  }
}
