import {boundedReconstructionDiff} from './source-reprocessing-diff.js';
import type {PageFurnitureCandidate} from './source-reprocessing-furniture.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';

type ReconstructionResponse=Record<string,unknown>;
const responseObject=(response:unknown):ReconstructionResponse|undefined=>response&&typeof response==='object'&&!Array.isArray(response)?response as ReconstructionResponse:undefined;

/** Furniture is presentation metadata, never permission to delete source text.
 * Recover only a complete corroborated fragment deleted in isolation. Substantive
 * deletions, changed fragments and uncertain alignments remain reviewable edits. */
export function restoreDeletedPageFurniture(chunk:PlannedReprocessingChunk,response:unknown,patterns:PageFurnitureCandidate[]):{response:unknown;diagnostics:string[]}{
 const data=responseObject(response),diagnostics:string[]=[];
 if(!data||!Array.isArray(data.blocks))return {response,diagnostics};
 const blocks=data.blocks.map(value=>{
  const item=responseObject(value),canonical=chunk.blocks.find(block=>block.id===item?.id);
  if(!item||!canonical||typeof item.text!=='string')return value;
  const proposed=item.text,repairs:{start:number;end:number;text:string}[]=[];
  for(const difference of boundedReconstructionDiff(canonical.text,proposed)){
   // The diff deliberately expands context around edits. Remove identical
   // context before deciding whether the deleted content is furniture alone.
   const span={...difference},old=canonical.text.slice(span.start,span.end),next=proposed.slice(span.newStart,span.newEnd);
   const a=Array.from(old),b=Array.from(next);let left=0,right=0;
   while(left<a.length&&left<b.length&&a[left]===b[left])left++;
   while(right<a.length-left&&right<b.length-left&&a[a.length-1-right]===b[b.length-1-right])right++;
   const prefix=a.slice(0,left).join('').length,suffix=right?a.slice(-right).join('').length:0;
   span.start+=prefix;span.newStart+=prefix;span.end-=suffix;span.newEnd-=suffix;
   const before=canonical.text.slice(span.start,span.end),after=proposed.slice(span.newStart,span.newEnd);
   if(!before||after.trim())continue;
   const deleted=patterns.filter(pattern=>pattern.startOffset>=canonical.start+span.start&&pattern.endOffset<=canonical.start+span.end&&canonical.text.slice(pattern.startOffset-canonical.start,pattern.endOffset-canonical.start)===pattern.text);
   if(!deleted.length)continue;
   let remaining=before;
   for(const pattern of [...deleted].sort((a,b)=>b.startOffset-a.startOffset))remaining=remaining.slice(0,pattern.startOffset-canonical.start-span.start)+remaining.slice(pattern.endOffset-canonical.start-span.start);
   if(remaining.trim())continue;
   // Never create a second copy when the model moved the fragment elsewhere.
   if(deleted.some(pattern=>proposed.includes(pattern.text)))continue;
   repairs.push({start:span.newStart,end:span.newEnd,text:before});
   diagnostics.push(`Restored ${deleted.length} exact corroborated page header/footer fragment${deleted.length===1?'':'s'} deleted from canonical block ${canonical.id}; presentation classification does not remove source text.`);
  }
  if(!repairs.length)return value;
  let text=proposed;
  for(const repair of repairs.reverse())text=text.slice(0,repair.start)+repair.text+text.slice(repair.end);
  return {...item,text};
 });
 return {response:diagnostics.length?{...data,blocks}:response,diagnostics};
}

/** Text recovery must not discard independently checked furniture and bibliographic
 * proposals. Callers still validate those annotations against canonical evidence. */
export function canonicalReconstructionFallback(chunk:PlannedReprocessingChunk,response:unknown):ReconstructionResponse{
 return {...responseObject(response),blocks:chunk.blocks.map(({id,text})=>({id,text})),unresolved:true};
}
