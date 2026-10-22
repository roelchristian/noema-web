import {createHash} from 'node:crypto';
import type {EntityImpact} from '../../shared/entity-lifecycle.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Knowledge} from './knowledge.js';
import {sourceDeletionImpact} from './source-deletion-impact.js';
import {Vaults} from './vaults.js';

/** Inventory is read from durable rows, including raw nested block/table JSON when
 * derivative indexes are absent. Archive changes eligibility, never reference targets. */
export class EntityLifecycle {
  constructor(private store:Store) {}
  private inventory(vault:string,id:string):EntityImpact {
    new Vaults(this.store).requireOpen(vault);
    const entity=new Knowledge(this.store).require(vault,id);
    const files=this.store.all<{id:string}>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY id',vault,id);
    const fileIds=new Set(files.map(file=>file.id));
    const rows=this.store.all<{id:string;title:string;blocks:string;deleted_at:string|null;revision:number}>(`SELECT p.id,p.title,p.blocks,p.deleted_at,p.revision FROM pages p WHERE p.vault_id=? ORDER BY p.id`,vault);
    const linked=new Set(this.store.all<{page_id:string}>(`SELECT page_id FROM page_sources WHERE source_id=? UNION SELECT page_id FROM note_source_references WHERE source_id=? UNION SELECT n.page_id FROM note_source_files n JOIN source_files f ON f.id=n.file_id WHERE f.entity_id=? UNION SELECT page_id FROM page_reading_notes WHERE source_id=? UNION SELECT page_id FROM source_page_creations WHERE source_id=?`,id,id,id,id,id).map(row=>row.page_id));
    const curated=this.store.all('SELECT * FROM entity_page_associations WHERE entity_id=? ORDER BY page_id',id);
    for(const row of curated as {page_id:string}[])linked.add(row.page_id);
    const overview=this.store.get('SELECT * FROM entity_overviews WHERE entity_id=?',id);
    const pages:EntityImpact['pages']=[];
    for(const row of rows) {
      let references=0;
      const visit=(value:unknown):void=>{
        if(!value||typeof value!=='object')return;
        const record=value as Record<string,unknown>;
        if(record.entityId===id||record.sourceId===id||typeof record.fileId==='string'&&fileIds.has(record.fileId))references++;
        for(const child of Object.values(value))visit(child);
      };
      visit(JSON.parse(row.blocks));
      if(references||linked.has(row.id))pages.push({id:row.id,title:row.title,trashed:!!row.deleted_at,references});
    }
    const properties=this.store.all('SELECT * FROM properties WHERE entity_id=? OR target_id=? ORDER BY id',id,id);
    const relationships=this.store.all('SELECT * FROM relationships WHERE source_id=? OR target_id=? ORDER BY id',id,id);
    const count=(sql:string)=>this.store.get<{n:number}>(sql,id)!.n;
    const counts={activePages:pages.filter(page=>!page.trashed).length,trashedPages:pages.filter(page=>page.trashed).length,blockReferences:pages.reduce((sum,page)=>sum+page.references,0),
      properties:count('SELECT count(*) n FROM properties WHERE entity_id=?'),incomingProperties:count('SELECT count(*) n FROM properties WHERE target_id=?'),relationships:relationships.length,attachments:files.length,
      citations:count('SELECT count(*) n FROM note_source_references WHERE source_id=?'),highlights:count('SELECT count(*) n FROM highlights WHERE source_id=?'),readingNotes:count('SELECT count(*) n FROM page_reading_notes WHERE source_id=?'),bookmarks:count("SELECT count(*) n FROM source_reading_locations WHERE id<>'resume' AND file_id IN (SELECT id FROM source_files WHERE entity_id=?)"),pendingSourceDrafts:count("SELECT count(*) n FROM source_page_drafts WHERE source_id=? AND status='pending'")};
    const deleteBlockedReason=entity.type==='source'?sourceDeletionImpact(this.store,vault,id).blockedReason:'Permanent entity deletion is unavailable.';
    // Include page revisions even when an edit keeps the same reference count. This
    // conservative token also catches intervening archive/restore and metadata edits.
    const sourceRecords=[
      this.store.all('SELECT * FROM note_source_references WHERE source_id=? ORDER BY id',id),
      this.store.all('SELECT * FROM highlights WHERE source_id=? ORDER BY id',id),
      this.store.all('SELECT * FROM page_reading_notes WHERE source_id=? ORDER BY page_id',id),
      this.store.all('SELECT * FROM source_reading_locations WHERE file_id IN (SELECT id FROM source_files WHERE entity_id=?) ORDER BY file_id,id',id),
      this.store.all('SELECT * FROM source_page_drafts WHERE source_id=? ORDER BY request_id',id),
    ];
    const version=createHash('sha256').update(JSON.stringify([entity,rows,files,properties,relationships,sourceRecords,curated,overview,counts,deleteBlockedReason])).digest('hex');
    return {id,name:entity.name,archivedAt:entity.archived_at??null,version,pages,counts,deleteBlockedReason,
      remainsAccessible:['Existing mentions, properties, relationships, pinned pages, page associations and authored overview','Active pages and pages in Trash (normal Trash retention still applies)','Citations, original source attachments and coordinates, highlights, reading notes and bookmarks'],
      hiddenByDefault:['Active knowledge and source library views; global search unless Include archived is selected','New-link pickers, automatic tagging and entity discovery suggestions'],
      draftPolicy:'Unsaved browser drafts are not inventoried. Saving explicit references to an archived identity remains allowed after vault and reference validation; this preserves drafts opened before archival. Other open tabs may retain older client-side suggestions until their entity list refreshes. Saves cannot distinguish a pre-archive draft link from a deliberate explicit link. Automatic tagging and fresh suggestions exclude archived identities. Restore does not rewrite pages.'};
  }
  preview(vault:string,id:string) {return this.store.transaction(()=>this.inventory(vault,id));}
  change(vault:string,id:string,restore:boolean,version:unknown) {
    return this.store.transaction(()=>{
      const state=this.inventory(vault,id);
      // Repeated requests for the same state are safe even with the original token.
      if(!!state.archivedAt===!restore)return state;
      if(typeof version!=='string'||version!==state.version)throw new HttpError(409,'The identity or its dependencies changed. Refresh the impact preview before trying again.');
      this.store.run('UPDATE entities SET archived_at=?,updated_at=? WHERE id=? AND vault_id=?',restore?null:now(),new Date(Math.max(Date.now(),Date.parse(new Knowledge(this.store).require(vault,id).updated_at)+1)).toISOString(),id,vault);
      this.store.run('DELETE FROM page_entity_match_cache WHERE vault_id=?',vault);
      return this.inventory(vault,id);
    });
  }
}
