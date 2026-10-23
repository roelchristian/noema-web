import {useEffect,useRef,useState} from 'react';
import type {Collection,CollectionMembership,Organization} from '../../shared/domain';
import {api} from '../api';

export function SmartCollectionStatus({vaultId,collection,data,itemNames,onChanged,onError}:{vaultId:string;collection:Collection;data:Organization;itemNames:Map<string,string>;onChanged:(data:Organization)=>void;onError:(error:unknown)=>void}) {
  const active=useRef(true);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{let stopped=false;void api.organization(vaultId).then(result=>{if(!stopped&&active.current)onChanged(result);}).catch(error=>{if(!stopped&&active.current)onError(error);});return()=>{stopped=true;};},[vaultId,collection.id]);
  const status=collection.smart?.status??'unevaluated';
  useEffect(()=>{
    let stopped=false;
    const timer=setTimeout(()=>{void api.organization(vaultId).then(result=>{if(!stopped&&active.current)onChanged(result);}).catch(error=>{if(!stopped&&active.current)onError(error);});},['refreshing','stale','unevaluated'].includes(status)?1000:5000);
    return()=>{stopped=true;clearTimeout(timer);};
  },[vaultId,collection,status,data,onChanged,onError]);
  async function update(route:string,body:unknown={},method='PUT') {
    if(busy)return;setBusy(true);
    try {const result=await api.organize(vaultId,route,body,method);if(active.current)onChanged(result);}
    catch(error){if(active.current)onError(error);}
    finally{if(active.current)setBusy(false);}
  }
  const advanced=!!collection.matching&&collection.matching!=='rules';
  const matchingLabel=collection.matching==='hybrid'?'hybrid':collection.matching==='examples'?'example':collection.matching==='semantic'?'semantic':'rule';
  const overrides=(data.smartOverrides??[]).filter(override=>override.collection_id===collection.id);
  return <div className="smart-collection-status"><p role="status"><strong>Smart collection</strong> · {status==='ready'?'Up to date':status==='refreshing'?'Evaluating pages…':status==='stale'?'Previous results are stale. Updating…':status==='error'?'Evaluation failed':status==='partial'?'Indexing gaps · Some pages have not been evaluated':'Not yet evaluated'}{collection.smart&&<> · {collection.smart.evaluated} evaluated · {collection.smart.matched} {matchingLabel} matches</>}</p>{advanced&&<p>{collection.smart?.unevaluated??0} pages await a current index · {collection.smart?.errors??0} errors. Missing or stale embeddings are not confirmed non-matches.</p>}{collection.smart?.error&&<p role="alert">{collection.smart.error}</p>}<p>{collection.matching==='examples'?'Example matching uses saved page indexes and checks positive and negative examples. Re-evaluating does not index missing pages.':collection.matching==='hybrid'?'Rules establish eligibility before semantic matching uses indexed passages and document coverage. Re-evaluating reuses the saved description embedding.':collection.matching==='semantic'?'Semantic matching uses saved indexed passages and document coverage. Re-evaluating reuses the saved description embedding; it does not index missing pages.':'Rules calculate page membership without moving or editing content.'} Explicit decisions survive refresh.</p><button className="button" disabled={busy||status==='refreshing'} onClick={()=>void update('collections/'+collection.id+'/refresh',{},'POST')}>Re-evaluate</button>
  {!!overrides.length&&<details><summary>Explicit decisions ({overrides.length})</summary><ul>{overrides.map(override=><li key={override.kind+override.item_id}>{override.decision==='include'?'Always included':'Excluded'} · {itemNames.get(override.kind+':'+override.item_id)??override.item_id}<button disabled={busy} onClick={()=>void update('memberships',{kind:override.kind,item_id:override.item_id,collection_id:collection.id,reset:true})}>{advanced?'Use matching again':'Use rules again'}</button></li>)}</ul></details>}</div>;
}
export function SmartMembershipDetails({membership,onDecision,disabled,semantic=false}:{membership:CollectionMembership;semantic?:boolean;onDecision:(decision:'include'|'exclude'|'reset')=>void;disabled:boolean}) {
  return <details className="smart-membership-evidence"><summary>Why is this here?</summary><p>{membership.provenance==='include'?'Always included by you':membership.provenance==='manual'?'Existing manual membership':membership.provenance==='semantic'?'Matched semantic collection':membership.provenance==='hybrid'?'Matched eligibility rules and semantic collection':membership.provenance==='examples'?'Matched example collection':'Matched collection rules'}{membership.stale?' · Stale evidence. Refresh is pending.':''}</p>{membership.evaluationState&&membership.evaluationState!=='evaluated'&&<p>{membership.evaluationState==='missing'?'Not evaluated: missing current embeddings.':membership.evaluationState==='stale'?'Previous evidence is stale while the index updates.':membership.evaluationState==='ineligible'?'This page is currently ineligible for indexing.':'Evaluation failed. Previous evidence may be retained.'}</p>}<ul>{membership.evidence?.map((reason,index)=><li key={index}>{reason}</li>)}</ul><div className="smart-rule-actions"><button disabled={disabled} onClick={()=>onDecision('include')}>Always include</button><button disabled={disabled} onClick={()=>onDecision('exclude')}>Exclude from this collection</button><button disabled={disabled} onClick={()=>onDecision('reset')}>{semantic?'Use matching again':'Use rules again'}</button></div></details>;
}
