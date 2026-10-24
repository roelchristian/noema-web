import {createHash} from 'node:crypto';
import type {MetadataEvidence} from '../../shared/source-metadata.js';
import {HttpError} from '../validation.js';

const invalid=()=>new HttpError(400,'This backup contains invalid Source metadata evidence.');
/** Restore only typed evidence; never turn archive-supplied excerpts into canonical anchors. */
export function restoreMetadataEvidence(value:unknown,files:Map<string,string>,runs:Map<string,string>):MetadataEvidence[] {
 if(!Array.isArray(value)||value.length>1000)throw invalid();
 return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw invalid();
  const e=item as Record<string,unknown>;
  const string=(key:string,max:number)=>{const s=e[key];if(typeof s!=='string'||s.length>max)throw invalid();return s;};
  const fileId=files.get(string('fileId',200)),runId=string('runId',200),version=string('version',20),revision=string('revision',64),excerpt=string('excerpt',16000),evidenceHash=string('evidenceHash',64);
  if(!fileId||!runId||!['canonical','editorial'].includes(version)||!/^[a-f0-9]{64}$/.test(revision)||!/^[a-f0-9]{64}$/.test(evidenceHash)||!excerpt||!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||(e.start as number)<0||(e.end as number)-(e.start as number)!==excerpt.length||typeof e.validated!=='boolean')throw invalid();
  if(createHash('sha256').update(excerpt).digest('hex')!==evidenceHash||version==='editorial'&&!runs.has(runId))throw invalid();
  return {fileId,runId:runs.get(runId)??runId,version:version as MetadataEvidence['version'],revision,excerpt,evidenceHash,start:e.start as number,end:e.end as number,validated:e.validated,validationReason:string('validationReason',2000)};
 });
}
