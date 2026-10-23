import { randomUUID } from 'node:crypto';
import type { SourceFile } from '../../shared/domain.js';
import { Store } from '../store.js';

export function syncSourceProvenance(store:Store,vault:string,entity:string) {
  const files=store.all<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,entity);
  const existing=store.all<{id:string;name:string;value:string|null;target_id:string|null}>("SELECT id,name,value,target_id FROM properties WHERE entity_id=? AND name IN ('Import method','Source URL')",entity);
  const desired: [string,string][] = [
    ...[...new Set(files.map(file=>file.import_method))].map(value=>['Import method',value] as [string,string]),
    ...[...new Set(files.map(file=>file.source_url).filter((url):url is string=>!!url))].map(value=>['Source URL',value] as [string,string]),
  ];
  // Retain stable IDs (and their typed/temporal metadata) for unchanged derived values.
  // Unexpected authored references with these names are preserved for review.
  for(const row of existing)if(row.target_id===null&&!desired.some(([name,value])=>row.name===name&&row.value===value))store.run('DELETE FROM properties WHERE id=?',row.id);
  for(const [name,value] of desired)if(!existing.some(row=>row.name===name&&row.value===value&&row.target_id===null))store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),entity,name,value,null);
}
