import type {DatabaseSync} from 'node:sqlite';

/** Keep a source's high-water mark even when every editorial revision is deleted. */
export function setupSourceReprocessingVersionSchema(db:DatabaseSync){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS source_reprocessing_versions (
   file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
   last_version INTEGER NOT NULL CHECK(last_version>0)
  );`);
  const rows=db.prepare(`SELECT id,file_id,json_extract(payload,'$.versionNumber') AS version_number
   FROM source_reprocessing ORDER BY created_at,id`).all() as {id:string;file_id:string;version_number:number|null}[];
  const counters=new Map<string,number>();
  for(const row of rows)if(Number.isSafeInteger(row.version_number)&&row.version_number!>0)counters.set(row.file_id,Math.max(counters.get(row.file_id)??0,row.version_number!));
  // Legacy runs of every status receive a number once, in creation order.
  const update=db.prepare("UPDATE source_reprocessing SET payload=json_set(payload,'$.versionNumber',?) WHERE id=?");
  for(const row of rows){if(Number.isSafeInteger(row.version_number)&&row.version_number!>0)continue;const number=(counters.get(row.file_id)??0)+1;counters.set(row.file_id,number);update.run(number,row.id);}
  const remember=db.prepare(`INSERT INTO source_reprocessing_versions(file_id,last_version) VALUES(?,?)
   ON CONFLICT(file_id) DO UPDATE SET last_version=max(last_version,excluded.last_version)`);
  for(const [file,number] of counters)remember.run(file,number);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS source_reprocessing_version_number ON source_reprocessing(file_id,json_extract(payload,'$.versionNumber'));
   CREATE TRIGGER IF NOT EXISTS source_reprocessing_version_insert AFTER INSERT ON source_reprocessing BEGIN
    INSERT INTO source_reprocessing_versions(file_id,last_version)
     VALUES(NEW.file_id,max(1,coalesce(json_extract(NEW.payload,'$.versionNumber'),1)))
     ON CONFLICT(file_id) DO UPDATE SET last_version=max(last_version+CASE WHEN json_extract(NEW.payload,'$.versionNumber') IS NULL THEN 1 ELSE 0 END,coalesce(json_extract(NEW.payload,'$.versionNumber'),0));
    UPDATE source_reprocessing SET payload=json_set(payload,'$.versionNumber',coalesce(json_extract(NEW.payload,'$.versionNumber'),(SELECT last_version FROM source_reprocessing_versions WHERE file_id=NEW.file_id))) WHERE id=NEW.id;
   END;
   CREATE TRIGGER IF NOT EXISTS source_reprocessing_version_immutable BEFORE UPDATE OF payload ON source_reprocessing
    WHEN json_extract(OLD.payload,'$.versionNumber') IS NOT NULL AND json_extract(NEW.payload,'$.versionNumber') IS NOT json_extract(OLD.payload,'$.versionNumber')
    BEGIN SELECT RAISE(ABORT,'Editorial version numbers are immutable'); END;`);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
