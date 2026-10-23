import {randomUUID} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {getPropertyProvenance,proposeValue,recordPropertyProvenance} from './property-provenance.js';

/** Reserved source metadata is derived from attachment fields, never extracted prose.
 * Unknown/manual historical values remain authored evidence and require conflict review. */
export function syncSourceProvenance(store:Store,vault:string,entity:string) {
 const files=store.all<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,entity);
 const existing=store.all<{id:string;name:string;value:string|null;target_id:string|null}>("SELECT id,name,value,target_id FROM properties WHERE entity_id=? AND name IN ('Import method','Source URL')",entity);
 const desired=files.flatMap(file=>[
  {name:'Import method',value:file.import_method,file},
  ...(file.source_url?[{name:'Source URL',value:file.source_url,file}]:[]),
 ]).filter((item,index,all)=>all.findIndex(other=>other.name===item.name&&other.value===item.value)===index);
 for(const row of existing) {
  const provenance=getPropertyProvenance(store,vault,row.id);
  if(!provenance||!['imported','derived'].includes(provenance.origin))continue;
  const match=desired.find(item=>row.target_id===null&&row.name===item.name&&row.value===item.value);
  if(match)recordPropertyProvenance(store,vault,row.id,{origin:'imported',source_file_id:match.file.id,source_hash:null,details:`source_attachment_metadata:${row.name}`,stale:false});
  else if(!provenance.stale)recordPropertyProvenance(store,vault,row.id,{...provenance,stale:true,details:`${provenance.details}\nAttachment metadata changed; previous value retained for review.`});
 }
 for(const item of desired) {
  if(existing.some(row=>row.name===item.name&&row.value===item.value&&row.target_id===null))continue;
  const conflict=existing.find(row=>row.name===item.name&&(!getPropertyProvenance(store,vault,row.id)||['manual','legacy_unknown'].includes(getPropertyProvenance(store,vault,row.id)!.origin)));
  if(conflict) {
   proposeValue(store,vault,{entity_id:entity,kind:'property',property_id:conflict.id,property_name:item.name,value:item.value,origin:'imported',source_file_id:item.file.id,source_hash:null,details:`source_attachment_metadata:${item.name}. A manual or unknown historical value is retained; review the current attachment metadata.`});
   continue;
  }
  const id=randomUUID();store.run('INSERT INTO properties VALUES (?,?,?,?,?)',id,entity,item.name,item.value,null);
  recordPropertyProvenance(store,vault,id,{origin:'imported',source_file_id:item.file.id,source_hash:null,details:`source_attachment_metadata:${item.name}`,stale:false});
 }
}
