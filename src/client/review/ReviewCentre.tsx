import {useEffect,useRef,useState,type ReactNode} from 'react';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {getLocale} from '../i18n';
import type {ReviewCategory,ReviewGroup,ReviewItem,ReviewQueue} from '../../shared/review-centre';
import type {InboxFacet} from '../state/navigation-address';
export type {InboxFacet} from '../state/navigation-address';
import './review-centre.css';

const groups:Record<ReviewGroup,{label:string;icon:string;description:string;empty:string}>={
 decisions:{label:'To review',icon:'review-text',description:'Consider the suggestions, check their evidence, and decide what belongs in your knowledge.',empty:'Nothing waiting for your review'},
 operations:{label:'Issues',icon:'alert',description:'Revisit changed pages and source work that needs another look.',empty:'Nothing needs attention'},
 activity:{label:'In progress',icon:'recent',description:'Source work is underway. You can continue writing while it finishes.',empty:'No work in progress'},
};
const categories:Record<ReviewCategory,{label:string;icon:string;action:string}>={
 scan:{label:'Page entities',icon:'page',action:'Review entities'},
 discovery:{label:'Entity discovery',icon:'knowledge',action:'Review discoveries'},
 editorial:{label:'Source corrections',icon:'review-text',action:'Review corrections'},
 source:{label:'Source processing',icon:'source',action:'View source'},
 property:{label:'Property and name proposals',icon:'knowledge',action:'Review proposal'},
 temporal:{label:'Date relationships',icon:'event',action:'Review date'},
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

const facetGroups:Partial<Record<InboxFacet,ReviewGroup>>={review:'decisions',issues:'operations',progress:'activity'};
const facets:{id:InboxFacet;label:string;icon:string}[]=[{id:'overview',label:'Overview',icon:'inbox'},{id:'review',label:'To review',icon:'review-text'},{id:'organise',label:'To organise',icon:'pages'},{id:'issues',label:'Issues',icon:'alert'},{id:'progress',label:'In progress',icon:'recent'}];
/** Presentation of authoritative saved work; this layer never records decisions. */
export interface InboxItem {id:string;category:ReviewCategory;subjectId:string;revisionId?:string;subject:string;reason:string;state:string;pendingCount:number;updatedAt:string;destination:ReviewItem}
export function attentionItem(item:ReviewItem):InboxItem{return {id:item.id,category:item.category,subjectId:item.originId,revisionId:item.runId,updatedAt:item.updatedAt,subject:item.title||'Untitled',reason:taskDescription(item),state:stateLabel(item),pendingCount:item.count,destination:item};}
export function ReviewCentre({vaultId,onOpen,facet,onFacetChange,organize,unfiledCount=0,organizeComplete=true}:{vaultId:string;onOpen:(item:ReviewItem,signal:AbortSignal)=>Promise<void>;facet?:InboxFacet;onFacetChange?:(facet:InboxFacet)=>void;organize?:ReactNode;unfiledCount?:number;organizeComplete?:boolean}) {
 const storageKey='noema-review-filter/'+vaultId;
 const [organiseVisited,setOrganiseVisited]=useState(facet==='organise');
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
 useEffect(()=>{opener.current?.abort();opener.current=null;setOpening('');if(facet==='organise')setOrganiseVisited(true);},[facet]);
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
 const shell=facet!==undefined||organize!==undefined,activeFacet=facet??'review', activeGroup=shell?(facetGroups[activeFacet]??filter):filter;
 const selected=groups[activeGroup], scoped=queue.items.filter(item=>!shell||activeFacet!=='overview'?item.group===activeGroup:true), search=query.trim().toLocaleLowerCase();
 const visible=scoped.filter(item=>!search||[item.title,categories[item.category].label,item.decision,stateLabel(item)].some(value=>value.toLocaleLowerCase().includes(search)));
 const incomplete=!!queue.errors.length, more=!!queue.more.length,partial=incomplete||more||!!error;
 const attentionGroups:ReviewGroup[]=['operations','decisions','activity'];
 const itemRows=(items:ReviewItem[])=><ul className="review-items" aria-label={shell&&activeFacet==='overview'?'Needs attention':selected.label}>{items.map(saved=>{const item=attentionItem(saved),category=categories[saved.category],action=actionLabel(saved),validDate=Number.isFinite(Date.parse(saved.updatedAt));return <li key={item.id}><article><span className="review-item-icon"><Icon name={category.icon}/></span><div className="review-item-content"><p className="review-eyebrow">{category.label}</p><h3 className="review-item-title">{item.subject}</h3><p className="review-item-description">{item.reason}{item.pendingCount>0&&saved.group==='decisions'?` · ${item.pendingCount} ${item.pendingCount===1?'suggestion':'suggestions'} to review`:''}</p><p className="review-meta"><span className="review-state" data-group={saved.group}>{item.state}</span>{validDate&&<time dateTime={saved.updatedAt} title={new Date(saved.updatedAt).toLocaleString(getLocale())}>{saved.category==='source'?'Imported ':''}{new Date(saved.updatedAt).toLocaleDateString(getLocale(),{month:'short',day:'numeric',year:'numeric'})}</time>}{saved.group==='decisions'&&saved.category!=='scan'&&<span>Evidence checked in reviewer</span>}</p></div><button type="button" className="button review-item-action" disabled={!!opening} aria-label={`${action}: ${item.subject}`} onClick={()=>void open(saved)}>{opening===saved.id?'Checking…':action}<Icon name="chevron"/></button></article></li>;})}</ul>;
 return <section className="review-centre" aria-busy={loading}>
  <header className="review-header"><div className="review-heading"><h1 className="page-heading" ref={heading} tabIndex={-1}>Inbox</h1></div><button type="button" className="button review-refresh" disabled={loading||!!opening} onClick={()=>void load()}><Icon name="refresh"/>{loading?'Refreshing…':'Refresh'}</button></header>
  <div className="review-toolbar"><div className="review-filters" role="group" aria-label="Inbox views">{shell?facets.map(entry=>{const group=facetGroups[entry.id],count=entry.id==='organise'?unfiledCount:group?queue.items.filter(item=>item.group===group).length:undefined;return <button type="button" key={entry.id} aria-pressed={activeFacet===entry.id} onClick={()=>onFacetChange?.(entry.id)}><Icon name={entry.icon}/><span className="review-filter-label">{entry.label}</span>{count!==undefined&&<span className="review-filter-count" title={entry.id==='organise'?(organizeComplete?'Unfiled pages':'Loaded unfiled pages; count may be incomplete'):'Loaded saved work'}>{count}{(entry.id==='organise'?!organizeComplete:partial)?'+':''}</span>}</button>;}):(Object.keys(groups) as ReviewGroup[]).map(group=><button type="button" key={group} aria-pressed={filter===group} onClick={()=>changeFilter(group)}><Icon name={groups[group].icon}/><span className="review-filter-label">{groups[group].label}</span><span className="review-filter-count">{queue.items.filter(item=>item.group===group).length}</span></button>)}</div>
   {(!shell||activeFacet!=='organise')&&<label className="review-search"><Icon name="search"/><input type="search" aria-label="Filter review queue" placeholder="Filter this view…" value={query} onChange={event=>changeQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&query){event.preventDefault();changeQuery('');}}}/>{query&&<button type="button" aria-label="Clear review filter" onClick={()=>changeQuery('')}><Icon name="close"/></button>}</label>}
  </div>
  <div hidden={shell&&activeFacet==='organise'}>
  <div className="review-section-heading"><div><h2>{shell&&activeFacet==='overview'?'Needs attention':selected.label}</h2><p className="review-section-description">{shell&&activeFacet==='overview'?'Suggestions, issues, and ongoing work in your vault.':selected.description}</p></div><span className="review-count">{visible.length} {visible.length===1?'item':'items'}{search?' found':''}{partial?' loaded':''}</span></div>
  {error&&<div className="review-message is-error" role="alert"><p>{queue.items.length?'Could not refresh. Previously loaded work is still shown. ':'Could not load your review queue. '}{error}</p><button type="button" className="button" disabled={loading||!!opening} onClick={()=>void load()}>Try again</button></div>}
  {queue.errors.map(message=><div className="review-message is-error" role="alert" key={message}><p>{message} Other work is still available.</p><button type="button" className="button" disabled={loading||!!opening} onClick={()=>void load()}>Retry unavailable work</button></div>)}
  {notice&&<p className="review-message" role="status">{notice}</p>}
  {loading&&<p className="review-message" role="status">{queue.items.length?'Refreshing your review queue…':'Gathering work from your vault…'}</p>}
  {!loading&&!error&&!visible.length&&(!shell||activeFacet!=='overview')&&<div className="review-empty"><span className="review-empty-icon"><Icon name={search?'search':incomplete||more?'info':activeGroup==='activity'?'recent':'check-circle'}/></span><h3>{search?'No matching work':incomplete?'Some work could not be checked':more?'No items in this view yet':selected.empty}</h3><p>{search?'Try another title or type of work, or clear your filter.':incomplete?'Retry the unavailable work before considering this queue complete.':more?'Load more to check older saved work in this view.':activeGroup==='decisions'?'Suggestions will appear here when a page scan, entity discovery, or source editorial pass is ready.':activeGroup==='operations'?'Changed scans and source processing issues will appear here when they need another look.':'Active source processing and editorial passes will appear here. This view refreshes automatically.'}</p>{search&&<button type="button" className="button" onClick={()=>changeQuery('')}>Clear filter</button>}</div>}
  {shell&&activeFacet==='overview'?attentionGroups.map(group=>{const items=visible.filter(item=>item.group===group);return <section className="inbox-overview-group" key={group}><div className="review-section-heading"><h2>{groups[group].label}</h2><button type="button" className="button" onClick={()=>onFacetChange?.(group==='decisions'?'review':group==='operations'?'issues':'progress')}>Open {groups[group].label.toLowerCase()}</button></div>{items.length?itemRows(items.slice(0,5)):<p className="review-section-description">{loading?'Checking saved work…':partial?'No loaded items. Coverage is incomplete.':groups[group].empty}</p>}{items.length>5&&<p className="review-section-description">{items.length-5} more loaded items in this view.</p>}</section>;}):itemRows(visible)}
  {shell&&activeFacet==='overview'&&<section className="inbox-organise-summary"><div><h2>To organise</h2><p>{unfiledCount}{organizeComplete?'':'+'} {organizeComplete?'unfiled pages':'loaded unfiled pages'}. Preview, file, or assign pages to collections in triage.</p></div><button type="button" className="button" onClick={()=>onFacetChange?.('organise')}>Open triage</button></section>}
  <div className="review-footer">{(shell||partial)&&<p>Counts cover loaded saved work.{incomplete?' Some categories could not be checked.':''}{more?' More saved work is available.':''}</p>}{more&&<button className="button" type="button" disabled={loading||!!opening} onClick={()=>void load(true)}>Load more work</button>}</div>
  <details className="review-coverage"><summary>About this workspace</summary><p>Review saved page entity suggestions, entity discoveries, property proposals, date relationships, and source corrections here. Open an item to check its evidence and make decisions in context. Opening work does not accept suggestions or start a new AI request.</p><p>Source processing appears separately in In progress. Completed and resolved work leaves this queue. Page drafts, summaries, and automatic enrichment are reviewed in their own workspaces; AI activity and usage remain in Settings.</p></details>
  </div>
  {shell&&<div className="inbox-organisation" hidden={activeFacet!=='organise'}>{(organiseVisited||activeFacet==='organise')&&organize}</div>}
 </section>;
}
