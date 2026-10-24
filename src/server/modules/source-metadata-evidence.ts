import {createHash} from 'node:crypto';
import type {MetadataEvidence} from '../../shared/source-metadata.js';
import type {Store} from '../store.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Offsets are an immutable record of extraction, never rewritten during remapping. */
export function locateMetadataEvidence(text:string,evidence:MetadataEvidence):{start:number;end:number}|null {
 if(!evidence.excerpt||!Number.isSafeInteger(evidence.start)||!Number.isSafeInteger(evidence.end)||evidence.start<0||evidence.end<=evidence.start||evidence.end-evidence.start!==evidence.excerpt.length||hash(evidence.excerpt)!==evidence.evidenceHash)return null;
 const start=text.indexOf(evidence.excerpt);
 if(start<0||text.indexOf(evidence.excerpt,start+1)!==-1)return null;
 // At the extraction revision, invalid original coordinates must fail closed.
 if(hash(text)===evidence.revision&&start!==evidence.start)return null;
 return {start,end:start+evidence.excerpt.length};
}
export function metadataEvidenceStaleReason(store:Store,vault:string,sourceId:string,evidence:MetadataEvidence):string|null {
 if(!evidence||typeof evidence!=='object'||!['canonical','editorial'].includes(evidence.version)||typeof evidence.revision!=='string'||!/^[a-f0-9]{64}$/.test(evidence.revision))return 'The evidence version is unavailable or invalid.';
 const file=store.get<{text:string;status:string;admitted:number;entity_id:string|null}>('SELECT text,status,admitted,entity_id FROM source_files WHERE id=? AND vault_id=?',evidence.fileId,vault);
 if(!file||file.entity_id!==sourceId||file.status!=='ready'||!file.admitted)return 'The evidence attachment is no longer available for this Source.';
 let text=file.text;
 if(evidence.version==='editorial') {
  const row=store.get<{payload:string}>('SELECT payload FROM source_reprocessing WHERE id=? AND file_id=? AND vault_id=?',evidence.runId,evidence.fileId,vault);
  if(!row)return 'The editorial evidence revision is unavailable.';
  try {
   const revision=JSON.parse(row.payload) as {reprocessed?:{text?:unknown};original?:{text?:unknown}};
   if(typeof revision.reprocessed?.text!=='string'||typeof revision.original?.text!=='string'||revision.original.text!==file.text)return 'The editorial evidence no longer belongs to the current canonical extraction.';
   text=revision.reprocessed.text;
   // The derivative version is immutable evidence. A later editorial decision is a new version.
   if(hash(text)!==evidence.revision)return 'The editorial evidence revision changed.';
  } catch {return 'The editorial evidence revision is invalid.';}
 }
 return locateMetadataEvidence(text,evidence)?null:'The supporting excerpt changed, disappeared, or is ambiguous.';
}
