import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';
import type {PageFurnitureCandidate} from './source-reprocessing-furniture.js';

type Kind='header'|'footer';
interface Line {text:string;start:number;end:number}
interface Page {number:number;start:number;end:number;lines:Line[]}
const make=(line:Line,page:number,kind:Kind,reason:string):PageFurnitureCandidate=>({id:'furniture-'+createHash('sha256').update(`${line.start}:${line.end}:${line.text}`).digest('hex').slice(0,24),startOffset:line.start,endOffset:line.end,page,text:line.text,kind,hidden:false,reason});
const escaped=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plausible=(text:string)=>text.length>0&&text.length<=240&&!/^\s*(?:\[\^|\d+[.)]\s)/.test(text)&&!/[.!?;:]$/.test(text)&&text.split(/\s+/).length<=24;

/** Repeated source fragments nominate metadata for AI review. Numeric templates
 * vary only an explicitly printed physical-page counter; case IDs and dates stay exact. */
export function repeatedPageFurniturePatterns(text:string,document:SourceDocument):PageFurnitureCandidate[]{
 const pages:Page[]=document.physical.pages.map(page=>{
  const raw=text.slice(page.range.startOffset,page.range.endOffset),marker=/^\s*<!--\s*Page\s+\d+\s*-->\s*/i.exec(raw),bodyStart=page.range.startOffset+(marker?.[0].length??0);
  const lines=[...text.slice(bodyStart,page.range.endOffset).matchAll(/[^\r\n]+/g)].flatMap(match=>{
   const clean=match[0].trim().replace(/\uFFFC+$/u,'').trimEnd();if(!clean)return [];
   const start=bodyStart+match.index!+match[0].indexOf(clean);return [{text:clean,start,end:start+clean.length}];
  });
  return {number:page.number,start:bodyStart,end:page.range.endOffset,lines};
 });
 const total=document.physical.pageCount??pages.length,result=new Map<string,PageFurnitureCandidate>(),templates=new Map<string,{kind:Kind;before:string;after:string}>(),exact=new Map<string,{kind:Kind;items:{page:number;line:Line}[]}>();
 for(const page of pages)for(const kind of ['header','footer'] as const){
  const selected=kind==='header'?page.lines.slice(0,3):page.lines.slice(-3).reverse();
  for(const [ordinal,line] of selected.entries()){
   if(!plausible(line.text))continue;
   const key=JSON.stringify([kind,ordinal,line.text]),group=exact.get(key)??{kind,items:[]};group.items.push({page:page.number,line});exact.set(key,group);
   // Counter syntax supplies both physical number and document page count.
   // Digit boundaries keep a docket/date fragment from becoming a page counter.
   const counters=[...line.text.matchAll(/\b(?:Page\s+)?(\d+)\s*(?:\/|of)\s*(\d+)\b/gi)];
   for(const counter of counters){
    if(Number(counter[1])!==page.number||Number(counter[2])!==total)continue;
    const numberAt=counter.index!+counter[0].indexOf(counter[1]!),before=line.text.slice(0,numberAt),after=line.text.slice(numberAt+counter[1]!.length);
    templates.set(JSON.stringify([kind,before,after]),{kind,before,after});
   }
  }
 }
 for(const {kind,items} of exact.values())if(new Set(items.map(item=>item.page)).size>=3)for(const {line,page} of items){
  const item=make(line,page,kind,'Exact boundary line repeated at the same page-edge position on at least three physical pages; requires AI review.');
  // A short page may put the same line at both edges. Keep its first nomination.
  if(!result.has(item.id))result.set(item.id,item);
 }
 for(const {kind,before,after} of templates.values()){
  const matches:{page:number;line:Line}[]=[];
  for(const page of pages){
   const fragment=before+String(page.number)+after,raw=text.slice(page.start,page.end);
   const pattern=kind==='header'?new RegExp('^\\s*'+escaped(fragment)+'(?=$|\\s|\\uFFFC)'):new RegExp(escaped(fragment)+'(?:\\uFFFC)*\\s*$');
   const match=pattern.exec(raw);if(!match)continue;
   const start=page.start+match.index+match[0].indexOf(fragment);matches.push({page:page.number,line:{text:fragment,start,end:start+fragment.length}});
  }
  if(new Set(matches.map(item=>item.page)).size<3)continue;
  for(const {page,line} of matches){const item=make(line,page,kind,'Printed physical-page counter and exact surrounding text corroborated at the physical page edge on at least three pages; requires AI review.');result.set(item.id,item);}
 }
 return [...result.values()].sort((a,b)=>a.startOffset-b.startOffset).slice(0,2000);
}
