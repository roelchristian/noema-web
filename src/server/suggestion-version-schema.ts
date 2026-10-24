import type {DatabaseSync} from 'node:sqlite';

/** Durable vault revisions make suggestion cache checks independent of corpus size. */
export function setupSuggestionVersionSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS suggestion_versions (
  vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0
 );`);
 const tables:Record<string,{vault:(row:string)=>string;columns?:string[]}>= {
  pages:{vault:row=>`${row}.vault_id`,columns:['title','blocks','revision','deleted_at','archived_at','vault_id']},
  entities:{vault:row=>`${row}.vault_id`,columns:['name','mention_case','inactive','archived_at','type','vault_id']},
  source_files:{vault:row=>`${row}.vault_id`,columns:['entity_id','status','admitted','text','vault_id']},
  embedding_settings:{vault:row=>`${row}.vault_id`},
  page_segments:{vault:row=>`${row}.vault_id`},
  source_passages:{vault:row=>`${row}.vault_id`},
  page_index_dirty:{vault:row=>`${row}.vault_id`},
  source_passage_dirty:{vault:row=>`${row}.vault_id`},
  page_segment_embeddings:{vault:row=>`(SELECT vault_id FROM page_segments WHERE id=${row}.segment_id)`},
  source_passage_embeddings:{vault:row=>`(SELECT vault_id FROM source_passages WHERE id=${row}.passage_id)`},
  page_sources:{vault:row=>`(SELECT vault_id FROM pages WHERE id=${row}.page_id)`},
  page_source_dismissals:{vault:row=>`(SELECT vault_id FROM pages WHERE id=${row}.page_id)`},
 };
 for(const [table,{vault,columns}] of Object.entries(tables))for(const event of ['INSERT','UPDATE','DELETE']) {
  const rows=event==='UPDATE'?['OLD','NEW']:[event==='DELETE'?'OLD':'NEW'];
  const changed=event==='UPDATE'&&columns?`WHEN ${columns.map(column=>`OLD.${column} IS NOT NEW.${column}`).join(' OR ')}`:'';
  db.exec(`DROP TRIGGER IF EXISTS suggestion_version_${table}_${event.toLowerCase()};
   CREATE TRIGGER suggestion_version_${table}_${event.toLowerCase()}
   AFTER ${event}${event==='UPDATE'&&columns?' OF '+columns.join(','):''} ON ${table} ${changed} BEGIN
   ${rows.map(row=>`INSERT INTO suggestion_versions(vault_id,version) SELECT ${vault(row)},1
    WHERE EXISTS(SELECT 1 FROM vaults WHERE id=${vault(row)}) ${table==='entities'?`AND ${row}.type='source'`:''}
    ON CONFLICT(vault_id) DO UPDATE SET version=version+1;`).join('\n')}
   END;`);
 }
}
