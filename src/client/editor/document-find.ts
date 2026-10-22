import {pageLinks} from '../../shared/page-links';
import {entityMentionName, type Block, type Entity, type Segment} from '../../shared/domain';
export interface FindSurface {blockId:string; surface:number; text:string; segments:Segment[]; spans:{start:number;end:number;protected:boolean;entityId?:string}[]}
export interface FindMatch {surface:number;start:number;end:number;replacement?:string;protected:boolean}
export interface FindOptions {query:string;regex:boolean;caseSensitive:boolean;wholeWord:boolean;replacement:string}
export interface FindResult {matches:FindMatch[];error?:string;truncated?:boolean;zeroWidth?:boolean}
const cache=new WeakMap<Block,Map<string,FindSurface[]>>();
/** Body-only addresses; table cells never share offsets. Atoms are searchable but immutable. */
export function findSurfaces(blocks:Block[],entities:Entity[]):FindSurface[] {
 const names=new Map(entities.map(e=>[e.id,entityMentionName(e)??e.name])); const key=JSON.stringify([...names]);
 return blocks.flatMap(block=>{
  let cached=cache.get(block)?.get(key); if(cached)return cached;
  if(['image','divider','columns'].includes(block.type))return [];
  const cells=block.type==='table'?(block.rows??[]).flat():[block.content];
  cached=cells.map((segments,surface)=>{let text='';const spans=segments.map(s=>{const start=text.length;text+=s.entityId?(s.mentionText??names.get(s.entityId)??'Unknown entity'):(s.text??'');return {start,end:text.length,protected:!!(s.entityId||s.math||s.sourceReference||block.type==='math'),entityId:s.entityId};});return {blockId:block.id,surface,text,segments,spans};});
  // Keep only the current entity-name projection for each immutable block.
  cache.set(block,new Map([[key,cached]])); return cached;
 });
}
export function searchSurfaces(surfaces:FindSurface[],options:FindOptions):FindResult {
 const matches:FindMatch[]=[]; if(!options.query)return {matches};
 if(options.query.length>1000)return {matches,error:'Pattern exceeds 1,000 characters.'};
 let pattern:RegExp;try{pattern=new RegExp(options.regex?options.query:options.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gu'+(options.caseSensitive?'':'i'));}catch{return {matches,error:'Invalid regular expression.'};}
 const word=(s:string)=>/[\p{L}\p{N}\p{M}_]/u.test(s);
 let zeroWidth=false;
 for(let surface=0;surface<surfaces.length;surface++){
  const item=surfaces[surface]!;pattern.lastIndex=0;let m:RegExpExecArray|null;
  while((m=pattern.exec(item.text))){
   if(!m[0].length){zeroWidth=true;pattern.lastIndex+=item.text.codePointAt(pattern.lastIndex)!>0xffff?2:1;continue;}
   const start=m.index,end=start+m[0].length;
   if(options.wholeWord&&(word(item.text.slice(Math.max(0,start-2),start).match(/.$/u)?.[0]??'')||word(String.fromCodePoint(item.text.codePointAt(end)??32))))continue;
   // Replacement syntax intentionally supports $$, $&, $1..$99 and named captures only.
   const replacement=options.regex?options.replacement.replace(/\$\$|\$&|\$<([^>]+)>|\$(\d{1,2})/g,(token,name,index)=>token==='$$'?'$':token==='$&'?m![0]:name!==undefined?(m!.groups?.[name]??token):Number(index)>0&&Number(index)<m!.length?(m![Number(index)]??''):token):options.replacement;
   matches.push({surface,start,end,replacement,protected:item.spans.some((s,i)=>s.start<end&&s.end>start&&(s.protected||(!item.segments[i]!.href&&!item.segments[i]!.code&&pageLinks(item.segments[i]!.text??'').some(link=>s.start+link.index<end&&s.start+link.index+link.source.length>start))))||new Set(item.spans.flatMap((s,i)=>s.start<end&&s.end>start?[item.segments[i]!.href??'']:[])).size>1});
   if(matches.length>=2000)return {matches,truncated:true,zeroWidth};
  }
 }
 return {matches,zeroWidth};
}
/** Caller must reject stale result snapshots. Inherit replacement style from first run;
 * reject mixed link boundaries so a replacement cannot silently change link meaning. */
export function replaceMatches(blocks:Block[],surfaces:FindSurface[],matches:FindMatch[]):{blocks:Block[];replaced:number;skipped:number} {
 const updates=new Map<string,Map<number,Segment[]>>();let replaced=0,skipped=0;
 const groups=new Map<number,FindMatch[]>();for(const m of matches){const list=groups.get(m.surface)??[];list.push(m);groups.set(m.surface,list);}
 for(const [index,list] of groups){const surface=surfaces[index]!;const current=blocks.find(block=>block.id===surface.blockId);const content=current?.type==='table'?current.rows?.flat()[surface.surface]:current?.content;
  if(content!==surface.segments){skipped+=list.length;continue;}
  let segments=surface.segments;let spans=surface.spans;const lengths=new Map(surface.segments.map((segment,i)=>[segment,surface.spans[i]!.end-surface.spans[i]!.start]));
  for(const m of list.sort((a,b)=>b.start-a.start)){
   const intersect=spans.map((s,i)=>({...s,i})).filter(s=>s.start<m.end&&s.end>m.start);
   if(m.protected||!intersect.length||new Set(intersect.map(s=>segments[s.i]!.href??'')).size>1){skipped++;continue;}
   if(m.replacement===surface.text.slice(m.start,m.end)){replaced++;continue;}
   const first=intersect[0]!,last=intersect.at(-1)!;const before=segments[first.i]!,after=segments[last.i]!;
   const replacement:Segment[]=[];
   if(m.start>first.start)replacement.push({...before,text:before.text!.slice(0,m.start-first.start)} as Segment);
   if(m.replacement)replacement.push({...before,text:m.replacement} as Segment);
   if(m.end<last.end)replacement.push({...after,text:after.text!.slice(m.end-last.start)} as Segment);
   segments=[...segments.slice(0,first.i),...replacement,...segments.slice(last.i+1)];replaced++;
   // Subsequent matches use original run indexes; rebuild their addressing below.
   const remaining=list.filter(other=>other.start<m.start);
   if(remaining.length){let offset=0;spans=segments.map(segment=>{const length=segment.text?.length??lengths.get(segment)??0;const start=offset;offset+=length;return {start,end:offset,protected:!!(segment.entityId||segment.math||segment.sourceReference)};});}
  }
  if(segments===surface.segments)continue;
  const map=updates.get(surface.blockId)??new Map();map.set(surface.surface,segments);updates.set(surface.blockId,map);
 }
 return {blocks:blocks.map(block=>{const map=updates.get(block.id);if(!map)return block;if(block.type!=='table')return {...block,content:map.get(0)??block.content};let i=0;return {...block,rows:block.rows?.map(row=>row.map(cell=>map.get(i++)??cell))};}),replaced,skipped};
}
