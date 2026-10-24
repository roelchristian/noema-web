import {useEffect,useRef,useState} from 'react';
import type {Page} from '../../shared/domain';
import type {NoteDateItem} from '../../shared/note-dates';
import type {TemporalCuration,TemporalDate,TemporalDetail,TemporalMentionSummary} from '../../shared/temporal';
import {api,ApiError} from '../api';
import {Icon} from '../components/Icon';
import {t as uiText} from '../i18n';
import {defaultCalendarSettings,type CalendarSettings} from '../settings/calendar-settings';
import {DateOverview} from './DateOverview';
import {DateLiturgicalDetails} from './DateLiturgicalDetails';

const dateDrafts=new Map<string,TemporalCuration>();
export function clearDateNoteDrafts(vaultId?:string){for(const key of dateDrafts.keys())if(!vaultId||key.startsWith(vaultId+'/'))dateDrafts.delete(key);}
const emptyDateNote=():TemporalCuration=>({label:'',annotation:'',pinned:false,importance:'ordinary',personalPriority:'ordinary',layer:'knowledge'});

/** Dates share the note inspector presentation while retaining temporal identity. */
export function NoteDatePanel({item,page,onClose,onOpenPage,onOpenCalendar,onOpenMention,calendarSettings=defaultCalendarSettings(),onOpenCalendarSettings}:{item:NoteDateItem;page:Page;onClose:()=>void;onOpenPage:(id:string)=>void;onOpenCalendar?:(date:TemporalDate)=>void;onOpenMention?:(id:string)=>Promise<void>;calendarSettings?:CalendarSettings;onOpenCalendarSettings?:()=>void}) {
 const [detail,setDetail]=useState<TemporalDetail|null>(null);
 const [mentions,setMentions]=useState<TemporalMentionSummary[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [offset,setOffset]=useState<number|null>(null),[version,setVersion]=useState(0);
 const draftKey=page.vault_id+'/'+item.id;
 const [draft,setDraft]=useState<TemporalCuration|null>(()=>dateDrafts.get(draftKey)??null),[saving,setSaving]=useState(false);
 const edit=(patch:Partial<TemporalCuration>)=>setDraft(current=>{const next={...(current??detail?.curation??emptyDateNote()),...patch};dateDrafts.set(draftKey,next);return next;});
 const leave=(action:()=>void)=>{if(draft){setError('Save or discard your date note before leaving. Your draft is retained for this date.');return;}action();};
 useEffect(()=>{if(!draft)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[draft]);
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
 useEffect(()=>{
  const controller=new AbortController();setMentions([]);setDetail(null);setError('');setLoading(true);setOffset(null);
  const timer=setTimeout(()=>{
   void api.temporalDetail(page.vault_id,item.id,0,0,controller.signal).then(detail=>{
    if(!controller.signal.aborted){setDetail(detail);setMentions(detail.mentions);setOffset(detail.nextMentionOffset);}
   }).catch(error=>{if(!controller.signal.aborted&&!(error instanceof ApiError&&error.status===404))setError(error instanceof Error?error.message:String(error));})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },300);
  return()=>{controller.abort();clearTimeout(timer);};
 },[page.vault_id,page.id,page.revision,item.id,version]);
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[page.vault_id,page.id,page.revision,item.id]);
 const others=mentions.filter(mention=>mention.pageId!==page.id);
 return <aside className="entity-panel note-date-panel" id="note-date-panel" aria-label={uiText('Date details')} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();leave(onClose);}}}>
  <div className="panel-top"><span><Icon name="event"/>{uiText('Date')}</span><button ref={close} type="button" className="page-tool" aria-label={uiText('Close date details')} onClick={()=>leave(onClose)}><Icon name="close"/></button></div>
  <div className="panel-body">
   <DateOverview date={item.date} item={detail} compact onOpenCalendar={onOpenCalendar?date=>leave(()=>onOpenCalendar(date)):undefined}/>
   <section className="eh-section"><h3>About this date</h3><label>Date note title<input disabled={loading||saving||(!detail&&!!error)} maxLength={200} value={(draft??detail?.curation)?.label??''} onChange={event=>edit({label:event.target.value})}/></label><label>Annotation<textarea disabled={loading||saving||(!detail&&!!error)} maxLength={2000} rows={3} value={(draft??detail?.curation)?.annotation??''} onChange={event=>edit({annotation:event.target.value})}/></label><label><input disabled={loading||saving||(!detail&&!!error)} type="checkbox" checked={(draft??detail?.curation)?.pinned??false} onChange={event=>edit({pinned:event.target.checked})}/>Pin this date</label>
    {draft&&<><p role="status">Unsaved date note · retained for this date</p><button type="button" className="button" disabled={saving||loading} onClick={async()=>{setSaving(true);setError('');try{await api.curateDate(page.vault_id,item.date.value,draft,item.date.calendar);dateDrafts.delete(draftKey);setDraft(null);setVersion(value=>value+1);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setSaving(false);}}}>Save date note</button><button type="button" className="button" disabled={saving} onClick={()=>{dateDrafts.delete(draftKey);setDraft(null);setError('');}}>Discard draft</button></>}
   </section>
   {!!detail?.relations?.length&&<section className="eh-section"><h3>Connections</h3><ul>{detail.relations.map(relation=><li key={relation.id}>{relation.name} · {relation.kind.replaceAll('_',' ')}</li>)}</ul>{detail.nextRelationOffset!==null&&<p>Open in Calendar for more connections.</p>}</section>}
   <DateLiturgicalDetails vaultId={page.vault_id} date={item.date} settings={calendarSettings} onOpenSettings={onOpenCalendarSettings}/>
   <section className="eh-section"><h3>{uiText('Mentioned in notes')}</h3>
    <ul className="knowledge-connected-list"><li><button type="button" onClick={()=>leave(()=>onOpenPage(page.id))}><Icon name="page"/><span>{page.title||uiText('Untitled')} · {item.count} {uiText(item.count===1?'mention':'mentions')}</span></button></li>
     {others.map(mention=><li key={mention.id}><button type="button" onClick={()=>leave(()=>{if(onOpenMention)void onOpenMention(mention.id).catch(error=>setError(error instanceof Error?error.message:String(error)));else onOpenPage(mention.pageId);})}><Icon name="page"/><span>{mention.title||uiText('Untitled')}<small>{mention.text}</small></span></button></li>)}
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
