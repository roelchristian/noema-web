import {createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {existsSync,readdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import type {VaultDeletionPreview,VaultDeletionResult} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError,now,text} from '../validation.js';
import {Vaults} from './vaults.js';

/** Confirmation and deletion are checked in the same database transaction. */
export class VaultDeletion {
  private root:string;private persistent:boolean;
  constructor(private store:Store) {
    const database=store.all<{name:string;file:string}>('PRAGMA database_list').find(db=>db.name==='main');
    this.persistent=!!database?.file;this.root=path.join(path.dirname(database?.file||':memory:'),'assets');
  }
  private directory(id:string) {
    if(!/^(default|[0-9a-f-]{36})$/.test(id))throw new HttpError(400,'Invalid vault ID');
    return path.join(this.root,id);
  }
  preview(id:string):VaultDeletionPreview {
    const vault=new Vaults(this.store).list().find(vault=>vault.id===id);
    if(!vault)throw new HttpError(404,'Vault not found');
    new Vaults(this.store).requireOpen(id);
    const count=(table:string,extra='')=>this.store.get<{count:number}>(`SELECT count(*) AS count FROM ${table} WHERE vault_id=? ${extra}`,id)!.count;
    const directory=path.join(this.directory(id),'images');
    const images=this.persistent&&existsSync(directory)?readdirSync(directory,{withFileTypes:true}).filter(file=>file.isFile()).map(file=>file.name).sort():[];
    const counts={notes:count('pages','AND deleted_at IS NULL'),trashedNotes:count('pages','AND deleted_at IS NOT NULL'),entities:count('entities'),sourceFiles:count('source_files'),images:images.length,folders:count('folders'),collections:count('collections')};
    const blockers:string[]=[];
    if(count('source_files',"AND status='processing'")||count('embedding_jobs',"AND status='running'"))blockers.push('A file extraction or embedding job is running. Wait for it to finish, then refresh this summary.');
    const revisions=this.store.all('SELECT id,title,revision FROM pages WHERE vault_id=? ORDER BY id',id);
    const entities=this.store.all('SELECT id,updated_at FROM entities WHERE vault_id=? ORDER BY id',id);
    const sources=this.store.all('SELECT id,size,status,entity_id FROM source_files WHERE vault_id=? ORDER BY id',id);
    const organization={
      folders:this.store.all('SELECT id,name,parent_id FROM folders WHERE vault_id=? ORDER BY id',id),
      collections:this.store.all('SELECT id,name FROM collections WHERE vault_id=? ORDER BY id',id),
      locations:this.store.all('SELECT kind,item_id,folder_id FROM item_locations WHERE vault_id=? ORDER BY kind,item_id',id),
      memberships:this.store.all('SELECT kind,item_id,collection_id FROM collection_memberships WHERE vault_id=? ORDER BY kind,item_id,collection_id',id),
      subtypes:this.store.all('SELECT id,type,name FROM entity_subtypes WHERE vault_id=? ORDER BY id',id),
      typeProperties:this.store.all('SELECT type,name FROM entity_type_properties WHERE vault_id=? ORDER BY type,name',id),
      subtypeProperties:this.store.all('SELECT subtype_id,name FROM entity_subtype_properties WHERE vault_id=? ORDER BY subtype_id,name',id),
      properties:this.store.all('SELECT id,name,value,target_id FROM properties WHERE entity_id IN (SELECT id FROM entities WHERE vault_id=?) ORDER BY id',id),
      relationships:this.store.all('SELECT id,source_id,label,target_id FROM relationships WHERE source_id IN (SELECT id FROM entities WHERE vault_id=?) ORDER BY id',id),
    };
    const fingerprint=createHash('sha256').update(JSON.stringify({vault,counts,revisions,entities,sources,images,organization})).digest('hex');
    return {vault,counts,fingerprint,canDelete:!blockers.length,blockers};
  }
  remove(id:string,body:Record<string,unknown>):VaultDeletionResult {
    this.store.transaction(()=>{
      const preview=this.preview(id);
      if(!preview.canDelete)throw new HttpError(409,preview.blockers.join(' '));
      if(body.name!==preview.vault.name||body.acknowledged!==true)throw new HttpError(400,'Type the vault name exactly and acknowledge permanent deletion.');
      if(body.fingerprint!==preview.fingerprint)throw new HttpError(409,'Vault contents changed. Refresh the summary and confirm again.');
      const protectedVault=this.store.get<{password_hash:string|null;salt:string|null}>('SELECT password_hash,salt FROM vaults WHERE id=?',id)!;
      if(protectedVault.password_hash&&typeof body.passphrase!=='string')throw new HttpError(400,'Enter the vault passphrase to confirm deletion.');
      if(protectedVault.password_hash && !timingSafeEqual(scryptSync(text(body.passphrase,500),protectedVault.salt!,64),Buffer.from(protectedVault.password_hash,'hex')))throw new HttpError(403,'Incorrect passphrase. The vault was not deleted.');
      const entityIds='SELECT id FROM entities WHERE vault_id=?',pageIds='SELECT id FROM pages WHERE vault_id=?';
      this.store.run(`DELETE FROM page_sources WHERE page_id IN (${pageIds}) OR source_id IN (${entityIds})`,id,id);
      this.store.run(`DELETE FROM properties WHERE entity_id IN (${entityIds}) OR target_id IN (${entityIds})`,id,id);
      this.store.run(`DELETE FROM relationships WHERE source_id IN (${entityIds}) OR target_id IN (${entityIds})`,id,id);
      // Explicit order covers legacy foreign keys without cascade behavior.
      for(const table of ['source_files','ai_notifications','page_entity_match_cache','embedding_jobs','pages','entities','favourites','item_locations','collection_memberships','folders','collections','entity_subtype_properties','entity_subtypes','entity_type_properties','embedding_settings','ai_activity'])this.store.run(`DELETE FROM ${table} WHERE vault_id=?`,id);
      this.store.run('DELETE FROM vaults WHERE id=?',id);
      this.store.run('INSERT INTO vault_deletion_cleanup (vault_id,created_at) VALUES (?,?)',id,now());
    });
    this.cleanup();
    return {vaults:new Vaults(this.store).list(),cleanupPending:!!this.store.get('SELECT vault_id FROM vault_deletion_cleanup WHERE vault_id=?',id)};
  }
  /** Failed file removal stays queued across restarts; never touch another vault. */
  cleanup() {
    for(const {vault_id} of this.store.all<{vault_id:string}>('SELECT vault_id FROM vault_deletion_cleanup')) {
      if(this.store.get('SELECT id FROM vaults WHERE id=?',vault_id))continue;
      try {
        if(this.persistent)rmSync(this.directory(vault_id),{recursive:true,force:true});
        this.store.run('DELETE FROM vault_deletion_cleanup WHERE vault_id=?',vault_id);
      }catch{console.error('Deleted vault attachment cleanup will retry.');}
    }
  }
}
