import {createHash} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
/** Attachment inventory for reading/status: never transfer document text or structures. */
export function sourceFileStatuses(store:Store,vault:string,entityId:string){
 if(!store.get("SELECT id FROM entities WHERE id=? AND vault_id=? AND type='source' AND archived_at IS NULL",entityId,vault))throw new HttpError(404,'Source not found.');
 return store.all<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at DESC,id',vault,entityId).map(file=>{
  const {text,structural_nodes,page_start_lines,summary,...status}=file;
  const contentVersion=createHash('sha256').update(JSON.stringify([text,structural_nodes,page_start_lines,file.generated_name,file.language,file.name,file.enrichment_status,file.status,file.admitted])).digest('hex');
  return {...status,text:'',summary:null,contentVersion};
 });
}
