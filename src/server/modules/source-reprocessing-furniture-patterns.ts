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
export function repeatedPageFurniturePatterns(text:string,document:SourceDocument,options:{shortRunningHeaders?:boolean}={}):PageFurnitureCandidate[]{
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
 if(options.shortRunningHeaders&&pages.length>1){
  // A short article can alternate its title and author rather than repeat either
  // line on three pages. Require exact first-page corroboration AND an actual
  // physical-page counter beside the fragment; edge proximity alone is not evidence.
  const first=pages[0]!,metadata=first.lines.slice(0,3).filter(line=>plausible(line.text)&&/[\p{L}]/u.test(line.text)&&!/^\s*(?:theorem|lemma|corollary|proposition|definition|proof|example|remark|exercise|section|chapter)\b/i.test(line.text));
  const number=(page:Page,line:Line)=>{
   const match=/^(?:Page[ \t]+)?(\d+)(?:[ \t]*(?:\/|of)[ \t]*(\d+))?[.]?$/i.exec(line.text);
   return !!match&&Number(match[1])===page.number&&(match[2]===undefined||Number(match[2])===total);
  };
  for(const page of pages.slice(1)){
   const edge=page.lines.slice(0,2);
   for(const original of metadata){
    for(const [index,line] of edge.entries()){
     let header:Line|undefined,counter:Line|undefined;
     if(line.text===original.text&&edge[1-index]&&number(page,edge[1-index]!)){header=line;counter=edge[1-index];}
     else{
      // Retain separate exact ranges when extraction joins the title/byline and
      // counter into one line. Neither range may absorb adjacent substantive text.
      const counterText=`(?:Page[ \t]+)?${page.number}(?:[ \t]*(?:/|of)[ \t]*${total})?`;
      const prefix=new RegExp(`^(${counterText})[ \t]+(${escaped(original.text)})$`,'i').exec(line.text);
      const suffix=new RegExp(`^(${escaped(original.text)})[ \t]+(${counterText})$`,'i').exec(line.text);
      const match=prefix??suffix;
      if(match){
       const fragment=prefix?match[2]!:match[1]!,printed=prefix?match[1]!:match[2]!;
       // Metadata spelling is exact source evidence, never case-folded matching.
       if(fragment!==original.text)continue;
       const at=line.text.indexOf(fragment),pageAt=prefix?0:line.text.length-printed.length;
       header={text:fragment,start:line.start+at,end:line.start+at+fragment.length};
       counter={text:printed,start:line.start+pageAt,end:line.start+pageAt+printed.length};
      }
     }
     if(!header||!counter)continue;
     const reason='Exact first-page title/byline fragment beside the matching physical-page counter on a continuation page; requires independent AI review. The original title/byline stays substantive.';
     for(const fragment of [header,counter]){const item=make(fragment,page.number,'header',reason);result.set(item.id,item);}
    }
   }
  }
  // Repeated running titles do not make the primary title/byline disappear.
  for(const item of result.values())if(item.page===first.number&&metadata.some(line=>line.start===item.startOffset&&line.end===item.endOffset))result.delete(item.id);
 }
 return [...result.values()].sort((a,b)=>a.startOffset-b.startOffset).slice(0,2000);
}
