import {blockSegments, type Block} from './domain.js';

export interface PageLinkMatch {source:string;title:string;label:string;index:number}
export function pageLinks(text:string):PageLinkMatch[] {
  return Array.from(text.matchAll(/\[\[([^\[\]\n|]+)(?:\|([^\]\n]*))?\]\]/g)).flatMap(match=>{
    const title=match[1]!.trim();
    return title && title.length<=500 ? [{source:match[0],title,label:match[2]?.trim()||title,index:match.index!}] : [];
  });
}
/** Keep title resolution consistent between the editor and backlink lookup. */
export const pageTitleKey = (title:string) => title.trim().normalize('NFC').toLowerCase();

/** Only syntax rendered as note links contributes to the note graph. */
export function blockPageLinks(blocks:Block[]):PageLinkMatch[] {
  return blocks.flatMap(block=>block.type==='code'||block.type==='divider'||block.type==='math'||block.type==='image' ? [] : blockSegments(block).flatMap(segment=>
    segment.entityId || segment.math || segment.code || segment.href ? [] : pageLinks(segment.text??'')));
}
