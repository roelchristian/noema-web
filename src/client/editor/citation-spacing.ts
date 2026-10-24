import type {Segment} from '../../shared/domain';

export const citationSpace='\u2009';
const plain=(segment:Segment):segment is Extract<Segment,{text:string}>=>!segment.entityId&&!segment.sourceReference&&!segment.bibliographicReference&&!segment.math&&!segment.code&&!segment.href;

/** Discard only the thin-space padding immediately after a block's final citation. */
export function trimTrailingCitationSpace(content:Segment[]):Segment[] {
  let index=content.length-1;
  while(index>=0&&plain(content[index]!)&&/^[\u2009]*$/.test(content[index]!.text??''))index--;
  return content[index]?.sourceReference&&index<content.length-1?content.slice(0,index+1):content;
}

/** Enter can split between a citation and its padding; don't carry it into the new block. */
export function trimLeadingCitationSpace(content:Segment[]):Segment[] {
  const result=[...content];
  while(result.length){
    const segment=result[0]!;if(!plain(segment))break;
    const text=segment.text.replace(/^\u2009+/,'');
    if(text===(segment.text??''))break;
    if(text){result[0]={...segment,text};break;}
    result.shift();
  }
  return result;
}
