import {blockSegments, type Block} from './domain.js';

export interface PageLinkMatch {source:string;title:string;label:string;index:number;pageId?:string}
export function pageLinks(text:string):PageLinkMatch[] {
  return Array.from(text.matchAll(/\[\[([^\[\]\n|]+)(?:\|([^\]\n]*))?\]\]/g)).flatMap(match=>{
    const title=match[1]!.trim();
    return title && title.length<=500 ? [{source:match[0],title,label:match[2]?.trim()||title,index:match.index!,...(/^page:[a-zA-Z0-9_-]+$/.test(title)?{pageId:title.slice(5)}:{})}] : [];
  });
}
/** Keep title resolution consistent between the editor and backlink lookup. */
export const pageTitleKey = (title:string) => title.trim().normalize('NFC').toLowerCase();

/** Only syntax rendered as note links contributes to the note graph. */
export function blockPageLinks(blocks:Block[]):PageLinkMatch[] {
  return blocks.flatMap(block=>block.type==='code'||block.type==='divider'||block.type==='math'||block.type==='image' ? [] : blockSegments(block).flatMap(segment=>
    segment.entityId || segment.math || segment.code || segment.href ? [] : pageLinks(segment.text??'')));
}

/** Explicit IDs take priority; legacy titles are valid only when unique. */
export function resolvePageLink<T extends {id:string;title:string}>(link:Pick<PageLinkMatch,'title'|'pageId'>,pages:T[]):T[] {
  return link.pageId?pages.filter(page=>page.id===link.pageId):pages.filter(page=>pageTitleKey(page.title)===pageTitleKey(link.title));
}
export function stablePageLink(id:string,label:string):string {return '[[page:'+id+'|'+label.replace(/[\[\]\n|]/g,' ')+']]';}
/** Backups remap IDs without rewriting legacy title references or display labels. */
export function remapPageLinks(text:string,map:(id:string)=>string):string {
  return text.replace(/\[\[page:([a-zA-Z0-9_-]+)(\|[^\]\n]*)?\]\]/g,(_source,id,label)=>'[[page:'+map(id)+(label??'')+']]');
}
