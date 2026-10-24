import {getLocale,t as uiText} from '../i18n';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {notificationMessage,runningMessage,type AINotification,type AINotificationQueue,type AIRunningActivity} from '../../shared/ai-notifications';
import {api} from '../api';
import {Icon} from '../components/Icon';
import {scheduleNotificationRead} from './notification-read-delay';

const empty:AINotificationQueue={items:[],running:[],unreadCount:0,through:0};
function useActivityFeed() {
  const [data,setData]=useState(empty),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const active=useRef(true),sequence=useRef(0),request=useRef<AbortController|null>(null),mutating=useRef(false);
  const refresh=useCallback(async()=>{
    if(mutating.current)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;const version=++sequence.current;
    try{const result=await api.aiNotifications(controller.signal);if(active.current&&version===sequence.current){setData(result);setError('');}}
    catch(cause){if(active.current&&version===sequence.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load activity.');}
    finally{if(active.current&&version===sequence.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    active.current=true;void refresh();
    const changed=()=>{if(document.visibilityState==='visible')void refresh();};
    // One shared lightweight feed, including when Inbox is closed. Never refresh the whole workspace.
    const timer=setInterval(changed,15000);
    window.addEventListener('focus',changed);document.addEventListener('visibilitychange',changed);window.addEventListener('noema:ai-activity',changed);
    return()=>{active.current=false;sequence.current++;request.current?.abort();clearInterval(timer);window.removeEventListener('focus',changed);document.removeEventListener('visibilitychange',changed);window.removeEventListener('noema:ai-activity',changed);};
  },[refresh]);
  async function markRead(body:{ids:string[]}|{through:number}) {
    if(mutating.current)return;
    mutating.current=true;setBusy(true);setError('');const version=++sequence.current;request.current?.abort();
    try{const result=await api.readAINotifications(body);if(active.current&&version===sequence.current)setData(result);}
    catch(cause){if(active.current&&version===sequence.current)setError(cause instanceof Error?cause.message:'Could not mark activity as read.');}
    finally{mutating.current=false;if(active.current){setBusy(false);if(version!==sequence.current)void refresh();}}
  }
  const reset=useCallback(()=>{sequence.current++;request.current?.abort();setData(empty);setLoading(true);void refresh();},[refresh]);
  return {data,error,busy,loading,refresh,markRead,reset};
}
const ActivityContext=createContext<ReturnType<typeof useActivityFeed>|null>(null);
export function AIActivityProvider({children}:{children:ReactNode}) {const feed=useActivityFeed();return <ActivityContext.Provider value={feed}>{children}</ActivityContext.Provider>;}
export function useAIActivity(){const feed=useContext(ActivityContext);if(!feed)throw new Error('Activity provider is missing');return feed;}
export function AIActivityUnreadCount(){return <>{useAIActivity().data.unreadCount} unread</>;}
/** The bell is only a shortcut; Inbox owns the activity workspace. */
export function AIActivityNotifications({onOpenActivity,onSourceUpdates,refreshKey,scopeKey,disabled=false}:{disabled?:boolean;onOpenActivity:()=>void;onSourceUpdates?:()=>Promise<void>;refreshKey:string;scopeKey:string}) {
  const {data,refresh,reset}=useAIActivity();
  useEffect(()=>{reset();},[scopeKey,reset]);
  useEffect(()=>{void refresh();},[refreshKey,refresh]);
  const sourceUpdates=data.items.filter(item=>item.action==='source_import'||item.action==='source_enrichment').map(item=>item.id).join(',');
  useEffect(()=>{if(sourceUpdates)void onSourceUpdates?.().catch(()=>{});},[sourceUpdates]);
  const label=`Inbox Activity${data.unreadCount?`, ${data.unreadCount} unread`:''}${data.running.length?`, ${data.running.length} in progress`:''}`;
  return <button className="page-tool ai-notification-trigger" aria-label={label} title={label} disabled={disabled} onClick={onOpenActivity}><Icon name="bell"/>{(data.unreadCount>0||data.running.length>0)&&<span className="ai-notification-dot" aria-hidden="true"/>}</button>;
}
export function InboxActivity({onOpenPage,onOpenEntity,onOpenSettings,visible=true}:{visible?:boolean;onOpenSettings:()=>void;onOpenEntity:(vault:string,entity:string,signal:AbortSignal)=>Promise<boolean>;onOpenPage:(vault:string,page:string,signal:AbortSignal)=>Promise<boolean>}) {
  const {data,error,busy,loading,refresh,markRead}=useAIActivity();
  const [filter,setFilter]=useState<'recent'|'unread'|'failed'>('recent'),[notice,setNotice]=useState(''),[opening,setOpening]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const mounted=useRef(true),opener=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;heading.current?.focus({preventScroll:true});void refresh();return()=>{mounted.current=false;opener.current?.abort();};},[refresh]);
  useEffect(()=>{
    if(!visible||!data.unreadCount||filter==='failed'||loading||error)return;
    // Preserve the bell's reading delay, but only while this view is actually mounted and visible.
    return scheduleNotificationRead(()=>void markRead({through:data.through}));
  },[data.through,data.unreadCount,filter,loading,error,visible]);
  async function openNote(item:AINotification|AIRunningActivity) {
    if(opener.current)return;const controller=new AbortController();opener.current=controller;setOpening(true);setNotice('');
    try{const opened=item.entityId?await onOpenEntity(item.vaultId,item.entityId,controller.signal):await onOpenPage(item.vaultId,item.pageId,controller.signal);if(opened&&'readAt' in item)await markRead({ids:[item.id]});else if(!opened&&!controller.signal.aborted&&mounted.current)setNotice('This item is no longer available. Refresh activity and try again.');}
    catch(cause){if(mounted.current)setNotice(cause instanceof Error?cause.message:'Could not open this item.');}
    finally{if(opener.current===controller)opener.current=null;if(mounted.current)setOpening(false);}
  }
  const items=data.items.filter(item=>filter==='unread'?!item.readAt:filter==='failed'?item.status!=='completed':true);
  return <section className="inbox-activity" aria-label="AI activity" aria-busy={loading}>
    <div className="review-section-heading"><div><h2 ref={heading} tabIndex={-1}>Activity</h2><p className="review-section-description">AI updates across unlocked vaults. Recent outcomes stay separate from work awaiting your decision.</p></div><button className="button" disabled={busy} onClick={()=>void refresh()}><Icon name="refresh"/>Refresh activity</button></div>
    <div className="ai-notifications-controls"><div role="group" aria-label="Activity filter">{(['recent','unread','failed'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='recent'?'Recent':value==='unread'?`Unread (${data.unreadCount})`:'Failed / interrupted'}</button>)}</div><button className="ai-notifications-mark-all" disabled={busy||!data.unreadCount} onClick={()=>void markRead({through:data.through})}>Mark all read</button></div>
    {loading&&<p role="status">Loading activity…</p>}
    {(error||notice)&&<p className="ai-notifications-error" role="alert">{error||notice}<button onClick={()=>{setNotice('');void refresh();}}>Retry</button></p>}
    {data.running.length>0&&<section className="ai-notifications-running" aria-label="In progress"><h3>In progress ({data.running.length})</h3>{data.running.map(item=><div key={item.id}><span className="scan-spinner" aria-hidden="true"/><button className="ai-notification-open" disabled={!item.available||opening||busy} onClick={()=>void openNote(item)}>{runningMessage(item,uiText)}</button></div>)}</section>}
    <ul className="ai-notification-list" aria-label="Recent outcomes">{items.map(item=><li key={item.id} className={item.readAt?'':'is-unread'}><span className={'ai-notification-icon '+item.status}><Icon name={item.status==='completed'?'sparkles':'alert'}/></span><button className="ai-notification-open" disabled={!item.available||busy||opening} onClick={()=>void openNote(item)}><strong>{notificationMessage(item,uiText)}</strong><small>{item.status==='completed'?'Completed':item.status==='failed'?'Failed':'Interrupted'} · {item.vaultName} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(getLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>{!item.available&&(item.entityId?' · Source unavailable':' · Note unavailable')}</small></button>{!item.readAt&&<button className="ai-notification-read" disabled={busy} aria-label={'Mark as read: '+notificationMessage(item,uiText)} title="Mark as read" onClick={()=>void markRead({ids:[item.id]})}><span aria-hidden="true"/></button>}</li>)}</ul>
    {!loading&&!error&&!items.length&&<div className="ai-notifications-empty"><Icon name="sparkles"/><strong>{filter==='unread'?'You’re all caught up':filter==='failed'?'No failed or interrupted updates':'No updates yet'}</strong><p>Source imports and AI updates appear here as they finish.</p></div>}
    <p className="review-section-description">The latest 10 outcomes are retained. Technical diagnostics and usage are available in <button type="button" className="button" onClick={onOpenSettings}>Settings → AI<Icon name="chevron"/></button></p>
  </section>;
}
