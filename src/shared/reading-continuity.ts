import {sourceDocumentEntries,type SourceDocument} from './source-document.js';

/** Canonical coordinates use extracted text with CRLF normalized to LF. */
export interface ReadingAnchor {
 fileId:string;revision:string;offset:number;quote:string;prefix:string;suffix:string;
 nodeId?:string;physicalPage?:number;atEnd:boolean;
}
export type AnchorResolution={status:'resolved';offset:number}|{status:'ambiguous'|'unresolved'};
export interface ReadingLocation {id:string;label:string;anchor:ReadingAnchor;resolution:AnchorResolution}
export interface ReadingContinuity {resume:ReadingLocation|null;bookmarks:ReadingLocation[]}
export const canonicalReadingText=(text:string)=>text.replace(/\r\n?/g,'\n');
export function canonicalReadingOffset(text:string,offset:number){return canonicalReadingText(text.slice(0,offset)).length;}
export function rawReadingOffset(text:string,offset:number){
 let canonical=0;
 for(let raw=0;raw<text.length;raw++){if(canonical===offset)return raw;if(text[raw]==='\r'&&text[raw+1]==='\n')raw++;canonical++;}
 return text.length;
}
export function createReadingAnchor(fileId:string,revision:string,raw:string,rawOffset:number,document?:SourceDocument,atEnd=false):ReadingAnchor {
 const text=canonicalReadingText(raw),offset=canonicalReadingOffset(raw,Math.min(raw.length,Math.max(0,rawOffset)));
 // At EOF retain evidence from the final passage, not an empty quote.
 const start=offset===text.length?Math.max(0,text.length-160):offset,end=Math.min(text.length,start+160);
 const node=document?sourceDocumentEntries(document).filter(({node})=>node.range.startOffset<=start&&node.range.endOffset>start).at(-1)?.node:undefined;
 const page=document?.physical.pages.find(page=>page.range.startOffset<=start&&page.range.endOffset>start);
 return {fileId,revision,offset:start,quote:text.slice(start,end),prefix:text.slice(Math.max(0,start-64),start),suffix:text.slice(end,end+64),nodeId:node?.id,physicalPage:page?.number,atEnd};
}
/** IDs and offsets are hints only after revision changes. Never guess among duplicates. */
export function resolveReadingAnchor(anchor:ReadingAnchor,raw:string,revision:string):AnchorResolution {
 const text=canonicalReadingText(raw),quote=anchor.quote;
 if(!quote.trim())return {status:'unresolved'};
 if(anchor.revision===revision&&text.slice(anchor.offset,anchor.offset+quote.length)===quote)return {status:'resolved',offset:anchor.offset};
 let count=0,first=0,contextCount=0,contextFirst=0;
 for(let start=0;start<=text.length-quote.length;){
  const found=text.indexOf(quote,start);if(found<0)break;count++;first=found;start=found+1;
  if((!anchor.prefix||text.slice(Math.max(0,found-anchor.prefix.length),found)===anchor.prefix)&&(!anchor.suffix||text.slice(found+quote.length,found+quote.length+anchor.suffix.length)===anchor.suffix)){
   contextCount++;contextFirst=found;if(contextCount>1)return {status:'ambiguous'};
  }
 }
 // Short evidence is only safe together with its original context.
 if(contextCount===1&&anchor.prefix.length+anchor.suffix.length+quote.length>=24)return {status:'resolved',offset:contextFirst};
 if(count===1&&quote.trim().length>=24)return {status:'resolved',offset:first};
 return {status:count>1?'ambiguous':'unresolved'};
}
