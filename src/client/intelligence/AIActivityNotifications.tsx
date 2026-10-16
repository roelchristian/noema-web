import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {notificationMessage,runningMessage,type AINotification,type AINotificationQueue} from '../../shared/ai-notifications';
import {api} from '../api';
import {Icon} from '../components/Icon';
import {AIActivityLog} from '../settings/AIActivityLog';

const empty:AINotificationQueue={items:[],running:[],unreadCount:0,through:0};
export function AIActivityNotifications({onOpenPage,refreshKey}:{onOpenPage:(vault:string,page:string)=>Promise<void>;refreshKey:string}) {
  const [data,setData]=useState(empty),[open,setOpen]=useState(false),[tab,setTab]=useState<'unread'|'recent'>('unread');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[logOpen,setLogOpen]=useState(false),[loading,setLoading]=useState(true);
  const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null);
  const active=useRef(true),sequence=useRef(0),request=useRef<AbortController|null>(null),mutating=useRef(false);
  async function refresh() {
    if(mutating.current) return;
    request.current?.abort(); const controller=new AbortController(); request.current=controller;
    const version=++sequence.current;
    try {const result=await api.aiNotifications(controller.signal);if(active.current&&version===sequence.current){setData(result);setError('');}}
    catch(error){if(active.current&&version===sequence.current&&!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load AI activity.');}
    finally {if(active.current&&version===sequence.current)setLoading(false);}
  }
  useEffect(()=>{
    active.current=true; void refresh();
    const changed=()=>{if(document.visibilityState==='visible')void refresh();};
    const timer=setInterval(changed,5000);
    window.addEventListener('focus',changed);document.addEventListener('visibilitychange',changed);window.addEventListener('noema:ai-activity',changed);
    return()=>{active.current=false;sequence.current++;request.current?.abort();clearInterval(timer);window.removeEventListener('focus',changed);document.removeEventListener('visibilitychange',changed);window.removeEventListener('noema:ai-activity',changed);};
  },[]);
  useEffect(()=>{void refresh();},[refreshKey]);
  useLayoutEffect(()=>{
    if(!open)return;
    const menu=popup.current!,button=trigger.current!;
    menu.showPopover();
    const position=()=>{const box=button.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-bounds.width,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+4,innerHeight-bounds.height-8))+'px';};
    position();menu.focus({preventScroll:true});void refresh();
    window.addEventListener('resize',position);
    return()=>window.removeEventListener('resize',position);
  },[open]);
  function close() {popup.current?.hidePopover();setOpen(false);}
  async function markRead(body:{ids:string[]}|{through:number}) {
    if(mutating.current)return;
    mutating.current=true;setBusy(true);setError('');sequence.current++;request.current?.abort();
    try {const result=await api.readAINotifications(body);if(active.current)setData(result);}
    catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not mark activity as read.');}
    finally{mutating.current=false;if(active.current)setBusy(false);}
  }
  async function openNote(item:AINotification) {
    try {await onOpenPage(item.vaultId,item.pageId);await markRead({ids:[item.id]});if(active.current)close();}
    catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not open this note.');}
  }
  const items=tab==='unread'?data.items.filter(item=>!item.readAt):[...data.items].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const label=`AI activity${data.unreadCount?`, ${data.unreadCount} unread`:''}${data.running.length?`, ${data.running.length} in progress`:''}`;
  return <>
    <button ref={trigger} className="page-tool ai-notification-trigger" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls="ai-notifications" onClick={()=>open?close():setOpen(true)}><Icon name="bell"/>{(data.unreadCount>0||data.running.length>0)&&<span className="ai-notification-dot" aria-hidden="true"/>}</button>
    <div ref={popup} id="ai-notifications" className="ai-notifications" popover="auto" role="dialog" aria-labelledby="ai-notifications-title" tabIndex={-1} onToggle={event=>{if(!event.currentTarget.matches(':popover-open'))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger.current?.focus();}}}>
      <header className="ai-notifications-heading"><h2 id="ai-notifications-title">AI activity</h2><button className="page-tool" aria-label="Close AI activity" onClick={()=>{close();trigger.current?.focus();}}><Icon name="close"/></button></header>
      <div className="ai-notifications-controls"><div role="group" aria-label="Activity filter"><button aria-pressed={tab==='unread'} onClick={()=>setTab('unread')}>Unread{data.unreadCount>0&&<span>{data.unreadCount}</span>}</button><button aria-pressed={tab==='recent'} onClick={()=>setTab('recent')}>Recent</button></div><button className="ai-notifications-mark-all" disabled={busy||!data.unreadCount} onClick={()=>void markRead({through:data.through})}>Mark all read</button></div>
      <div className="ai-notifications-body">
        {loading&&<p className="ai-notifications-loading" role="status">Loading activity…</p>}
        {error&&<p className="ai-notifications-error" role="alert">{error}<button onClick={()=>void refresh()}>Retry</button></p>}
        {data.running.length>0&&<section className="ai-notifications-running" aria-label="In progress"><h3>In progress</h3>{data.running.map(item=><div key={item.id}><span className="scan-spinner" aria-hidden="true"/><span>{runningMessage(item)}</span></div>)}</section>}
        <ul className="ai-notification-list">{items.map(item=><li key={item.id} className={item.readAt?'':'is-unread'}><span className={'ai-notification-icon '+item.status}><Icon name={item.status==='completed'?'sparkles':'alert'}/></span><button className="ai-notification-open" disabled={!item.available||busy} onClick={()=>void openNote(item)}><strong>{notificationMessage(item)}</strong><small>{item.vaultName}<span> · </span><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{new Date(item.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{!item.available&&' · Note unavailable'}</small></button>{!item.readAt&&<button className="ai-notification-read" disabled={busy} aria-label={'Mark as read: '+notificationMessage(item)} title="Mark as read" onClick={()=>void markRead({ids:[item.id]})}><span aria-hidden="true"/></button>}</li>)}</ul>
        {!loading&&!items.length&&!error&&<div className="ai-notifications-empty"><Icon name="sparkles"/><strong>{tab==='unread'?'You’re all caught up':'No AI updates yet'}</strong><p>Titles, summaries, and entity scans appear here as they finish.</p></div>}
      </div>
      <footer className="ai-notifications-footer"><span>{data.running.length?`${data.running.length} in progress`:'Updates saved locally'}</span><button onClick={()=>{close();setLogOpen(true);}}>View full activity log<Icon name="chevron"/></button></footer>
    </div>
    {logOpen&&<AIActivityLog onOpenPage={async(vault,page)=>{await onOpenPage(vault,page);setLogOpen(false);}} onClose={()=>setLogOpen(false)}/>}
  </>;
}
