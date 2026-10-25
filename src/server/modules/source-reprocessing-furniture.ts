import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';

export interface PageFurnitureCandidate {id:string;startOffset:number;endOffset:number;page:number;text:string;kind?:'header'|'footer';hidden:boolean;reason:string}
const candidate=(startOffset:number,endOffset:number,page:number,text:string,kind:'header'|'footer',reason:string):PageFurnitureCandidate=>({id:'furniture-'+createHash('sha256').update(`${startOffset}:${endOffset}:${text}`).digest('hex').slice(0,24),startOffset,endOffset,page,text,kind,hidden:false,reason});
/** Only physical page edges can support a furniture annotation. Keep exact source
 * ranges even when a header contains a changing date, page number or case number. */
export function pageFurnitureBoundaries(text:string,document:SourceDocument):PageFurnitureCandidate[]{
 const result:PageFurnitureCandidate[]=[];
 for(const page of document.physical.pages){
  const lines=[...text.slice(page.range.startOffset,page.range.endOffset).matchAll(/[^\r\n]+/g)].filter(match=>match[0].trim()&&!/^<!--\s*Page\s+\d+\s*-->$/i.test(match[0].trim()));
  for(const [kind,selected] of [['header',lines.slice(0,3)],['footer',lines.slice(-3)]] as const)for(const line of selected){
   // Footnote definitions and long body lines are not page furniture candidates.
   if(line[0].trim().length>240||/^\s*\[\^|^\s*\d+[.)]\s/.test(line[0]))continue;
   const start=page.range.startOffset+line.index!;
   result.push(candidate(start,start+line[0].length,page.number,line[0],kind,'Physical page boundary; classification requires review.'));
  }
 }
 return result;
}
/** Repetition identifies candidates, never authorizes deleting their text. Normalize
 * changing numeric fields, while keeping words and punctuation as matching evidence. */
export function detectPageFurniture(text:string,document:SourceDocument):PageFurnitureCandidate[]{
 const boundaries=pageFurnitureBoundaries(text,document),seen=new Set<string>();
 const signature=(value:string)=>value.trim().replace(/\d+/g,'#').replace(/\s+/g,' ').toLocaleLowerCase('en');
 const counts=new Map<string,Set<number>>(),exactCounts=new Map<string,Set<number>>();
 for(const item of boundaries){const key=item.kind+':'+signature(item.text),pages=counts.get(key)??new Set<number>();pages.add(item.page);counts.set(key,pages);const exactKey=item.kind+':'+item.text.trim(),exactPages=exactCounts.get(exactKey)??new Set<number>();exactPages.add(item.page);exactCounts.set(exactKey,exactPages);}
 return boundaries.filter(item=>{
  if(seen.has(item.id))return false;
  const sig=signature(item.text),pages=counts.get(item.kind+':'+sig)!;
  // Short pure page labels are recognizable; other varying lines need words.
  const pageLabel=/^(?:page\s+)?#(?:\s*(?:\/|of|–|-)\s*#)?[.]?$/i.test(sig);
  const exactPages=exactCounts.get(item.kind+':'+item.text.trim())!;
  // Numeric similarity alone must not classify ordinary sentences as furniture.
  // Exact repetition and explicit page labels remain eligible; uncertain prose
  // can still be classified through the separately source-checked model path.
  if(pages.size<3||!pageLabel&&exactPages.size<3&&((sig.match(/\p{L}/gu)?.length??0)<12||/[.!?;:]$/.test(item.text.trim())))return false;
  seen.add(item.id);return true;
 }).slice(0,2000).map(item=>({...item,reason:`Repeated ${item.kind} pattern on at least three physical pages; changing numeric fields are preserved. Review before hiding.`}));
}
/** AI classifications must quote one unique canonical block occurrence and match a
 * real physical boundary. Unsupported classifications are reported, never applied. */
export function parsePageFurniture(response:unknown,chunk:PlannedReprocessingChunk,text:string,document:SourceDocument):{candidates:PageFurnitureCandidate[];diagnostics:string[]}{
 const value=(response as {pageFurniture?:unknown})?.pageFurniture;
 if(value===undefined)return {candidates:[],diagnostics:[]};
 const candidates:PageFurnitureCandidate[]=[],diagnostics:string[]=[],boundaries=pageFurnitureBoundaries(text,document);
 if(!Array.isArray(value)||value.length>100)return {candidates,diagnostics:['Page header/footer classifications were ignored because the response was malformed.']};
 for(const entry of value){
  const item=entry as {blockId?:unknown;quote?:unknown;kind?:unknown};
  const block=chunk.blocks.find(block=>block.id===item?.blockId);
  if(!block||typeof item?.quote!=='string'||!item.quote.trim()||!['header','footer'].includes(String(item.kind))){diagnostics.push('An unsupported page header/footer classification was ignored.');continue;}
  const quote=item.quote,at=block.text.indexOf(quote);
  const boundary=at<0||block.text.indexOf(quote,at+1)!==-1?undefined:boundaries.find(boundary=>boundary.startOffset===block.start+at&&boundary.endOffset===block.start+at+quote.length&&boundary.kind===item.kind);
  if(!boundary){diagnostics.push('A page header/footer classification did not uniquely match an exact physical boundary and was ignored.');continue;}
  if(!candidates.some(candidate=>candidate.id===boundary.id))candidates.push({...boundary,reason:`AI-classified page ${boundary.kind}; exact canonical boundary text retained for review.`});
 }
 return {candidates,diagnostics};
}
/** Apply only explicitly hidden exact candidates to a presentation string. Never store this
 * result as canonical extraction or use its offsets for citation anchoring. */
export function presentWithoutFurniture(text:string,candidates:PageFurnitureCandidate[]):string{
 let output=text;const hidden=candidates.filter(item=>item.hidden).sort((a,b)=>b.startOffset-a.startOffset);let next=text.length;
 for(const item of hidden){if(item.startOffset<0||item.endOffset>next||item.endOffset<=item.startOffset||text.slice(item.startOffset,item.endOffset)!==item.text)throw new Error('Furniture presentation evidence no longer matches the canonical snapshot.');output=output.slice(0,item.startOffset)+output.slice(item.endOffset);next=item.startOffset;}
 return output;
}
