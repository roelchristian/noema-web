import {highlightParts} from '../../shared/search-snippets';
export function HighlightedText({text,query}:{text:string;query:string}) {
  return <>{highlightParts(text,query).map((part,index)=>part.match?<mark className="search-highlight" key={index}>{part.text}</mark>:part.text)}</>;
}
