import {useEffect,useRef,useState} from 'react';
import type {Page} from '../../shared/domain';
import type {NoteDateItem} from '../../shared/note-dates';
import type {TemporalMentionSummary} from '../../shared/temporal';
import {api,ApiError} from '../api';
import {Icon} from '../components/Icon';
import {t as uiText} from '../i18n';
import {defaultCalendarSettings,type CalendarSettings} from '../settings/calendar-settings';
import {DateLiturgicalDetails} from './DateLiturgicalDetails';

/** Dates share the note inspector presentation while retaining temporal identity. */
export function NoteDatePanel({item,page,onClose,onOpenPage,calendarSettings=defaultCalendarSettings(),onOpenCalendarSettings}:{item:NoteDateItem;page:Page;onClose:()=>void;onOpenPage:(id:string)=>void;calendarSettings?:CalendarSettings;onOpenCalendarSettings?:()=>void}) {
 const [mentions,setMentions]=useState<TemporalMentionSummary[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [offset,setOffset]=useState<number|null>(null),[version,setVersion]=useState(0);
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
 useEffect(()=>{
  const controller=new AbortController();setMentions([]);setError('');setLoading(true);setOffset(null);
  const timer=setTimeout(()=>{
   void api.temporalDetail(page.vault_id,item.id,0,0,controller.signal).then(detail=>{
    if(!controller.signal.aborted){setMentions(detail.mentions);setOffset(detail.nextMentionOffset);}
   }).catch(error=>{if(!controller.signal.aborted&&!(error instanceof ApiError&&error.status===404))setError(error instanceof Error?error.message:String(error));})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },300);
  return()=>{controller.abort();clearTimeout(timer);};
 },[page.vault_id,page.id,page.revision,item.id,version]);
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[page.vault_id,page.id,page.revision,item.id]);
 const others=mentions.filter(mention=>mention.pageId!==page.id);
 return <aside className="entity-panel note-date-panel" id="note-date-panel" aria-label={uiText('Date details')} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
  <div className="panel-top"><span><Icon name="event"/>{uiText('Date')}</span><button ref={close} type="button" className="page-tool" aria-label={uiText('Close date details')} onClick={onClose}><Icon name="close"/></button></div>
  <div className="panel-body">
   <h2 className="page-heading">{item.name}</h2>
   <section className="eh-section"><h3>{uiText('Details')}</h3><dl className="entity-overview-properties">
    <div><dt>{uiText('Date')}</dt><dd>{item.date.value}</dd></div>
    <div><dt>{uiText('Precision')}</dt><dd>{uiText(item.date.precision==='day'?'Day':item.date.precision==='month'?'Month':'Year')}</dd></div>
    <div><dt>{uiText('Calendar')}</dt><dd>{uiText(item.date.calendar==='julian'?'Julian':'Gregorian')}</dd></div>
   </dl></section>
   <DateLiturgicalDetails vaultId={page.vault_id} date={item.date} settings={calendarSettings} onOpenSettings={onOpenCalendarSettings}/>
   <section className="eh-section"><h3>{uiText('Mentioned in notes')}</h3>
    <ul className="knowledge-connected-list"><li><button type="button" onClick={()=>onOpenPage(page.id)}><Icon name="page"/><span>{page.title||uiText('Untitled')} · {item.count} {uiText(item.count===1?'mention':'mentions')}</span></button></li>
     {others.map(mention=><li key={mention.id}><button type="button" onClick={()=>onOpenPage(mention.pageId)}><Icon name="page"/><span>{mention.title||uiText('Untitled')}<small>{mention.text}</small></span></button></li>)}
    </ul>
    {loading&&<p role="status">{uiText('Loading saved mentions…')}</p>}
    {error&&<p role="alert">{error}<button type="button" className="button" onClick={()=>setVersion(value=>value+1)}>{uiText('Retry')}</button></p>}
    {offset!==null&&<button type="button" className="button" disabled={loading} onClick={async()=>{
     const controller=new AbortController();request.current?.abort();request.current=controller;setLoading(true);setError('');
     try{const detail=await api.temporalDetail(page.vault_id,item.id,offset,0,controller.signal);if(!controller.signal.aborted){setMentions(current=>[...current,...detail.mentions.filter(item=>!current.some(previous=>previous.id===item.id))]);setOffset(detail.nextMentionOffset);}}
     catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}
     finally{if(!controller.signal.aborted)setLoading(false);}
    }}>{uiText('More mentions')}</button>}
   </section>
  </div>
 </aside>;
}
