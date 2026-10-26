import {useEffect,useState} from 'react';
import type {ChatThread} from '../../shared/chat';
import {ChatThreadRow} from './ChatThreadRow';
import {Icon} from '../components/Icon';
import {getLocale} from '../i18n';

interface Props {
 active?:boolean;animatedTitle?:{id:string;title:string}|null;threads:ChatThread[];selectedId?:string;disabled:boolean;loading:boolean;error:string;
 onHide?:()=>void;onDelete?:(id:string)=>void;onNew:()=>void;onSelect:(id:string)=>void;onRetry:()=>void;
}

export function relativeChatTime(value:string,now=Date.now()) {
 const time=Date.parse(value);if(!Number.isFinite(time))return '';
 const seconds=Math.max(0,Math.floor((now-time)/1000));
 if(seconds<60)return 'just now';
 for(const [size,suffix] of [[31536000,'y'],[2592000,'mo'],[604800,'w'],[86400,'d'],[3600,'h'],[60,'m']] as const)if(seconds>=size)return Math.floor(seconds/size)+suffix;
 return 'just now';
}

export function ChatInbox({active=true,animatedTitle,threads,selectedId,disabled,loading,error,onHide,onDelete,onNew,onSelect,onRetry}:Props) {
 const [query,setQuery]=useState(''),[now,setNow]=useState(Date.now),[revealedId,setRevealedId]=useState<string|null>(null);
 useEffect(()=>{if(!active)return;const tick=()=>{if(document.visibilityState!=='hidden')setNow(Date.now());};tick();const timer=window.setInterval(tick,30000);document.addEventListener('visibilitychange',tick);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[active]);
 const matching=threads.filter(thread=>(thread.title||'Untitled conversation').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const today=new Date(now);today.setHours(0,0,0,0);
 const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
 const week=new Date(today);week.setDate(week.getDate()-7);
 const group=(thread:ChatThread)=>{const time=Date.parse(thread.updatedAt);return time>=today.getTime()?'Today':time>=yesterday.getTime()?'Yesterday':time>=week.getTime()?'Previous 7 days':'Earlier';};
 const dateFormat=new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'});
 return <div className="chat-inbox" aria-busy={loading}>
  <div className="chat-inbox-heading"><div><h2>Conversations <span>{threads.length}</span></h2></div>{onHide&&<button type="button" className="chat-icon" aria-label="Hide conversation inbox" title="Hide inbox" onClick={onHide}><Icon name="panel-hide"/></button>}</div>
  <button type="button" className="button chat-new" disabled={disabled} onClick={()=>{setQuery('');onNew();}}><Icon name="compose"/>New chat</button>
  <label className="chat-history-search"><Icon name="search"/><input type="search" aria-label="Search conversation titles" placeholder="Search titles…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  {error&&<div className="chat-history-error" role="alert"><p>{error}</p><button type="button" className="button" disabled={loading} onClick={onRetry}>Retry history</button></div>}
  <nav className="chat-thread-list" aria-label="Conversation history">
   {loading&&!threads.length?<p className="chat-inbox-empty" role="status">Loading conversations…</p>:!matching.length&&!error?<div className="chat-inbox-empty"><Icon name={query?'search':'annotation'}/><strong>{query?'No matches':'A place for your questions'}</strong><p>{query?'Try another title.':'Start a chat. Your saved conversations will appear here.'}</p></div>:null}
   {(['Today','Yesterday','Previous 7 days','Earlier'] as const).map(label=>{
    const items=matching.filter(thread=>group(thread)===label);return items.length?<section className="chat-thread-group" key={label} aria-label={label}><h3>{label}</h3><ul>{items.map(thread=><ChatThreadRow key={thread.id} thread={thread} selected={thread.id===selectedId} disabled={disabled} revealed={thread.id===revealedId} animate={animatedTitle?.id===thread.id&&animatedTitle.title===thread.title} time={relativeChatTime(thread.updatedAt,now)} exactTime={Number.isFinite(Date.parse(thread.updatedAt))?dateFormat.format(new Date(thread.updatedAt)):undefined} onSelect={()=>onSelect(thread.id)} onReveal={open=>setRevealedId(open?thread.id:null)} onDelete={()=>onDelete?.(thread.id)}/>)}</ul></section>:null;
   })}
  </nav>
 </div>;
}
