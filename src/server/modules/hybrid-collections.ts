import {createHash} from 'node:crypto';
import type {SmartRuleDefinition,SemanticCollectionDefinition} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {evaluateSmartRule} from './smart-rules.js';
import {evaluateSemanticBatch,type SemanticResult} from './smart-semantic-scoring.js';
/** Deterministic eligibility always precedes candidate vector reads. */
export function evaluateHybridBatch(store:Store,vault:string,rule:SmartRuleDefinition,semantic:SemanticCollectionDefinition,vector:number[],after:string,limit:number,itemIds?:string[],collectionId?:string):{items:SemanticResult[];hasMore:boolean} {
 const candidates=evaluateSmartRule(store,vault,rule,after,limit,itemIds);
 const eligible=candidates.items.filter(item=>item.matched).map(item=>item.item_id);
 const scores=evaluateSemanticBatch(store,vault,semantic,vector,'',limit,eligible,collectionId),byId=new Map(scores.items.map(item=>[item.item_id,item]));
 const ruleHash=createHash('sha256').update(JSON.stringify(rule)).digest('hex');
 return {hasMore:candidates.hasMore,items:candidates.items.map(item=>{
  const result=byId.get(item.item_id);
  if(!item.matched)return {item_id:item.item_id,title:item.title,matched:false,state:'evaluated',evidence:['Rule eligibility was not met; semantic passages were not evaluated.'],fingerprint:ruleHash};
  if(!result)return {item_id:item.item_id,title:item.title,matched:false,state:'stale',evidence:['The eligible page changed before semantic evaluation.'],fingerprint:ruleHash};
  return {...result,evidence:[...item.evidence.map(reason=>'Rule: '+reason),...result.evidence.map(reason=>'Semantic: '+reason)],fingerprint:createHash('sha256').update(ruleHash+result.fingerprint).digest('hex')};
 })};
}
