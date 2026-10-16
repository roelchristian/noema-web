import type {SemanticSearchResult} from '../../shared/embeddings';
interface SearchItem {id:string;kind:'page'|'entity';name:string}
/** Match only the supplied (already scoped) items, retaining text matches first. */
export function combinedMatches<T extends SearchItem>(items:T[],query:string,semantic:SemanticSearchResult[]):T[] {
  const term=query.trim().toLowerCase();if(!term)return items;
  const scores=new Map(semantic.map(result=>[result.id,result.score]));
  const text=(item:T)=>item.name.toLowerCase().includes(term);
  return items.filter(item=>text(item)||(item.kind==='page'&&scores.has(item.id)))
    .sort((a,b)=>Number(text(b))-Number(text(a))||(text(a)?0:(scores.get(b.id)??-1)-(scores.get(a.id)??-1)));
}
