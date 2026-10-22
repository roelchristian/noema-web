import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {api,ApiError} from '../api';
import {Icon} from '../components/Icon';
import {temporalDate,type TemporalCuration,type TemporalDetail,type TemporalItem,type TemporalLayer,type TemporalResults} from '../../shared/temporal';
import {calendarGroups,civilDate,dateLabel,emptyCuration,layerLabels,monthBounds,monthCells,shiftDay,shiftMonth,todayValue,type CalendarView} from './calendar-model';

export function CalendarWorkspace({vaultId,view,onChange,mobile,onOpenMention}:{vaultId:string;view:CalendarView;onChange:(patch:Partial<CalendarView>)=>void;mobile:boolean;onOpenMention:(id:string)=>Promise<void>}) {
 const [results,setResults]=useState<TemporalResults|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0);
 const [detail,setDetail]=useState<TemporalDetail|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(''),[actionError,setActionError]=useState(''),[acting,setActing]=useState(false),[notice,setNotice]=useState('');
 const [focusDay,setFocusDay]=useState(view.selected?.startsWith(view.month)&&view.selected.length===10?view.selected:monthBounds(view.month).from);
 const root=useRef<HTMLElement>(null),sheet=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),focusGrid=useRef(false),request=useRef<AbortController|null>(null),detailRequest=useRef<AbortController|null>(null);
 const actionSequence=useRef(0);
 const current=useRef('');current.current=JSON.stringify([vaultId,view.selected]);
 const selected=view.selected,queryKey=JSON.stringify([vaultId,view.month,view.layers,view.allReferences,version]);
 useEffect(()=>{
  const controller=new AbortController();request.current?.abort();request.current=controller;setResults(null);setLoading(true);setError('');
  const {from,to}=monthBounds(view.month);
  api.temporalDates(vaultId,from,to,{allReferences:view.allReferences,layers:view.layers},controller.signal).then(result=>{if(!controller.signal.aborted)setResults(result);}).catch(error=>{if(!controller.signal.aborted)setError(error.message||'Could not load calendar.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[queryKey]);
 useLayoutEffect(()=>{
  if(!focusDay.startsWith(view.month)){setFocusDay(monthBounds(view.month).from);return;}
  if(focusGrid.current){root.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus();focusGrid.current=false;}
 },[view.month,focusDay]);
 useEffect(()=>{
  setDetail(null);setDetailError('');setActionError('');
  if(!selected)return;
  const date=temporalDate(selected);if(!date)return;
  const controller=new AbortController();detailRequest.current?.abort();detailRequest.current=controller;setDetailLoading(true);
  api.temporalDetail(vaultId,date.id,0,0,controller.signal).then(result=>{if(!controller.signal.aborted)setDetail(result);}).catch(error=>{
   if(controller.signal.aborted)return;
   if(error instanceof ApiError&&error.status===404)setDetail({date,curation:null,layer:'knowledge',mentions:[],mentionCount:0,relations:[],relationCount:0,nextMentionOffset:null,nextRelationOffset:null});
   else setDetailError(error.message||'Could not load this date.');
  }).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});
  return()=>controller.abort();
 },[vaultId,selected,version]);
 useEffect(()=>{
  const dialog=sheet.current;if(!dialog)return;
  if(mobile&&selected&&!dialog.open)dialog.showModal();
  if((!mobile||!selected)&&dialog.open)dialog.close();
 },[mobile,selected]);
 useEffect(()=>{actionSequence.current++;setActing(false);setNotice('');},[vaultId,selected]);
 useEffect(()=>()=>{request.current?.abort();detailRequest.current?.abort();},[]);
 function choose(value:string,element?:HTMLElement) {trigger.current=element??document.activeElement as HTMLElement;setActionError('');onChange({selected:value});}
 function close() {onChange({selected:null});requestAnimationFrame(()=>{if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});else root.current?.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]')?.focus();});}
 function gridKey(event:KeyboardEvent<HTMLButtonElement>,value:string) {
  let next:string|undefined;
  if(event.key==='ArrowLeft')next=shiftDay(value,-1);if(event.key==='ArrowRight')next=shiftDay(value,1);if(event.key==='ArrowUp')next=shiftDay(value,-7);if(event.key==='ArrowDown')next=shiftDay(value,7);
  if(event.key==='Home')next=shiftDay(value,-((civilDate(value).getUTCDay()+6)%7));if(event.key==='End')next=shiftDay(value,6-(civilDate(value).getUTCDay()+6)%7);
  if(event.key==='PageUp'||event.key==='PageDown'){const month=shiftMonth(value.slice(0,7),event.key==='PageUp'?-1:1);next=month+'-'+String(Math.min(Number(value.slice(-2)),Number(monthBounds(month).to.slice(-2)))).padStart(2,'0');}
  if(!next||next.length!==10||next<'0001-01-01'||next>'9999-12-31')return;event.preventDefault();focusGrid.current=true;setFocusDay(next);if(next.slice(0,7)!==view.month)onChange({month:next.slice(0,7)});
 }
 async function more() {
  if(!results||results.nextOffset===null)return;
  const controller=new AbortController();request.current?.abort();request.current=controller;setLoading(true);setError('');
  const {from,to}=monthBounds(view.month);
  try {const result=await api.temporalDates(vaultId,from,to,{allReferences:view.allReferences,layers:view.layers,offset:results.nextOffset},controller.signal);if(!controller.signal.aborted)setResults({...result,items:[...results.items,...result.items.filter(item=>!results.items.some(old=>old.date.id===item.date.id))]});}
  catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load more dates.');}finally{if(!controller.signal.aborted)setLoading(false);}
 }
 async function moreEvidence(kind:'mentions'|'relations') {
  if(!detail)return;const key=current.current,controller=new AbortController();detailRequest.current?.abort();detailRequest.current=controller;setDetailLoading(true);setActionError('');
  try {const result=await api.temporalDetail(vaultId,detail.date.id,kind==='mentions'?detail.nextMentionOffset??0:0,kind==='relations'?detail.nextRelationOffset??0:0,controller.signal);
   if(!controller.signal.aborted&&current.current===key)setDetail({...result,mentions:kind==='mentions'?[...detail.mentions,...result.mentions]:detail.mentions,relations:kind==='relations'?[...detail.relations,...result.relations]:detail.relations,nextMentionOffset:kind==='mentions'?result.nextMentionOffset:detail.nextMentionOffset,nextRelationOffset:kind==='relations'?result.nextRelationOffset:detail.nextRelationOffset});
  }catch(error){if(!controller.signal.aborted)setActionError(error instanceof Error?error.message:'Could not load more evidence.');}finally{if(!controller.signal.aborted)setDetailLoading(false);}
 }
 async function mutate(remove=false) {
  if(!selected||!detail)return;const key=current.current,sequence=++actionSequence.current;setActing(true);setActionError('');setNotice('');
  try {if(remove)await api.uncurateDate(vaultId,detail.date.id);else await api.curateDate(vaultId,selected,view.drafts[selected]??detail.curation??emptyCuration());
   if(current.current!==key||sequence!==actionSequence.current)return;
   const drafts={...view.drafts};delete drafts[selected];onChange({drafts});setVersion(value=>value+1);setNotice(remove?'Curation removed. Page evidence is retained.':'Date curation saved.');
  }catch(error){if(current.current===key&&sequence===actionSequence.current)setActionError(error instanceof Error?error.message:'Could not save date curation.');}finally{if(current.current===key&&sequence===actionSequence.current)setActing(false);}
 }
 async function openEvidence(id:string) {const key=current.current,sequence=++actionSequence.current;setActing(true);setActionError('');try{await onOpenMention(id);}catch(error){if(current.current===key&&sequence===actionSequence.current)setActionError(error instanceof Error?error.message:'Could not open evidence.');}finally{if(current.current===key&&sequence===actionSequence.current)setActing(false);}}
 const {days,periods}=calendarGroups(results?.items??[]),draft=selected?(view.drafts[selected]??detail?.curation??emptyCuration()):emptyCuration();
 function edit(patch:Partial<TemporalCuration>) {if(selected)onChange({drafts:{...view.drafts,[selected]:{...draft,...patch}}});}
 const caption=(item:TemporalItem)=>item.curation?.label||item.relations[0]?.name||`${item.mentionCount} reference${item.mentionCount===1?'':'s'}`;
 const card=(item:TemporalItem)=><button type="button" className="calendar-entry" key={item.date.id} onClick={event=>choose(item.date.value,event.currentTarget)}><span><strong>{dateLabel(item.date.value)}</strong><small>{layerLabels[item.layer]} · {item.date.precision==='day'?'Exact day':item.date.precision==='month'?'Month precision':'Year precision'}{item.curation?.pinned?' · Pinned':''}</small></span><span>{caption(item)}</span><Icon name="chevron"/></button>;
 const inspector=<>
  <header className="calendar-inspector-heading"><div><p className="calendar-eyebrow">DATE INSPECTOR</p><h2 id="calendar-date-heading">{selected?dateLabel(selected):''}</h2><p>{selected?.length===10?'Exact civil day':selected?.length===7?'Month precision · no day assigned':'Year precision · no day assigned'}</p></div><button className="button" type="button" aria-label="Close date inspector" onClick={close}><Icon name="close"/></button></header>
  {detailLoading&&!detail&&<p role="status">Loading date evidence…</p>}
  {detailError&&<div role="alert" className="calendar-status" data-status="danger">{detailError}<button className="button" type="button" onClick={()=>setVersion(value=>value+1)}>Retry date</button></div>}
  {detail&&<>
   <section className="calendar-evidence" aria-label="Date evidence" aria-busy={detailLoading}>{detailLoading&&<p role="status">Loading more evidence…</p>}<h3>Linked knowledge <span>{detail.mentionCount+detail.relationCount}</span></h3>
    {!detail.mentions.length&&!detail.relations.length&&<p className="calendar-muted">No indexed evidence for this {detail.date.precision}. You can curate it independently.</p>}
    {detail.mentions.map(mention=><button className="calendar-evidence-link" type="button" key={mention.id} disabled={acting} onClick={()=>void openEvidence(mention.id)}><Icon name="pages"/><span><strong>{mention.title||'Untitled page'}</strong><small>“{mention.text}” · Open original passage</small></span><Icon name="external-link"/></button>)}
    {detail.relations.map(relation=><div className="calendar-relation" key={relation.id}><strong>{relation.name}</strong><small>{relation.kind.replaceAll('_',' ')} · Explicit relationship</small>{relation.evidence.status==='current'&&relation.mentionId?<button className="button" type="button" disabled={acting} onClick={()=>void openEvidence(relation.mentionId!)}>Open supporting passage</button>:<p data-status="warning">{relation.evidence.status==='stale'?'Stale evidence':relation.evidence.status==='unavailable'?'Evidence unavailable':'No resolved evidence'} · {relation.evidence.reason}</p>}</div>)}
    {detail.nextMentionOffset!==null&&<button className="button" type="button" disabled={detailLoading} onClick={()=>void moreEvidence('mentions')}>Load more references</button>}
    {detail.nextRelationOffset!==null&&<button className="button" type="button" disabled={detailLoading} onClick={()=>void moreEvidence('relations')}>Load more relationships</button>}
    <button className="button" type="button" disabled={acting||detailLoading} onClick={()=>setVersion(value=>value+1)}>Refresh evidence</button>
   </section>
   <form className="calendar-curation" onSubmit={event=>{event.preventDefault();void mutate();}}>
    <div><h3>Curate this {detail.date.precision==='day'?'date':'period'}</h3><p>Choose its meaning. Detected references do not become commitments.</p></div>
    <div className="calendar-field"><label htmlFor="calendar-label">Label</label><input id="calendar-label" disabled={acting} value={draft.label} maxLength={200} placeholder="An optional name" onChange={event=>edit({label:event.target.value})}/></div>
    <div className="calendar-field"><label htmlFor="calendar-layer">Layer</label><select id="calendar-layer" disabled={acting} value={draft.layer} onChange={event=>edit({layer:event.target.value as TemporalLayer})}>{Object.entries(layerLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>
    <div className="calendar-form-row"><div className="calendar-field"><label htmlFor="calendar-importance">Significance</label><select id="calendar-importance" disabled={acting} value={draft.importance} onChange={event=>edit({importance:event.target.value as TemporalCuration['importance']})}><option value="ordinary">Ordinary</option><option value="notable">Notable</option><option value="important">Important</option></select></div><div className="calendar-field"><label htmlFor="calendar-priority">Personal priority</label><select id="calendar-priority" disabled={acting} value={draft.personalPriority} onChange={event=>edit({personalPriority:event.target.value as TemporalCuration['personalPriority']})}><option value="ordinary">Ordinary</option><option value="important">Important to me</option></select></div></div>
    <div className="calendar-field"><label htmlFor="calendar-annotation">Annotation</label><textarea id="calendar-annotation" rows={3} maxLength={2000} disabled={acting} value={draft.annotation} placeholder="Why this date matters" onChange={event=>edit({annotation:event.target.value})}/></div>
    <label className="calendar-check"><input type="checkbox" disabled={acting} checked={draft.pinned} onChange={event=>edit({pinned:event.target.checked})}/>Pin this date</label>
    {selected&&view.drafts[selected]&&<p className="calendar-muted">Unsaved curation · retained while you explore</p>}
    <div className="calendar-form-row"><button className="button primary" type="submit" disabled={acting}>{acting?'Working…':'Save curation'}</button>{detail.curation&&<button className="button" type="button" disabled={acting} onClick={()=>void mutate(true)}>Remove curation</button>}</div>
   </form>
  </>}
  {actionError&&<p className="calendar-status" role="alert" data-status="danger">{actionError}</p>}{notice&&<p role="status">{notice}</p>}
 </>;
 return <section className={'calendar-workspace'+(selected?' has-inspector':'')} ref={root} aria-label="Calendar workspace" onKeyDown={event=>{if(event.key==='Escape'&&selected&&!mobile){event.stopPropagation();close();}}}>
  <div className="calendar-main"><header className="calendar-heading"><div><p className="calendar-eyebrow">YOUR KNOWLEDGE, IN TIME</p><h1>Calendar</h1><p>Important dates, with the knowledge behind them.</p></div><div className="calendar-heading-actions"><div className="calendar-view-switch" role="group" aria-label="Calendar view">{(['month','agenda'] as const).map(mode=><button type="button" key={mode} aria-pressed={view.mode===mode} onClick={()=>onChange({mode})}>{mode==='month'?'Month':'Agenda'}</button>)}</div><button type="button" className="button" aria-label="Refresh calendar" disabled={loading} onClick={()=>setVersion(value=>value+1)}><Icon name="refresh"/></button></div></header>
  <div className="calendar-month-bar"><h2>{dateLabel(view.month)}</h2><div><button type="button" className="button" aria-label="Previous month" disabled={view.month==='0001-01'} onClick={()=>onChange({month:shiftMonth(view.month,-1)})}><Icon name="arrow-left"/></button><button type="button" className="button" onClick={event=>{trigger.current=event.currentTarget;const value=todayValue();setFocusDay(value);onChange({month:value.slice(0,7),selected:value});}}>Today</button><button type="button" className="button" aria-label="Next month" disabled={view.month==='9999-12'} onClick={()=>onChange({month:shiftMonth(view.month,1)})}><Icon name="chevron"/></button></div></div>
  <div className="calendar-filters"><fieldset><legend className="sr-only">Calendar layers</legend>{(['personal','knowledge','historical'] as const).map(layer=><label className="calendar-check" key={layer}><input type="checkbox" checked={view.layers.includes(layer)} onChange={()=>onChange({layers:view.layers.includes(layer)?view.layers.filter(value=>value!==layer):[...view.layers,layer]})}/>{layerLabels[layer]}</label>)}</fieldset><label className="calendar-check"><input type="checkbox" checked={view.allReferences} onChange={event=>onChange({allReferences:event.target.checked})}/>All references</label></div>
  <p className="calendar-scope">{view.allReferences?'Showing detected references alongside curated dates.':'Curated dates and explicit relationships. Enable All references to explore detected dates.'}</p>
  {loading&&<p role="status" className="calendar-status">Loading calendar…</p>}{error&&<div role="alert" data-status="danger" className="calendar-status">{error}<button className="button" type="button" onClick={()=>setVersion(value=>value+1)}>Retry calendar</button></div>}
  {!!results?.indexing.pending&&<div className="calendar-status" role="status" data-status="info">{results.indexing.pending} saved pages still need indexing. Results are partial.<button className="button" type="button" disabled={loading} onClick={()=>setVersion(value=>value+1)}>Continue indexing</button></div>}
  {periods.length>0&&<section className="calendar-periods" aria-label="Month and year periods"><h3>Across this period <span>Dates without an exact day</span></h3>{periods.map(card)}</section>}
  {view.mode==='month'?<div role="grid" className="calendar-grid" aria-label={dateLabel(view.month)} aria-describedby="calendar-keyboard-help"><div role="row" className="calendar-weekdays">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><span role="columnheader" key={day}>{day}</span>)}</div>{monthCells(view.month).map((week,i)=><div role="row" className="calendar-week" key={i}>{week.map((value,j)=>{
    const items=days.filter(item=>item.date.value===value);return <div role="gridcell" aria-selected={!!value&&selected===value} className={value?'calendar-cell':'calendar-cell is-empty'} key={value??j}>{value&&<button type="button" data-date={value} tabIndex={focusDay===value?0:-1} aria-label={`${dateLabel(value)}${items.length?', '+items.map(caption).join('; '):''}`} aria-current={value===todayValue()?'date':undefined} onFocus={()=>setFocusDay(value)} onKeyDown={event=>gridKey(event,value)} onClick={event=>choose(value,event.currentTarget)}><span className="calendar-day-number">{Number(value.slice(-2))}</span>{items.slice(0,2).map(item=><span className="calendar-cell-entry" key={item.date.id}>{caption(item)}</span>)}{items.length>2&&<span className="calendar-more">+{items.length-2} more</span>}{!!items.length&&<span className="calendar-mobile-dot" aria-hidden="true">•</span>}</button>}</div>;
   })}</div>)}</div>:<section className="calendar-agenda" aria-label="Dated agenda">{days.map(card)}</section>}
  {results&&!results.items.length&&!loading&&<div className="calendar-empty"><Icon name="event"/><h3>{view.layers.length?'No matching dates this month':'Choose a calendar layer'}</h3><p>{view.allReferences?'No indexed references match these filters. Select a day to curate it.':'Select a day to give it significance, or enable All references to explore your pages.'}</p></div>}
  {results?.nextOffset!==null&&results&&<div className="calendar-pagination"><p>More dates are available. This view shows a partial list.</p><button className="button" type="button" disabled={loading} onClick={()=>void more()}>Load more dates</button></div>}
  <p className="calendar-footer" id="calendar-keyboard-help">Gregorian civil calendar · Arrow keys move between days; Enter opens a date. Month/year references retain their precision.</p>
  </div>
  {selected&&(mobile?<dialog ref={sheet} className="calendar-sheet" aria-labelledby="calendar-date-heading" onCancel={event=>{event.preventDefault();close();}} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>{inspector}</dialog>:<aside className="calendar-inspector" aria-labelledby="calendar-date-heading">{inspector}</aside>)}
 </section>;
}
