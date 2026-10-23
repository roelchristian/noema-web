import {useEffect,useRef,useState} from 'react';
import {request} from '../api';
import type {ReviewGroup,ReviewItem,ReviewQueue} from '../../shared/review-centre';
import './review-centre.css';
const labels:Record<ReviewGroup,string>={decisions:'Needs judgement',operations:'Failures and stale results',activity:'In progress'};
export function ReviewCentre({vaultId,onOpen}:{vaultId:string;onOpen:(item:ReviewItem,signal:AbortSignal)=>Promise<void>}) {
 const storageKey='noema-review-filter/'+vaultId;
 const [filter,setFilter]=useState<ReviewGroup>(()=>{try{const value=sessionStorage.getItem(storageKey);return value&&value in labels?value as ReviewGroup:'decisions';}catch{return 'decisions';}});
 const [queue,setQueue]=useState<ReviewQueue>({items:[],errors:[],more:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[opening,setOpening]=useState('');
 const offset=useRef(0),generation=useRef(0),reader=useRef<AbortController|null>(null),opener=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
 async function load(append=false){
  const version=++generation.current;reader.current?.abort();const controller=new AbortController();reader.current=controller;setLoading(true);setError('');
  try{const next=append?offset.current+50:0;const data=await request<ReviewQueue>(`review-centre?offset=${next}`,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted||version!==generation.current)return;
   offset.current=next;setQueue(previous=>({...data,items:append?[...new Map([...previous.items,...data.items].map(item=>[item.id,item])).values()]:data.items}));
  }catch(cause){if(!controller.signal.aborted)setError(navigator.onLine===false?'You are offline. Saved status could not be refreshed.':String(cause));}finally{if(version===generation.current&&!controller.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  void load();heading.current?.focus({preventScroll:true});
  const refresh=()=>{if(!document.hidden&&!opener.current)void load();};
  const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
  return()=>{generation.current++;reader.current?.abort();opener.current?.abort();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
 },[vaultId]);
 async function open(item:ReviewItem){
  if(opener.current)return;const controller=new AbortController();opener.current=controller;setOpening(item.id);setNotice('');
  try{const current=await request<ReviewItem|null>(`review-centre?id=${encodeURIComponent(item.id)}`,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;
   if(!current||current.runId!==item.runId){setNotice('This work changed or is no longer available. The queue has been refreshed.');await load();return;}
   await onOpen(current,controller.signal);
  }catch(cause){if(!controller.signal.aborted)setNotice('Could not open this work. '+String(cause));}
  finally{if(opener.current===controller)opener.current=null;if(!controller.signal.aborted)setOpening('');}
 }
 return <section className="review-centre" aria-busy={loading}>
  <header><div><p className="review-eyebrow">AI workspace</p><h1 className="page-heading" ref={heading} tabIndex={-1}>Review Centre</h1><p>Generated work that still needs attention in this vault.</p></div><button type="button" className="button" disabled={loading||!!opening} onClick={()=>void load()}>Refresh status</button></header>
  <div className="review-filters" role="group" aria-label="Review queue filters">{(Object.keys(labels) as ReviewGroup[]).map(group=><button type="button" key={group} aria-pressed={filter===group} onClick={()=>{setFilter(group);try{sessionStorage.setItem(storageKey,group);}catch{/* Session state still works. */}}}>{labels[group]} <span>{queue.items.filter(item=>item.group===group).length}</span></button>)}</div>
  {error&&<p role="alert">{error}</p>}{queue.errors.map(message=><p role="alert" key={message}>{message} Other categories remain available.</p>)}{notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">Loading saved status…</p>}
  {!loading&&!error&&!queue.items.some(item=>item.group===filter)&&<div className="review-empty"><h2>{queue.more.length?'No matching work in loaded status':filter==='decisions'?'No saved decisions waiting':filter==='operations'?'No current operational issues':'No tracked source processing in progress'}</h2><p>{queue.more.length?'Load more to check older saved work.':queue.errors.length?'Some categories could not be checked.':'Refresh to check for changes. Completed and resolved work stays out of this queue.'}</p></div>}
  <ul className="review-items">{queue.items.filter(item=>item.group===filter).map(item=><li key={item.id}><article><div><p className="review-eyebrow">{item.category==='scan'?'Page entity scan':item.category==='discovery'?'Entity discovery':item.category==='editorial'?'Source editorial pass':'Source processing'}</p><h2>{item.title||'Untitled'}</h2><p>{item.decision}{item.count>0?` · ${item.count} pending`:''}</p><p className="review-meta">{item.state} · {item.category==='source'?'imported ':''}<time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></p></div><button type="button" className="button" disabled={!!opening} aria-label={`Open ${item.title||'Untitled'}`} onClick={()=>void open(item)}>{opening===item.id?'Checking…':'Open workspace'}</button></article></li>)}</ul>
  {!!queue.more.length&&<p>Showing loaded status only. Older saved work is available below.</p>}
  {!!queue.more.length&&<button className="button" type="button" disabled={loading||!!opening} onClick={()=>void load(true)}>Load more saved status</button>}
  <details className="review-coverage"><summary>What this queue covers</summary><p>Saved page entity scans, the latest entity discovery draft, the latest editorial pass per source attachment, and current source processing status. Freshness of discovery and editorial work is checked when opened; those workspaces show stale evidence warnings.</p><p>Running source jobs appear under In progress, never as decisions. Generated page-from-source drafts currently have no supported direct review destination here. Page summaries and automatic enrichment do not have persisted accept/reject queues. General AI failures are historical activity, not durable unresolved incidents, so their logs and usage remain in Settings. This queue does not infer unresolved work from notifications or logs.</p></details>
 </section>;
}
