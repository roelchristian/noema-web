import type {Block,Segment} from './domain.js';

export interface ProjectedBlock {id:string;type:Block['type'];text:string;start:number;end:number;heading:string[]}
export interface PageProjection {text:string;blocks:ProjectedBlock[]}
/** Canonical saved editor text. Offsets are UTF-16 offsets, never rendered HTML. */
export function projectPageText(blocks:Block[],name:(id:string)=>string|undefined):PageProjection {
 const inline=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??name(segment.entityId)??'':segment.text??'').join('');
 const projected:ProjectedBlock[]=[],headings:string[]=[];
 let text='';
 for(const block of blocks) {
  const value=block.type==='table'||block.type==='columns'?(block.rows??[]).map(row=>row.map(inline).join(' | ')).join('\n'):block.type==='image'?[inline(block.content),block.alt??''].filter(Boolean).join('\n'):inline(block.content);
  if(block.type==='heading1'){headings.length=0;headings.push(value);}
  else if(block.type==='heading2'){headings.length=Math.min(1,headings.length);headings.push(value);}
  if(projected.length)text+='\n';
  const start=text.length;text+=value;
  projected.push({id:block.id,type:block.type,text:value,start,end:text.length,heading:[...headings]});
 }
 return {text,blocks:projected};
}
