import type {Block, Segment} from './domain.js';
import {extractTemporal, type TemporalDate} from './temporal.js';
import {pageLinks} from './page-links.js';
import {memoizeBlock} from './immutable-blocks.js';

export interface NoteDateRange {start:number;end:number;date:TemporalDate}
export interface NoteDateItem {id:string;name:string;date:TemporalDate;count:number;position:number}
export function noteDateLabel(date:TemporalDate) {
 const [year,month,day]=date.value.split('-');
 const months='January February March April May June July August September October November December'.split(' ');
 return (month?`${months[Number(month)-1]}${day?` ${Number(day)},`:''} ${year}`:year)+(date.calendar==='julian'?' (Julian)':'');
}
/** Match across formatting, but never across a semantic atom or an explicit exclusion.
 * These ranges decorate authored text; they do not rewrite saved segments. */
export function noteDateRanges(content:Segment[]):NoteDateRange[] {
 const ranges:NoteDateRange[]=[];
 let offset=0,run='',start=0;
 const flush=()=>{
  const links=pageLinks(run);
  for(const expression of extractTemporal(run))if(expression.date&&!links.some(link=>expression.start<link.index+link.source.length&&expression.end>link.index))ranges.push({start:start+expression.start,end:start+expression.end,date:expression.date});
  run='';
 };
 for(const segment of content) {
  const text=segment.text??'';
  if(segment.entityId||segment.math||segment.sourceReference||segment.skipAutoTag||segment.code||segment.href)flush();
  else {if(!run)start=offset;run+=text;}
  offset+=text.length;
 }
 flush();return ranges;
}
const blockDates=memoizeBlock(block=>{
  if(['code','math','divider','image'].includes(block.type))return [];
  const cells=block.type==='table'||block.type==='columns'?(block.rows??[]).flat():[block.content];
  return cells.flatMap(cell=>noteDateRanges(cell).map(range=>range.date));
});
export function noteDateItems(blocks:Block[]):NoteDateItem[] {
 const items=new Map<string,NoteDateItem>();
 for(const block of blocks) {
  for(const date of blockDates(block)) {
   const previous=items.get(date.id);
   if(previous)previous.count++;
   else items.set(date.id,{id:date.id,date,name:noteDateLabel(date),count:1,position:items.size});
  }
 }
 return [...items.values()];
}
