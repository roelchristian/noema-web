import type {Relationship} from './domain';

/** Display vocabulary, not a migration: stored records and custom predicates remain intact. */
export const canonicalRelationshipPredicates = [
  {label:'Related to', inverse:'Related to', aliases:['related']},
  {label:'Author of', inverse:'Authored by', aliases:['wrote']},
  {label:'Member of', inverse:'Has member', aliases:['membership of']},
  {label:'Located in', inverse:'Location of', aliases:['located at','location in']},
  {label:'Part of', inverse:'Has part', aliases:['is part of']},
  {label:'Founded', inverse:'Founded by', aliases:['founder of']},
  {label:'Influenced', inverse:'Influenced by', aliases:['influences']},
  {label:'Created', inverse:'Created by', aliases:['creator of']},
  {label:'Parent of', inverse:'Child of', aliases:[]},
  {label:'Preceded', inverse:'Succeeded', aliases:['predecessor of']},
] as const;

function predicate(label:string):{label:string;inverse:string}|undefined {
  const key=label.trim().toLocaleLowerCase('en-US');
  const direct=canonicalRelationshipPredicates.find(item=>item.label.toLocaleLowerCase('en-US')===key || item.aliases.some(alias=>alias===key));
  if(direct)return direct;
  const inverse=canonicalRelationshipPredicates.find(item=>item.inverse.toLocaleLowerCase('en-US')===key);
  return inverse?{label:inverse.inverse,inverse:inverse.label}:undefined;
}

/** Use only for a user-submitted new/changed predicate; never bulk-rewrite existing data. */
export function canonicalRelationshipLabel(label:string):string {
  return predicate(label)?.label ?? label.trim();
}

/** Reading an inverse does not create a reciprocal relationship. */
export function relationshipDisplayLabel(relation:Pick<Relationship,'source_id'|'label'>, entityId:string):string {
  const known=predicate(relation.label);
  if(relation.source_id===entityId)return known?.label ?? relation.label;
  return known?.inverse ?? 'Incoming · '+relation.label;
}

export function relationshipDirection(relation:Pick<Relationship,'source_id'>, entityId:string):'outgoing'|'incoming' {
  return relation.source_id===entityId?'outgoing':'incoming';
}
