import type {DatabaseSync} from 'node:sqlite';

/** Persist only selector fields; full snapshots and excerpt histories stay in the detail payload. */
export function setupSourceReprocessingSummarySchema(db:DatabaseSync) {
 const projection=(payload:string)=>`CASE WHEN json_valid(${payload}) THEN json_set(
  json_remove(${payload},'$.original','$.reprocessed','$.nodeLinks','$.furniture','$.patches','$.report.excerpts','$.report.diagnostics','$.report.validationDiagnostics','$.origin.pageRecovery'),
  '$.report.diagnostics',json('[]'),
  '$.patchCount',coalesce(json_array_length(${payload},'$.patches'),0),
  '$.pendingCount',(SELECT count(*) FROM json_each(${payload},'$.patches') WHERE json_extract(value,'$.decision')='pending')
 ) ELSE NULL END`;
 db.exec('BEGIN IMMEDIATE');
 try {
  if(!(db.prepare('PRAGMA table_info(source_reprocessing)').all() as {name:string}[]).some(column=>column.name==='summary_json')) {
   db.exec('ALTER TABLE source_reprocessing ADD COLUMN summary_json TEXT');
   // One-time migration processes rows in SQLite rather than materializing documents in JS.
   db.exec(`UPDATE source_reprocessing SET summary_json=${projection('payload')}`);
  }
  // Refresh projections on upgrade without rewriting canonical revision payloads.
  db.exec('DROP TRIGGER IF EXISTS source_reprocessing_summary_insert; DROP TRIGGER IF EXISTS source_reprocessing_summary_update');
  db.exec(`UPDATE source_reprocessing SET summary_json=${projection('payload')} WHERE json_type(summary_json,'$.furniture') IS NOT NULL OR json_type(summary_json,'$.origin.pageRecovery') IS NOT NULL`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS source_reprocessing_summary_insert AFTER INSERT ON source_reprocessing BEGIN
   UPDATE source_reprocessing SET summary_json=${projection('(SELECT payload FROM source_reprocessing WHERE id=NEW.id)')} WHERE id=NEW.id;
   END;
   CREATE TRIGGER IF NOT EXISTS source_reprocessing_summary_update AFTER UPDATE OF payload ON source_reprocessing BEGIN
   UPDATE source_reprocessing SET summary_json=${projection('NEW.payload')} WHERE id=NEW.id;
   END;
   CREATE INDEX IF NOT EXISTS source_reprocessing_summary_list ON source_reprocessing(file_id,vault_id,created_at DESC,id DESC);`);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
