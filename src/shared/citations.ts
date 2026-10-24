import {memoizeBlock} from './immutable-blocks.js';
import {blockSegments, type Block, type SourceReference} from './domain.js';
export type CitationStyle='inline'|'references';
/** A passage is distinct from another page or section in the same source. */
export function citationKey(ref:SourceReference){return JSON.stringify([ref.fileId,ref.sourceHash,ref.userLocator??null,ref.nodeId??ref.startOffset??ref.startLine,ref.nodeId?null:ref.endOffset??ref.endLine]);}
/** Compact locators use the most specific named context; full paths stay saved. */
export function citationContextLabel(context:string):string {
  const parts=context.split(' › ').map(part=>part.trim()).filter(Boolean);
  while(parts.length>1&&/^(paragraph|code|equation|list|table|blockquote|footnote)$/i.test(parts.at(-1)!))parts.pop();
  const label=parts.at(-1)??context;
  const abbreviations:Record<string,string>={chapter:'Ch.',section:'§',subsection:'§',theorem:'Thm.',lemma:'Lem.',proposition:'Prop.',corollary:'Cor.',definition:'Def.',example:'Ex.',remark:'Rem.'};
  const numbered=label.match(/^(chapter|section|subsection|theorem|lemma|proposition|corollary|definition|example|remark)\s+(\d+(?:[.-][A-Z0-9]+)*|[IVXLCDM]+(?:[.-]\d+)*|[A-Z](?:[.-]\d+)*)\b/i);
  if(numbered)return `${abbreviations[numbered[1]!.toLowerCase()]} ${numbered[2]}`;
  const section=label.match(/^(\d+(?:\.\d+)*)(?:[.)]?\s|$)/);
  if(section)return `§ ${section[1]}`;
  const plain=label.replace(/[.:]$/,'');
  // Unnumbered proofs still need their enclosing section to locate them.
  if(/^proof$/i.test(plain)&&parts.length>1)return `${citationContextLabel(parts.slice(0,-1).join(' › '))} · Proof`;
  return plain.length>40?plain.slice(0,39).trimEnd()+'…':plain;
}
export function citationLocation(ref:SourceReference){
  if(ref.userLocator)return ref.userLocator;
  if(ref.appLocator)return ref.appLocator;
  if(ref.contextLabel&&!(ref.startPage&&/^(paragraph|code|equation|list|table|blockquote|footnote)$/i.test(ref.contextLabel)))return citationContextLabel(ref.contextLabel)+(ref.startPage?` · ${ref.startPage===ref.endPage?`p. ${ref.startPage}`:`pp. ${ref.startPage}–${ref.endPage}`}`:'');
  if(ref.startPage)return ref.startPage===ref.endPage?`p. ${ref.startPage}`:`pp. ${ref.startPage}–${ref.endPage}`;
  return ref.startLine===ref.endLine?`L${ref.startLine}`:`L${ref.startLine}–${ref.endLine}`;
}
const blockCitations=memoizeBlock(block=>blockSegments(block).flatMap(segment=>segment.sourceReference?[segment.sourceReference]:[]));
export function noteCitations(blocks:Block[]){
  const entries=new Map<string,{number:number;reference:SourceReference;occurrences:string[]}>();
  for(const block of blocks)for(const ref of blockCitations(block)){
    const key=citationKey(ref),existing=entries.get(key);
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

/** Normalize only horizontal runs of citations; prose and line breaks separate groups. */
export function cleanCitationGroups(content:import('./domain.js').Segment[],compare:(left:SourceReference,right:SourceReference)=>number) {
  const result:import('./domain.js').Segment[]=[];
  let changed=false;
  for(let index=0;index<content.length;){
    if(!content[index]!.sourceReference){result.push(content[index++]!);continue;}
    const positions=[index];
    let cursor=index+1;
    for(;cursor<content.length;cursor++){
      const segment=content[cursor]!;
      if(segment.sourceReference)positions.push(cursor);
      else if(segment.entityId||segment.math||segment.code||segment.href||segment.text===undefined||!/^[^\S\r\n]*$/.test(segment.text))break;
    }
    const seen=new Set<string>();
    const unique=positions.map(position=>content[position]!).filter(segment=>{
      const key=citationKey(segment.sourceReference!);if(seen.has(key))return false;seen.add(key);return true;
    }).sort((left,right)=>compare(left.sourceReference!,right.sourceReference!));
    const last=positions.at(-1)!;
    const same=unique.length===positions.length&&unique.every((segment,i)=>segment===content[positions[i]!]);
    if(same)result.push(...content.slice(index,last+1));
    else {
      changed=true;
      unique.forEach((segment,i)=>{
        if(i)result.push(...content.slice(positions[i-1]!+1,positions[i]!));
        result.push(segment);
      });
    }
    index=last+1;
  }
  return changed?result:content;
}

/** Source attachments implied by citations, including citations in table cells. */
export function citationSourceIds(blocks:Block[]):string[] {
  return [...new Set(blocks.flatMap(block=>blockSegments(block).flatMap(segment=>segment.sourceReference?[segment.sourceReference.sourceId]:segment.bibliographicReference?[segment.bibliographicReference.sourceId]:[])))];
}
