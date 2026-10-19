import type {SourceLifecycle} from '../../shared/source-lifecycle.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Knowledge} from './knowledge.js';

export class SourceLifecycleService {
  constructor(private store:Store) {}
  preview(vault:string,id:string):SourceLifecycle {
    const source=new Knowledge(this.store).require(vault,id);
    if(source.type!=='source')throw new HttpError(400,'Choose a Source entity.');
    // Include trashed pages and raw block references, even when a derived index is missing.
    const linkedPageCount=this.store.get<{count:number}>(`SELECT count(*) AS count FROM pages p WHERE p.vault_id=? AND (
      EXISTS (SELECT 1 FROM page_sources WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM note_source_references WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM note_source_files n JOIN source_files f ON f.id=n.file_id WHERE n.page_id=p.id AND f.entity_id=?) OR
      EXISTS (SELECT 1 FROM page_reading_notes WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM source_page_creations WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM json_tree(p.blocks) j WHERE (j.key IN ('entityId','sourceId') AND j.value=?) OR
        (j.key='fileId' AND j.value IN (SELECT id FROM source_files WHERE entity_id=?)))
    )`,vault,id,id,id,id,id,id,id)!.count;
    const busy=this.store.get(`SELECT 1 FROM source_files f WHERE f.entity_id=? AND (
      f.status IN ('queued','processing') OR f.enrichment_status='running' OR
      EXISTS (SELECT 1 FROM source_reprocessing r WHERE r.file_id=f.id AND r.status IN ('queued','running'))
    )`,id)||this.store.get("SELECT 1 FROM ai_activity WHERE vault_id=? AND object_kind='entity' AND object_id=? AND status='running'",vault,id)
      ||this.store.get("SELECT 1 FROM source_passage_embedding_jobs WHERE vault_id=? AND source_id=? AND status='running'",vault,id);
    const draft=this.store.get("SELECT 1 FROM source_page_drafts WHERE vault_id=? AND source_id=? AND status='pending'",vault,id);
    return {id,name:source.name,archivedAt:source.archived_at??null,linkedPageCount,
      blockedReason:linkedPageCount?'Sources with linked pages cannot be archived or deleted. This includes pages in Trash.':
        busy?'Wait for source processing to finish before archiving or deleting.':
        draft?'Accept or discard the pending page draft before archiving or deleting.':null};
  }
  archive(vault:string,id:string,restore=false) {
    return this.store.transaction(()=>{
      const state=this.preview(vault,id);
      if(!restore&&state.blockedReason)throw new HttpError(409,state.blockedReason);
      this.store.run('UPDATE entities SET archived_at=?,updated_at=? WHERE id=? AND vault_id=?',restore?null:state.archivedAt??now(),now(),id,vault);
      return this.preview(vault,id);
    });
  }
  delete(vault:string,id:string,confirmation:unknown) {
    return this.store.transaction(()=>{
      const state=this.preview(vault,id);
      if(state.blockedReason)throw new HttpError(409,state.blockedReason);
      if(!state.archivedAt)throw new HttpError(409,'Archive the source before permanently deleting it.');
      if(confirmation!==state.name)throw new HttpError(400,'Type the exact source name to confirm deletion.');
      this.store.run("UPDATE source_passage_embedding_jobs SET status='skipped',finished_at=?,error='Source was permanently deleted.' WHERE vault_id=? AND source_id=? AND status='queued'",now(),vault,id);
      this.store.run("UPDATE embedding_jobs SET status='skipped',finished_at=?,error='Source was permanently deleted.' WHERE vault_id=? AND source_id=? AND status IN ('queued','running')",now(),vault,id);
      // Preserve file records for the existing retryable orphan-upload cleanup. Never unlink
      // originals before committing deletion: a failed transaction must leave them intact.
      this.store.run('UPDATE source_files SET entity_id=NULL,created_at=? WHERE vault_id=? AND entity_id=?',now(),vault,id);
      this.store.run('DELETE FROM entities WHERE id=? AND vault_id=?',id,vault);
      return {ok:true};
    });
  }
}
