import {Store} from '../store.js';
import {HttpError} from '../validation.js';
export const organizationDescriptionLimit=2000;
/** Plain text only. Omission is handled by the caller; null and blank clear metadata. */
export function organizationDescription(input:unknown):string|null {
 if(input===null)return null;
 if(typeof input!=='string'||input.length>organizationDescriptionLimit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input))throw new HttpError(400,'Enter a description of at most 2,000 characters');
 return input.trim()||null;
}
export function saveOrganizationDescription(store:Store,vault:string,kind:'folder'|'collection',id:string,value:string|null) {
 const table=kind==='folder'?'folder_descriptions':'collection_descriptions',key=kind==='folder'?'folder_id':'collection_id';
 if(value===null)store.run(`DELETE FROM ${table} WHERE vault_id=? AND ${key}=?`,vault,id);
 else store.run(`INSERT INTO ${table}(vault_id,${key},description) VALUES(?,?,?) ON CONFLICT(${key}) DO UPDATE SET description=excluded.description WHERE vault_id=excluded.vault_id`,vault,id,value);
}
