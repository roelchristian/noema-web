import {createHash} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
export const sourceTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export interface MathText {text:string;uncertain:{id:number;text:string}[]}
/** A versioned derived source. Line/page identities stay stable; offsets address cleaned text. */
export function mathSource(store:Store,file:SourceFile):SourceFile {
 const row=store.get<{cleaned_text:string}>('SELECT cleaned_text FROM source_math_documents WHERE file_id=? AND raw_hash=? AND algorithm_version=2',file.id,sourceTextHash(file.text));
 return row?{...file,text:row.cleaned_text}:file;
}
export function mathMetadata(store:Store,fileId:string,cleanedText:string) {
 const row=store.get<{raw_hash:string;uncertainty_json:string}>('SELECT raw_hash,uncertainty_json FROM source_math_documents WHERE file_id=? AND cleaned_text=?',fileId,cleanedText);
 return row?{format:'LaTeX' as const,originalTextHash:row.raw_hash,uncertain:(JSON.parse(row.uncertainty_json) as MathText['uncertain']).map(issue=>({line:issue.id+1,text:issue.text}))}:undefined;
}
