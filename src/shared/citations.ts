import {blockSegments, type Block, type SourceReference} from './domain.js';
export type CitationStyle='inline'|'references';
/** A passage is distinct from another page or section in the same source. */
export function citationKey(ref:SourceReference){return JSON.stringify([ref.fileId,ref.sourceHash,ref.startLine,ref.endLine]);}
export function citationLocation(ref:SourceReference){
  if(ref.startPage)return ref.startPage===ref.endPage?`p. ${ref.startPage}`:`pp. ${ref.startPage}–${ref.endPage}`;
  return ref.startLine===ref.endLine?`L${ref.startLine}`:`L${ref.startLine}–${ref.endLine}`;
}
export function noteCitations(blocks:Block[]){
  const entries=new Map<string,{number:number;reference:SourceReference;occurrences:string[]}>();
  for(const block of blocks)for(const segment of blockSegments(block))if(segment.sourceReference){
    const ref=segment.sourceReference,key=citationKey(ref),existing=entries.get(key);
    if(existing)existing.occurrences.push(ref.id);
    else entries.set(key,{number:entries.size+1,reference:ref,occurrences:[ref.id]});
  }
  return entries;
}

/** Sort only citations beside one another, retaining whitespace and all prose positions. */
export function sortCitationRuns(content:import('./domain.js').Segment[], compare:(left:SourceReference,right:SourceReference)=>number) {
  const result=[...content];
  for(let start=0;start<result.length;start++) {
    if(!result[start]?.sourceReference)continue;
    const positions=[start];let end=start+1;
    for(;end<result.length;end++) {
      const segment=result[end]!;
      if(segment.sourceReference)positions.push(end);
      else if(segment.text===undefined||segment.math||segment.code||segment.href||segment.text.trim())break;
    }
    const sorted=positions.map(index=>result[index]!).sort((left,right)=>compare(left.sourceReference!,right.sourceReference!));
    positions.forEach((index,offset)=>{result[index]=sorted[offset]!;});
    start=end-1;
  }
  return result;
}
