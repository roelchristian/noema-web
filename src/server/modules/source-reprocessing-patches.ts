import {HttpError} from '../validation.js';

export const wellFormedUnicode=(text:string)=>!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text);

export function utf16Boundary(text:string,offset:number){
 return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1]!)&&/[\uDC00-\uDFFF]/.test(text[offset]!));
}
/** Offsets address the exact editable UTF-16 excerpt, without Unicode/newline normalization.
 * Old responses retain the safer unique-substring fallback. */
export function locateEditorialPatch(text:string,item:{original:string;startOffset?:unknown;endOffset?:unknown}){
 let start:number,end:number;
 if(item.startOffset==null&&item.endOffset==null){
  start=text.indexOf(item.original);end=start+item.original.length;
  if(start<0||text.indexOf(item.original,start+1)!==-1)throw new HttpError(502,'AI patch did not match a unique canonical excerpt.');
 }else{
  if(typeof item.startOffset!=='number'||typeof item.endOffset!=='number'||!Number.isSafeInteger(item.startOffset)||!Number.isSafeInteger(item.endOffset))throw new HttpError(502,'AI patch offsets must be integer UTF-16 excerpt coordinates.');
  start=item.startOffset;end=item.endOffset;
 }
 if(start<0||end<=start||end>text.length||!utf16Boundary(text,start)||!utf16Boundary(text,end)||text.slice(start,end)!==item.original)throw new HttpError(502,'AI patch offsets or original text do not match the canonical excerpt.');
 return {start,end};
}
