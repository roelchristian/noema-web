export interface HighlightPart {text:string;match:boolean}
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Literal matching only: note content is never interpreted as HTML or a regex. */
export function matchingRanges(text:string,query:string):Array<{start:number;end:number}> {
  const phrase=query.trim();if(!phrase)return [];
  const terms=[...new Set(phrase.match(/[\p{L}\p{N}]+/gu)??[])].filter(term=>term.length>=2);
  const patterns=[escape(phrase),...terms.filter(term=>term!==phrase).map(term=>`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`)];
  const expression=new RegExp(patterns.join('|'),'giu'),ranges=[];
  for(const match of text.matchAll(expression)){ranges.push({start:match.index,end:match.index+match[0].length});if(ranges.length>=1000)break;}
  return ranges;
}
export function highlightParts(text:string,query:string):HighlightPart[] {
  let cursor=0;const parts:HighlightPart[]=[];
  for(const range of matchingRanges(text,query)){
    if(range.start>cursor)parts.push({text:text.slice(cursor,range.start),match:false});
    parts.push({text:text.slice(range.start,range.end),match:true});cursor=range.end;
  }
  if(cursor<text.length)parts.push({text:text.slice(cursor),match:false});
  return parts;
}
/** Pick a bounded excerpt near the phrase, or the densest literal term overlap. */
export function makeSearchSnippet(input:string,query:string,maxLength=240):string {
  const text=input.replace(/\s+/gu,' ').trim();if(text.length<=maxLength)return text;
  const ranges=matchingRanges(text,query),phrase=query.trim();
  let anchor=ranges.find(range=>text.slice(range.start,range.end).toLocaleLowerCase()===phrase.toLocaleLowerCase())?.start;
  if(anchor===undefined&&ranges.length){
    let best=-1,right=0;
    for(let left=0;left<ranges.length;left++){
      while(right<ranges.length&&ranges[right].end-ranges[left].start<maxLength-30)right++;
      const score=right-left;if(score>best){best=score;anchor=ranges[left].start;}
    }
  }
  let start=Math.max(0,(anchor??0)-60);if(start===0||anchor===undefined)start=0;
  // Reserve room for omission marks, and avoid splitting words or surrogate pairs.
  const budget=maxLength-2;
  if(start>0){const boundary=text.indexOf(' ',start);if(boundary>=0&&boundary<=(anchor??0))start=boundary+1;}
  if(start>0&&/[\uDC00-\uDFFF]/.test(text[start]))start++;
  let end=Math.min(text.length,start+budget);
  if(end<text.length){const boundary=text.lastIndexOf(' ',end);if(boundary>start+budget/2)end=boundary;}
  if(end>start&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
  return (start>0?'…':'')+text.slice(start,end).trim()+(end<text.length?'…':'');
}
