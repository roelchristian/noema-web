import {HttpError} from '../validation.js';
import {utf16Boundary,wellFormedUnicode} from './source-reprocessing-patches.js';
import {pageBoundaryDiagnostics} from './source-reprocessing-diagnostics.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';
import type {SourceEditorialPatch} from '../../shared/source-reprocessing.js';

export interface ReconstructionDifference {startOffset:number;endOffset:number;original:string;replacement:string;category:SourceEditorialPatch['category'];reason:string;confidence:number}
const invalid=(reason:string):never=>{throw new HttpError(502,`Invalid semantic reconstruction: ${reason}`);};
/** A model returns complete block text. No model-provided coordinate is trusted. */
export function reconstructBlocks(chunk:PlannedReprocessingChunk,response:unknown):{patches:ReconstructionDifference[];diagnostics:string[];unresolved:boolean}{
 if(!response||typeof response!=='object'||Array.isArray(response))return invalid('expected an object.');
 const data=response as Record<string,unknown>;
 if(!Array.isArray(data.blocks)||data.blocks.length!==chunk.blocks.length)return invalid('every canonical block must be returned.');
 if(data.diagnostics!==undefined&&(!Array.isArray(data.diagnostics)||data.diagnostics.length>30||data.diagnostics.some(item=>typeof item!=='string'||item.length>2000)))return invalid('invalid diagnostics.');
 if(data.unresolved!==undefined&&typeof data.unresolved!=='boolean')return invalid('invalid unresolved indicator.');
 const patches:ReconstructionDifference[]=[];
 for(const [index,value] of data.blocks.entries()){
  const original=chunk.blocks[index]!;
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('invalid block.');
  const candidate=value as Record<string,unknown>;
  if(candidate.id!==original.id||typeof candidate.text!=='string'||candidate.text.length>16000||!wellFormedUnicode(candidate.text))return invalid('unknown, reordered, duplicate, or malformed block.');
  const replacement=candidate.text;
  if(replacement===original.text)continue;
  if(pageBoundaryDiagnostics(original.text,replacement).length)return invalid('physical page provenance changed.');
  const mechanical=original.text.replace(/[ \t]+/g,' ')===replacement.replace(/[ \t]+/g,' ');
  let prefix=0;while(prefix<Math.min(original.text.length,replacement.length)&&original.text[prefix]===replacement[prefix])prefix++;
  while(prefix>0&&(!utf16Boundary(original.text,prefix)||!utf16Boundary(replacement,prefix)))prefix--;
  let oldEnd=original.text.length,newEnd=replacement.length;
  while(oldEnd>prefix&&newEnd>prefix&&original.text[oldEnd-1]===replacement[newEnd-1]){oldEnd--;newEnd--;}
  while(oldEnd<original.text.length&&(!utf16Boundary(original.text,oldEnd)||!utf16Boundary(replacement,newEnd))){oldEnd++;newEnd++;}
  // The legacy patch apparatus requires a nonempty canonical range. Include an adjacent
  // unchanged code point for insertions, preserving exact provenance without guessed offsets.
  if(oldEnd===prefix){if(oldEnd<original.text.length){oldEnd++;newEnd++;while(!utf16Boundary(original.text,oldEnd)){oldEnd++;newEnd++;}}else if(prefix>0){prefix--;while(!utf16Boundary(original.text,prefix))prefix--;}else return invalid('empty canonical block.');}
  if(mechanical){
   while(prefix>0&&/[ \t]/.test(original.text[prefix-1]!))prefix--;
   if(prefix>0){prefix--;while(!utf16Boundary(original.text,prefix))prefix--;}
   while(oldEnd<original.text.length&&/[ \t]/.test(original.text[oldEnd]!)){oldEnd++;newEnd++;}
   if(oldEnd<original.text.length){oldEnd++;newEnd++;while(!utf16Boundary(original.text,oldEnd)){oldEnd++;newEnd++;}}
  }
  // Apparatus dependencies must retain complete labels in the patch evidence so that
  // reference/definition edits can be grouped even when a single label character changes.
  if(/\[\^[^\]\n]+\]/.test(original.text+replacement)){prefix=0;oldEnd=original.text.length;newEnd=replacement.length;}
  const before=original.text.slice(prefix,oldEnd),after=replacement.slice(prefix,newEnd);
  if(before.length>16000||after.length>16000)return invalid('difference exceeds the patch limit.');
  patches.push({startOffset:original.start+prefix,endOffset:original.start+oldEnd,original:before,replacement:after,category:mechanical?'formatting':'ocr',reason:'Deterministic difference from reconstructed canonical block; source comparison is required for substantive changes.',confidence:0});
 }
 return {patches,diagnostics:(data.diagnostics as string[]|undefined)??[],unresolved:data.unresolved===true};
}
