import type {Segment} from '../../shared/domain.js';

/** Locate explicit LaTeX only; currency, code, and unfinished delimiters stay literal. */
export function sourcePageMathRanges(text:string) {
  const pattern=/(`+)[\s\S]*?\1|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?!\$)/g;
  return Array.from(text.matchAll(pattern)).flatMap(match=>{
    const source=(match[2]??match[3])?.trim();
    return source?[{start:match.index!,end:match.index!+match[0].length,source}]:[];
  });
}

export function sourcePageMathSegments(text:string):Segment[] {
  const segments:Segment[]=[];let offset=0;
  for(const range of sourcePageMathRanges(text)) {
    if(range.start>offset)segments.push({text:text.slice(offset,range.start)});
    segments.push({text:range.source,math:true});offset=range.end;
  }
  if(offset<text.length)segments.push({text:text.slice(offset)});
  return segments;
}

export function sourcePageDisplayMath(text:string):string {
  const match=text.trim().match(/^\$\$([\s\S]*?)\$\$$|^\\\[([\s\S]*?)(?<!\\)\\\]$/);
  return (match?.[1]??match?.[2]??text).trim();
}
