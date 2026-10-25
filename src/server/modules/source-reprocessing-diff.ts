import {HttpError} from '../validation.js';
import {wellFormedUnicode} from './source-reprocessing-patches.js';
import {pageBoundaryDiagnostics,preserveReconstructionSeparators} from './source-reprocessing-diagnostics.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';
import type {SourceEditorialPatch} from '../../shared/source-reprocessing.js';

export interface ReconstructionDifference {startOffset:number;endOffset:number;original:string;replacement:string;category:SourceEditorialPatch['category'];reason:string;confidence:number}
const invalid=(reason:string):never=>{throw new HttpError(502,`Invalid semantic reconstruction: ${reason}`);};
/** A model returns complete block text. No model-provided coordinate is trusted. */
export function reconstructBlocks(chunk:PlannedReprocessingChunk,response:unknown):{patches:ReconstructionDifference[];diagnostics:string[];unresolved:boolean;text:string}{
 if(!response||typeof response!=='object'||Array.isArray(response))return invalid('expected an object.');
 const data=response as Record<string,unknown>;
 if(!Array.isArray(data.blocks)||data.blocks.length!==chunk.blocks.length)return invalid('every canonical block must be returned.');
 if(data.diagnostics!==undefined&&(!Array.isArray(data.diagnostics)||data.diagnostics.length>30||data.diagnostics.some(item=>typeof item!=='string'||item.length>2000)))return invalid('invalid diagnostics.');
 if(data.unresolved!==undefined&&typeof data.unresolved!=='boolean')return invalid('invalid unresolved indicator.');
 const patches:ReconstructionDifference[]=[],diagnostics=[...(data.diagnostics as string[]|undefined)??[]],reconstructed:string[]=[];
 for(const [index,value] of data.blocks.entries()){
  const original=chunk.blocks[index]!;
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('invalid block.');
  const candidate=value as Record<string,unknown>;
  if(candidate.id!==original.id){
   // Recover only an unknown identifier attached to the unique, byte-for-byte
   // unchanged block in its expected position. Never infer an edited passage.
   const recoverable=typeof candidate.id==='string'&&/^[a-f0-9]{24}$/.test(candidate.id)&&candidate.text===original.text&&chunk.blocks.filter(block=>block.text===candidate.text).length===1&&!chunk.blocks.some(block=>block.id===candidate.id)&&data.blocks.filter(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).id===candidate.id).length===1&&!data.blocks.some(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).id===original.id);
   if(!recoverable)return invalid('unknown, reordered, duplicate, or malformed block.');
   diagnostics.push(`Recovered mistyped block ID ${candidate.id} as ${original.id} from unique unchanged source text at its original position.`);
  }
  if(typeof candidate.text!=='string'||candidate.text.length>16000||!wellFormedUnicode(candidate.text))return invalid('unknown, reordered, duplicate, or malformed block.');
  const replacement=preserveReconstructionSeparators(original.text,candidate.text);
  reconstructed.push(replacement);
  if(replacement===original.text)continue;
  if(pageBoundaryDiagnostics(original.text,replacement).length)return invalid('physical page provenance changed.');
  for(const span of boundedReconstructionDiff(original.text,replacement)){
   const before=original.text.slice(span.start,span.end),after=replacement.slice(span.newStart,span.newEnd);
   if(before.length>16000||after.length>16000)return invalid('difference exceeds the patch limit.');
   const mechanical=before.replace(/[ \t\r\n]+/g,' ')===after.replace(/[ \t\r\n]+/g,' ');
   patches.push({startOffset:original.start+span.start,endOffset:original.start+span.end,original:before,replacement:after,category:mechanical?'formatting':before.includes('\n')&&!/\n[ \t]*\n/.test(before)&&before.replace(/\r?\n/g,' ')===after?'line_breaks':'ocr',reason:'Deterministic difference from reconstructed canonical block; source comparison is required for substantive changes.',confidence:0});
  }
 }
 // Preserve the durable revision's 6,400-patch bound (128 chunks × 50).
 // Excessively fragmented results are combined deterministically with unchanged
 // canonical gaps, retaining complete apparatus labels and exact roundtrips.
 if(patches.length>50){
  const canonical=chunk.blocks.map(block=>block.text).join(''),compacted:ReconstructionDifference[]=[],width=Math.ceil(patches.length/50);
  for(let at=0;at<patches.length;at+=width){
   const group=patches.slice(at,at+width),first=group[0]!,last=group[group.length-1]!;
   let replacement='',cursor=first.startOffset;
   for(const patch of group){replacement+=canonical.slice(cursor-chunk.start,patch.startOffset-chunk.start)+patch.replacement;cursor=patch.endOffset;}
   const original=canonical.slice(first.startOffset-chunk.start,last.endOffset-chunk.start);
   if(original.length>16000||replacement.length>16000)return invalid('compacted difference exceeds the patch limit.');
   compacted.push({...first,endOffset:last.endOffset,original,replacement,category:original.replace(/[ \t]+/g,' ')===replacement.replace(/[ \t]+/g,' ')?'formatting':'ocr'});
  }
  patches.splice(0,patches.length,...compacted);
 }
 return {patches,diagnostics,unresolved:data.unresolved===true,text:reconstructed.join('')};
}

interface EditSpan {start:number;end:number;newStart:number;newEnd:number}
const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'});
/** Myers alignment over grapheme clusters. Work and patch counts are bounded; highly
 * divergent output conservatively falls back to a single span for manual review. */
export function boundedReconstructionDiff(original:string,replacement:string):EditSpan[]{
 if(original===replacement)return [];
 const segments=(text:string)=>[...segmenter.segment(text)].map(value=>value.segment);
 const a=segments(original),b=segments(replacement),offsets=(tokens:string[])=>{const result=[0];for(const token of tokens)result.push(result[result.length-1]!+token.length);return result;};
 const ao=offsets(a),bo=offsets(b);
 let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 let ae=a.length,be=b.length;while(ae>prefix&&be>prefix&&a[ae-1]===b[be-1]){ae--;be--;}
 const left=a.slice(prefix,ae),right=b.slice(prefix,be),trace:Map<number,number>[]=[],v=new Map<number,number>([[1,0]]);
 let work=0,operations:string[]|undefined;
 search:for(let d=0;d<=256;d++){
  trace.push(new Map(v));
  for(let k=-d;k<=d;k+=2){
   if(++work>1000000)break search;
   let x=k===-d||(k!==d&&(v.get(k-1)??-1)<(v.get(k+1)??-1))?(v.get(k+1)??0):(v.get(k-1)??0)+1;
   let y=x-k;
   while(x<left.length&&y<right.length&&left[x]===right[y]){x++;y++;if(++work>1000000)break search;}
   v.set(k,x);
   if(x>=left.length&&y>=right.length){
    const reverse:string[]=[];let atX=x,atY=y;
    for(let step=d;step>=0;step--){
     const prior=trace[step]!,diagonal=atX-atY,previous=diagonal===-step||(diagonal!==step&&(prior.get(diagonal-1)??-1)<(prior.get(diagonal+1)??-1))?diagonal+1:diagonal-1;
     const oldX=prior.get(previous)??0,oldY=oldX-previous;
     while(atX>oldX&&atY>oldY){reverse.push('=');atX--;atY--;}
     if(step>0){if(atX===oldX){reverse.push('+');atY--;}else{reverse.push('-');atX--;}}
    }
    operations=reverse.reverse();break search;
   }
  }
 }
 const spans:EditSpan[]=[];
 if(operations){
  let x=prefix,y=prefix,current:EditSpan|undefined;
  for(const op of operations){
   if(op==='='){if(current){spans.push(current);current=undefined;}x++;y++;continue;}
   current??={start:ao[x]!,end:ao[x]!,newStart:bo[y]!,newEnd:bo[y]!};
   if(op==='-')x++;else y++;current.end=ao[x]!;current.newEnd=bo[y]!;
  }
  if(current)spans.push(current);
 }
 if(!operations||spans.length>64)spans.splice(0,spans.length,{start:ao[prefix]!,end:ao[ae]!,newStart:bo[prefix]!,newEnd:bo[be]!});
 const oldLabels=[...original.matchAll(/\[\^[^\]\n]+\]/g)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
 const newLabels=[...replacement.matchAll(/\[\^[^\]\n]+\]/g)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
 for(const span of spans){
  // Extend touched labels only, so dependent references remain visible to grouping.
  const touched=(label:{start:number;end:number},start:number,end:number)=>label.start<end&&label.end>start||start===end&&label.start<start&&label.end>start;
  const old=oldLabels.filter(label=>touched(label,span.start,span.end)),next=newLabels.filter(label=>touched(label,span.newStart,span.newEnd));
  const before=Math.max(0,...old.map(label=>span.start-label.start),...next.map(label=>span.newStart-label.start));
  const after=Math.max(0,...old.map(label=>label.end-span.end),...next.map(label=>label.end-span.newEnd));
  const extendLeft=Math.min(before,span.start,span.newStart),extendRight=Math.min(after,original.length-span.end,replacement.length-span.newEnd);
  span.start-=extendLeft;span.newStart-=extendLeft;span.end+=extendRight;span.newEnd+=extendRight;
  // Retain neighboring prose around horizontal-spacing edits for independent safety checks.
  if(/^[ \t\r\n]*$/.test(original.slice(span.start,span.end))&&/^[ \t\r\n]*$/.test(replacement.slice(span.newStart,span.newEnd))){
   while(span.start>0&&span.newStart>0&&original[span.start-1]===replacement[span.newStart-1]&&/[ \t]/.test(original[span.start-1]!)){span.start--;span.newStart--;}
   while(span.end<original.length&&span.newEnd<replacement.length&&original[span.end]===replacement[span.newEnd]&&/[ \t]/.test(original[span.end]!)){span.end++;span.newEnd++;}
   if(span.start>0&&span.newStart>0){const index=ao.indexOf(span.start),length=span.start-ao[index-1]!;if(original.slice(span.start-length,span.start)===replacement.slice(span.newStart-length,span.newStart)){span.start-=length;span.newStart-=length;}}
   if(span.end<original.length&&span.newEnd<replacement.length){const index=ao.indexOf(span.end),length=ao[index+1]!-span.end;if(original.slice(span.end,span.end+length)===replacement.slice(span.newEnd,span.newEnd+length)){span.end+=length;span.newEnd+=length;}}
  }
  // Legacy patch ranges must be nonempty; include one unchanged grapheme for insertion.
  if(span.start===span.end){
   if(span.end<original.length){const index=ao.indexOf(span.end),length=ao[index+1]!-span.end;span.end+=length;span.newEnd+=length;}
   else if(span.start>0){const index=ao.indexOf(span.start),length=span.start-ao[index-1]!;span.start-=length;span.newStart-=length;}
   else return invalid('empty canonical block.');
  }
 }
 // Context expansion can overlap adjacent edits. Merge such spans before validation.
 const merged:EditSpan[]=[];
 for(const span of spans){const prior=merged[merged.length-1];if(prior&&(span.start<prior.end||span.newStart<prior.newEnd)){prior.start=Math.min(prior.start,span.start);prior.newStart=Math.min(prior.newStart,span.newStart);prior.end=Math.max(prior.end,span.end);prior.newEnd=Math.max(prior.newEnd,span.newEnd);}else merged.push({...span});}
 // Expanded context must still describe exactly the returned block. Apparatus labels
 // near another edit may cross its alignment; fail closed to complete-block review.
 let reconstructed=original;
 for(const span of [...merged].reverse())reconstructed=reconstructed.slice(0,span.start)+replacement.slice(span.newStart,span.newEnd)+reconstructed.slice(span.end);
 if(reconstructed!==replacement||merged.some(span=>!ao.includes(span.start)||!ao.includes(span.end)||!bo.includes(span.newStart)||!bo.includes(span.newEnd)))return [{start:0,end:original.length,newStart:0,newEnd:replacement.length}];
 return merged;
}
