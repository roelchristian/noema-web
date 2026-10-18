import {Fragment,memo,useMemo} from 'react';
import {highlightParts} from '../../shared/search-snippets';
import {renderMath} from '../editor/math';

type TitlePart={text:string;math?:string};
/** Match the editor's LaTeX delimiters; keep code examples and ordinary prices literal. */
function titleParts(text:string):TitlePart[] {
  const expressions=/(`+)([\s\S]*?)\1|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
  const parts:TitlePart[]=[];let start=0;
  for(const match of text.matchAll(expressions)) {
    const math=(match[3]??match[4]??match[5]??match[6])?.trim();
    if(!math)continue;
    if(match.index!>start)parts.push({text:text.slice(start,match.index)});
    parts.push({text:match[0],math});start=match.index!+match[0].length;
  }
  if(start<text.length)parts.push({text:text.slice(start)});
  return parts;
}
export function titleHasMath(text:string) {return titleParts(text).some(part=>part.math);}

/** Titles stay plain strings in storage; only their presentation interprets math. */
export const TitleText=memo(function TitleText({text,query=''}:{text:string;query?:string}) {
  const parts=useMemo(()=>titleParts(text),[text]);
  return <>{parts.map((part,index)=>{
    if(part.math) {
      // Titles always use inline layout, including when pasted with display delimiters.
      try {return <span key={index} className="title-math" dangerouslySetInnerHTML={{__html:renderMath(part.math)}}/>;}
      catch {return <Fragment key={index}>{part.text}</Fragment>;}
    }
    return <Fragment key={index}>{highlightParts(part.text,query).map((chunk,i)=>chunk.match?<mark className="search-highlight" key={i}>{chunk.text}</mark>:chunk.text)}</Fragment>;
  })}</>;
});
