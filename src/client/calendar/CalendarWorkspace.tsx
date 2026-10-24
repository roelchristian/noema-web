import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {CalendarMonthGrid} from './CalendarMonthGrid';
import {CalendarMonthJump} from './CalendarMonthJump';
import {liturgicalLabel,liturgicalRankLabel} from './liturgical-label';
import {useLiturgicalYear} from './use-liturgical-year';
import {LiturgicalDayPanel} from './LiturgicalDayPanel';
import {liturgicalCalendar} from '../../shared/liturgical';
import type {CalendarSettings} from '../settings/calendar-settings';
import type {Entity} from '../../shared/domain';
import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {api,ApiError} from '../api';
import {Icon} from '../components/Icon';
import {temporalDate,type TemporalCuration,type TemporalDetail,type TemporalItem,type TemporalLayer,type TemporalResults} from '../../shared/temporal';
import {calendarGroups,civilDate,dateLabel,dateSummary,dateAssociations,emptyCuration,layerLabels,monthBounds,monthCells,shiftDay,shiftMonth,todayValue,type CalendarView} from './calendar-model';

export function CalendarWorkspace({settings,onOpenSettings,vaultId,view,onChange,mobile,onOpenMention,onOpenSource,onOpenEntity,entities=[],evidenceOpen=false}:{settings:CalendarSettings;onOpenSettings:()=>void;vaultId:string;view:CalendarView;onChange:(patch:Partial<CalendarView>)=>void;mobile:boolean;onOpenMention:(id:string)=>Promise<void>;onOpenSource?:(id:string,trigger:HTMLElement)=>Promise<void>;onOpenEntity?:(id:string)=>void;entities?:Entity[];evidenceOpen?:boolean}) {
 const destination=useContext(ReviewDestination);
 const reviewDateId=destination?.category==='temporal'&&destination.dateId===(view.selectedId??temporalDate(view.selected??'',view.calendar)?.id)?destination.dateId:undefined;
 const activeCalendar=view.selectedId?.startsWith('julian:')?'julian':view.selectedId?'gregorian':view.calendar??'gregorian';
 const selectedId=view.selectedId??temporalDate(view.selected??'',activeCalendar)?.id??null;
 const contentFilter=view.contentFilter??(view.allReferences?'all':'linked');
 const [inspectorTab,setInspectorTab]=useState<'overview'|'connections'|'evidence'>('overview');
 const [addAction,setAddAction]=useState<'note'|'event'|'link'|null>(null),[eventName,setEventName]=useState('');
 const reviewProposalId=reviewDateId?destination?.proposalId:undefined;
 const {enabled:overlayEnabled,optional:overlayOptional,calendarId}=settings;
 const weekStart=settings.weekStart??0,liturgicalLabels=settings.liturgicalLabels??'off',labelsEnabled=liturgicalLabels!=='off',supplementEnabled=overlayEnabled||labelsEnabled;
 const [availableWidth,setAvailableWidth]=useState<number|null>(null),[optionalDate,setOptionalDate]=useState<string|null>(null);
 const modal=mobile||(availableWidth!==null&&availableWidth<1000);
 const supplement=liturgicalCalendar(calendarId)!;
 const [storedResults,setResults]=useState<TemporalResults|null>(null),[resultScope,setResultScope]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0);
 const [detail,setDetail]=useState<TemporalDetail|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(''),[actionError,setActionError]=useState(''),[acting,setActing]=useState(false),[notice,setNotice]=useState('');
 const [focusDay,setFocusDay]=useState(view.selected?.startsWith(view.month)&&view.selected.length===10?view.selected:monthBounds(view.month).from);
 const root=useRef<HTMLElement>(null),sheet=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),focusGrid=useRef(false),request=useRef<AbortController|null>(null),detailRequest=useRef<AbortController|null>(null);
 const proposalElement=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(reviewProposalId)setInspectorTab('evidence');if(reviewProposalId&&detail?.proposals?.some(proposal=>proposal.id===reviewProposalId)){proposalElement.current?.scrollIntoView?.({block:'nearest'});proposalElement.current?.focus({preventScroll:true});}},[reviewProposalId,detail]);
 const actionSequence=useRef(0);
 const current=useRef('');current.current=JSON.stringify([vaultId,view.selected,selectedId]);
 const visibleYear=Number(view.month.slice(0,4)),selectedYear=Number(view.selected?.slice(0,4)??visibleYear);
 const liturgical=useLiturgicalYear(vaultId,visibleYear,supplementEnabled,calendarId),otherLiturgical=useLiturgicalYear(vaultId,selectedYear,overlayEnabled&&!!view.selected&&selectedYear!==visibleYear,calendarId);
 const previousLiturgical=useLiturgicalYear(vaultId,visibleYear-1,supplementEnabled&&view.month.endsWith('-01')&&visibleYear>1,calendarId);
 const nextLiturgical=useLiturgicalYear(vaultId,visibleYear+1,supplementEnabled&&view.month.endsWith('-12')&&visibleYear<9999,calendarId);
 const inspectorLiturgical=selectedYear===visibleYear?liturgical:otherLiturgical;
 const visibleDates=monthCells(view.month,weekStart).flat().filter((date):date is string=>date!==null);
 const range=view.mode==='month'?{from:visibleDates[0]!,to:visibleDates[visibleDates.length-1]!}:monthBounds(view.month);
 const selected=view.selected,scope=JSON.stringify([vaultId,view.month,range.from,range.to,view.layers,view.allReferences,view.calendar,contentFilter]),queryKey=JSON.stringify([scope,version]);
 const results=resultScope===scope?storedResults:null;
 const previousScope=useRef('');
 const previousModal=useRef(modal);
 const resizedFocus=useRef<{id:string;start:number|null;end:number|null}|null>(null);

 function rememberField(target:EventTarget|null) {
  if((target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement)&&target.id){
   const text=target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement;
   resizedFocus.current={id:target.id,start:text?target.selectionStart:null,end:text?target.selectionEnd:null};
  }else resizedFocus.current=null;
 }
 useLayoutEffect(()=>{
  const node=root.current;if(!node||typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(entries=>{
   const focused=document.activeElement;
   if(focused&&node.contains(focused)&&(focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement||focused instanceof HTMLSelectElement))rememberField(focused);
   setAvailableWidth(entries[0]!.contentRect.width);
  });
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const controller=new AbortController();request.current?.abort();request.current=controller;if(previousScope.current!==scope)setResults(null);previousScope.current=scope;setLoading(true);setError('');
  const {from,to}=range;
  api.temporalDates(vaultId,from,to,{allReferences:view.allReferences,calendar:view.calendar,layers:view.layers},controller.signal).then(result=>{if(!controller.signal.aborted){setResultScope(scope);setResults(result);}}).catch(error=>{if(!controller.signal.aborted)setError(error.message||'Could not load calendar.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[queryKey]);
 useLayoutEffect(()=>{
  if(!visibleDates.includes(focusDay)){setFocusDay(monthBounds(view.month).from);return;}
  if(focusGrid.current){root.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus();focusGrid.current=false;}
 },[view.month,weekStart,focusDay]);
 useEffect(()=>{
  setDetail(null);setDetailError('');setActionError('');
  if(!selected)return;
  const date=temporalDate(selected,activeCalendar);if(!date)return;
  const controller=new AbortController();detailRequest.current?.abort();detailRequest.current=controller;setDetailLoading(true);
  api.temporalDetail(vaultId,date.id,0,0,controller.signal,{proposalId:reviewProposalId}).then(result=>{if(!controller.signal.aborted)setDetail(result);}).catch(error=>{
   if(controller.signal.aborted)return;
   if(error instanceof ApiError&&error.status===404)setDetail({date,curation:null,layer:'knowledge',mentions:[],mentionCount:0,relations:[],relationCount:0,nextMentionOffset:null,nextRelationOffset:null});
   else setDetailError(error.message||'Could not load this date.');
  }).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});
  return()=>controller.abort();
 },[vaultId,selected,selectedId,version,reviewDateId,reviewProposalId]);
 useEffect(()=>{
  const saved=previousModal.current!==modal?resizedFocus.current:null;previousModal.current=modal;resizedFocus.current=null;
  const dialog=sheet.current;
  if(dialog){
   if(modal&&selected&&!evidenceOpen&&!dialog.open)dialog.showModal();
   if((!modal||!selected||evidenceOpen)&&dialog.open)dialog.close();
  }
  if(saved)requestAnimationFrame(()=>{const field=document.getElementById(saved.id);if(field instanceof HTMLElement){field.focus();if((field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement)&&saved.start!==null&&saved.end!==null)field.setSelectionRange(saved.start,saved.end);}});
 },[modal,selected,evidenceOpen]);
 useEffect(()=>{actionSequence.current++;setActing(false);setNotice('');},[vaultId,selected]);
 useEffect(()=>()=>{request.current?.abort();detailRequest.current?.abort();},[]);
 function choose(value:string,element?:HTMLElement,id?:string) {trigger.current=element??document.activeElement as HTMLElement;setActionError('');setInspectorTab('overview');setAddAction(null);if(selectedId&&view.drafts[selectedId])setNotice('Unsaved changes are kept for the previous date. Return to that date to save them.');onChange({selected:value,selectedId:id??temporalDate(value,view.calendar)?.id??null});}
 function close() {if(selectedId&&view.drafts[selectedId])setNotice('Unsaved date changes are kept in this workspace. Return to the date to save them.');onChange({selected:null,selectedId:null});requestAnimationFrame(()=>{if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});else root.current?.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]')?.focus();});}
 function gridKey(event:KeyboardEvent<HTMLButtonElement>,value:string) {
  let next:string|undefined;
  if(event.key==='ArrowLeft')next=shiftDay(value,-1);if(event.key==='ArrowRight')next=shiftDay(value,1);if(event.key==='ArrowUp')next=shiftDay(value,-7);if(event.key==='ArrowDown')next=shiftDay(value,7);
  const column=(civilDate(value).getUTCDay()-weekStart+7)%7;
  if(event.key==='Home')next=shiftDay(value,-column);if(event.key==='End')next=shiftDay(value,6-column);
  if(event.key==='PageUp'||event.key==='PageDown'){const month=shiftMonth(value.slice(0,7),event.key==='PageUp'?-1:1);next=month+'-'+String(Math.min(Number(value.slice(-2)),Number(monthBounds(month).to.slice(-2)))).padStart(2,'0');}
  if(!next||next.length!==10||next<'0001-01-01'||next>'9999-12-31')return;event.preventDefault();focusGrid.current=true;setFocusDay(next);if((event.key==='PageUp'||event.key==='PageDown'||!visibleDates.includes(next))&&next.slice(0,7)!==view.month)onChange({month:next.slice(0,7)});
 }
 async function more() {
  if(!results||results.nextOffset===null)return;
  const controller=new AbortController();request.current?.abort();request.current=controller;setLoading(true);setError('');
  const {from,to}=range;
  try {const result=await api.temporalDates(vaultId,from,to,{allReferences:view.allReferences,calendar:view.calendar,layers:view.layers,offset:results.nextOffset},controller.signal);if(!controller.signal.aborted)setResults({...result,items:[...results.items,...result.items.filter(item=>!results.items.some(old=>old.date.id===item.date.id))]});}
  catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load more dates.');}finally{if(!controller.signal.aborted)setLoading(false);}
 }
 async function moreEvidence(kind:'mentions'|'relations'|'sources'|'properties'|'proposals') {
  if(!detail)return;const key=current.current,controller=new AbortController();detailRequest.current?.abort();detailRequest.current=controller;setDetailLoading(true);setActionError('');
  const fields={mentions:'nextMentionOffset',relations:'nextRelationOffset',sources:'nextSourceOffset',properties:'nextPropertyOffset',proposals:'nextProposalOffset'} as const,field=fields[kind];
  try {const offset=detail[field]??0,result=await api.temporalDetail(vaultId,detail.date.id,kind==='mentions'?offset:0,kind==='relations'?offset:0,controller.signal,{sourceOffset:kind==='sources'?offset:0,propertyOffset:kind==='properties'?offset:0,proposalOffset:kind==='proposals'?offset:0,proposalId:reviewProposalId});
   if(!controller.signal.aborted&&current.current===key)setDetail({...detail,[kind]:[...(detail[kind]??[]),...(result[kind]??[]).filter(item=>!(detail[kind]??[]).some(old=>old.id===item.id))],[field]:result[field]});
  }catch(error){if(!controller.signal.aborted)setActionError(error instanceof Error?error.message:'Could not load more evidence.');}finally{if(!controller.signal.aborted)setDetailLoading(false);}
 }
 async function relationAction(work:()=>Promise<unknown>) {
  const key=current.current,sequence=++actionSequence.current;setActing(true);setActionError('');
  try{await work();if(current.current===key&&sequence===actionSequence.current)setVersion(value=>value+1);}
  catch(error){if(current.current===key&&sequence===actionSequence.current)setActionError(error instanceof Error?error.message:'Relationship could not be saved.');}
  finally{if(current.current===key&&sequence===actionSequence.current)setActing(false);}
 }
 async function mutate(remove=false) {
  if(!selected||!detail)return;const key=current.current,sequence=++actionSequence.current;setActing(true);setActionError('');setNotice('');
  try {if(remove)await api.uncurateDate(vaultId,detail.date.id);else await api.curateDate(vaultId,selected,view.drafts[selectedId!]??detail.curation??emptyCuration(),activeCalendar);
   if(current.current!==key||sequence!==actionSequence.current)return;
   const drafts={...view.drafts};delete drafts[selectedId!];onChange({drafts});setVersion(value=>value+1);setNotice(remove?'Date details removed. Linked knowledge is retained.':'Date details saved.');
  }catch(error){if(current.current===key&&sequence===actionSequence.current)setActionError(error instanceof Error?error.message:'Could not save date curation.');}finally{if(current.current===key&&sequence===actionSequence.current)setActing(false);}
 }
 async function openEvidence(id:string) {const key=current.current,sequence=++actionSequence.current;setActing(true);setActionError('');try{await onOpenMention(id);}catch(error){if(current.current===key&&sequence===actionSequence.current)setActionError(error instanceof Error?error.message:'Could not open evidence.');}finally{if(current.current===key&&sequence===actionSequence.current)setActing(false);}}
 const filteredItems=(results?.items??[]).filter(item=>contentFilter!=='curated'||item.curation!==null);
 const {days,periods}=calendarGroups(filteredItems),draft=selectedId?(view.drafts[selectedId]??detail?.curation??emptyCuration()):emptyCuration();
 function edit(patch:Partial<TemporalCuration>) {if(selectedId)onChange({drafts:{...view.drafts,[selectedId]:{...draft,...patch}}});}
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(Object.keys(view.drafts).length){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[view.drafts]);
 async function createEvent() {
  if(!detail||!eventName.trim())return;
  const key=current.current;setActing(true);setActionError('');
  let created:string|undefined;
  try{const entity=await api.createEntity(vaultId,{name:eventName.trim(),type:'event',subtypes:[]});created=entity.id;
   await api.saveProperty(vaultId,entity.id,{name:'start date',value:detail.date.value+(detail.date.calendar==='julian'?' (Julian)':''),definition_id:'builtin:event:start_date'});
   if(current.current===key){setVersion(value=>value+1);setEventName('');setAddAction(null);setNotice('Event created with its original date property.');}
  }catch(error){if(current.current===key)setActionError(`${created?'The Event was created, but its date property could not be saved. Open the Event to complete it. ':''}${error instanceof Error?error.message:String(error)}`);}
  finally{if(current.current===key)setActing(false);}
 }
 const caption=(item:TemporalItem)=>dateSummary(item).title;
 const card=(item:TemporalItem)=><button type="button" className="calendar-entry" key={item.date.id} onClick={event=>choose(item.date.value,event.currentTarget,item.date.id)}><span><strong>{dateLabel(item.date.value)}</strong><small>{layerLabels[item.layer]} · {item.date.precision==='day'?'Exact day':item.date.precision==='month'?'Month precision':'Year precision'}{item.curation?.pinned?' · Pinned':''}</small></span><span>{caption(item)}</span><Icon name="chevron"/></button>;
 const inspector=<>
  <header className="calendar-inspector-heading"><div><h2 id="calendar-date-heading">{selected?dateLabel(selected):''}{activeCalendar==='julian'?' · Julian calendar':''}</h2>{detail&&detail.date.precision!=='day'&&<p>{detail.date.precision} precision · no exact day assigned</p>}</div><button className="page-tool" type="button" aria-label="Close date inspector" title="Close date inspector" onClick={close}><Icon name="close"/></button></header>
  <div className="calendar-inspector-body">
  <div className="calendar-view-switch calendar-inspector-tabs" role="group" aria-label="Date overview sections">{(['overview','connections','evidence'] as const).map(tab=><button key={tab} type="button" aria-pressed={inspectorTab===tab} onClick={()=>setInspectorTab(tab)}>{tab[0]!.toUpperCase()+tab.slice(1)}</button>)}</div>
  <div className="calendar-form-row" aria-label="Add to selected date"><button className="button" type="button" onClick={()=>{setInspectorTab('overview');setAddAction('note');requestAnimationFrame(()=>document.getElementById('calendar-label')?.focus());}}>Add a date note</button><button className="button" type="button" onClick={()=>{setInspectorTab('connections');setAddAction('event');}}>Create an event</button><button className="button" type="button" onClick={()=>{setInspectorTab('connections');setAddAction('link');}}>Link existing knowledge</button></div>
  {inspectorTab==='connections'&&addAction==='event'&&<form className="calendar-curation" onSubmit={event=>{event.preventDefault();void createEvent();}}><label className="calendar-field">Event name<input value={eventName} required maxLength={200} onChange={event=>setEventName(event.target.value)} disabled={acting}/></label><p>The Event will retain this date’s precision and calendar in its start date property.</p><button className="button primary" disabled={acting||!eventName.trim()}>Create Event</button></form>}
  {(draft.label||draft.annotation)&&<section className="calendar-date-summary" aria-label="Date summary">{draft.label&&<h3>{draft.label}</h3>}{draft.annotation&&<p>{draft.annotation}</p>}</section>}
  {selected&&selected.slice(0,7)!==view.month&&<button className="button" type="button" onClick={()=>onChange({month:selected.length===4?selected+'-01':selected.slice(0,7)})}>Show selected date</button>}

  {detailLoading&&!detail&&<p role="status">Loading date evidence…</p>}
  {detailError&&<div role="alert" className="calendar-status" data-status="danger">{detailError}<button className="button" type="button" onClick={()=>setVersion(value=>value+1)}>Retry date</button></div>}
  {detail&&<>
   {reviewProposalId&&!detail.proposals?.some(proposal=>proposal.id===reviewProposalId)&&<p role="status">This relationship proposal is no longer pending here. Return to Inbox and refresh.</p>}
   <section hidden={inspectorTab!=='evidence'} className="calendar-evidence" aria-label="Date evidence" aria-busy={detailLoading}>{detailLoading&&<p role="status">Loading more evidence…</p>}<div className="knowledge-section-heading"><h3><Icon name="knowledge"/>Linked knowledge <span className="knowledge-count">{detail.mentionCount+detail.relationCount+(detail.sourceCount??0)+(detail.propertyCount??0)}</span></h3></div>
    {!detail.mentions.length&&!detail.relations.length&&!detail.sources?.length&&!detail.properties?.length&&<p className="calendar-muted">No linked knowledge yet. You can still add details below.</p>}
    {detail.mentions.map(mention=><button className="calendar-evidence-link" type="button" key={mention.id} disabled={acting} onClick={()=>void openEvidence(mention.id)}><Icon name="pages"/><span><strong>{mention.title||'Untitled page'}</strong><small>“{mention.text}” · Open original passage</small></span><Icon name="external-link"/></button>)}
    {(detail.sources??[]).map((mention,index)=><button className="calendar-evidence-link calendar-source-evidence" type="button" key={mention.id} disabled={acting||!onOpenSource} onClick={event=>{const target=event.currentTarget;void relationAction(()=>onOpenSource!(mention.id,target));}}><Icon name="source"/><span><strong>{mention.title}</strong><small>Source reference {index+1} · Line {mention.startLine??1} · “{mention.text}”</small>{mention.context&&<small>{mention.context}</small>}</span><Icon name="external-link"/></button>)}
    {(detail.properties??[]).map(property=><div className="calendar-relation" key={property.id}><strong>{property.title}</strong><small>{property.name}: {property.raw} · Original text property</small>{onOpenEntity&&<button type="button" className="button" onClick={()=>onOpenEntity(property.entityId)}>Open entity</button>}</div>)}
    {detail.relations.map(relation=><div className="calendar-relation" key={relation.id}><strong>{relation.name}</strong><small>{relation.kind.replaceAll('_',' ')}</small>{relation.evidence.status==='current'&&relation.sourceMentionId&&onOpenSource?<button className="button" type="button" disabled={acting} onClick={event=>{const target=event.currentTarget;void relationAction(()=>onOpenSource(relation.sourceMentionId!,target));}}>Open supporting source passage</button>:relation.evidence.status==='current'&&relation.propertyId?<p>Verified original date property</p>:relation.evidence.status==='current'&&relation.mentionId?<button className="button" type="button" disabled={acting} onClick={()=>void openEvidence(relation.mentionId!)}>Open supporting passage</button>:<p data-status="warning">{relation.evidence.status==='stale'?'Stale evidence':relation.evidence.status==='unavailable'?'Evidence unavailable':'No resolved evidence'} · {relation.evidence.reason}</p>}<button type="button" className="button" disabled={acting} onClick={()=>void relationAction(()=>api.reviewTemporalRelation(vaultId,relation.id,'rejected',relation.version!))}>Remove relationship</button></div>)}
    {(detail.proposals??[]).map(proposal=><div className="calendar-relation" key={proposal.id} tabIndex={proposal.id===reviewProposalId?-1:undefined} ref={proposal.id===reviewProposalId?proposalElement:undefined}><strong>{proposal.name}</strong><small>{proposal.kind.replaceAll('_',' ')} · {proposal.status==='rejected'?'Rejected':'Unreviewed'} {proposal.origin==='manual'?'manual relationship':'field-derived proposal'}</small><p>{proposal.evidence.status==='current'?'propertyId' in proposal.evidence?`${proposal.evidence.name}: ${proposal.evidence.raw}`:'Current supporting evidence':`${proposal.evidence.status}: ${proposal.evidence.reason}`}</p><div className="calendar-relation-actions"><button type="button" className="button" disabled={acting||proposal.evidence.status!=='current'} onClick={()=>void relationAction(()=>api.reviewTemporalRelation(vaultId,proposal.id,'accepted',proposal.version!))}>Accept relationship</button>{proposal.status!=='rejected'&&<button type="button" className="button" disabled={acting} onClick={()=>void relationAction(()=>api.reviewTemporalRelation(vaultId,proposal.id,'rejected',proposal.version!))}>Reject relationship</button>}</div></div>)}
    {(['sources','properties','proposals'] as const).map(kind=>{const field=({sources:'nextSourceOffset',properties:'nextPropertyOffset',proposals:'nextProposalOffset'} as const)[kind];return detail[field]!=null&&<button key={kind} className="button" type="button" disabled={detailLoading} onClick={()=>void moreEvidence(kind)}>Load more {kind}</button>;})}
    {detail.nextMentionOffset!==null&&<button className="button" type="button" disabled={detailLoading} onClick={()=>void moreEvidence('mentions')}>Load more references</button>}
    {detail.nextRelationOffset!==null&&<button className="button" type="button" disabled={detailLoading} onClick={()=>void moreEvidence('relations')}>Load more relationships</button>}
    <button className="button" type="button" disabled={acting||detailLoading} onClick={()=>setVersion(value=>value+1)}>Refresh evidence</button>
   </section>

  </>}
  {detail&&inspectorTab!=='evidence'&&<section aria-label="Associated knowledge"><h3>Associated knowledge</h3>{dateAssociations(detail,view.allReferences).filter(entry=>entry.kind!=='curation').map(entry=><button type="button" className="calendar-evidence-link" key={entry.id} onClick={()=>{if(entry.entityId&&onOpenEntity)onOpenEntity(entry.entityId);else if(entry.mentionId)void openEvidence(entry.mentionId);else setInspectorTab('evidence');}}><span><strong>{entry.title}</strong><small>{entry.description}</small></span></button>)}{!dateAssociations(detail).length&&<p className="calendar-muted">No associated knowledge yet. Add a note or link an Event.</p>}</section>}
  {overlayEnabled&&selected&&activeCalendar!=='julian'&&<>{selected.length!==10?<p className="calendar-muted">Select a day to see its observances.</p>:inspectorLiturgical.data?.days[selected]?<LiturgicalDayPanel calendarId={calendarId} day={inspectorLiturgical.data.days[selected]!} key={calendarId+selected} showOptional={overlayOptional||optionalDate===selected}/>:inspectorLiturgical.loading?<p role="status">Preparing liturgical year…</p>:inspectorLiturgical.error?<p className="calendar-muted" role="status">{inspectorLiturgical.error}</p>:null}</>}
  {detail&&<>
   <details hidden={inspectorTab!=='connections'} open={addAction==='link'} className="calendar-link-disclosure"><summary>Link an entity to this date</summary><form className="calendar-relationship-form" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget),support=String(form.get('support')??''),body={dateId:detail.date.id,entityId:String(form.get('entity')),kind:String(form.get('kind')),...(support.startsWith('page:')?{mentionId:support.slice(5)}:support.startsWith('source:')?{sourceMentionId:support.slice(7)}:{})};void relationAction(()=>api.linkTemporalEntity(vaultId,body));}}>
    <div className="calendar-field"><label htmlFor="calendar-link-entity">Entity</label><select id="calendar-link-entity" name="entity" required defaultValue="" disabled={acting}><option value="" disabled>Choose an entity</option>{entities.filter(entity=>entity.vault_id===vaultId&&!entity.archived_at).map(entity=><option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></div>
    <div className="calendar-field"><label htmlFor="calendar-link-kind">Relationship</label><select id="calendar-link-kind" name="kind" defaultValue="discusses" disabled={acting}><option value="discusses">Discusses this date</option><option value="occurs_on">Occurs on this date</option><option value="born_on">Born on this date</option><option value="published_on">Published on this date</option><option value="deadline">Personal deadline</option></select></div>
    <div className="calendar-field"><label htmlFor="calendar-link-support">Supporting evidence</label><select id="calendar-link-support" name="support" defaultValue="" disabled={acting}><option value="">No supporting passage</option>{detail.mentions.map(mention=><option key={mention.id} value={'page:'+mention.id}>Page: {mention.title} · {mention.text}</option>)}{(detail.sources??[]).map((mention,index)=><option key={mention.id} value={'source:'+mention.id}>Source {index+1}: {mention.title} · {mention.text}</option>)}</select></div>
    <button className="button" type="submit" disabled={acting}>Create relationship</button>
   </form></details>
   <form hidden={inspectorTab!=='overview'} className="calendar-curation" onSubmit={event=>{event.preventDefault();void mutate();}}>
    <div className="knowledge-section-heading"><h3><Icon name="edit"/>Date details</h3></div>
    <div className="calendar-field"><label htmlFor="calendar-label">Title</label><input id="calendar-label" disabled={acting} value={draft.label} maxLength={200} placeholder="Add a title" onChange={event=>edit({label:event.target.value})}/></div>
    <div className="calendar-field"><label htmlFor="calendar-layer">Layer</label><select id="calendar-layer" disabled={acting} value={draft.layer} onChange={event=>edit({layer:event.target.value as TemporalLayer})}>{Object.entries(layerLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>

    <div className="calendar-field"><label htmlFor="calendar-annotation">Notes</label><textarea id="calendar-annotation" rows={3} maxLength={2000} disabled={acting} value={draft.annotation} placeholder="Why this date matters" onChange={event=>edit({annotation:event.target.value})}/></div>
    <label className="calendar-check"><input type="checkbox" disabled={acting} checked={draft.pinned} onChange={event=>edit({pinned:event.target.checked})}/>Pin this date</label>
    <details className="calendar-detail-options"><summary>More details</summary>
    <div className="calendar-form-row"><div className="calendar-field"><label htmlFor="calendar-importance">Significance</label><select id="calendar-importance" disabled={acting} value={draft.importance} onChange={event=>edit({importance:event.target.value as TemporalCuration['importance']})}><option value="ordinary">Ordinary</option><option value="notable">Notable</option><option value="important">Important</option></select></div><div className="calendar-field"><label htmlFor="calendar-priority">Personal priority</label><select id="calendar-priority" disabled={acting} value={draft.personalPriority} onChange={event=>edit({personalPriority:event.target.value as TemporalCuration['personalPriority']})}><option value="ordinary">Ordinary</option><option value="important">Important to me</option></select></div></div>
    </details>
    {selected&&view.drafts[selectedId!]&&<p className="calendar-muted">Unsaved changes · kept while you explore</p>}
    <div className="calendar-form-row"><button className="button primary" type="submit" disabled={acting}>{acting?'Working…':'Save'}</button>{detail.curation&&<button className="button" type="button" disabled={acting} onClick={()=>void mutate(true)}>Remove saved details</button>}</div>
   </form>
  </>}
  {actionError&&<p className="calendar-status" role="alert" data-status="danger">{actionError}</p>}{notice&&<p role="status">{notice}</p>}
  </div>
 </>;
 return <section className={'calendar-workspace'+(selected&&!evidenceOpen&&!modal?' has-inspector':'')} ref={root} onSelectCapture={event=>rememberField(event.target)} onFocusCapture={event=>rememberField(event.target)} aria-label="Calendar workspace" onKeyDown={event=>{if(event.key==='Escape'&&selected&&!modal){event.stopPropagation();close();}}}>
  <div className="calendar-main"><header className="calendar-heading">
   <div className="calendar-month-title"><h1 className="page-heading">{dateLabel(view.month)}</h1><span className="sr-only" role="status">{dateLabel(view.month)}</span><div className="calendar-month-navigation" role="group" aria-label="Month navigation"><button type="button" className="button calendar-icon-button" aria-label="Previous month" disabled={view.month==='0001-01'} onClick={()=>onChange({month:shiftMonth(view.month,-1)})}><Icon name="arrow-left"/></button><button type="button" className="button calendar-icon-button" aria-label="Next month" disabled={view.month==='9999-12'} onClick={()=>onChange({month:shiftMonth(view.month,1)})}><Icon name="chevron"/></button><button type="button" className="button" onClick={event=>{trigger.current=event.currentTarget;const value=todayValue();setFocusDay(value);onChange({month:value.slice(0,7),selected:value,selectedId:temporalDate(value,view.calendar)?.id??null});}}>Today</button><CalendarMonthJump month={view.month} onChange={month=>onChange({month})}/></div></div>
   <div className="calendar-heading-actions"><div className="calendar-view-switch" role="group" aria-label="Calendar view">{(['month','agenda'] as const).map(mode=><button type="button" key={mode} aria-pressed={view.mode===mode} onClick={()=>onChange({mode})}>{mode==='month'?'Month':'Agenda'}</button>)}</div><button type="button" className="button calendar-icon-button" aria-label="Calendar settings" title="Calendar settings" onClick={onOpenSettings}><Icon name="settings"/></button><button type="button" className="button calendar-icon-button" aria-label="Refresh calendar" title="Refresh calendar" disabled={loading} onClick={()=>setVersion(value=>value+1)}><Icon name="refresh"/></button></div>
  </header>
  <div className="calendar-filters"><label className="calendar-field">Show<select aria-label="Calendar content" value={contentFilter} onChange={event=>{const filter=event.target.value as 'curated'|'linked'|'all';onChange({contentFilter:filter,allReferences:filter==='all'});}}><option value="curated">Curated</option><option value="linked">Linked events</option><option value="all">All references</option></select></label><label className="calendar-field">Calendar<select aria-label="Civil calendar" value={view.calendar??'gregorian'} onChange={event=>onChange({calendar:event.target.value as 'gregorian'|'julian',selected:null,selectedId:null})}><option value="gregorian">Gregorian</option><option value="julian">Julian</option></select></label><details className="calendar-facets"><summary>Filters</summary><fieldset><legend className="sr-only">Calendar layers</legend>{(['personal','knowledge','historical'] as const).map(layer=><label className="calendar-filter-toggle" key={layer}><input type="checkbox" checked={view.layers.includes(layer)} onChange={()=>onChange({layers:view.layers.includes(layer)?view.layers.filter(value=>value!==layer):[...view.layers,layer]})}/><span>{layerLabels[layer]}</span></label>)}</fieldset></details>{overlayEnabled&&<details className="calendar-overlay-info"><summary><Icon name="event"/><span>{supplement.label}</span><Icon name="chevron"/></summary><div className="calendar-overlay-info-panel"><h2>{supplement.label}</h2><p>Weekdays, seasons and observances appear alongside your saved dates. Calendar sources are managed automatically.</p><button type="button" className="button" onClick={onOpenSettings}>Calendar settings</button></div></details>}</div>
  {supplementEnabled&&liturgical.loading&&<p role="status" className="calendar-status">Downloading liturgical calendar…</p>}
  {supplementEnabled&&liturgical.error&&<div role="status" className="calendar-status" data-status="warning">{liturgical.error}<button type="button" className="button" onClick={liturgical.retry}>Retry supplement</button></div>}
  {loading&&<p role="status" className="calendar-status">{results?'Updating calendar…':'Loading calendar…'}</p>}{error&&<div role="alert" data-status="danger" className="calendar-status">{error}{results&&<span>Showing the last loaded results.</span>}<button className="button" type="button" onClick={()=>setVersion(value=>value+1)}>Retry calendar</button></div>}
  {!!results?.indexing.pending&&<div className="calendar-status" role="status" data-status="info">{results.indexing.pending} saved items still need indexing. Results are partial.<button className="button" type="button" disabled={loading} onClick={()=>setVersion(value=>value+1)}>Continue indexing</button></div>}
  {periods.length>0&&<details open className="calendar-periods" key={view.month} aria-label="Month and year periods"><summary>Across this period · {periods.length}{results&&(results.nextOffset!==null||results.indexing.pending>0)?'+':''} dates <span>Month/year precision · no exact day</span></summary>{periods.map(card)}</details>}
  {view.mode==='month'?<CalendarMonthGrid month={view.month} selected={selected} focusDay={focusDay} weekStart={weekStart} weekNumbers={settings.weekNumbers!==false} liturgicalLabels={liturgicalLabels} weekLiturgy={[previousLiturgical.data,liturgical.data,nextLiturgical.data]} optionalIndicators={settings.optionalIndicators!==false} items={days} liturgy={overlayEnabled?liturgical.data??undefined:undefined} calendarId={calendarId} onFocus={setFocusDay} onKey={gridKey} onChoose={(value,button,optional)=>{setOptionalDate(optional?value:null);choose(value,button);}} includeReferences={view.allReferences} busy={loading}/>:<section className="calendar-agenda" aria-label="Dated agenda">{days.map(item=><section className="calendar-agenda-day" key={item.date.id}><h2><button className="button" type="button" onClick={event=>choose(item.date.value,event.currentTarget,item.date.id)}>{dateLabel(item.date.value)}</button><small>{item.date.calendar} · {dateSummary(item).counts}</small></h2>{dateAssociations(item,view.allReferences).map(entry=><button type="button" className="calendar-entry" key={entry.id} onClick={event=>choose(item.date.value,event.currentTarget,item.date.id)}><span><strong>{entry.title}</strong><small>{entry.kind==='reference'?'Detected reference':entry.kind==='curation'?'Curated':entry.kind==='property'?'Date property':'Accepted link'}</small></span><span>{entry.description}</span><Icon name="chevron"/></button>)}</section>)}</section>}
  {view.mode==='agenda'&&overlayEnabled&&liturgical.data&&<details className="calendar-liturgical-agenda"><summary><Icon name="chevron"/><span>{supplement.label} <small>{dateLabel(view.month)} · Observances</small></span></summary>{Object.entries(liturgical.data.days).filter(([date])=>date.startsWith(view.month)).map(([date,day])=><button type="button" className="calendar-entry" key={date} onClick={event=>choose(date,event.currentTarget)}><span><strong>{dateLabel(date)}</strong><small>Liturgical supplement</small></span><span>{liturgicalLabel(day.principal.name,calendarId)}<small className="calendar-liturgical-rank">{liturgicalRankLabel(day.principal.rankName)}</small></span></button>)}</details>}
  {results&&!results.items.length&&!loading&&<div className="calendar-empty"><Icon name="event"/><h3>{!view.layers.length?'Choose a calendar layer':results.indexing.pending?'No dates loaded yet':view.allReferences?'No saved dates or detected references this month':'No saved dates match this month and filters'}</h3><p>{!view.layers.length?'Select Personal, Knowledge, or Historical to show saved dates.':results.indexing.pending?'Indexing is incomplete. Continue indexing to find more dates.':view.allReferences?'No indexed references match these filters. Select a day to add a date.':'Select a day to add a date, or choose All references to explore your pages.'}</p></div>}
  {!selected&&Object.keys(view.drafts).length>0&&<p role="status" className="calendar-status">Unsaved changes are kept for {Object.keys(view.drafts).length} date(s). Return to a date to save them before leaving this workspace.</p>}
  {results?.nextOffset!==null&&results&&<div className="calendar-pagination"><p>More dates are available. This view shows a partial list.</p><button className="button" type="button" disabled={loading} onClick={()=>void more()}>Load more dates</button></div>}
  <p className="calendar-footer" id="calendar-keyboard-help">Arrow keys move · Home/End move to week edges · Page Up/Down change month · Enter/Space open details · Escape closes details</p>
  </div>
  {selected&&(modal?<dialog ref={sheet} className={'calendar-sheet'+(!mobile?' calendar-sheet-bounded':'')} aria-labelledby="calendar-date-heading" onCancel={event=>{event.preventDefault();close();}} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>{inspector}</dialog>:<aside hidden={evidenceOpen} className="calendar-inspector" aria-labelledby="calendar-date-heading">{inspector}</aside>)}
 </section>;
}
