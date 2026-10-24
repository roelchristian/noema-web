import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';

export interface PageFurnitureCandidate {id:string;startOffset:number;endOffset:number;page:number;text:string;hidden:boolean;reason:string}
/** Repeated boundary lines are suggestions, never proof that printed content is expendable.
 * These coordinates are presentation metadata over the immutable canonical snapshot. */
export function detectPageFurniture(text:string,document:SourceDocument):PageFurnitureCandidate[]{
 const boundaries:{start:number;end:number;page:number;text:string;side:'first'|'last'}[]=[];
 for(const page of document.physical.pages){
  const lines=[...text.slice(page.range.startOffset,page.range.endOffset).matchAll(/[^\r\n]+/g)].filter(match=>match[0].trim()&&!/^<!--\s*Page\s+\d+\s*-->$/i.test(match[0].trim()));
  for(const [side,line] of [['first',lines[0]],['last',lines.at(-1)]] as const){if(!line||line[0].trim().length>120)continue;const start=page.range.startOffset+line.index!;boundaries.push({start,end:start+line[0].length,page:page.number,text:line[0],side});}
 }
 return boundaries.filter((line,index)=>boundaries.findIndex(other=>other.start===line.start)===index&&new Set(boundaries.filter(other=>other.side===line.side&&other.text.trim()===line.text.trim()).map(other=>other.page)).size>=3).map(line=>({id:'furniture-'+createHash('sha256').update(`${line.start}:${line.end}:${line.text}`).digest('hex').slice(0,24),startOffset:line.start,endOffset:line.end,page:line.page,text:line.text,hidden:false,reason:'Repeated exact boundary line on at least three physical pages; review before hiding.'}));
}
/** Apply only explicitly hidden exact candidates to a presentation string. Never store this
 * result as canonical extraction or use its offsets for citation anchoring. */
export function presentWithoutFurniture(text:string,candidates:PageFurnitureCandidate[]):string{
 let output=text;const hidden=candidates.filter(item=>item.hidden).sort((a,b)=>b.startOffset-a.startOffset);let next=text.length;
 for(const item of hidden){if(item.startOffset<0||item.endOffset>next||item.endOffset<=item.startOffset||text.slice(item.startOffset,item.endOffset)!==item.text)throw new Error('Furniture presentation evidence no longer matches the canonical snapshot.');output=output.slice(0,item.startOffset)+output.slice(item.endOffset);next=item.startOffset;}
 return output;
}
