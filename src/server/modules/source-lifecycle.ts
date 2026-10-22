import {sourceDeletionImpact} from './source-deletion-impact.js';
import {EntityLifecycle} from './entity-lifecycle.js';
import type {SourceLifecycle} from '../../shared/source-lifecycle.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Knowledge} from './knowledge.js';

export class SourceLifecycleService {
  constructor(private store:Store) {}
  preview(vault:string,id:string):SourceLifecycle {
    return sourceDeletionImpact(this.store,vault,id);
  }

  archive(vault:string,id:string,restore=false) {
    const lifecycle=new EntityLifecycle(this.store),state=lifecycle.preview(vault,id);
    if(new Knowledge(this.store).require(vault,id).type!=='source')throw new HttpError(400,'Choose a Source entity.');
    lifecycle.change(vault,id,restore,state.version);
    return this.preview(vault,id);
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
      this.store.run('DELETE FROM source_reading_locations WHERE vault_id=? AND file_id IN (SELECT id FROM source_files WHERE vault_id=? AND entity_id=?)',vault,vault,id);
      this.store.run('UPDATE source_files SET entity_id=NULL,created_at=? WHERE vault_id=? AND entity_id=?',now(),vault,id);
      this.store.run('DELETE FROM entities WHERE id=? AND vault_id=?',id,vault);
      return {ok:true};
    });
  }
}
