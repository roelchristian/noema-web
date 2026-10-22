import {t as uiText} from '../i18n';
import {domainPath} from '../../shared/domains';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';
import { entityReviewFeedback, type ReviewFeedback } from './entity-review-feedback';
import {EntityResolutionPicker} from '../editor/EntityResolutionPicker';
import {normalizeEntityName,linkedEntityIds} from '../../shared/auto-entities';
import { Select } from '../components/Select';
import { Fragment, useEffect, useRef, useState } from 'react';
import {anchorKey,evidenceOccurrences,evidenceContext, type EntityScan, type EntitySuggestion, type EntitySuggestionEdit } from '../../shared/entity-scan';
import { entityLabels, entityTypes, type Entity, type EntityType, type Page, type Segment } from '../../shared/domain';
import { api } from '../api';
import { useEntitySchema } from '../knowledge/useEntitySchema';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import {AliasInput,parseAliases} from '../knowledge/AliasInput';

function ReviewConfirmation({feedback,inline=false}:{feedback:ReviewFeedback;inline?:boolean}) {
  return <div className={'entity-review-confirmation'+(inline?' entity-review-confirmation-inline':'')} role="status" title={feedback.detail}>
    <Icon name="check"/><span>{feedback.message}</span><span className="sr-only">{feedback.detail}</span>
  </div>;
}

type Decision = 'accepted' | 'rejected';
export function EntityScanReview({page,scan:savedScan,onScan,onFlush,onReview,disabled,entities}:{entities:Entity[];page:Page;scan:EntityScan|null;onScan:(scan:EntityScan)=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:Decision,edits?:EntitySuggestionEdit[])=>Promise<EntityScan>;disabled:boolean}) {
  const {schema}=useEntitySchema(page.vault_id);
  const [preview,setPreview]=useState<EntityScan|null>(null);
  const [reviewingBatch,setReviewingBatch]=useState(false);
  const scan=preview??savedScan;
  const scanController=useRef<AbortController|null>(null);
  useEffect(()=>()=>scanController.current?.abort(),[]);
  const [open,setOpen]=useState(false),[operation,setOperation]=useState<{ids:string[];decision?:Decision}|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState<'all'|'pending'|'reviewed'>('all'),[query,setQuery]=useState('');
  const [editingId,setEditingId]=useState<string|null>(null);
  const [mode,setMode]=useState<'batch'|'context'>(()=>typeof window!=='undefined'&&window.matchMedia?.('(min-width: 751px)').matches?'context':'batch'),[activeId,setActiveId]=useState<string|null>(null);
  const [typeFilter,setTypeFilter]=useState('all'),[identityFilter,setIdentityFilter]=useState('all'),[grouped,setGrouped]=useState(false);
  const snapshot=useRef<HTMLElement>(null);
  const [drafts,setDrafts]=useState<Record<string,EntitySuggestionEdit>>({});
  useEffect(()=>{setDrafts({});setEditingId(null);},[scan?.id]);
  const [feedback,setFeedback]=useState<ReviewFeedback|null>(null);
  const [error,setError]=useState(''),[announcement,setAnnouncement]=useState('');
  const running=useRef(false),active=useRef(true),selectAll=useRef<HTMLInputElement>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const pending=scan?.suggestions.filter(s=>s.status==='pending')||[];
  const subtypePending=scan?.subtypeSuggestions?.filter(item=>item.status==='pending') ?? [];
  const selectedIds=selected.filter(id=>pending.some(s=>s.id===id));
  function identityStatus(s:EntitySuggestion){const draft=drafts[s.id];return awaitingIdentity(s)?'ambiguous':awaitingSubtype(s)?'subtype-required':(draft?draft.existingId:s.existingId)?'existing':'new';}
  const visible=(scan?.suggestions||[]).filter(s=>(filter==='all'||(filter==='pending'?s.status==='pending':s.status!=='pending'))&&(typeFilter==='all'||(drafts[s.id]?.type??s.type)===typeFilter)&&(identityFilter==='all'||identityStatus(s)===identityFilter)&&`${s.name} ${entityLabels[s.type]} ${s.evidence}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{
    if(grouped){const group=identityStatus(a).localeCompare(identityStatus(b));if(group)return group;}
    const position=(s:EntitySuggestion)=>{const anchor=s.evidenceAnchor;return [page.blocks.findIndex(block=>block.id===anchor?.blockId),anchor?.row??-1,anchor?.col??-1,anchor?.start??0];};
    const left=position(a),right=position(b);return left.reduce((difference,value,index)=>difference||value-right[index]!,0);
  });
  const focused=visible.find(s=>s.id===activeId)??visible[0];
  function focusSuggestion(id:string){setActiveId(id);setEditingId(id);}
  function moveSuggestion(delta:number){if(!visible.length)return;const index=visible.findIndex(s=>s.id===focused?.id);focusSuggestion(visible[(index+delta+visible.length)%visible.length]!.id);}
  useEffect(()=>{if(mode==='context'&&focused?.evidenceAnchor){const target=Array.from(snapshot.current?.querySelectorAll<HTMLElement>('[data-snapshot-block]')??[]).find(element=>element.dataset.snapshotBlock===focused.evidenceAnchor!.blockId);target?.scrollIntoView?.({block:'nearest'});}},[mode,focused?.id]);
  const visiblePending=visible.filter(s=>s.status==='pending').map(s=>s.id);
  const allSelected=visiblePending.length>0&&visiblePending.every(id=>selectedIds.includes(id));
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=!allSelected&&visiblePending.some(id=>selectedIds.includes(id));},[allSelected,visiblePending,selectedIds]);
  const stale=!!scan&&scan.revision!==page.revision;
  const scanning=!!operation&&!operation.decision;
  const locked=!!operation||disabled;
  const total=(scan?.suggestions.length ?? 0)+(scan?.subtypeSuggestions?.length ?? 0);
  const reviewed=total-pending.length-subtypePending.length;
  const batchSuggestions=scan?.suggestions.slice(-(scan.batchCount??scan.suggestions.length))??[];
  const batchPending=batchSuggestions.filter(item=>item.status==='pending').length;
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

      if(active.current){onScan(result);if(decision)setFeedback(entityReviewFeedback(result,ids,decision));if(!decision||ids.includes(editingId||''))setEditingId(null);setDrafts(current=>decision?Object.fromEntries(Object.entries(current).filter(([id])=>!ids.includes(id))):{});setSelected(current=>decision?current.filter(id=>!ids.includes(id)):[]);setAnnouncement(decision?`${ids.length} ${result.subtypeSuggestions?.some(item=>ids.includes(item.id))?'subtype suggestions':'entity suggestions'} ${decision}.`:`${result.suggestions.length} potential entities found.`);}
    }catch(error){if(active.current)setError(error instanceof Error?error.message:'Entity scan failed.');}
    finally{running.current=false;if(active.current){setOperation(null);setPreview(null);}}
  }
  function scanNote(continuePrevious=false) {
    void run([],async()=>{
      const saved=await onFlush();
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected note changed. Try again.');
      const controller=new AbortController();scanController.current=controller;
      if(active.current){setReviewingBatch(false);setPreview(continuePrevious&&savedScan?savedScan:{id:'scanning',revision:saved.revision,suggestions:[]});setFilter('all');setQuery('');}
      const result=await api.scanEntities(saved.vault_id,saved.id,saved.revision,partial=>{if(active.current)setPreview(partial);},controller.signal,continuePrevious&&savedScan?.continuation?{scanId:savedScan.id,token:savedScan.continuation.token}:undefined);
      if(active.current){setFilter('all');setQuery('');}
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
  function awaitingIdentity(s:EntitySuggestion){return s.status==='pending'&&ambiguous(s)&&!drafts[s.id]?.existingId;}
  function decide(ids:string[],decision:Decision){
    if(!scan||!ids.length)return;
    const edits=decision==='accepted'&&!ids.some(id=>scan.subtypeSuggestions?.some(item=>item.id===id))?ids.flatMap(id=>drafts[id]?[drafts[id]!]:[]):undefined;
    void run(ids,()=>onReview(scan.id,ids,decision,edits),decision);
  }
  function editSuggestion(draft:EntitySuggestionEdit){setDrafts(current=>({...current,[draft.id]:draft}));}
  function toggleAll(){setSelected(current=>allSelected?current.filter(id=>!visiblePending.includes(id)):[...new Set([...current,...visiblePending])]);}
  return <div className="knowledge-entity-discovery">
    <button type="button" className={'knowledge-icon-action entity-detect-action'+(scanning?' is-working':'')} disabled={disabled} aria-label={scan?uiText("Review detected entities ({value0})",{value0: pending.length+subtypePending.length}):uiText("Detect entities with AI")} aria-haspopup="dialog" title={scan?uiText("{value0} pending suggestions",{value0: pending.length+subtypePending.length}):uiText("Detect entities with AI")} onClick={()=>{setFeedback(null);setAnnouncement('');setOpen(true);if(!scan&&!running.current)scanNote();}}><Icon name="sparkles"/>{!!scan&&pending.length+subtypePending.length>0&&<span className="knowledge-action-badge">{pending.length+subtypePending.length}</span>}</button>
    {!open&&feedback&&<ReviewConfirmation feedback={feedback} inline/>}
    {open&&<Modal className="entity-review-modal" titleId="entity-review-title" onClose={()=>setOpen(false)}>
      <div className="entity-review-controls"><ModalHeader titleId="entity-review-title">{uiText("Entity review")}</ModalHeader><p className="modal-description">{page.title||uiText("Untitled")}</p>
      {total>0&&!scanning&&<div className="entity-review-progress"><span>Saved review: {reviewed}{" " + uiText("of") + " "}{total}{" " + uiText("reviewed")}</span><div role="progressbar" aria-label="Saved review decisions" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed}><span style={{width:`${reviewed/total*100}%`}}/></div></div>}
      <div className="entity-review-toolbar"><div className="entity-review-filters" role="group" aria-label={uiText("Filter suggestions")}>{(['all','pending','reviewed'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?uiText("All"):value==='pending'?uiText("Pending"):uiText("Reviewed")}<span>{value==='all'?total:value==='pending'?pending.length+subtypePending.length:reviewed}</span></button>)}</div><label className="entity-review-search"><Icon name="search"/><input aria-label={uiText("Search suggestions")} placeholder={uiText("Search entities…")} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="knowledge-icon-action" disabled={locked} aria-label={scanning?uiText("Scanning entities"):scan?uiText("Scan again"):uiText("Scan note")} title={scan?uiText("Scan again"):uiText("Scan note")} onClick={()=>scanNote()}>{scanning?<span className="scan-spinner"/>:<Icon name={scan?'refresh':'sparkles'}/>}</button></div>
      <div className="entity-review-toolbar">
        <div role="group" aria-label="Review mode"><button className="button" aria-pressed={mode==='context'} onClick={()=>{setMode('context');if(focused)focusSuggestion(focused.id);}}>Contextual review</button><button className="button" aria-pressed={mode==='batch'} onClick={()=>setMode('batch')}>Compact batch</button></div>
        <details className="entity-scan-filter-options"><summary>Filter and sort</summary><div><label>Type<Select aria-label="Filter by entity type" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All types</option>{entityTypes.map(type=><option key={type} value={type}>{entityLabels[type]}</option>)}</Select></label>
        <label>Identity<Select aria-label="Filter by identity status" value={identityFilter} onChange={e=>setIdentityFilter(e.target.value)}><option value="all">All identities</option><option value="existing">Existing entity</option><option value="new">New entity</option><option value="ambiguous">Ambiguous identity</option><option value="subtype-required">Requires subtype decision</option></Select></label>
        <label>Order<Select aria-label="Suggestion order" value={grouped?'identity':'document'} onChange={e=>setGrouped(e.target.value==='identity')}><option value="document">Document order</option><option value="identity">Group by identity status</option></Select></label></div></details>
        <span role="status">{scanning?'Scanning · provisional results cannot be accepted':scan?.continuation?'Scan paused at a saved checkpoint':'Scan finalized'}{!scanning&&scan&&<> · This batch: {batchSuggestions.length} suggestions · {batchPending} pending · {batchSuggestions.length-batchPending} reviewed</>}</span>
      </div>
      <div className="entity-review-messages" aria-live="polite">{announcement&&!feedback&&<span className="sr-only" role="status">{announcement}</span>}{feedback&&<ReviewConfirmation feedback={feedback}/>}{error&&<p className="inline-error" role="alert">{error}</p>}{stale&&<p role="status">{uiText("Note changed. Scan again to review fresh suggestions.")}</p>}</div>
      {!!scan?.continuation&&!scanning&&!stale&&<div className="entity-scan-batch-prompt" role="status">
        <p>{uiText("{value0} suggestions saved in this batch. More text remains to scan.",{value0:scan.batchCount??25})}</p>
        <div><button className="button primary" disabled={locked} onClick={()=>scanNote(true)}>{uiText("Continue scanning")}</button>{!reviewingBatch&&<button className="button" disabled={locked} onClick={()=>{setReviewingBatch(true);setFilter('pending');setQuery('');}}>{uiText("Review these suggestions first")}</button>}</div>
      </div>}
      {scanning&&visible.length>0&&<p className="entity-scan-live-status" role="status"><span className="scan-spinner"/>{scan?.suggestions.length}{" " + uiText("entities found · Still scanning…")}</p>}
      </div><div className={'entity-review-workspace mode-'+mode} onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();moveSuggestion(event.key==='ArrowRight'?1:-1);}
        if(event.key==='/'&&!(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')&&focused){event.preventDefault();setEditingId(focused.id);requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.entity-review-editor [role=combobox]')?.focus());}
      }}>
      {mode==='context'&&<section className="entity-scan-snapshot" ref={snapshot} aria-label="Read-only page snapshot"><h3>Document context</h3><p>Read-only snapshot · revision {scan?.revision}. Returning to edit requires a fresh scan if the revision changes.</p><ScanSnapshot page={page} suggestion={focused} onSelect={id=>{const candidate=visible.find(item=>item.evidenceAnchor?.blockId===id);if(candidate)focusSuggestion(candidate.id);}}/></section>}
      <div className="entity-review-table-wrap" aria-busy={scanning}>
        {mode==='context'&&<><nav className="entity-scan-queue" aria-label="Candidate queue" onKeyDown={event=>{if((event.target as HTMLElement).closest('button')&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();moveSuggestion(event.key==='ArrowDown'?1:-1);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.entity-scan-queue [aria-current=true]')?.focus());}}}>{visible.map(s=><button className="button" key={s.id} aria-current={focused?.id===s.id?'true':undefined} onClick={()=>focusSuggestion(s.id)}>{s.name} · {identityStatus(s)} · {s.status}</button>)}</nav><div className="entity-review-toolbar"><button className="button" disabled={!visible.length} onClick={()=>moveSuggestion(-1)}>Previous</button><span>{focused?visible.findIndex(s=>s.id===focused.id)+1:0} of {visible.length} candidates</span><button className="button" disabled={!visible.length} onClick={()=>moveSuggestion(1)}>Next</button><small>Alt+← / →: navigate · /: identity search</small></div></>}

        {mode==='batch' && !scanning && !!scan?.subtypeSuggestions?.length && <section className="entity-review-subtype-proposals" aria-labelledby="subtype-proposals-title">
          <h3 id="subtype-proposals-title">{uiText("Proposed subtypes") + " "}<span>{subtypePending.length}{" " + uiText("pending")}</span></h3>
          <ul>{scan.subtypeSuggestions.filter(item => (filter === 'all' || (filter === 'pending' ? item.status === 'pending' : item.status !== 'pending')) && `${item.name} ${entityLabels[item.type]}`.toLowerCase().includes(query.toLowerCase())).map(item => <li key={item.id}>
            <div><strong>{item.name}</strong><small>{uiText(entityLabels[item.type])} · {scan.suggestions.filter(suggestion => suggestion.proposedSubtypeIds?.includes(item.id)).map(suggestion => suggestion.name).join(', ')}</small></div>
            {item.status === 'pending' ? <div className="entity-review-subtype-actions"><button type="button" className="knowledge-icon-action" aria-label={uiText("Approve subtype: ")+item.name} title={uiText("Approve subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'accepted')}><Icon name="check"/></button><button type="button" className="knowledge-icon-action" aria-label={uiText("Reject subtype: ")+item.name} title={uiText("Reject subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'rejected')}><Icon name="close"/></button></div> : <span>{item.status === 'accepted' ? uiText("Approved") : uiText("Rejected")}</span>}
          </li>)}</ul>
        </section>}

        {scanning&&!visible.length?<div className="scan-empty"><span className="scan-spinner"/><strong>{uiText("Finding connections in your note")}</strong><span>{uiText("Suggestions will appear here for review.")}</span></div>:!visible.length?<div className="scan-empty"><Icon name="search"/><strong>{query||filter!=='all'?uiText("No matching suggestions"):scan?uiText("No potential entities found"):uiText("Ready to discover entities")}</strong><span>{query?uiText("Try another search."):filter!=='all'?uiText("Choose another filter to see more."):uiText("Scan your note to find people, places, works and more.")}</span></div>:<table className="entity-review-table"><thead><tr><th className="entity-review-check"><input ref={selectAll} type="checkbox" aria-label={uiText("Select all visible pending suggestions")} checked={allSelected} disabled={locked||stale||!visiblePending.length} onChange={toggleAll}/></th><th>{uiText("Entity")}</th><th>{uiText("Category")}</th><th>{uiText("In this note")}</th><th>{uiText("Review")}</th></tr></thead><tbody>{(mode==='context'?(focused?[focused]:[]):visible).map(s=>{
          const draft=drafts[s.id]||{id:s.id,name:s.name,aliases:s.aliases??[],type:s.type,subtypes:s.subtypes||[],domainIds:s.domainIds||[],existingId:s.existingId};
          const saving=!!operation?.decision&&operation.ids.includes(s.id);
          return <Fragment key={s.id}><tr className={'is-'+s.status+(selectedIds.includes(s.id)?' is-selected':'')+(feedback?.ids.includes(s.id)?' was-reviewed':'')} aria-busy={saving}>
            <td className="entity-review-check"><input type="checkbox" aria-label={uiText("Select ")+s.name} checked={selectedIds.includes(s.id)} disabled={locked||stale||s.status!=='pending'} onChange={()=>setSelected(current=>current.includes(s.id)?current.filter(id=>id!==s.id):[...current,s.id])}/></td>
            <td><div className="entity-review-name"><span className={'scan-entity-icon '+draft.type}><Icon name={draft.type}/></span><div><strong>{draft.name}</strong><span className="entity-review-match-label">{awaitingIdentity(s)?"Ambiguous identity":awaitingSubtype(s)?"Requires subtype decision":draft.existingId?"Existing entity":"New entity"}{drafts[s.id]?uiText(" · Edited"):''}</span>{!!draft.aliases?.length&&<small>{uiText("Aliases:") + " "}{draft.aliases.join('; ')}</small>}</div></div></td>
            <td><span className="entity-review-category">{uiText(entityLabels[draft.type])}</span><small>{draft.subtypes.map(id=>schema.subtypes.find(t=>t.id===id)?.name).filter(Boolean).join(', ')}</small>{!!s.proposedSubtypeIds?.length && <small>{s.proposedSubtypeIds.flatMap(id => {const item=scan?.subtypeSuggestions?.find(item=>item.id===id);return item?.status==='pending'?[item.name+' (awaiting review)']:[];}).join(', ')}</small>}</td>
            <td><Evidence page={page} suggestion={s}/><button className="button small" onClick={()=>{setMode('context');focusSuggestion(s.id);}}>View in page</button><p>{s.reason}</p><small>{draft.existingId?'Links the highlighted occurrence to the saved identity.':'Creates an entity and links the highlighted occurrence.'} Original wording is preserved.</small>{draft.type==='concept' && !!draft.domainIds?.length && <small>{uiText("Disciplines:") + " "}{draft.domainIds.map(domainBreadcrumb).join(' · ')}</small>}{draft.type==='concept' && !!draft.domainIds?.length && page.pageDomains?.primaryDomainId && !draft.domainIds.some(id => domainPath(id).some(domain => domainPath(page.pageDomains!.primaryDomainId!).some(pageDomain => pageDomain.id === domain.id))) && <small>{uiText("Different page subject; review the passage for local context.")}</small>}</td>
            <td><div className="entity-review-row-actions">{saving?<span className="scan-decision"><span className="scan-spinner"/>{operation.decision==='accepted'?uiText("Connecting…"):uiText("Rejecting…")}</span>:s.status==='pending'?<><button className="scan-row-edit" disabled={locked||stale} aria-label={uiText("Edit ")+s.name} title={uiText("Edit ")+s.name} aria-expanded={editingId===s.id} aria-controls={'suggestion-edit-'+s.id} onClick={()=>setEditingId(current=>current===s.id?null:s.id)}><Icon name="edit"/></button><button className="scan-row-accept" disabled={locked||stale||(!!awaitingSubtype(s)||awaitingIdentity(s))} aria-label={(draft.existingId?"Link existing entity: ":"Create and link: ")+s.name} title={draft.existingId?"Link existing entity":"Create and link"} onClick={()=>decide([s.id],'accepted')}><Icon name="check"/>{draft.existingId?"Link existing entity":"Create and link"}</button><button className="scan-row-reject" disabled={locked||stale} aria-label={uiText("Reject ")+s.name} title={uiText("Reject ")+s.name} onClick={()=>decide([s.id],'rejected')}><Icon name="close"/></button></>:<span className={'scan-decision is-'+s.status}><Icon name={s.status==='accepted'?'check':'close'}/>{s.status==='accepted'?uiText("Connected"):uiText("Rejected")}</span>}</div></td>
          </tr>{editingId===s.id&&s.status==='pending'&&<tr className="entity-review-editor-row"><td colSpan={5}><div className="entity-review-editor" id={'suggestion-edit-'+s.id}>
            <div className="entity-review-editor-heading"><strong>{uiText("Edit suggestion")}</strong><button className="button small" disabled={locked} onClick={()=>setEditingId(null)}>{uiText("Done editing")}</button></div>
            <div className="entity-review-editor-fields">
              <div className="entity-review-match-field"><strong>Resolve identity</strong><EntityResolutionPicker entities={entities} selection={s.evidence} options={{priorityIds:[...linkedEntityIds(page.blocks)]}} disabled={locked||stale} onChoose={entity=>editSuggestion({...draft,name:entity.name,type:entity.type,subtypes:entity.subtypes,domainIds:entity.domainIds??[],existingId:entity.id})}/><button className="button" disabled={locked||stale} onClick={()=>editSuggestion({...draft,existingId:null,name:s.name,type:s.type,subtypes:s.subtypes??[]})}>Create a new identity</button></div>
              <label>{uiText("Name")}<input aria-label={uiText("Entity name for ")+s.name} maxLength={200} value={draft.name} readOnly={!!draft.existingId} disabled={locked||stale} onChange={e=>editSuggestion({...draft,name:e.target.value})}/></label>
              <label><input type="checkbox" checked={draft.saveAliases===true} disabled={locked||stale||draft.type==='source'} onChange={e=>editSuggestion({...draft,saveAliases:e.target.checked})}/>Save suggested aliases for future matching across this vault</label><p>Linking preserves wording. Reusable aliases change the catalogue and are separate from document undo.</p><AliasInput value={(draft.aliases??[]).join('\n')} onChange={value=>editSuggestion({...draft,aliases:parseAliases(value)})} disabled={locked||stale||draft.type==='source'} maxAliases={20} compact/>
              <label>{uiText("Category")}<Select aria-label={uiText("Category for ")+s.name} value={draft.type} disabled={locked||stale||!!draft.existingId} onChange={e=>editSuggestion({...draft,type:e.target.value as EntityType,subtypes:[],domainIds:[]})}>{entityTypes.map(type=><option value={type} key={type}>{uiText(entityLabels[type])}</option>)}</Select></label>
            </div>
            {!draft.existingId&&s.proposedSubtypeIds?.some(id=>subtypePending.some(item=>item.id===id))&&<fieldset disabled={locked||stale}><legend>Dependent subtype decisions</legend><p>Checked subtypes and this entity will be approved together in one transaction.</p>{subtypePending.filter(item=>s.proposedSubtypeIds?.includes(item.id)&&item.type===draft.type).map(item=><label key={item.id}><input type="checkbox" checked={draft.approveSubtypeIds?.includes(item.id)??false} onChange={e=>editSuggestion({...draft,approveSubtypeIds:e.target.checked?[...(draft.approveSubtypeIds??[]),item.id]:(draft.approveSubtypeIds??[]).filter(id=>id!==item.id)})}/>Approve “{item.name}” with this entity</label>)}</fieldset>}
            <fieldset disabled={locked||stale}><legend>Occurrences to link</legend><p>The highlighted evidence is always linked. Select additional occurrences explicitly; unselected wording stays unlinked after reload.</p>{evidenceOccurrences(page,s.evidence).map(anchor=>{const key=anchorKey(anchor),primary=!!s.evidenceAnchor&&key===anchorKey(s.evidenceAnchor),context=evidenceContext(page,anchor,45);return <label className="scan-occurrence" key={key}><input type="checkbox" checked={primary||!!draft.additionalOccurrences?.some(item=>anchorKey(item)===key)} disabled={primary} onChange={e=>editSuggestion({...draft,additionalOccurrences:e.target.checked?[...(draft.additionalOccurrences??[]),anchor]:(draft.additionalOccurrences??[]).filter(item=>anchorKey(item)!==key)})}/><span>{context?.before}<mark>{context?.match}</mark>{context?.after}<small>{context?.label}{primary?' · Scan evidence':''}</small></span></label>;})}</fieldset>
            <fieldset className="entity-review-edit-subtypes" disabled={locked||stale||!!draft.existingId}><legend>{uiText("Subtypes")}</legend><div>{schema.subtypes.filter(type=>type.type===draft.type).map(type=><label key={type.id}><input type="checkbox" checked={draft.subtypes.includes(type.id)} onChange={e=>editSuggestion({...draft,subtypes:e.target.checked?[...draft.subtypes,type.id]:draft.subtypes.filter(id=>id!==type.id)})}/>{type.name}</label>)}{!schema.subtypes.some(type=>type.type===draft.type)&&<span>{uiText("No subtypes available")}</span>}</div></fieldset>
            {draft.type==='concept' && <DomainPicker value={draft.domainIds ?? []} onChange={domainIds => editSuggestion({...draft,domainIds})} disabled={locked||stale||!!draft.existingId}/>}
            <p className="entity-review-edit-reason">{s.reason}{draft.existingId?uiText(" · Using saved entity details."):''}</p>
          </div></td></tr>}</Fragment>;
        })}</tbody></table>}
      </div></div>
      <footer className="entity-review-footer"><div className="entity-review-selection"><strong>{selectedIds.length}{" " + uiText("selected")}</strong><button disabled={locked||stale||!pending.length} onClick={()=>setSelected(pending.map(s=>s.id))}>{uiText("Select all pending entities")}</button>{selectedIds.length>0&&<button disabled={locked} onClick={()=>setSelected([])}>{uiText("Clear")}</button>}</div><div className="entity-review-bulk-actions"><button className="button" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'rejected')}>{operation?.decision==='rejected'&&<span className="scan-spinner"/>}{uiText("Reject selected")}</button><button className="button primary" disabled={locked||stale||!selectedIds.length||pending.some(item=>selectedIds.includes(item.id)&&(awaitingSubtype(item)||awaitingIdentity(item)))} onClick={()=>decide(selectedIds,'accepted')}>{operation?.decision==='accepted'&&<span className="scan-spinner"/>}{uiText("Accept selected")}{selectedIds.length>0?` (${selectedIds.length})`:''}</button><button className="button" onClick={()=>setOpen(false)}>{uiText("Return to page")}</button>{feedback?.complete&&<button className="button" onClick={()=>{setMode('batch');setFilter('reviewed');setTypeFilter('all');setIdentityFilter('all');setQuery('');}}>View changes</button>}</div></footer>
    </Modal>}
  </div>;
}

function Evidence({page,suggestion}:{page:Page;suggestion:EntitySuggestion}) {
  const context=evidenceContext(page,suggestion.evidenceAnchor);
  return context?<div className="scan-evidence"><q>{context.before}<mark>{context.match}</mark>{context.after}</q><small>{context.label}</small><details><summary>Full block context</summary><p>{context.text}</p></details></div>:<q>{suggestion.evidence}</q>;
}

function ScanSnapshot({page,suggestion,onSelect}:{page:Page;suggestion?:EntitySuggestion;onSelect:(id:string)=>void}) {
  const anchor=suggestion?.evidenceAnchor;
  function text(segments:Segment[],blockId:string,row?:number,col?:number){
    const value=segments.map(segment=>segment.text??segment.mentionText??'').join('');
    return anchor&&blockId===anchor.blockId&&row===anchor.row&&col===anchor.col?<>{value.slice(0,anchor.start)}<mark>{value.slice(anchor.start,anchor.end)}</mark>{value.slice(anchor.end)}</>:value;
  }
  return <>{page.blocks.map((block,index)=><article key={block.id} data-snapshot-block={block.id} className={block.id===anchor?.blockId?'is-active':''}>
    <button className="button small" onClick={()=>onSelect(block.id)}>Block {index+1} · {block.type}</button>
    {block.rows?<table><tbody>{block.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{text(cell,block.id,r,c)}</td>)}</tr>)}</tbody></table>:<p>{text(block.content,block.id)}</p>}
  </article>)}</>;
}
