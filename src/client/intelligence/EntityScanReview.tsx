import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {t as uiText} from '../i18n';
import {domainPath} from '../../shared/domains';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';
import { entityReviewFeedback, type ReviewFeedback } from './entity-review-feedback';
import {annotationSuggestions} from '../editor/selection-annotation';
import {EntityResolutionPicker} from '../editor/EntityResolutionPicker';
import {normalizeEntityName,linkedEntityIds} from '../../shared/auto-entities';
import { Select } from '../components/Select';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {anchorKey,evidenceOccurrences,evidenceContext, type EntityScan, type EntitySuggestion, type EntitySuggestionEdit } from '../../shared/entity-scan';
import { entityLabels, entityTypes, type Entity, type EntityType, type Page, type Segment } from '../../shared/domain';
import { api } from '../api';
import { useEntitySchema } from '../knowledge/useEntitySchema';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import {reviewMentionCount,reviewMentionAnchors,reviewSegmentText,reviewContextWindows} from './entity-review-mentions';
import {restoreReviewDocumentView,type ReviewDocumentPreference,type ReviewDocumentView} from './entity-review-preferences';
import {renderedReviewLines} from './entity-review-lines';
import {AliasInput,parseAliases} from '../knowledge/AliasInput';

function ReviewConfirmation({feedback,inline=false}:{feedback:ReviewFeedback;inline?:boolean}) {
  return <div className={'entity-review-confirmation'+(inline?' entity-review-confirmation-inline':'')} role="status" title={feedback.detail}>
    <Icon name="check"/><span>{feedback.message}</span><span className="sr-only">{feedback.detail}</span>
  </div>;
}

type Decision = 'accepted' | 'rejected';
export function EntityScanReview({page,scan:savedScan,onScan,onFlush,onReview,onOpenChange,disabled,entities}:{onOpenChange?:(open:boolean)=>void;entities:Entity[];page:Page;scan:EntityScan|null;onScan:(scan:EntityScan)=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:Decision,edits?:EntitySuggestionEdit[])=>Promise<EntityScan>;disabled:boolean}) {
  const destination=useContext(ReviewDestination);
  const openedFromCentre=useRef<string|null>(null);
  useEffect(()=>{if(savedScan&&destination?.category==='scan'&&destination.originId===page.id&&destination.runId===savedScan?.id&&openedFromCentre.current!==savedScan.id){openedFromCentre.current=savedScan.id;setFilter('pending');setOpen(true);}},[destination,savedScan?.id,page.id]);
  const {schema}=useEntitySchema(page.vault_id);
  const [preview,setPreview]=useState<EntityScan|null>(null);
  const [reviewingBatch,setReviewingBatch]=useState(false);
  const scan=preview??savedScan;
  const scanController=useRef<AbortController|null>(null);
  useEffect(()=>()=>scanController.current?.abort(),[]);
  const [open,setOpen]=useState(false),[operation,setOperation]=useState<{ids:string[];decision?:Decision}|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState<'all'|'pending'|'reviewed'>('pending'),[query,setQuery]=useState('');
  useLayoutEffect(()=>{onOpenChange?.(open);return()=>onOpenChange?.(false);},[open,onOpenChange]);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [mode,setMode]=useState<'batch'|'context'>(()=>typeof window!=='undefined'&&window.matchMedia?.('(min-width: 751px)').matches?'context':'batch'),[activeId,setActiveId]=useState<string|null>(null);
  const [typeFilter,setTypeFilter]=useState('all'),[identityFilter,setIdentityFilter]=useState('all'),[grouped,setGrouped]=useState(false);
  const snapshot=useRef<HTMLElement>(null),queue=useRef<HTMLElement>(null);
  const [documentView,setDocumentView]=useState<ReviewDocumentView>('excerpts');
  const documentPreference=useRef<ReviewDocumentPreference|null>(null);
  const documentPreferenceKey=`noema-entity-review-document:${page.vault_id}:${page.id}`;
  function saveDocumentView(view:ReviewDocumentView,lastOpenedAt=documentPreference.current?.lastOpenedAt??Date.now()){
    const preference={scanId:savedScan?.id??null,view,lastOpenedAt};
    documentPreference.current=preference;
    try{window.localStorage.setItem(documentPreferenceKey,JSON.stringify(preference));}catch{/* Keep the current session usable without browser storage. */}
    setDocumentView(view);
  }
  function openReview(){
    let saved:unknown=documentPreference.current;
    try{const stored=window.localStorage.getItem(documentPreferenceKey);if(stored)saved=JSON.parse(stored);}catch{/* Fall back to the current session. */}
    const now=Date.now();
    saveDocumentView(restoreReviewDocumentView(saved,savedScan?.id??null,now),now);
    setFeedback(null);setAnnouncement('');setFilter('pending');setOpen(true);
    if(!scan&&!running.current)scanNote();
  }
  useEffect(()=>{documentPreference.current=null;setDocumentView('excerpts');},[documentPreferenceKey,savedScan?.id]);
  const [drafts,setDrafts]=useState<Record<string,EntitySuggestionEdit>>({});
  useEffect(()=>{setDrafts({});setEditingId(null);},[scan?.id]);
  const [feedback,setFeedback]=useState<ReviewFeedback|null>(null);
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(null),6000);return()=>clearTimeout(timer);},[feedback]);
  useEffect(()=>setSelected([]),[filter,query,typeFilter,identityFilter]);
  const [occurrenceEditor,setOccurrenceEditor]=useState<string|null>(null);
  const [error,setError]=useState(''),[announcement,setAnnouncement]=useState('');
  useEffect(()=>{
    if(!announcement)return;
    const cancelTimeout=clearTimeout;
    const timer=setTimeout(()=>setAnnouncement(''),6000);
    return()=>cancelTimeout(timer);
  },[announcement]);
  const running=useRef(false),active=useRef(true),selectAll=useRef<HTMLInputElement>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const pending=scan?.suggestions.filter(s=>s.status==='pending')||[];
  const subtypePending=scan?.subtypeSuggestions?.filter(item=>item.status==='pending') ?? [];
  function identityStatus(s:EntitySuggestion){const draft=drafts[s.id];return awaitingIdentity(s)?(ambiguous(s)?'ambiguous':'existing-required'):awaitingSubtype(s)?'subtype-required':(draft?draft.existingId:s.existingId)?'existing':'new';}
  const visible=(scan?.suggestions||[]).filter(s=>(filter==='all'||(filter==='pending'?s.status==='pending':s.status!=='pending'))&&(typeFilter==='all'||(drafts[s.id]?.type??s.type)===typeFilter)&&(identityFilter==='all'||identityStatus(s)===identityFilter)&&`${s.name} ${entityLabels[s.type]} ${s.evidence}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{
    if(grouped){const group=identityStatus(a).localeCompare(identityStatus(b));if(group)return group;}
    const position=(s:EntitySuggestion)=>{const anchor=s.evidenceAnchor;return [page.blocks.findIndex(block=>block.id===anchor?.blockId),anchor?.row??-1,anchor?.col??-1,anchor?.start??0];};
    const left=position(a),right=position(b);return left.reduce((difference,value,index)=>difference||value-right[index]!,0);
  });
  const selectedIds=selected.filter(id=>visible.some(s=>s.id===id&&s.status==='pending'));
  const mentionCounts=useMemo(()=>Object.fromEntries((scan?.suggestions??[]).map(s=>{
    const draft=drafts[s.id],identity=entities.find(entity=>entity.id===(draft?draft.existingId:s.existingId));
    return [s.id,reviewMentionCount(page,[s.evidence,draft?.name??s.name,...(draft?.aliases??s.aliases??[]),...(identity?[identity.name,...(identity.aliases??[])]:[])],entities)];
  })),[page.blocks,scan?.suggestions,drafts,entities]);
  const focused=visible.find(s=>s.id===activeId)??visible.find(s=>s.status==='pending')??visible[0];
  const focusedDraft=focused?drafts[focused.id]:undefined;
  const focusedIdentity=entities.find(entity=>entity.id===(focusedDraft?focusedDraft.existingId:focused?.existingId));
  const focusedNames=focused?[focused.evidence,focusedDraft?.name??focused.name,...(focusedDraft?.aliases??focused.aliases??[]),...(focusedIdentity?[focusedIdentity.name,...(focusedIdentity.aliases??[])]:[])]:[];
  function focusSuggestion(id:string){setActiveId(id);setEditingId(null);}
  function moveSuggestion(delta:number){if(!visible.length)return;const index=visible.findIndex(s=>s.id===focused?.id);focusSuggestion(visible[(index+delta+visible.length)%visible.length]!.id);}
  useEffect(()=>{
    if(mode!=='context'||!open)return;
    queue.current?.querySelector<HTMLElement>('[aria-current=true]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    const inspector=snapshot.current?.parentElement?.querySelector('.entity-review-table-scroll');
    if(inspector)inspector.scrollTop=0;
  },[mode,focused?.id,open,documentView]);
  useLayoutEffect(()=>{
    if(mode!=='context'||!open||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const panes=snapshot.current?.parentElement?.querySelectorAll<HTMLElement>('.entity-review-table');
    const animations=Array.from(panes??[]).map(pane=>pane.animate?.(
      [{opacity:.72,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:180,easing:'ease-out'},
    ));
    return()=>animations.forEach(animation=>animation?.cancel());
  },[mode,focused?.id,open]);
  const visiblePending=visible.filter(s=>s.status==='pending').map(s=>s.id);
  const allSelected=visiblePending.length>0&&visiblePending.every(id=>selectedIds.includes(id));
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=!allSelected&&visiblePending.some(id=>selectedIds.includes(id));},[allSelected,visiblePending,selectedIds]);
  const stale=!!scan&&scan.revision!==page.revision&&!operation?.decision;
  const scanning=!!operation&&!operation.decision;
  const locked=!!operation||disabled;
  const visibleSubtypes=(scan?.subtypeSuggestions??[]).filter(item=>(typeFilter==='all'||item.type===typeFilter)&&(filter==='all'||(filter==='pending'?item.status==='pending':item.status!=='pending'))&&`${item.name} ${entityLabels[item.type]}`.toLowerCase().includes(query.toLowerCase()));
  const hasReviewItems=visible.length>0||(mode==='batch'&&!scanning&&visibleSubtypes.length>0);
  const total=(scan?.suggestions.length ?? 0)+(scan?.subtypeSuggestions?.length ?? 0);
  const narrowed=!!query||(filter!=='all'&&total>0)||typeFilter!=='all'||identityFilter!=='all';
  function clearReviewFilters(){setQuery('');setFilter('all');setTypeFilter('all');setIdentityFilter('all');}
  const reviewed=total-pending.length-subtypePending.length;
  const subtypeOnly=mode==='context'&&visible.length===0&&subtypePending.length>0;
  const pendingComplete=filter==='pending'&&total>0&&reviewed===total&&!query&&typeFilter==='all'&&identityFilter==='all';
  async function run(ids:string[],work:()=>Promise<EntityScan>,decision?:Decision) {
    if(running.current)return;
    running.current=true;setOperation({ids,decision});setError('');setFeedback(null);setAnnouncement('');
    try {
      const result=await work();
      if (active.current && decision === 'accepted') setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, draft]) => {
        const suggestion = result.suggestions.find(item => item.id === id);
        const approved = result.subtypeSuggestions?.filter(item => ids.includes(item.id) && item.resolvedId && item.type === draft.type && suggestion?.proposedSubtypeIds?.includes(item.id)) ?? [];
        return [id, draft.existingId ? draft : {...draft, subtypes: [...new Set([...draft.subtypes, ...approved.map(item => item.resolvedId!)])]}];
      })));

      if(active.current){
        if(decision&&mode==='context'&&focused&&ids.includes(focused.id)&&result.suggestions.some(item=>item.id===focused.id&&item.status===decision)){
          const index=visible.findIndex(item=>item.id===focused.id);
          const next=[...visible.slice(index+1),...visible.slice(0,index)].find(item=>result.suggestions.some(updated=>updated.id===item.id&&updated.status==='pending'));
          if(next)setActiveId(next.id);
          setEditingId(null);
        }
        onScan(result);if(decision)setFeedback(entityReviewFeedback(result,ids,decision));if(!decision||ids.includes(editingId||''))setEditingId(null);setDrafts(current=>decision?Object.fromEntries(Object.entries(current).filter(([id])=>!ids.includes(id))):{});setSelected(current=>decision?current.filter(id=>!ids.includes(id)):[]);setAnnouncement(decision?`${ids.length} ${result.subtypeSuggestions?.some(item=>ids.includes(item.id))?'subtype suggestions':'entity suggestions'} ${decision==='accepted'?uiText('accepted'):uiText('dismissed')}.`:JSON.stringify(result)===JSON.stringify(savedScan)?'Suggestions are up to date. Showing saved results.':`${result.suggestions.length} potential entities found.`);}
    }catch(error){if(active.current)setError(error instanceof Error?error.message:'Entity scan failed.');}
    finally{running.current=false;if(active.current){setOperation(null);setPreview(null);}}
  }
  function scanNote(continuePrevious=false) {
    if(!continuePrevious)saveDocumentView('excerpts');
    void run([],async()=>{
      const saved=await onFlush();
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected note changed. Try again.');
      const controller=new AbortController();scanController.current=controller;
      if(active.current){setReviewingBatch(false);setPreview(continuePrevious&&savedScan?savedScan:{id:'scanning',revision:saved.revision,suggestions:[]});setFilter('pending');setQuery('');}
      const result=await api.scanEntities(saved.vault_id,saved.id,saved.revision,partial=>{if(active.current)setPreview(partial);},controller.signal,continuePrevious&&savedScan?.continuation?{scanId:savedScan.id,token:savedScan.continuation.token}:undefined);
      if(active.current){setFilter('pending');setQuery('');}
      return result;
    });
  }
  function awaitingSubtype(suggestion: EntitySuggestion) {
    const draft = drafts[suggestion.id];
    return !(draft?draft.existingId:suggestion.existingId) && (!draft || draft.type === suggestion.type) && suggestion.proposedSubtypeIds?.some(id => subtypePending.some(item => item.id === id) && !draft?.approveSubtypeIds?.includes(id));
  }
  function ambiguous(s:EntitySuggestion) {
    return entities.filter(entity=>!entity.archived_at&&!entity.inactive&&[entity.name,...(entity.aliases??[])].some(name=>[s.name,s.evidence].some(value=>normalizeEntityName(name)===normalizeEntityName(value)))).length>1;
  }
  function effectiveDraft(s:EntitySuggestion):EntitySuggestionEdit{return drafts[s.id]??{id:s.id,name:s.name,aliases:s.aliases??[],type:s.type,subtypes:s.subtypes??[],domainIds:s.domainIds??[],existingId:s.existingId};}
  function createUnavailable(s:EntitySuggestion){
    const draft=effectiveDraft(s);
    const creation=draft.existingId?{name:s.name,type:s.type}:draft;
    if(ambiguous(s))return uiText('Create new is unavailable because several existing entities match this wording. Link an existing entity.');
    if(creation.type==='source')return uiText('Create new is unavailable for sources. Sources need an attached original file.');
    if(entities.some(entity=>entity.type===creation.type&&normalizeEntityName(entity.name)===normalizeEntityName(creation.name)))return uiText('Create new is unavailable because an entity with this name already exists. Link it or edit the name.');
    return '';
  }
  function awaitingIdentity(s:EntitySuggestion){return s.status==='pending'&&!effectiveDraft(s).existingId&&!!createUnavailable(s);}
  function showOccurrences(id:string){setEditingId(id);setOccurrenceEditor(id);requestAnimationFrame(()=>document.getElementById('suggestion-edit-'+id)?.scrollIntoView?.({block:'nearest'}));}
  function reviewSubtypes(){setMode('batch');setFilter('pending');setTypeFilter('all');setIdentityFilter('all');setQuery('');requestAnimationFrame(()=>document.getElementById('subtype-proposals-title')?.scrollIntoView?.({block:'nearest'}));}
  function decide(ids:string[],decision:Decision){
    if(!scan||!ids.length)return;
    const edits=decision==='accepted'&&!ids.some(id=>scan.subtypeSuggestions?.some(item=>item.id===id))?ids.flatMap(id=>{const suggestion=scan.suggestions.find(item=>item.id===id);return suggestion?[effectiveDraft(suggestion)]:[];}):undefined;
    void run(ids,()=>onReview(scan.id,ids,decision,edits),decision);
  }
  function editSuggestion(draft:EntitySuggestionEdit){setDrafts(current=>({...current,[draft.id]:draft}));}
  function toggleAll(){setSelected(current=>allSelected?current.filter(id=>!visiblePending.includes(id)):[...new Set([...current,...visiblePending])]);}
  function reviewActions(s:EntitySuggestion) {
    const saving=!!operation?.decision&&operation.ids.includes(s.id);
    return <div className="entity-review-row-actions" aria-busy={saving}>{s.status==='pending'?<><button className="scan-row-edit" disabled={locked||stale} aria-label={uiText('Edit ')+s.name} title={uiText('Edit ')+s.name} aria-expanded={editingId===s.id} aria-controls={'suggestion-edit-'+s.id} onClick={()=>setEditingId(current=>current===s.id?null:s.id)}><Icon name="edit"/>{mode==='context'&&uiText('Edit suggestion')}</button><button className="button primary scan-row-accept" disabled={locked||stale||!!awaitingSubtype(s)||awaitingIdentity(s)} aria-label={uiText('Accept: ')+s.name} title={uiText('Accept: ')+s.name} onClick={()=>decide([s.id],'accepted')}><span className="entity-review-action-icon">{saving&&operation?.decision==='accepted'?<span className="scan-spinner"/>:<Icon name="check"/>}</span><span>{uiText(saving&&operation?.decision==='accepted'?'Accepting…':'Accept')}</span></button><button className="button scan-row-reject" disabled={locked||stale} aria-label={uiText('Dismiss ')+s.name} title={uiText('Dismiss ')+s.name} onClick={()=>decide([s.id],'rejected')}><span className="entity-review-action-icon">{saving&&operation?.decision==='rejected'?<span className="scan-spinner"/>:<Icon name="close"/>}</span>{uiText(saving&&operation?.decision==='rejected'?'Dismissing…':'Dismiss')}</button></>:<span className={'scan-decision is-'+s.status}><Icon name={s.status==='accepted'?'check':'close'}/>{uiText(s.status==='accepted'?'Accepted':'Dismissed')}</span>}</div>;
  }
  return <div className="knowledge-entity-discovery">
    <button type="button" className={'knowledge-icon-action entity-detect-action'+(scanning?' is-working':'')} disabled={disabled} aria-label={scan?uiText("Review detected entities ({value0})",{value0: pending.length+subtypePending.length}):uiText("Detect entities with AI")} aria-haspopup="dialog" title={scan?uiText("{value0} pending suggestions",{value0: pending.length+subtypePending.length}):uiText("Detect entities with AI")} onClick={openReview}><Icon name="sparkles"/>{!!scan&&pending.length+subtypePending.length>0&&<span className="knowledge-action-badge">{pending.length+subtypePending.length}</span>}</button>
    {!open&&feedback&&<ReviewConfirmation feedback={feedback} inline/>}
    {open&&<Modal className="entity-review-modal" titleId="entity-review-title" onClose={()=>setOpen(false)}>
      <div className="entity-review-controls"><ModalHeader titleId="entity-review-title" leading={<Icon name="review-text"/>} actions={total>0&&!scanning&&<div className="entity-review-progress"><span>{reviewed} / {total}{" " + uiText("reviewed")}</span><div role="progressbar" aria-label="Saved review decisions" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed}><span style={{width:`${reviewed/total*100}%`}}/></div></div>}><span className="entity-review-header-label">{uiText("Entity review")}</span><span className="entity-review-header-page" title={page.title||uiText("Untitled")}>{page.title||uiText("Untitled")}</span></ModalHeader>
      {(total>0||scanning)&&<div className="entity-review-toolbar entity-review-unified-toolbar">
        <div className="entity-review-modes" role="group" aria-label="Review mode"><button className="button" aria-pressed={mode==='context'} onClick={()=>{setMode('context');}}><Icon name="columns"/>{uiText('Review one by one')}</button><button className="button" aria-pressed={mode==='batch'} onClick={()=>setMode('batch')}><Icon name="table"/>{uiText('Review as a list')}</button></div>
        <div className="entity-review-filters" role="group" aria-label={uiText("Filter suggestions")}>{(['all','pending','reviewed'] as const).map(value=><button key={value} data-filter={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}><Icon name={value==='all'?'view-list':value==='pending'?'recent':'check'}/>{value==='all'?uiText("All"):value==='pending'?uiText("Pending"):uiText("Reviewed")}<span>{value==='all'?total:value==='pending'?pending.length+subtypePending.length:reviewed}</span></button>)}</div>
        <label className="entity-review-search"><Icon name="search"/><input aria-label={uiText("Search suggestions")} placeholder={uiText("Search entities…")} value={query} onChange={e=>{setQuery(e.target.value);saveDocumentView('excerpts');}}/></label>
        <details className="entity-scan-filter-options" data-filtered={typeFilter!=='all'||identityFilter!=='all'||grouped}><summary aria-label="Filter and sort" title="Filter and sort"><Icon name="sliders"/><span className="sr-only">Filter and sort</span></summary><div><label>Type<Select aria-label="Filter by entity type" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All types</option>{entityTypes.map(type=><option key={type} value={type}>{entityLabels[type]}</option>)}</Select></label>
        <label>{uiText("Existing entity match")}<Select aria-label={uiText("Filter by existing entity match")} value={identityFilter} onChange={e=>setIdentityFilter(e.target.value)}><option value="all">{uiText("All matches")}</option><option value="existing">Existing entity</option><option value="new">New entity</option><option value="ambiguous">{uiText("Needs a match")}</option><option value="subtype-required">Requires subtype decision</option></Select></label>
        <label>Order<Select aria-label="Suggestion order" value={grouped?'identity':'document'} onChange={e=>setGrouped(e.target.value==='identity')}><option value="document">Note order</option><option value="identity">{uiText("Group by existing entity match")}</option></Select></label></div></details>
        <button className="knowledge-icon-action" disabled={locked} aria-label={scanning?uiText("Scanning entities"):scan?uiText("Scan again"):uiText("Scan note")} title={scan?uiText("Scan again"):uiText("Scan note")} onClick={()=>scanNote()}>{scanning?<span className="scan-spinner"/>:<Icon name={scan?'refresh':'sparkles'}/>}</button>
      </div>}
      <div className="entity-review-messages" aria-live="polite">{error?<p className="inline-error" role="alert">{error}</p>:scanning?<div className="entity-review-scan-message" role="status"><span className="scan-spinner"/><span>{uiText('Scanning · provisional results cannot be accepted')}{visible.length>0&&` · ${scan?.suggestions.length} ${uiText(scan?.suggestions.length===1?'entity found':'entities found')}`}</span></div>:stale?<div className="entity-review-stale" role="status"><span>{uiText('Note changed. Scan again to review fresh suggestions.')}</span><button className="button small" disabled={locked} onClick={()=>scanNote()}>{uiText('Refresh suggestions')}</button></div>:scan?.continuation?<div className="entity-scan-batch-prompt" role="status"><p>{uiText('{value0} suggestions saved in this batch. More text remains to scan.',{value0:scan.batchCount??25})}</p><div><button className="button primary" disabled={locked} onClick={()=>scanNote(true)}>{uiText('Continue scanning')}</button>{!reviewingBatch&&<button className="button" disabled={locked} onClick={()=>{setReviewingBatch(true);setFilter('pending');setQuery('');}}>{uiText('Review these suggestions first')}</button>}</div></div>:announcement&&!feedback?<div className="entity-review-scan-message" role="status"><Icon name="info"/><span>{announcement}</span><button type="button" className="entity-review-message-dismiss" aria-label={uiText('Dismiss scan message')} onClick={()=>setAnnouncement('')}><Icon name="close"/></button></div>:null}</div>
      {feedback&&!error&&!scanning&&!stale&&<ReviewConfirmation feedback={feedback}/>}
      {mode==='context'&&!scanning&&subtypePending.length>0&&<div className="entity-review-subtype-notice"><span>{uiText(subtypePending.length===1?'{value0} subtype suggestion needs review':'{value0} subtype suggestions need review',{value0:subtypePending.length})}</span><button className="button small" onClick={reviewSubtypes}>{uiText('Review subtypes')}</button></div>}
      </div><div className={'entity-review-workspace mode-'+mode+(!hasReviewItems?' is-empty':'')} onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();moveSuggestion(event.key==='ArrowRight'?1:-1);}
        if(event.key==='/'&&!(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')&&focused){event.preventDefault();requestAnimationFrame(()=>{const search=document.querySelector<HTMLDetailsElement>('.mode-context .entity-decision-search');if(search)search.open=true;document.querySelector<HTMLInputElement>('.mode-context [role=combobox]')?.focus();});}
      }}>
      {!hasReviewItems?<div className={"scan-empty entity-review-empty-state"+(pendingComplete?" is-complete":"")} role="status" aria-live="polite">
        {scanning?<><span className="scan-spinner"/><strong>{uiText('Finding entities in your note')}</strong><span>{uiText('Suggestions will appear here as the scan progresses.')}</span></>:<><Icon name={pendingComplete?'check-circle':'search'}/><strong>{subtypeOnly?uiText('Subtype suggestions need review'):pendingComplete?uiText(scan?.continuation?'This batch is reviewed':'All suggestions reviewed'):narrowed?uiText('No matching suggestions'):uiText(scan?'No new entity suggestions':'Ready to find entities')}</strong><span>{subtypeOnly?uiText('Review the proposed subtypes in the list to finish this batch.'):pendingComplete?uiText(scan?.continuation?'Your decisions are saved. More text remains to scan.':'Your decisions are saved. Open Reviewed to see them.'):narrowed?uiText('Try another search or clear the filters.'):uiText(scan?'This scan returned no suggestions. You can scan again after editing the note.':'Scan this note to find entities to review.')}</span>{subtypeOnly?<button className="button small" onClick={reviewSubtypes}>{uiText('Review subtypes')}</button>:pendingComplete?<button className="button small" onClick={()=>setFilter('reviewed')}>{uiText('View reviewed entities')}</button>:narrowed?<button className="button small" onClick={clearReviewFilters}>{uiText('Clear search and filters')}</button>:<button className="button small" disabled={locked} onClick={()=>scanNote()}>{uiText(scan?'Scan again':'Scan note')}</button>}</>}

      </div>:<>
      {mode==='context'&&<aside className="entity-scan-candidates"><div className="entity-scan-candidates-heading entity-scan-pane-header">Suggestions <span>{visible.filter(s=>s.status==='pending').length} pending</span></div><nav ref={queue} className="entity-scan-queue" aria-label="Candidate queue" onKeyDown={event=>{if((event.target as HTMLElement).closest('button')&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();moveSuggestion(event.key==='ArrowDown'?1:-1);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.entity-scan-queue [aria-current=true]')?.focus());}}}>{visible.map(s=><button className={"entity-scan-candidate is-"+s.status} key={s.id} title={`${drafts[s.id]?.name??s.name} · ${uiText(s.status==='rejected'?'Dismissed':s.status==='accepted'?'Accepted':'Pending')}`} aria-label={`${drafts[s.id]?.name??s.name} · ${uiText(s.status==='rejected'?'Dismissed':s.status==='accepted'?'Accepted':'Pending')}`} aria-current={focused?.id===s.id?'true':undefined} onClick={()=>focusSuggestion(s.id)}><span className="entity-scan-candidate-status" aria-label={uiText(s.status==='rejected'?'Dismissed':s.status==='accepted'?'Accepted':'Pending')} title={uiText(s.status==='rejected'?'Dismissed':s.status==='accepted'?'Accepted':'Pending')}>{s.status==='accepted'?'✓':s.status==='rejected'?'−':'·'}</span><span className="entity-scan-candidate-name">{drafts[s.id]?.name??s.name}<small>{entityLabels[drafts[s.id]?.type??s.type]}<span className="entity-scan-mention-count" title={uiText("Mentions in this note, including aliases")}> · {mentionCounts[s.id]??0} {uiText(mentionCounts[s.id]===1?'mention found':'mentions found')} · {s.status==='accepted'?(s.linkedOccurrences?.length??1):1+(drafts[s.id]?.additionalOccurrences?.length??0)} {uiText(s.status==='accepted'?'linked':'selected to link')}</span></small></span></button>)}</nav></aside>}
      {mode==='context'&&<section className="entity-scan-snapshot" ref={snapshot} aria-label={uiText("Read-only note preview")}><div className="entity-scan-document-heading entity-scan-pane-header"><h3>{uiText('Note preview')}</h3><div className="entity-scan-document-views" role="group" aria-label={uiText("Note view")}><button type="button" aria-label={uiText("Full note")} title={uiText("Full note")} aria-pressed={documentView==='full'} onClick={()=>saveDocumentView('full')}><Icon name="document-full"/></button><button type="button" aria-label="Matching excerpts" title="Matching excerpts · all mentions with surrounding context" aria-pressed={documentView==='excerpts'} onClick={()=>saveDocumentView('excerpts')}><Icon name="document-excerpt"/></button></div></div><ScanSnapshot page={page} entities={entities} names={focusedNames} view={documentView} onShowFull={()=>saveDocumentView('full')} suggestion={focused}/></section>}

      <div className="entity-review-table-wrap" aria-busy={scanning}>
        {mode==='context'&&<div className="entity-scan-navigator entity-scan-pane-header" aria-label="Entity navigation"><button className="button" aria-label="Previous entity" title="Previous entity · Alt+←" disabled={!visible.length} onClick={()=>moveSuggestion(-1)}>‹</button><div><span>Suggestion {focused?visible.findIndex(s=>s.id===focused.id)+1:0} of {visible.length}</span></div><button className="button" aria-label="Next entity" title="Next entity · Alt+→" disabled={!visible.length} onClick={()=>moveSuggestion(1)}>›</button></div>}

        <div className="entity-review-table-scroll">
        {mode==='batch' && !scanning && !!visibleSubtypes.length && <section className="entity-review-subtype-proposals" aria-labelledby="subtype-proposals-title">
          <h3 id="subtype-proposals-title">{uiText("Proposed subtypes") + " "}<span>{subtypePending.length}{" " + uiText("pending")}</span></h3>
          <ul>{visibleSubtypes.map(item => <li key={item.id}>
            <div><strong>{item.name}</strong><small>{uiText(entityLabels[item.type])} · {(scan?.suggestions??[]).filter(suggestion => suggestion.proposedSubtypeIds?.includes(item.id)).map(suggestion => suggestion.name).join(', ')}</small></div>
            {item.status === 'pending' ? <div className="entity-review-subtype-actions"><button type="button" className="knowledge-icon-action" aria-label={uiText("Accept subtype: ")+item.name} title={uiText("Accept subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'accepted')}><Icon name="check"/></button><button type="button" className="knowledge-icon-action" aria-label={uiText("Dismiss subtype: ")+item.name} title={uiText("Dismiss subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'rejected')}><Icon name="close"/></button></div> : <span>{item.status === 'accepted' ? uiText("Accepted") : uiText("Dismissed")}</span>}
          </li>)}</ul>
        </section>}

        {visible.length>0&&<table className="entity-review-table"><thead><tr>{mode==='batch'&&<th className="entity-review-check"><input ref={selectAll} type="checkbox" aria-label={uiText("Select all visible pending suggestions")} checked={allSelected} disabled={locked||stale||!visiblePending.length} onChange={toggleAll}/></th>}<th>{uiText("Entity")}</th><th>{uiText('Entity type')}</th><th>{uiText("In this note")}</th><th>{uiText("Review")}</th></tr></thead><tbody>{(mode==='context'?(focused?[focused]:[]):visible).map(s=>{
          const draft=effectiveDraft(s);
          const selectedMentions=s.status==='accepted'?(s.linkedOccurrences?.length??1):1+(draft.additionalOccurrences?.length??0);
          const creationReason=createUnavailable(s);
          const saving=!!operation?.decision&&operation.ids.includes(s.id);
          const identityOptions={priorityIds:[...linkedEntityIds(page.blocks)]};
          const hasMatches=mode==='context'&&annotationSuggestions(entities,s.evidence,'',identityOptions).results.length>0;
          const resolutionPicker=<EntityResolutionPicker compact key={s.id} entities={entities} selection={s.evidence} options={identityOptions} disabled={locked||stale} onChoose={entity=>editSuggestion({...draft,name:entity.name,type:entity.type,subtypes:entity.subtypes,domainIds:entity.domainIds??[],existingId:entity.id})}/>;
          return <Fragment key={s.id}><tr className={'is-'+s.status+(selectedIds.includes(s.id)?' is-selected':'')+(feedback?.ids.includes(s.id)?' was-reviewed':'')} aria-busy={saving}>
            {mode==='batch'&&<td className="entity-review-check"><input type="checkbox" aria-label={uiText("Select ")+s.name} checked={selectedIds.includes(s.id)} disabled={locked||stale||s.status!=='pending'} onChange={()=>setSelected(current=>current.includes(s.id)?current.filter(id=>id!==s.id):[...current,s.id])}/></td>}
            <td><div className="entity-review-name"><span className={'scan-entity-icon '+draft.type}><Icon name={draft.type}/></span><div><strong>{draft.name}</strong><span className="entity-review-match-label">{uiText(awaitingIdentity(s)?(ambiguous(s)?'Choose existing entity':'Requires existing entity'):awaitingSubtype(s)?'Requires subtype decision':draft.existingId?'Existing entity':'New entity')}{drafts[s.id]?uiText(" · Edited"):''}</span>{mode==='context'&&<small>{uiText(entityLabels[draft.type])}</small>}{mode==='batch'&&!!draft.aliases?.length&&<small>{uiText("Aliases:") + " "}{draft.aliases.join('; ')}</small>}</div></div></td>
            {mode==='batch'&&<td><span className="entity-review-category">{uiText(entityLabels[draft.type])}</span><small>{draft.subtypes.map(id=>schema.subtypes.find(t=>t.id===id)?.name).filter(Boolean).join(', ')}</small>{!!s.proposedSubtypeIds?.length && <small>{s.proposedSubtypeIds.flatMap(id => {const item=scan?.subtypeSuggestions?.find(item=>item.id===id);return item?.status==='pending'?[item.name+' (awaiting review)']:[];}).join(', ')}</small>}{awaitingSubtype(s)&&<button className="button small" disabled={locked||stale} onClick={()=>setEditingId(s.id)}>{uiText('Review subtype')}</button>}</td>}
            {mode==='batch'&&<td><Evidence page={page} suggestion={s}/><small>{uiText(s.status==='accepted'?((mentionCounts[s.id]??0)===1?"{value0} mention found · {value1} linked":"{value0} mentions found · {value1} linked"):((mentionCounts[s.id]??0)===1?"{value0} mention found · {value1} selected to link":"{value0} mentions found · {value1} selected to link"),{value0:mentionCounts[s.id]??0,value1:selectedMentions})}</small>{s.status==='pending'&&<button className="button small" disabled={locked||stale} onClick={()=>showOccurrences(s.id)}>{uiText("Choose mentions")}</button>}<details className="entity-review-evidence-details"><summary>Review details</summary>{evidenceContext(page,s.evidenceAnchor)&&<p>{evidenceContext(page,s.evidenceAnchor)?.text}</p>}<button className="button small" onClick={()=>{setMode('context');focusSuggestion(s.id);}}>{uiText("View in note")}</button><p>{s.reason}</p><small>{draft.existingId?'Links the highlighted occurrence to the saved entity.':'Creates an entity and links the highlighted occurrence.'} Original wording is preserved.</small>{draft.type==='concept' && !!draft.domainIds?.length && <small>{uiText("Disciplines:") + " "}{draft.domainIds.map(domainBreadcrumb).join(' · ')}</small>}{draft.type==='concept' && !!draft.domainIds?.length && page.pageDomains?.primaryDomainId && !draft.domainIds.some(id => domainPath(id).some(domain => domainPath(page.pageDomains!.primaryDomainId!).some(pageDomain => pageDomain.id === domain.id))) && <small>{uiText("Different note subject; review the passage for local context.")}</small>}</details></td>}
            {mode==='context'&&s.status==='pending'&&<td className="entity-context-resolution">
              <div className="entity-decision-choices" role="group" aria-label={uiText('Entity destination')}><button className="button small" aria-pressed={!!draft.existingId} disabled={locked||stale} onClick={()=>{const picker=document.getElementById('entity-match-'+s.id);picker?.querySelector<HTMLInputElement>('[role=combobox]')?.focus();}}>{uiText('Link existing')}</button><button className="button small entity-decision-create" aria-pressed={!draft.existingId&&!creationReason} disabled={locked||stale||!!creationReason} onClick={()=>editSuggestion({...draft,existingId:null,name:s.name,type:s.type,subtypes:s.subtypes??[]})}>{uiText('Create new')}</button></div>
              <div id={'entity-match-'+s.id}><h3>{uiText(hasMatches?'Possible matches':'Search existing entities')}</h3>{resolutionPicker}</div>
              {creationReason&&<p className="entity-decision-required">{creationReason}</p>}
              <div className="entity-decision-outcome" role="status"><Icon name={draft.existingId?'knowledge':'plus'}/><p>{awaitingIdentity(s)?uiText('Choose an existing entity to continue.'):uiText(draft.existingId?'Links to “{value0}”':'Creates “{value0}”',{value0:entities.find(entity=>entity.id===draft.existingId)?.name??draft.name})}<small>{uiText((mentionCounts[s.id]??0)===1?'{value0} mention found · {value1} selected to link':'{value0} mentions found · {value1} selected to link',{value0:mentionCounts[s.id]??0,value1:selectedMentions})}</small></p></div>
              <button className="button small" disabled={locked||stale} onClick={()=>showOccurrences(s.id)}>{uiText('Choose mentions')}</button>
              {awaitingSubtype(s)&&<div className="entity-decision-required"><span>{uiText('Review the proposed subtype before accepting.')}</span><button className="button small" disabled={locked||stale} onClick={()=>setEditingId(s.id)}>{uiText('Review subtype')}</button></div>}

            </td>}
            {mode==='batch'&&<td>{reviewActions(s)}</td>}

          </tr>{editingId===s.id&&s.status==='pending'&&<tr className="entity-review-editor-row"><td colSpan={5}><div className="entity-review-editor" id={'suggestion-edit-'+s.id}>
            <div className="entity-review-editor-heading"><strong>{uiText("Edit suggestion")}</strong><button className="button small" disabled={locked} onClick={()=>setEditingId(null)}>{uiText("Done editing")}</button></div>
            <div className="entity-review-editor-fields">
              {mode==='batch'&&<div className="entity-review-match-field"><strong>{uiText("Link existing")}</strong><EntityResolutionPicker entities={entities} selection={s.evidence} options={{priorityIds:[...linkedEntityIds(page.blocks)]}} disabled={locked||stale} onChoose={entity=>editSuggestion({...draft,name:entity.name,type:entity.type,subtypes:entity.subtypes,domainIds:entity.domainIds??[],existingId:entity.id})}/><button className="button" onClick={()=>editSuggestion({...draft,existingId:null,name:s.name,type:s.type,subtypes:s.subtypes??[]})} disabled={locked||stale||!!creationReason}>{uiText("Create new")}</button>{creationReason&&<p className="entity-decision-required">{creationReason}</p>}</div>}
              <label>{uiText("Name")}<input aria-label={uiText("Entity name for ")+s.name} maxLength={200} value={draft.name} readOnly={!!draft.existingId} disabled={locked||stale} onChange={e=>editSuggestion({...draft,name:e.target.value})}/></label>
              <label>{uiText('Entity type')}<Select aria-label={uiText("Entity type for ")+s.name} value={draft.type} disabled={locked||stale||!!draft.existingId} onChange={e=>editSuggestion({...draft,type:e.target.value as EntityType,subtypes:[],domainIds:[]})}>{entityTypes.map(type=><option value={type} key={type}>{uiText(entityLabels[type])}</option>)}</Select></label>
              <details className="entity-review-alias-options"><summary>Aliases{draft.aliases?.length?` (${draft.aliases.length})`:""}</summary><label className="entity-review-alias-toggle"><input type="checkbox" checked={draft.saveAliases===true} disabled={locked||stale||draft.type==='source'} onChange={e=>editSuggestion({...draft,saveAliases:e.target.checked})}/>Save aliases for future matching</label><div className="entity-review-aliases"><AliasInput value={(draft.aliases??[]).join('\n')} onChange={value=>editSuggestion({...draft,aliases:parseAliases(value)})} disabled={locked||stale||draft.type==='source'} maxAliases={20} compact/><small>Aliases update the catalogue separately from note undo.</small></div></details>
            </div>
            {!draft.existingId&&s.proposedSubtypeIds?.some(id=>subtypePending.some(item=>item.id===id))&&<fieldset disabled={locked||stale}><legend>Dependent subtype decisions</legend><p>{uiText("Selected subtypes and this entity will be accepted together.")}</p>{subtypePending.filter(item=>s.proposedSubtypeIds?.includes(item.id)&&item.type===draft.type).map(item=><label key={item.id}><input type="checkbox" checked={draft.approveSubtypeIds?.includes(item.id)??false} onChange={e=>editSuggestion({...draft,approveSubtypeIds:e.target.checked?[...(draft.approveSubtypeIds??[]),item.id]:(draft.approveSubtypeIds??[]).filter(id=>id!==item.id)})}/>{uiText("Accept “{value0}” with this entity",{value0:item.name})}</label>)}</fieldset>}
            <details className="entity-review-occurrence-options" open={occurrenceEditor===s.id?true:undefined} onToggle={event=>{if(!event.currentTarget.open&&occurrenceEditor===s.id)setOccurrenceEditor(null);}}><summary>{uiText("Mentions to link")}{draft.additionalOccurrences?.length?` (${draft.additionalOccurrences.length+1} selected)`:""}</summary><fieldset disabled={locked||stale}><legend>{uiText("Mentions to link")}</legend><p>{uiText("The highlighted mention is included. Additional choices match its exact wording.")}</p>{evidenceOccurrences(page,s.evidence).map(anchor=>{const key=anchorKey(anchor),primary=!!s.evidenceAnchor&&key===anchorKey(s.evidenceAnchor),context=evidenceContext(page,anchor,45);return <label className="scan-occurrence" key={key}><input type="checkbox" checked={primary||!!draft.additionalOccurrences?.some(item=>anchorKey(item)===key)} disabled={primary} onChange={e=>editSuggestion({...draft,additionalOccurrences:e.target.checked?[...(draft.additionalOccurrences??[]),anchor]:(draft.additionalOccurrences??[]).filter(item=>anchorKey(item)!==key)})}/><span>{context?.before}<mark>{context?.match}</mark>{context?.after}<small>{context?.label}{primary?' · Scan evidence':''}</small></span></label>;})}</fieldset></details>
            <fieldset className="entity-review-edit-subtypes" disabled={locked||stale||!!draft.existingId}><legend>{uiText("Subtypes")}</legend><div>{schema.subtypes.filter(type=>type.type===draft.type).map(type=><label key={type.id}><input type="checkbox" checked={draft.subtypes.includes(type.id)} onChange={e=>editSuggestion({...draft,subtypes:e.target.checked?[...draft.subtypes,type.id]:draft.subtypes.filter(id=>id!==type.id)})}/>{type.name}</label>)}{!schema.subtypes.some(type=>type.type===draft.type)&&<span>{uiText("No subtypes available")}</span>}</div></fieldset>
            {draft.type==='concept' && <DomainPicker value={draft.domainIds ?? []} onChange={domainIds => editSuggestion({...draft,domainIds})} disabled={locked||stale||!!draft.existingId}/>}
            <p className="entity-review-edit-reason">{s.reason}{draft.existingId?uiText(" · Using saved entity details."):''}</p>
          </div></td></tr>}</Fragment>;
        })}</tbody></table>}
        </div>
        {mode==='context'&&focused&&<div className="entity-review-inspector-actions">{reviewActions(focused)}</div>}
      </div></>}
      </div>
      {((hasReviewItems&&mode==='batch')||feedback?.complete)&&<footer className="entity-review-footer">{mode==='batch'&&<div className="entity-review-selection"><strong>{selectedIds.length}{" " + uiText("selected")}</strong><button disabled={locked||stale||!visiblePending.length} onClick={()=>setSelected(visiblePending)}>{uiText("Select all visible ({value0})",{value0:visiblePending.length})}</button>{selectedIds.length>0&&<button disabled={locked} onClick={()=>setSelected([])}>{uiText("Clear")}</button>}</div>}<div className="entity-review-bulk-actions">{mode==='batch'&&<><button className="button" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'rejected')}>{operation?.decision==='rejected'&&<span className="scan-spinner"/>}{uiText("Dismiss selected")}</button><button className="button primary" disabled={locked||stale||!selectedIds.length||pending.some(item=>selectedIds.includes(item.id)&&(awaitingSubtype(item)||awaitingIdentity(item)))} onClick={()=>decide(selectedIds,'accepted')}>{operation?.decision==='accepted'&&<span className="scan-spinner"/>}{uiText("Accept selected")}{selectedIds.length>0?` (${selectedIds.length})`:''}</button></>}{feedback?.complete&&<button className="button" onClick={()=>{setMode('batch');setFilter('reviewed');setTypeFilter('all');setIdentityFilter('all');setQuery('');}}>View changes</button>}</div></footer>}
    </Modal>}
  </div>;
}

function Evidence({page,suggestion}:{page:Page;suggestion:EntitySuggestion}) {
  const context=evidenceContext(page,suggestion.evidenceAnchor);
  return context?<div className="scan-evidence"><q>{context.before}<mark>{context.match}</mark>{context.after}</q><details><summary>Evidence details</summary><small>{context.label}</small></details></div>:<q>{suggestion.evidence}</q>;
}

function ScanSnapshot({page,suggestion,entities,names,view,onShowFull}:{page:Page;suggestion?:EntitySuggestion;entities:Entity[];names:string[];view:'full'|'excerpts';onShowFull:()=>void}) {
  const measurement=useRef<HTMLDivElement>(null);
  const expansionScope=[page.id,page.revision,suggestion?.id].join(':');
  const [expansion,setExpansion]=useState<{scope:string;sections:Array<{start:number;end:number}>}>({scope:expansionScope,sections:[]});
  const expandedSections=expansion.scope===expansionScope?expansion.sections:[];
  const [renderedLines,setRenderedLines]=useState<Array<{index:number;row:number|undefined;start:number;end:number}>>([]);
  useLayoutEffect(()=>{
    const root=measurement.current;
    if(!root)return;
    const measure=()=>{
      const next=page.blocks.flatMap<{index:number;row:number|undefined;start:number;end:number}>((block,index)=>block.rows?block.rows.map((_,row)=>({index,row,start:0,end:0})):Array.from(root.querySelectorAll<HTMLElement>('[data-measure-index]')).filter(element=>Number(element.dataset.measureIndex)===index).flatMap(element=>renderedReviewLines(element).map(line=>({...line,index,row:undefined}))));
      setRenderedLines(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);
    };
    measure();
    const win=root.ownerDocument.defaultView;
    const observer=win?.ResizeObserver?new win.ResizeObserver(measure):undefined;
    observer?.observe(root);
    win?.addEventListener('resize',measure);
    root.ownerDocument.fonts?.addEventListener('loadingdone',measure);
    return ()=>{observer?.disconnect();win?.removeEventListener('resize',measure);root.ownerDocument.fonts?.removeEventListener('loadingdone',measure);};
  },[page.blocks,entities]);
  const scrolledPreview=useRef<string|null>(null);
  const scrollTarget=[expansionScope,view].join(':');
  useEffect(()=>{
    if(scrolledPreview.current===scrollTarget)return;
    const match=measurement.current?.parentElement?.querySelector<HTMLElement>('[data-active-match]');
    // Excerpts may need their first layout measurement before the match exists.
    if(match){match.scrollIntoView?.({block:'center',inline:'nearest'});scrolledPreview.current=scrollTarget;}
  },[scrollTarget,renderedLines]);
  const anchor=suggestion?.evidenceAnchor;
  const occurrences=reviewMentionAnchors(page,names,entities);
  if(anchor&&!occurrences.some(item=>anchorKey(item)===anchorKey(anchor)))occurrences.push(anchor);
  const sameCell=(a:NonNullable<EntitySuggestion['evidenceAnchor']>,blockId:string,row?:number,col?:number)=>a.blockId===blockId&&a.row===row&&a.col===col;
  function text(segments:Segment[],blockId:string,row?:number,col?:number,from=0,to?:number){
    const value=reviewSegmentText(segments,entities),until=to??value.length;
    const currentMatches=occurrences.filter(item=>sameCell(item,blockId,row,col));
    const boundaries=new Set([from,until]);
    for(const a of currentMatches){if(a.start>=from&&a.start<until)boundaries.add(a.start);if(a.end>from&&a.end<=until)boundaries.add(a.end);}
    const points=[...boundaries].sort((a,b)=>a-b);
    return points.slice(0,-1).map((start,index)=>{
      const end=points[index+1]!,current=currentMatches.some(a=>a.start<=start&&a.end>=end);
      const primary=anchor?sameCell(anchor,blockId,row,col)&&anchor.start<=start&&anchor.end>=end:current;
      return current?<mark key={start} data-current-mention="true" data-active-match={primary?'true':undefined}>{value.slice(start,end)}</mark>:<Fragment key={start}>{value.slice(start,end)}</Fragment>;
    });
  }
  function blockContent(index:number,start?:number,end?:number,rowStart=0,rowEnd?:number){
    const block=page.blocks[index]!;
    return <article key={`${block.id}-${start??rowStart}`} data-snapshot-block={block.id} data-block-type={block.type} className={occurrences.some(a=>a.blockId===block.id)?'is-active':''}>
      {block.rows?<table><tbody>{block.rows.slice(rowStart,rowEnd).map((row,r)=><tr key={rowStart+r}>{row.map((cell,c)=><td key={c}>{text(cell,block.id,rowStart+r,c)}</td>)}</tr>)}</tbody></table>:<p>{text(block.content,block.id,undefined,undefined,start,end)}</p>}
    </article>;
  }
  // Same width, typography and block grid as the visible document. Clipping this
  // copy keeps measurement from adding scroll height or entering accessibility.
  const measuringDocument=<div className="entity-scan-measurement" ref={measurement} aria-hidden="true">{page.blocks.map((block,index)=><article key={block.id} data-block-type={block.type}>{block.rows?<table><tbody>{block.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{reviewSegmentText(cell,entities)}</td>)}</tr>)}</tbody></table>:<p data-measure-index={index}>{reviewSegmentText(block.content,entities)}</p>}</article>)}</div>;
  const wrap=(content:React.ReactNode)=><div className="entity-scan-rendered-document">{measuringDocument}<div className="entity-scan-document-content">{content}</div></div>;
  if(view==='full')return wrap(page.blocks.map((_,index)=>blockContent(index)));
  // Source offsets remain stable when the preview wraps into different lines.
  let sourceOffset=0;
  const rowOffsets=page.blocks.map(block=>(block.rows?block.rows.map(row=>row.flat()):[block.content]).map(segments=>{const start=sourceOffset;sourceOffset+=reviewSegmentText(segments,entities).length+1;return {start,end:sourceOffset};}));
  const lines=renderedLines.map(line=>{
    const offset=rowOffsets[line.index]![line.row??0]!;
    return {...line,sourceStart:offset.start+line.start,sourceEnd:line.row===undefined?offset.start+line.end:offset.end,matched:occurrences.some(a=>a.blockId===page.blocks[line.index]!.id&&(line.row===undefined?a.row===undefined&&a.start<line.end&&a.end>line.start:a.row===line.row))};
  });
  const contextWindows=reviewContextWindows(lines.map(line=>line.matched));
  const windows=reviewContextWindows(lines.map((line,index)=>contextWindows.some(window=>index>=window.start&&index<window.end)||expandedSections.some(section=>line.sourceStart<section.end&&line.sourceEnd>section.start)),0);
  if(!windows.length)return wrap(<div className="entity-scan-no-excerpts"><p>{uiText("No mentions found in this note.")}</p><button className="button small" onClick={onShowFull}>{uiText("Show full note")}</button></div>);
  const skipped=(start:number,end:number)=><button key={`skip-${start}-${end}`} type="button" className="entity-scan-skipped" data-context-start={lines[start]!.sourceStart} data-context-end={lines[end-1]!.sourceEnd} onClick={()=>setExpansion(current=>({scope:expansionScope,sections:[...(current.scope===expansionScope?current.sections:[]),{start:lines[start]!.sourceStart,end:lines[end-1]!.sourceEnd}]}))} title="Expand this section" aria-label="Expand this skipped section" aria-expanded="false"><Icon name="more"/><span>More context</span></button>;
  function collapseSection(section:{start:number;end:number}){
    setExpansion(current=>({...current,sections:current.sections.filter(item=>item!==section)}));
    requestAnimationFrame(()=>{
      const controls=measurement.current?.parentElement?.querySelectorAll<HTMLButtonElement>('.entity-scan-skipped');
      const replacement=Array.from(controls??[]).find(button=>Number(button.dataset.contextStart)<section.end&&Number(button.dataset.contextEnd)>section.start);
      replacement?.focus({preventScroll:true});
      replacement?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    });
  }
  function renderLines(start:number,end:number){
    const content=[];
    for(let i=start;i<end;){
      const first=lines[i]!;let j=i+1;
      while(j<end&&lines[j]!.index===first.index)j++;
      const last=lines[j-1]!;
      content.push(blockContent(first.index,first.row===undefined?first.start:undefined,first.row===undefined?last.end:undefined,first.row??0,last.row===undefined?undefined:last.row+1));
      i=j;
    }
    return content;
  }
  const sectionForLine=(index:number)=>expandedSections.find(section=>lines[index]!.sourceStart<section.end&&lines[index]!.sourceEnd>section.start);
  return wrap(<>{windows.map((window,windowIndex)=>{
    const content=[];
    if(window.start>(windows[windowIndex-1]?.end??0))content.push(skipped(windows[windowIndex-1]?.end??0,window.start));
    for(let i=window.start;i<window.end;){
      const section=sectionForLine(i);let j=i+1;
      while(j<window.end&&sectionForLine(j)===section)j++;
      content.push(section?<div className="entity-scan-expanded-context" key={`expanded-${section.start}`}><button type="button" className="entity-scan-collapse-context" aria-label="Collapse this context section" aria-expanded="true" onClick={()=>collapseSection(section)}>Less context</button>{renderLines(i,j)}</div>:<Fragment key={`context-${i}`}>{renderLines(i,j)}</Fragment>);
      i=j;
    }
    return <Fragment key={window.start}>{content}</Fragment>;
  })}{windows.at(-1)!.end<lines.length&&skipped(windows.at(-1)!.end,lines.length)}</>);
}
