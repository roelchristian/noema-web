import {useContext,useEffect,useState} from 'react';
import {adaptTemporalProperty} from '../../shared/temporal-properties';
import type {TemporalDetail} from '../../shared/temporal';
import {api,ApiError} from '../api';
import {DateOverview} from './DateOverview';
import {DateNavigation} from './date-navigation';

/** Fetch only the disclosed identity, never every property or every date in a vault. */
export function DatePropertyOverview({vaultId,type,name,value,declaredDate=false}:{vaultId:string;type:string;name:string;value:string|null;declaredDate?:boolean}) {
 const openCalendar=useContext(DateNavigation),date=value===null?null:adaptTemporalProperty(type,name,value,declaredDate)?.date;
 const [open,setOpen]=useState(false),[item,setItem]=useState<TemporalDetail|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  setItem(null);setError('');if(!open||!date)return;
  const controller=new AbortController();setLoading(true);
  void api.temporalDetail(vaultId,date.id,0,0,controller.signal).then(result=>{if(!controller.signal.aborted)setItem(result);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof ApiError&&error.status===404?'No saved date evidence yet.':error instanceof Error?error.message:String(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[vaultId,date?.id,open,retry]);
 if(!date)return null;
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Date overview</summary><DateOverview date={date} item={item} compact onOpenCalendar={openCalendar}>
  {loading&&<p role="status">Loading date overview…</p>}
  {error&&<p role="status">{error}<button type="button" className="button" onClick={()=>setRetry(value=>value+1)}>Refresh date overview</button></p>}
  {!!item?.relations.length&&<section><h3>Connections</h3><ul>{item.relations.slice(0,3).map(relation=><li key={relation.id}>{relation.name} · {relation.kind.replaceAll('_',' ')}</li>)}</ul>{item.relationCount>3&&<small>Open in Calendar for more connections.</small>}</section>}
  {item&&<section><h3>Evidence</h3><p>{item.mentionCount} note occurrences · {item.sourceCount??0} source occurrences · {item.propertyCount??0} date properties</p>{item.mentions.slice(0,2).map(mention=><p key={mention.id}>{mention.title} · {mention.text}</p>)}<small>Open in Calendar to inspect validated passages and provenance.</small></section>}
 </DateOverview></details>;
}
