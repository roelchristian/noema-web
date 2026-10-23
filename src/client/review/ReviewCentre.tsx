import {useEffect,useRef,useState} from 'react';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {getLocale} from '../i18n';
import type {ReviewCategory,ReviewGroup,ReviewItem,ReviewQueue} from '../../shared/review-centre';
import './review-centre.css';

const groups:Record<ReviewGroup,{label:string;icon:string;description:string;empty:string}>={
 decisions:{label:'To review',icon:'review-text',description:'Consider the suggestions, check their evidence, and decide what belongs in your knowledge.',empty:'Nothing waiting for your review'},
 operations:{label:'Needs attention',icon:'alert',description:'Revisit changed pages and source work that needs another look.',empty:'Nothing needs attention'},
 activity:{label:'In progress',icon:'recent',description:'Source work is underway. You can continue writing while it finishes.',empty:'No work in progress'},
};
const categories:Record<ReviewCategory,{label:string;icon:string;action:string}>={
 scan:{label:'Page entities',icon:'page',action:'Review entities'},
 discovery:{label:'Entity discovery',icon:'knowledge',action:'Review discoveries'},
 editorial:{label:'Source corrections',icon:'review-text',action:'Review corrections'},
 source:{label:'Source processing',icon:'source',action:'View source'},
};
function readSession(key:string){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
function savedFilter(key:string):ReviewGroup{const value=readSession(key);return Object.hasOwn(groups,value)?value as ReviewGroup:'decisions';}
function stateLabel(item:ReviewItem){
 if(item.state==='stale')return 'Page changed';
 if(item.state==='interrupted')return 'Interrupted';
 if(item.group==='operations')return 'Needs attention';
 if(item.group==='activity')return item.state==='queued'||item.state==='pending'?'Queued':'In progress';
 return 'Ready to review';
}
function taskDescription(item:ReviewItem){
 if(item.state==='stale')return 'This page has changed since the scan. Check its suggestions against the current page.';
 if(item.group==='operations')return item.category==='editorial'?'The editorial pass did not finish. Open the source to inspect it and try again.':'Source processing needs attention. Open the source to inspect its status.';
 if(item.group==='activity')return item.category==='editorial'?'An editorial pass is checking this source for corrections.':'This source is being prepared for your knowledge library.';
 return item.decision;
}
function actionLabel(item:ReviewItem){return item.group==='decisions'?categories[item.category].action:item.category==='scan'?'Revisit page':item.group==='activity'?'View progress':'Inspect source';}

export function ReviewCentre({vaultId,onOpen}:{vaultId:string;onOpen:(item:ReviewItem,signal:AbortSignal)=>Promise<void>}) {
 const storageKey='noema-review-filter/'+vaultId;
 const [filter,setFilter]=useState<ReviewGroup>(()=>savedFilter(storageKey));
 const [query,setQuery]=useState(()=>readSession(storageKey+'/query'));
 const [queue,setQueue]=useState<ReviewQueue>({items:[],errors:[],more:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[opening,setOpening]=useState('');
 const offset=useRef(0),generation=useRef(0),reader=useRef<AbortController|null>(null),opener=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
 async function load(append=false){
  const version=++generation.current;reader.current?.abort();const controller=new AbortController();reader.current=controller;setLoading(true);setError('');
  try{const next=append?offset.current+50:0;const data=await request<ReviewQueue>(`review-centre?offset=${next}`,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted||version!==generation.current)return;
   offset.current=next;setQueue(previous=>({...data,items:append?[...new Map([...previous.items,...data.items].map(item=>[item.id,item])).values()]:data.items}));
  }catch(cause){if(!controller.signal.aborted)setError(navigator.onLine===false?'You are offline. Reconnect to refresh your review queue.':cause instanceof Error?cause.message:String(cause));}finally{if(version===generation.current&&!controller.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  setFilter(savedFilter(storageKey));setQuery(readSession(storageKey+'/query'));setQueue({items:[],errors:[],more:[]});setNotice('');setOpening('');opener.current=null;offset.current=0;
  void load();heading.current?.focus({preventScroll:true});
  const refresh=()=>{if(!document.hidden&&!opener.current)void load();};
  const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
  return()=>{generation.current++;reader.current?.abort();opener.current?.abort();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
 },[vaultId]);
 async function open(item:ReviewItem){
  if(opener.current)return;const controller=new AbortController();opener.current=controller;setOpening(item.id);setNotice('');
  try{const current=await request<ReviewItem|null>(`review-centre?id=${encodeURIComponent(item.id)}`,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;
   if(!current||current.runId!==item.runId){setNotice('This work changed or is no longer available. Your review queue has been refreshed.');await load();return;}
   await onOpen(current,controller.signal);
  }catch(cause){if(!controller.signal.aborted)setNotice('Could not open this work. '+(cause instanceof Error?cause.message:String(cause)));}
  finally{if(opener.current===controller)opener.current=null;if(!controller.signal.aborted)setOpening('');}
 }
 function changeFilter(group:ReviewGroup){setFilter(group);try{sessionStorage.setItem(storageKey,group);}catch{/* Session state still works. */}}
 function changeQuery(value:string){setQuery(value);try{sessionStorage.setItem(storageKey+'/query',value);}catch{/* Session state still works. */}}
 const selected=groups[filter], scoped=queue.items.filter(item=>item.group===filter), search=query.trim().toLocaleLowerCase();
 const visible=scoped.filter(item=>!search||[item.title,categories[item.category].label,item.decision,stateLabel(item)].some(value=>value.toLocaleLowerCase().includes(search)));
 const incomplete=!!queue.errors.length, more=!!queue.more.length;
 return <section className="review-centre" aria-busy={loading}>
  <header className="review-header"><div className="review-heading"><h1 className="page-heading" ref={heading} tabIndex={-1}>Review Centre</h1><p className="review-intro">A place to consider AI suggestions and tend to work in your vault.</p></div><button type="button" className="button review-refresh" disabled={loading||!!opening} onClick={()=>void load()}><Icon name="refresh"/>{loading?'Refreshing…':'Refresh'}</button></header>
  <div className="review-toolbar"><div className="review-filters" role="group" aria-label="Review queue filters">{(Object.keys(groups) as ReviewGroup[]).map(group=><button type="button" key={group} aria-pressed={filter===group} onClick={()=>changeFilter(group)}><Icon name={groups[group].icon}/><span className="review-filter-label">{groups[group].label}</span><span className="review-filter-count">{queue.items.filter(item=>item.group===group).length}</span></button>)}</div>
   <label className="review-search"><Icon name="search"/><input type="search" aria-label="Filter review queue" placeholder="Filter this view…" value={query} onChange={event=>changeQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&query){event.preventDefault();changeQuery('');}}}/>{query&&<button type="button" aria-label="Clear review filter" onClick={()=>changeQuery('')}><Icon name="close"/></button>}</label>
  </div>
  <div className="review-section-heading"><div><h2>{selected.label}</h2><p className="review-section-description">{selected.description}</p></div><span className="review-count">{visible.length} {visible.length===1?'item':'items'}{search?' found':''}</span></div>
  {error&&<div className="review-message is-error" role="alert"><p>{queue.items.length?'Could not refresh. Previously loaded work is still shown. ':'Could not load your review queue. '}{error}</p><button type="button" className="button" disabled={loading||!!opening} onClick={()=>void load()}>Try again</button></div>}
  {queue.errors.map(message=><div className="review-message is-error" role="alert" key={message}><p>{message} Other work is still available.</p><button type="button" className="button" disabled={loading||!!opening} onClick={()=>void load()}>Retry unavailable work</button></div>)}
  {notice&&<p className="review-message" role="status">{notice}</p>}
  {loading&&<p className="review-message" role="status">{queue.items.length?'Refreshing your review queue…':'Gathering work from your vault…'}</p>}
  {!loading&&!error&&!visible.length&&<div className="review-empty"><span className="review-empty-icon"><Icon name={search?'search':incomplete||more?'info':filter==='activity'?'recent':'check-circle'}/></span><h3>{search?'No matching work':incomplete?'Some work could not be checked':more?'No items in this view yet':selected.empty}</h3><p>{search?'Try another title or type of work, or clear your filter.':incomplete?'Retry the unavailable work before considering this queue complete.':more?'Load more to check older saved work in this view.':filter==='decisions'?'Suggestions will appear here when a page scan, entity discovery, or source editorial pass is ready.':filter==='operations'?'Changed scans and source processing issues will appear here when they need another look.':'Active source processing and editorial passes will appear here. This view refreshes automatically.'}</p>{search&&<button type="button" className="button" onClick={()=>changeQuery('')}>Clear filter</button>}</div>}
  <ul className="review-items" aria-label={selected.label}>{visible.map(item=>{const category=categories[item.category],action=actionLabel(item),validDate=Number.isFinite(Date.parse(item.updatedAt));return <li key={item.id}><article><span className="review-item-icon"><Icon name={category.icon}/></span><div className="review-item-content"><p className="review-eyebrow">{category.label}</p><h3 className="review-item-title">{item.title||'Untitled'}</h3><p className="review-item-description">{taskDescription(item)}{item.count>0&&item.group==='decisions'?` · ${item.count} ${item.count===1?'suggestion':'suggestions'} to review`:''}</p><p className="review-meta"><span className="review-state" data-group={item.group}>{stateLabel(item)}</span>{validDate&&<time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString(getLocale())}>{item.category==='source'?'Imported ':''}{new Date(item.updatedAt).toLocaleDateString(getLocale(),{month:'short',day:'numeric',year:'numeric'})}</time>}{item.group==='decisions'&&item.category!=='scan'&&<span>Evidence checked on open</span>}</p></div><button type="button" className="button review-item-action" disabled={!!opening} aria-label={`${action}: ${item.title||'Untitled'}`} onClick={()=>void open(item)}>{opening===item.id?'Checking…':action}<Icon name="chevron"/></button></article></li>;})}</ul>
  <div className="review-footer">{more&&<><p>Counts cover loaded work. More saved work is available.</p><button className="button" type="button" disabled={loading||!!opening} onClick={()=>void load(true)}>Load more work</button></>}</div>
  <details className="review-coverage"><summary>About this workspace</summary><p>Review saved page entity suggestions, entity discoveries, and source corrections here. Open an item to check its evidence and make decisions in context. Opening work does not accept suggestions or start a new AI request.</p><p>Source processing appears separately in In progress. Completed and resolved work leaves this queue. Page drafts, summaries, and automatic enrichment are reviewed in their own workspaces; AI activity and usage remain in Settings.</p></details>
 </section>;
}
