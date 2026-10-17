import { randomUUID } from 'node:crypto';
import type { SourceFile } from '../../shared/domain.js';
import { Store } from '../store.js';

export function syncSourceProvenance(store:Store,vault:string,entity:string) {
  const files=store.all<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,entity);
  store.run("DELETE FROM properties WHERE entity_id=? AND name IN ('Import method','Source URL')",entity);
  for(const method of new Set(files.map(file=>file.import_method)))store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),entity,'Import method',method,null);
  for(const url of new Set(files.map(file=>file.source_url).filter((url):url is string=>!!url)))store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),entity,'Source URL',url,null);
}
