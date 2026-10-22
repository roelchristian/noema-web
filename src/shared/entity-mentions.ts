import {projectPageText} from './page-text.js';
import type {Block,Page,Segment} from './domain.js';
import type {PageReference} from './embeddings.js';

export interface EntityMentionReference extends PageReference {entityId:string;blockId:string;segmentIndex:number;row?:number;column?:number}
export interface EntityMentionOccurrence {id:string;label:string;reference:EntityMentionReference}
export interface EntityMentionContext {blockId:string;heading:string[];excerpt:string;occurrences:EntityMentionOccurrence[]}

/** Explicit saved segments, in canonical UTF-16 page order. Cell separators match projectPageText. */
export function projectEntityMentions(page:Pick<Page,'id'|'revision'|'blocks'>,entityId:string,name:(id:string)=>string|undefined,projectionHash=''):EntityMentionContext[] {
 const projection=projectPageText(page.blocks,name),contexts:EntityMentionContext[]=[];
 for(let blockIndex=0;blockIndex<page.blocks.length;blockIndex++) {
  const block=page.blocks[blockIndex]!,projected=projection.blocks[blockIndex]!,occurrences:EntityMentionOccurrence[]=[];
  let offset=projected.start;
  const visit=(segments:Segment[],row?:number,column?:number)=>{
   segments.forEach((segment,segmentIndex)=>{
    const label=segment.entityId?segment.mentionText??name(segment.entityId)??'':segment.text??'';
    if(segment.entityId===entityId&&label.length) {
     const id=JSON.stringify([page.id,block.id,row??null,column??null,segmentIndex]);
     occurrences.push({id,label,reference:{pageId:page.id,segmentId:id,revision:page.revision,projectionHash,blockIds:[block.id],blockId:block.id,entityId,segmentIndex,...(row===undefined?{}:{row,column}),startOffset:offset,endOffset:offset+label.length,excerpt:label}});
    }
    offset+=label.length;
   });
  };
  if(block.type==='table'||block.type==='columns') (block.rows??[]).forEach((row,rowIndex)=>{if(rowIndex)offset++;row.forEach((cell,columnIndex)=>{if(columnIndex)offset+=3;visit(cell,rowIndex,columnIndex);});});
  else visit(block.content);
  let nearby:EntityMentionOccurrence[]=[];
  const flush=()=>{if(!nearby.length)return;contexts.push({blockId:block.id,heading:projected.heading,excerpt:contextExcerpt(projected.text,nearby[0]!.reference.startOffset-projected.start,nearby[nearby.length-1]!.reference.endOffset-projected.start),occurrences:nearby});nearby=[];};
  for(const occurrence of occurrences) {
   if(nearby.length&&(occurrence.reference.startOffset-nearby[nearby.length-1]!.reference.endOffset>120||occurrence.reference.endOffset-nearby[0]!.reference.startOffset>320))flush();
   nearby.push(occurrence);
  }
  flush();
 }
 return contexts;
}

function contextExcerpt(text:string,start:number,end:number):string {
 let from=Math.max(0,start-90),to=Math.min(text.length,end+110);
 // UTF-16 offsets locate segments; display snippets must not split astral code points.
 if(from>0&&/[\uDC00-\uDFFF]/.test(text[from]!))from--;
 if(to<text.length&&/[\uD800-\uDBFF]/.test(text[to-1]!))to++;
 return `${from?'…':''}${text.slice(from,to).trim()}${to<text.length?'…':''}`;
}

/** Locate the saved segment without searching text, so repeated labels cannot collide. */
export function entityMentionSegments(block:Block,reference:EntityMentionReference):Segment[]|undefined {
 if(block.type==='table'||block.type==='columns') {
  if(!Number.isInteger(reference.row)||!Number.isInteger(reference.column)||reference.row!<0||reference.column!<0)return;
  return block.rows?.[reference.row!]?.[reference.column!];
 }
 if(reference.row!==undefined||reference.column!==undefined)return;
 return block.content;
}
