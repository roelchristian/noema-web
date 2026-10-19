import {t as uiText} from '../i18n';
import {domainPath} from '../../shared/domains';
import {DomainPicker, domainBreadcrumb} from '../knowledge/DomainPicker';
import { entityReviewFeedback, type ReviewFeedback } from './entity-review-feedback';
import { Select } from '../components/Select';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { EntityScan, EntitySuggestion, EntitySuggestionEdit } from '../../shared/entity-scan';
import { entityLabels, entityTypes, type Entity, type EntityType, type Page } from '../../shared/domain';
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
  const scan=preview??savedScan;
  const scanController=useRef<AbortController|null>(null);
  useEffect(()=>()=>scanController.current?.abort(),[]);
  const [open,setOpen]=useState(false),[operation,setOperation]=useState<{ids:string[];decision?:Decision}|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState<'all'|'pending'|'reviewed'>('all'),[query,setQuery]=useState('');
  const [editingId,setEditingId]=useState<string|null>(null);
  const [drafts,setDrafts]=useState<Record<string,EntitySuggestionEdit>>({});
  useEffect(()=>{setDrafts({});setEditingId(null);},[scan?.id]);
  const [feedback,setFeedback]=useState<ReviewFeedback|null>(null);
  useEffect(()=>{
    if(!feedback) return;
    const closeTimer=feedback.complete&&open?setTimeout(()=>setOpen(false),1100):undefined;
    const clearTimer=setTimeout(()=>setFeedback(null),5000);
    return()=>{clearTimeout(closeTimer);clearTimeout(clearTimer);};
  },[feedback,open]);
  const [error,setError]=useState(''),[announcement,setAnnouncement]=useState('');
  const running=useRef(false),active=useRef(true),selectAll=useRef<HTMLInputElement>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const pending=scan?.suggestions.filter(s=>s.status==='pending')||[];
  const subtypePending=scan?.subtypeSuggestions?.filter(item=>item.status==='pending') ?? [];
  const selectedIds=selected.filter(id=>pending.some(s=>s.id===id));
  const visible=(scan?.suggestions||[]).filter(s=>(filter==='all'||(filter==='pending'?s.status==='pending':s.status!=='pending'))&&`${s.name} ${entityLabels[s.type]} ${s.evidence}`.toLowerCase().includes(query.toLowerCase()));
  const visiblePending=visible.filter(s=>s.status==='pending').map(s=>s.id);
  const allSelected=visiblePending.length>0&&visiblePending.every(id=>selectedIds.includes(id));
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=!allSelected&&visiblePending.some(id=>selectedIds.includes(id));},[allSelected,visiblePending,selectedIds]);
  const stale=!!scan&&scan.revision!==page.revision;
  const scanning=!!operation&&!operation.decision;
  const locked=!!operation||disabled;
  const total=(scan?.suggestions.length ?? 0)+(scan?.subtypeSuggestions?.length ?? 0);
  const reviewed=total-pending.length-subtypePending.length;
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
  function scanNote() {
    void run([],async()=>{
      const saved=await onFlush();
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected note changed. Try again.');
      const controller=new AbortController();scanController.current=controller;
      if(active.current){setPreview({id:'scanning',revision:saved.revision,suggestions:[]});setFilter('all');setQuery('');}
      const result=await api.scanEntities(saved.vault_id,saved.id,saved.revision,partial=>{if(active.current)setPreview(partial);},controller.signal);
      if(active.current){setFilter('all');setQuery('');}
      return result;
    });
  }
  function awaitingSubtype(suggestion: EntitySuggestion) {
    const draft = drafts[suggestion.id];
    return !(draft?.existingId ?? suggestion.existingId) && (!draft || draft.type === suggestion.type) && suggestion.proposedSubtypeIds?.some(id => subtypePending.some(item => item.id === id));
  }
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
      <ModalHeader titleId="entity-review-title">{uiText("Entity review")}</ModalHeader><p className="modal-description">{page.title||uiText("Untitled")}</p>
      {total>0&&!scanning&&<div className="entity-review-progress"><span>{reviewed}{" " + uiText("of") + " "}{total}{" " + uiText("reviewed")}</span><div role="progressbar" aria-label={uiText("Entity review progress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed}><span style={{width:`${reviewed/total*100}%`}}/></div></div>}
      <div className="entity-review-toolbar"><div className="entity-review-filters" role="group" aria-label={uiText("Filter suggestions")}>{(['all','pending','reviewed'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?uiText("All"):value==='pending'?uiText("Pending"):uiText("Reviewed")}<span>{value==='all'?total:value==='pending'?pending.length+subtypePending.length:reviewed}</span></button>)}</div><label className="entity-review-search"><Icon name="search"/><input aria-label={uiText("Search suggestions")} placeholder={uiText("Search entities…")} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="knowledge-icon-action" disabled={locked} aria-label={scanning?uiText("Scanning entities"):scan?uiText("Scan again"):uiText("Scan note")} title={scan?uiText("Scan again"):uiText("Scan note")} onClick={scanNote}>{scanning?<span className="scan-spinner"/>:<Icon name={scan?'refresh':'sparkles'}/>}</button></div>
      <div className="entity-review-messages" aria-live="polite">{announcement&&!feedback&&<span className="sr-only" role="status">{announcement}</span>}{feedback&&<ReviewConfirmation feedback={feedback}/>}{error&&<p className="inline-error" role="alert">{error}</p>}{stale&&<p role="status">{uiText("Note changed. Scan again to review fresh suggestions.")}</p>}</div>
      {scanning&&visible.length>0&&<p className="entity-scan-live-status" role="status"><span className="scan-spinner"/>{scan?.suggestions.length}{" " + uiText("entities found · Still scanning…")}</p>}
      <div className="entity-review-table-wrap" aria-busy={scanning}>
        {!scanning && !!scan?.subtypeSuggestions?.length && <section className="entity-review-subtype-proposals" aria-labelledby="subtype-proposals-title">
          <h3 id="subtype-proposals-title">{uiText("Proposed subtypes") + " "}<span>{subtypePending.length}{" " + uiText("pending")}</span></h3>
          <ul>{scan.subtypeSuggestions.filter(item => (filter === 'all' || (filter === 'pending' ? item.status === 'pending' : item.status !== 'pending')) && `${item.name} ${entityLabels[item.type]}`.toLowerCase().includes(query.toLowerCase())).map(item => <li key={item.id}>
            <div><strong>{item.name}</strong><small>{uiText(entityLabels[item.type])} · {scan.suggestions.filter(suggestion => suggestion.proposedSubtypeIds?.includes(item.id)).map(suggestion => suggestion.name).join(', ')}</small></div>
            {item.status === 'pending' ? <div className="entity-review-subtype-actions"><button type="button" className="knowledge-icon-action" aria-label={uiText("Approve subtype: ")+item.name} title={uiText("Approve subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'accepted')}><Icon name="check"/></button><button type="button" className="knowledge-icon-action" aria-label={uiText("Reject subtype: ")+item.name} title={uiText("Reject subtype")} disabled={locked || stale} onClick={() => decide([item.id], 'rejected')}><Icon name="close"/></button></div> : <span>{item.status === 'accepted' ? uiText("Approved") : uiText("Rejected")}</span>}
          </li>)}</ul>
        </section>}

        {scanning&&!visible.length?<div className="scan-empty"><span className="scan-spinner"/><strong>{uiText("Finding connections in your note")}</strong><span>{uiText("Suggestions will appear here for review.")}</span></div>:!visible.length?<div className="scan-empty"><Icon name="search"/><strong>{query||filter!=='all'?uiText("No matching suggestions"):scan?uiText("No potential entities found"):uiText("Ready to discover entities")}</strong><span>{query?uiText("Try another search."):filter!=='all'?uiText("Choose another filter to see more."):uiText("Scan your note to find people, places, works and more.")}</span></div>:<table className="entity-review-table"><thead><tr><th className="entity-review-check"><input ref={selectAll} type="checkbox" aria-label={uiText("Select all visible pending suggestions")} checked={allSelected} disabled={locked||stale||!visiblePending.length} onChange={toggleAll}/></th><th>{uiText("Entity")}</th><th>{uiText("Category")}</th><th>{uiText("In this note")}</th><th>{uiText("Review")}</th></tr></thead><tbody>{visible.map(s=>{
          const draft=drafts[s.id]||{id:s.id,name:s.name,aliases:s.aliases??[],type:s.type,subtypes:s.subtypes||[],domainIds:s.domainIds||[],existingId:s.existingId};
          const saving=!!operation?.decision&&operation.ids.includes(s.id);
          return <Fragment key={s.id}><tr className={'is-'+s.status+(selectedIds.includes(s.id)?' is-selected':'')+(feedback?.ids.includes(s.id)?' was-reviewed':'')} aria-busy={saving}>
            <td className="entity-review-check"><input type="checkbox" aria-label={uiText("Select ")+s.name} checked={selectedIds.includes(s.id)} disabled={locked||stale||s.status!=='pending'} onChange={()=>setSelected(current=>current.includes(s.id)?current.filter(id=>id!==s.id):[...current,s.id])}/></td>
            <td><div className="entity-review-name"><span className={'scan-entity-icon '+draft.type}><Icon name={draft.type}/></span><div><strong>{draft.name}</strong><span className="entity-review-match-label">{draft.existingId?uiText("In vault"):uiText("New entity")}{drafts[s.id]?uiText(" · Edited"):''}</span>{!!draft.aliases?.length&&<small>{uiText("Aliases:") + " "}{draft.aliases.join('; ')}</small>}</div></div></td>
            <td><span className="entity-review-category">{uiText(entityLabels[draft.type])}</span><small>{draft.subtypes.map(id=>schema.subtypes.find(t=>t.id===id)?.name).filter(Boolean).join(', ')}</small>{!!s.proposedSubtypeIds?.length && <small>{s.proposedSubtypeIds.flatMap(id => {const item=scan?.subtypeSuggestions?.find(item=>item.id===id);return item?.status==='pending'?[item.name+' (awaiting review)']:[];}).join(', ')}</small>}</td>
            <td><q title={s.reason}>{s.evidence}</q>{draft.type==='concept' && !!draft.domainIds?.length && <small>{uiText("Disciplines:") + " "}{draft.domainIds.map(domainBreadcrumb).join(' · ')}</small>}{draft.type==='concept' && !!draft.domainIds?.length && page.pageDomains?.primaryDomainId && !draft.domainIds.some(id => domainPath(id).some(domain => domainPath(page.pageDomains!.primaryDomainId!).some(pageDomain => pageDomain.id === domain.id))) && <small>{uiText("Different page subject; review the passage for local context.")}</small>}</td>
            <td><div className="entity-review-row-actions">{saving?<span className="scan-decision"><span className="scan-spinner"/>{operation.decision==='accepted'?uiText("Connecting…"):uiText("Rejecting…")}</span>:s.status==='pending'?<><button className="scan-row-edit" disabled={locked||stale} aria-label={uiText("Edit ")+s.name} title={uiText("Edit ")+s.name} aria-expanded={editingId===s.id} aria-controls={'suggestion-edit-'+s.id} onClick={()=>setEditingId(current=>current===s.id?null:s.id)}><Icon name="edit"/></button><button className="scan-row-accept" disabled={locked||stale||!!awaitingSubtype(s)} aria-label={uiText("Accept ")+s.name} title={uiText("Accept ")+s.name} onClick={()=>decide([s.id],'accepted')}><Icon name="check"/></button><button className="scan-row-reject" disabled={locked||stale} aria-label={uiText("Reject ")+s.name} title={uiText("Reject ")+s.name} onClick={()=>decide([s.id],'rejected')}><Icon name="close"/></button></>:<span className={'scan-decision is-'+s.status}><Icon name={s.status==='accepted'?'check':'close'}/>{s.status==='accepted'?uiText("Connected"):uiText("Rejected")}</span>}</div></td>
          </tr>{editingId===s.id&&s.status==='pending'&&<tr className="entity-review-editor-row"><td colSpan={5}><div className="entity-review-editor" id={'suggestion-edit-'+s.id}>
            <div className="entity-review-editor-heading"><strong>{uiText("Edit suggestion")}</strong><button className="button small" disabled={locked} onClick={()=>setEditingId(null)}>{uiText("Done editing")}</button></div>
            <div className="entity-review-editor-fields">
              <label className="entity-review-match-field">{uiText("Match")}<Select aria-label={uiText("Match entity for ")+s.name} value={draft.existingId||''} disabled={locked||stale} onChange={e=>{
                const entity=entities.find(entity=>entity.id===e.target.value);
                editSuggestion(entity?{id:s.id,name:entity.name,aliases:draft.aliases??[],type:entity.type,subtypes:entity.subtypes,domainIds:entity.domainIds||[],existingId:entity.id}:{...draft,existingId:null});
              }}><option value="">{uiText("Create new entity")}</option>{entities.map(entity=><option key={entity.id} value={entity.id}>{entity.name} · {uiText(entityLabels[entity.type])}</option>)}</Select></label>
              <label>{uiText("Name")}<input aria-label={uiText("Entity name for ")+s.name} maxLength={200} value={draft.name} readOnly={!!draft.existingId} disabled={locked||stale} onChange={e=>editSuggestion({...draft,name:e.target.value})}/></label>
              <AliasInput value={(draft.aliases??[]).join('\n')} onChange={value=>editSuggestion({...draft,aliases:parseAliases(value)})} disabled={locked||stale||draft.type==='source'} maxAliases={20} compact/>
              <label>{uiText("Category")}<Select aria-label={uiText("Category for ")+s.name} value={draft.type} disabled={locked||stale||!!draft.existingId} onChange={e=>editSuggestion({...draft,type:e.target.value as EntityType,subtypes:[],domainIds:[]})}>{entityTypes.map(type=><option value={type} key={type}>{uiText(entityLabels[type])}</option>)}</Select></label>
            </div>
            <fieldset className="entity-review-edit-subtypes" disabled={locked||stale||!!draft.existingId}><legend>{uiText("Subtypes")}</legend><div>{schema.subtypes.filter(type=>type.type===draft.type).map(type=><label key={type.id}><input type="checkbox" checked={draft.subtypes.includes(type.id)} onChange={e=>editSuggestion({...draft,subtypes:e.target.checked?[...draft.subtypes,type.id]:draft.subtypes.filter(id=>id!==type.id)})}/>{type.name}</label>)}{!schema.subtypes.some(type=>type.type===draft.type)&&<span>{uiText("No subtypes available")}</span>}</div></fieldset>
            {draft.type==='concept' && <DomainPicker value={draft.domainIds ?? []} onChange={domainIds => editSuggestion({...draft,domainIds})} disabled={locked||stale||!!draft.existingId}/>}
            <p className="entity-review-edit-reason">{s.reason}{draft.existingId?uiText(" · Using saved entity details."):''}</p>
          </div></td></tr>}</Fragment>;
        })}</tbody></table>}
      </div>
      <footer className="entity-review-footer"><div className="entity-review-selection"><strong>{selectedIds.length}{" " + uiText("selected")}</strong><button disabled={locked||stale||!pending.length} onClick={()=>setSelected(pending.map(s=>s.id))}>{uiText("Select all pending entities")}</button>{selectedIds.length>0&&<button disabled={locked} onClick={()=>setSelected([])}>{uiText("Clear")}</button>}</div><div className="entity-review-bulk-actions"><button className="button" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'rejected')}>{operation?.decision==='rejected'&&<span className="scan-spinner"/>}{uiText("Reject selected")}</button><button className="button primary" disabled={locked||stale||!selectedIds.length||pending.some(item=>selectedIds.includes(item.id)&&awaitingSubtype(item))} onClick={()=>decide(selectedIds,'accepted')}>{operation?.decision==='accepted'&&<span className="scan-spinner"/>}{uiText("Accept selected")}{selectedIds.length>0?` (${selectedIds.length})`:''}</button><button className="button" onClick={()=>setOpen(false)}>{uiText("Done")}</button></div></footer>
    </Modal>}
  </div>;
}
