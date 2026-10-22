import type {Entity, Page, Segment} from '../../shared/domain';
import type {EvidenceAnchor} from '../../shared/entity-scan';

export function reviewSegmentText(segments:Segment[],entities:Entity[]=[]):string {
  return segments.map(segment=>segment.text??segment.mentionText??entities.find(entity=>entity.id===segment.entityId)?.name??'').join('');
}

/** Locate visible mentions, merging overlapping canonical-name and alias matches. */
export function reviewMentionAnchors(page:Pick<Page,'blocks'>,names:string[],entities:Entity[]=[]):EvidenceAnchor[] {
  const terms=[...new Set(names.map(name=>name.trim()).filter(Boolean))];
  if(!terms.length)return [];
  const pattern=terms.sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+').replace(/['‘’]/g,"['‘’]")).join('|');
  const matcher=new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`,'giu');
  return page.blocks.flatMap(block=>{
    const locate=(segments:Segment[],row?:number,col?:number)=>[...reviewSegmentText(segments,entities).matchAll(matcher)].map(match=>({blockId:block.id,start:match.index!,end:match.index!+match[0].length,...(row===undefined?{}:{row,col})}));
    return block.rows?block.rows.flatMap((row,r)=>row.flatMap((cell,c)=>locate(cell,r,c))):locate(block.content);
  });
}
export function reviewMentionCount(page:Pick<Page,'blocks'>,names:string[],entities:Entity[]=[]):number {
  return reviewMentionAnchors(page,names,entities).length;
}

/** Merge overlapping windows so nearby mentions share their surrounding context. */
export function reviewContextWindows(matches:boolean[],radius=1):Array<{start:number;end:number}> {
  const windows:Array<{start:number;end:number}>=[];
  matches.forEach((matched,index)=>{
    if(!matched)return;
    const start=Math.max(0,index-radius),end=Math.min(matches.length,index+radius+1),last=windows.at(-1);
    if(last&&start<=last.end)last.end=Math.max(last.end,end);
    else windows.push({start,end});
  });
  return windows;
}
