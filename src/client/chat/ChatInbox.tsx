import {useState} from 'react';
import type {ChatThread} from '../../shared/chat';
import {Icon} from '../components/Icon';
import {getLocale} from '../i18n';

interface Props {
 threads:ChatThread[];selectedId?:string;disabled:boolean;loading:boolean;error:string;
 onNew:()=>void;onSelect:(id:string)=>void;onRetry:()=>void;
}
const scopeLabels={vault:'Entire vault',page:'Page',source:'Source',entity:'Entity'};

export function ChatInbox({threads,selectedId,disabled,loading,error,onNew,onSelect,onRetry}:Props) {
 const [query,setQuery]=useState('');
 const matching=threads.filter(thread=>(thread.title||'Untitled conversation').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const today=new Date();today.setHours(0,0,0,0);
 const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
 const week=new Date(today);week.setDate(week.getDate()-7);
 const group=(thread:ChatThread)=>{const time=Date.parse(thread.updatedAt);return time>=today.getTime()?'Today':time>=yesterday.getTime()?'Yesterday':time>=week.getTime()?'Previous 7 days':'Earlier';};
 const dateFormat=new Intl.DateTimeFormat(getLocale(),{month:'short',day:'numeric'});
 return <div className="chat-inbox" aria-busy={loading}>
  <div className="chat-inbox-heading"><div><h2>Conversations <span>{threads.length}</span></h2></div></div>
  <button type="button" className="button chat-new" disabled={disabled} onClick={()=>{setQuery('');onNew();}}><Icon name="compose"/>New chat</button>
  <label className="chat-history-search"><Icon name="search"/><input type="search" aria-label="Search conversations" placeholder="Search conversations…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  {error&&<div className="chat-history-error" role="alert"><p>{error}</p><button type="button" className="button" disabled={loading} onClick={onRetry}>Retry history</button></div>}
  <nav className="chat-thread-list" aria-label="Conversation history">
   {loading&&!threads.length?<p className="chat-inbox-empty" role="status">Loading conversations…</p>:!matching.length&&!error?<div className="chat-inbox-empty"><Icon name={query?'search':'annotation'}/><strong>{query?'No matches':'A place for your questions'}</strong><p>{query?'Try another title.':'Start a chat. Your saved conversations will appear here.'}</p></div>:null}
   {(['Today','Yesterday','Previous 7 days','Earlier'] as const).map(label=>{
    const items=matching.filter(thread=>group(thread)===label);return items.length?<section className="chat-thread-group" key={label} aria-label={label}><h3>{label}</h3><ul>{items.map(thread=><li key={thread.id}><button type="button" className="chat-thread" data-thread-id={thread.id} aria-current={thread.id===selectedId?'page':undefined} disabled={disabled} onClick={()=>onSelect(thread.id)}><span className="chat-thread-title">{thread.title||'Untitled conversation'}</span><span className="chat-thread-meta"><span>{scopeLabels[thread.scope.kind]}</span><time dateTime={thread.updatedAt}>{Number.isFinite(Date.parse(thread.updatedAt))?dateFormat.format(new Date(thread.updatedAt)):''}</time></span></button></li>)}</ul></section>:null;
   })}
  </nav>
 </div>;
}
