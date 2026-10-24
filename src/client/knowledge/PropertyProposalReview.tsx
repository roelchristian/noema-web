import {isScholarlyDisciplineProposal,parseScholarlyDiscipline} from '../../shared/source-scholarly';
import {useEffect,useRef,useState} from 'react';
import type {Entity} from '../../shared/domain';
import {api,ApiError,type PropertyProposalPreview} from '../api';
import {EntityReferencePicker} from './EntityReferencePicker';

interface Props {proposalId?:string;vaultId:string;entityId:string;entities:Entity[];onUpdated:()=>Promise<void>;onError?:(message:string)=>void}
const retained=new Map<string,{target:string;uncertain:boolean}>();
export function PropertyProposalReview({vaultId,entityId,entities,onUpdated,onError,proposalId}:Props) {
 const [items,setItems]=useState<PropertyProposalPreview[]>([]),[status,setStatus]=useState('pending'),[error,setError]=useState(''),[busy,setBusy]=useState(''),[version,setVersion]=useState(0),[refreshFailed,setRefreshFailed]=useState(false);
 const selected=useRef<HTMLElement>(null);
 const lock=useRef(false),scope=vaultId+':'+entityId;
 const key=(id:string)=>scope+':'+id;
 const draft=(item:PropertyProposalPreview)=>retained.get(key(item.id))??{target:item.target_id??'',uncertain:false};
 async function load(){const result=await api.propertyProposals(vaultId,entityId,proposalId?'all':status,undefined,proposalId);setItems(result);setError('');}
 useEffect(()=>{let active=true;const controller=new AbortController();setItems([]);void api.propertyProposals(vaultId,entityId,proposalId?'all':status,controller.signal,proposalId).then(result=>{if(active){setItems(result);setError('');}}).catch(reason=>{if(active)setError(String(reason instanceof Error?reason.message:reason));});return()=>{active=false;controller.abort();};},[scope,status,proposalId]);
 useEffect(()=>{if(proposalId&&items.some(item=>item.id===proposalId)){selected.current?.scrollIntoView?.({block:'center'});selected.current?.focus({preventScroll:true});}},[proposalId,items]);
 async function refresh(){try{await onUpdated();setRefreshFailed(false);}catch{setRefreshFailed(true);setError('Review saved. Entity refresh failed; retry refresh to see the latest values.');}}
 async function check(item:PropertyProposalPreview){
  if(lock.current)return;lock.current=true;setBusy(item.id);
  try{const all=await api.propertyProposals(vaultId,entityId,'all',undefined,item.id),fresh=all.find(value=>value.id===item.id);if(!fresh)throw new Error('Review status unavailable. No decision was retried.');retained.set(key(item.id),{...draft(item),uncertain:false});setItems(previous=>previous.map(value=>value.id===item.id?fresh:value));setVersion(value=>value+1);setError('');if(fresh.status!=='pending')await refresh();}
  catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{lock.current=false;setBusy('');}
 }
 async function decide(item:PropertyProposalPreview,action:'accept'|'reject'|'retain_both'){
  if(lock.current||draft(item).uncertain)return;lock.current=true;setBusy(item.id);setError('');
  try{const target=draft(item).target,result=await api.reviewPropertyProposal(vaultId,entityId,item.id,{action,fingerprint:item.fingerprint,...target?{target_id:target}:{}});retained.delete(key(item.id));setItems(previous=>previous.map(value=>value.id===item.id?result:value));await refresh();}
  catch(reason){const message=reason instanceof Error?reason.message:String(reason);if(!(reason instanceof ApiError)||reason.status>=500){retained.set(key(item.id),{...draft(item),uncertain:true});setVersion(value=>value+1);setError('Could not confirm the review decision. Check review status before another attempt.');}else{setError(message);onError?.(message);}}
  finally{lock.current=false;setBusy('');}
 }
 return <section className="property-proposal-review" aria-label="Property evidence review" data-draft-version={version}>
  <h3>Property evidence review</h3>{proposalId?<p>Selected proposal from Inbox</p>:<label>Review status <select value={status} onChange={event=>setStatus(event.target.value)}><option value="pending">Pending</option><option value="all">All decisions</option></select></label>}
  {error&&<p role="alert">{error} {refreshFailed?<button type="button" onClick={()=>void refresh()}>Retry refresh</button>:<button type="button" onClick={()=>void load().catch(reason=>setError(String(reason)))}>Reload previews</button>}</p>}
  {!items.length&&!error&&<p>{proposalId?'This proposal is no longer available. Return to Inbox and refresh.':'No proposals in this view.'}</p>}
  {items.map(item=>{const discipline=isScholarlyDisciplineProposal(item)?parseScholarlyDiscipline(item.value):null,state=draft(item),disabled=!!busy||state.uncertain,conflicting=item.definition?.cardinality==='one'&&item.conflicts.some(value=>value.value!==item.value||value.target_id!==item.target_id);
   return <article key={item.id} ref={item.id===proposalId?selected:undefined} tabIndex={item.id===proposalId?-1:undefined} className="property-proposal"><h4>{item.kind==='entity_name'?'Proposed entity name':discipline?'Proposed discipline':item.definition?.label??item.property_name}</h4>
    <p>{item.origin==='ai'?'AI extracted':item.origin} · {item.status}</p><p>Proposed: {item.target_id?(entities.find(entity=>entity.id===item.target_id)?.name??item.target_id):discipline?`${discipline.label} (${discipline.domainId})`:item.value??'Unavailable reference'}</p>
    {item.kind==='entity_name'?<p>Current name: {item.currentName}</p>:item.conflicts.length>0&&<p>Existing values: {item.conflicts.map(value=>value.target_id?(entities.find(entity=>entity.id===value.target_id)?.name??value.target_id):value.value).join('; ')}</p>}
    {(item.source_file_id||item.source_hash||item.details)&&<details><summary>Source evidence</summary>{item.source_file_id&&<p>File: {item.sourceName??item.source_file_id} ({item.source_file_id})</p>}{item.source_hash&&<p className="property-evidence-hash">Content SHA-256: {item.source_hash}</p>}{item.details&&<p>{item.details}</p>}</details>}
    {item.stale&&<p role="status">Stale evidence: {item.staleReason}</p>}
    {item.status==='pending'&&<>{item.definition?.valueKind==='entity_reference'&&<EntityReferencePicker vaultId={vaultId} entities={entities} value={state.target} onChange={target=>{retained.set(key(item.id),{...state,target});setVersion(value=>value+1);}} types={item.definition.allowedTargetTypes} subtypes={item.definition.allowedTargetSubtypes} disabled={disabled||item.stale} label="Resolve proposed reference"/>}
     <div className="entity-inline-actions"><button type="button" disabled={disabled||item.stale} onClick={()=>void decide(item,conflicting?'retain_both':'accept')}>{item.kind==='entity_name'?'Use proposed name':discipline?'Apply discipline':conflicting?'Retain both values':'Accept value'}</button><button type="button" disabled={disabled} onClick={()=>void decide(item,'reject')}>{item.kind==='entity_name'?'Keep current name':'Reject suggestion'}</button>{state.uncertain&&<button type="button" disabled={!!busy} onClick={()=>void check(item)}>Check review status</button>}</div>
    </>}
   </article>;
  })}
 </section>;
}
