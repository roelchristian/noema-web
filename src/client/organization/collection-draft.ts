import type {Collection} from '../../shared/domain';

export interface CollectionDefinitionDraft {
  kind:'manual'|'smart'; matching?:Collection['matching'];
  rule?:Collection['rule'];semantic?:Collection['semantic'];examples?:Collection['examples'];
}
function equalValue(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>equalValue(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equalValue(a[key],b[key]));
}
/** Human metadata edits must never require a currently usable matching index or provider. */
export function collectionDefinitionUnchanged(collection:Collection|undefined,draft:CollectionDefinitionDraft):boolean {
  if(!collection||(collection.kind??'manual')!==draft.kind)return false;
  if(draft.kind==='manual')return true;
  const matching=collection.matching??'rules';
  if(matching!==draft.matching)return false;
  if((matching==='rules'||matching==='hybrid')&&!equalValue(collection.rule,draft.rule))return false;
  if((matching==='semantic'||matching==='hybrid')&&!equalValue(collection.semantic,draft.semantic))return false;
  return matching!=='examples'||equalValue(collection.examples,draft.examples);
}
