import {useEffect,useRef,useState} from 'react';
import type {Collection,CollectionMembership,Organization} from '../../shared/domain';
import {api} from '../api';

export function SmartCollectionStatus({vaultId,collection,data,itemNames,onChanged,onError}:{vaultId:string;collection:Collection;data:Organization;itemNames:Map<string,string>;onChanged:(data:Organization)=>void;onError:(error:unknown)=>void}) {
  const active=useRef(true);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const status=collection.smart?.status??'unevaluated';
  useEffect(()=>{
    if(!['refreshing','stale','unevaluated'].includes(status))return;
    let stopped=false;
    const timer=setTimeout(()=>{void api.organization(vaultId).then(result=>{if(!stopped&&active.current)onChanged(result);}).catch(error=>{if(!stopped&&active.current)onError(error);});},1000);
    return()=>{stopped=true;clearTimeout(timer);};
  },[vaultId,collection,status,data,onChanged,onError]);
  async function update(route:string,body:unknown={},method='PUT') {
    if(busy)return;setBusy(true);
    try {const result=await api.organize(vaultId,route,body,method);if(active.current)onChanged(result);}
    catch(error){if(active.current)onError(error);}
    finally{if(active.current)setBusy(false);}
  }
  const overrides=(data.smartOverrides??[]).filter(override=>override.collection_id===collection.id);
  return <div className="smart-collection-status"><p role="status"><strong>Smart collection</strong> · {status==='ready'?'Up to date':status==='refreshing'?'Evaluating pages…':status==='stale'?'Previous results are stale. Updating…':status==='error'?'Evaluation failed':'Not yet evaluated'}{collection.smart&&<> · {collection.smart.evaluated} evaluated · {collection.smart.matched} rule matches</>}</p>{collection.smart?.error&&<p role="alert">{collection.smart.error}</p>}<p>Rules calculate page membership without moving or editing content. Explicit decisions survive refresh.</p><button className="button" disabled={busy||status==='refreshing'} onClick={()=>void update('collections/'+collection.id+'/refresh',{},'POST')}>Re-evaluate</button>
  {!!overrides.length&&<details><summary>Explicit decisions ({overrides.length})</summary><ul>{overrides.map(override=><li key={override.kind+override.item_id}>{override.decision==='include'?'Always included':'Excluded'} · {itemNames.get(override.kind+':'+override.item_id)??override.item_id}<button disabled={busy} onClick={()=>void update('memberships',{kind:override.kind,item_id:override.item_id,collection_id:collection.id,reset:true})}>Use rules again</button></li>)}</ul></details>}</div>;
}
export function SmartMembershipDetails({membership,onDecision,disabled}:{membership:CollectionMembership;onDecision:(decision:'include'|'exclude'|'reset')=>void;disabled:boolean}) {
  return <details className="smart-membership-evidence"><summary>Why is this here?</summary><p>{membership.provenance==='include'?'Always included by you':membership.provenance==='manual'?'Existing manual membership':'Matched collection rules'}{membership.stale?' · Stale evidence. Refresh is pending.':''}</p><ul>{membership.evidence?.map((reason,index)=><li key={index}>{reason}</li>)}</ul><div className="smart-rule-actions"><button disabled={disabled} onClick={()=>onDecision('include')}>Always include</button><button disabled={disabled} onClick={()=>onDecision('exclude')}>Exclude from this collection</button><button disabled={disabled} onClick={()=>onDecision('reset')}>Use rules again</button></div></details>;
}
