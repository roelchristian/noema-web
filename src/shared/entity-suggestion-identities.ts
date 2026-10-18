import {normalizeEntityName} from './auto-entities.js';
import type {EntitySuggestion} from './entity-scan.js';

/** Reciprocal name/alias claims identify one proposal, not two new entities.
 * First suggestion wins; an explicit saved identity takes precedence. Shared
 * aliases alone never establish identity, and distinct saved IDs never merge.
 */
export function mergeSuggestionIdentities(input:EntitySuggestion[]):EntitySuggestion[] {
  const parents=input.map((_,i)=>i),savedIds=input.map(s=>s.existingId);
  const root=(index:number):number=>parents[index]===index?index:root(parents[index]!);
  const hasAlias=(suggestion:EntitySuggestion,name:string)=>suggestion.aliases?.some(alias=>normalizeEntityName(alias)===normalizeEntityName(name));
  for(let i=0;i<input.length;i++)for(let j=i+1;j<input.length;j++) {
    const first=input[i]!,next=input[j]!,a=root(i),b=root(j);
    if(a===b||first.type!==next.type||savedIds[a]&&savedIds[b]&&savedIds[a]!==savedIds[b])continue;
    if(!hasAlias(first,next.name)||!hasAlias(next,first.name))continue;
    const keep=Math.min(a,b),remove=Math.max(a,b);
    parents[remove]=keep;savedIds[keep]=savedIds[a]??savedIds[b]??null;
  }
  const groups=new Map<number,EntitySuggestion[]>();
  input.forEach((suggestion,i)=>{const key=root(i),group=groups.get(key)??[];group.push(suggestion);groups.set(key,group);});
  return [...groups.values()].map(group=>{
    if(group.length===1)return {...group[0]!};
    const winner=group.find(s=>s.existingId)??group[0]!;
    const aliases=new Map<string,string>();
    for(const name of [...(winner.aliases??[]),...group.flatMap(s=>[s.name,...(s.aliases??[])])]) {
      const key=normalizeEntityName(name);
      if(key!==normalizeEntityName(winner.name)&&!aliases.has(key))aliases.set(key,name);
    }
    return {...winner,aliases:[...aliases.values()].slice(0,20),
      subtypes:winner.existingId?winner.subtypes:[...new Set(group.flatMap(s=>s.subtypes??[]))],
      proposedSubtypeIds:winner.existingId?[]:[...new Set(group.flatMap(s=>s.proposedSubtypeIds??[]))],
      domainIds:winner.type!=='concept'?[]:winner.existingId?winner.domainIds:[...new Set(group.flatMap(s=>s.domainIds??[]))].slice(0,20),
    };
  });
}
