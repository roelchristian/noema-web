import type {SourceLifecycle} from '../../shared/source-lifecycle.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Knowledge} from './knowledge.js';

/** Existing permanent-deletion guards, independent of reversible archival. */
export function sourceDeletionImpact(store:Store,vault:string,id:string):SourceLifecycle {
    const source=new Knowledge(store).require(vault,id);
    if(source.type!=='source')throw new HttpError(400,'Choose a Source entity.');
    // Include trashed pages and raw block references, even when a derived index is missing.
    const linkedPageCount=store.get<{count:number}>(`SELECT count(*) AS count FROM pages p WHERE p.vault_id=? AND (
      EXISTS (SELECT 1 FROM page_sources WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM note_source_references WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM note_source_files n JOIN source_files f ON f.id=n.file_id WHERE n.page_id=p.id AND f.entity_id=?) OR
      EXISTS (SELECT 1 FROM page_reading_notes WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM source_page_creations WHERE page_id=p.id AND source_id=?) OR
      EXISTS (SELECT 1 FROM json_tree(p.blocks) j WHERE (j.key IN ('entityId','sourceId') AND j.value=?) OR
        (j.key='fileId' AND j.value IN (SELECT id FROM source_files WHERE entity_id=?)))
    )`,vault,id,id,id,id,id,id,id)!.count;
    const busy=store.get(`SELECT 1 FROM source_files f WHERE f.entity_id=? AND (
      f.status IN ('queued','processing') OR f.enrichment_status='running' OR
      EXISTS (SELECT 1 FROM source_reprocessing r WHERE r.file_id=f.id AND r.status IN ('queued','running'))
    )`,id)||store.get("SELECT 1 FROM ai_activity WHERE vault_id=? AND object_kind='entity' AND object_id=? AND status='running'",vault,id)
      ||store.get("SELECT 1 FROM source_passage_embedding_jobs WHERE vault_id=? AND source_id=? AND status='running'",vault,id);
    const draft=store.get("SELECT 1 FROM source_page_drafts WHERE vault_id=? AND source_id=? AND status='pending'",vault,id);
    return {id,name:source.name,archivedAt:source.archived_at??null,linkedPageCount,
      blockedReason:linkedPageCount?'Sources with linked pages cannot be permanently deleted. This includes pages in Trash.':
        busy?'Wait for source processing to finish before permanently deleting.':
        draft?'Accept or discard the pending page draft before permanently deleting.':null};
}
