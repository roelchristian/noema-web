import { entityReviewFeedback, type ReviewFeedback } from './entity-review-feedback';
import { Select } from '../components/Select';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { EntityScan, EntitySuggestion, EntitySuggestionEdit } from '../../shared/entity-scan';
import { entityLabels, entityTypes, type Entity, type EntityType, type Page } from '../../shared/domain';
import { api } from '../api';
import { useEntitySchema } from '../knowledge/useEntitySchema';
import { Icon } from '../components/Icon';
import { HelpMenu } from '../components/HelpMenu';
import { Modal } from '../components/Modal';

type Decision = 'accepted' | 'rejected';
export function EntityScanReview({page,scan,onScan,onFlush,onReview,disabled,entities}:{entities:Entity[];page:Page;scan:EntityScan|null;onScan:(scan:EntityScan)=>void;onFlush:()=>Promise<Page|null>;onReview:(scanId:string,id:string|string[],decision:Decision,edits?:EntitySuggestionEdit[])=>Promise<EntityScan>;disabled:boolean}) {
  const {schema}=useEntitySchema(page.vault_id);
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
    finally{running.current=false;if(active.current)setOperation(null);}
  }
  function scanNote() {
    void run([],async()=>{
      const saved=await onFlush();
      if(!saved||saved.id!==page.id||saved.vault_id!==page.vault_id)throw new Error('The selected note changed. Try again.');
      const result=await api.scanEntities(saved.vault_id,saved.id,saved.revision);
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
  const help=<HelpMenu label="About entity scanning"><p>Find existing and new entities using your vault’s types and subtypes. Scans and review decisions are saved with this note.</p><p>Scanning sends this note’s title, text, and math formulas as context, your category schema, and this vault’s entity names and descriptions to your configured AI. AI can make mistakes; API charges may apply.</p><p>Edit names, categories and subtypes before accepting new entities, or choose a saved entity to match. Matching uses that entity’s saved details without changing it. Choose “Create new entity” to edit the suggested details. Accept connects the original matching phrase and creates the entity if needed. Reject leaves the note unchanged. Proposed subtypes appear in a separate section. Approve a subtype to add it to the vault, or reject it to continue without it. Review these before accepting the related entities. Select rows to review them together. Bulk changes save together; if a phrase overlaps, review those rows individually. Scanning again replaces this review.</p></HelpMenu>;
  return <div className="knowledge-entity-discovery">
    <button type="button" className="entity-detect-action" disabled={disabled} aria-haspopup="dialog" title={scan?`${pending.length+subtypePending.length} pending · ${reviewed} reviewed · Open review to scan again`:'Use AI to suggest entities mentioned in this page'} onClick={()=>{setFeedback(null);setAnnouncement('');setOpen(true);if(!scan&&!running.current)scanNote();}}><Icon name="sparkles"/><span>{scanning?'Detecting entities…':operation?'Review in progress…':scan?`Review detected entities (${pending.length+subtypePending.length})`:'Detect entities with AI'}</span></button>
    {!open&&feedback&&<div className="entity-review-confirmation entity-review-confirmation-inline" role="status"><span className="review-confirmation-icon"><Icon name="check"/></span><div><strong>{feedback.message}</strong><span>{feedback.detail}</span></div></div>}
    {open&&<Modal className="entity-review-modal" titleId="entity-review-title" onClose={()=>setOpen(false)}>
      <header className="entity-review-header"><div><h2 id="entity-review-title">Review potential entities</h2><p>{page.title||'Untitled'}</p></div><div className="entity-review-header-actions">{help}<button className="page-tool" aria-label="Close entity review" onClick={()=>setOpen(false)}><Icon name="close"/></button></div></header>
      {total>0&&!scanning&&<div className="entity-review-progress"><span>{reviewed} of {total} reviewed</span><div role="progressbar" aria-label="Entity review progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed}><span style={{width:`${reviewed/total*100}%`}}/></div></div>}
      <div className="entity-review-toolbar"><div className="entity-review-filters" role="group" aria-label="Filter suggestions">{(['all','pending','reviewed'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?'All':value==='pending'?'Pending':'Reviewed'}<span>{value==='all'?total:value==='pending'?pending.length+subtypePending.length:reviewed}</span></button>)}</div><label className="entity-review-search"><Icon name="search"/><input aria-label="Search suggestions" placeholder="Search entities…" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="button" disabled={locked} onClick={scanNote}>{scanning?<span className="scan-spinner"/>:<Icon name="sparkles"/>}{scanning?'Scanning…':scan?'Scan again':'Scan note'}</button></div>
      <div className="entity-review-messages" aria-live="polite">{announcement&&!feedback&&<span className="sr-only" role="status">{announcement}</span>}{feedback&&<div className="entity-review-confirmation" role="status"><span className="review-confirmation-icon"><Icon name="check"/></span><div><strong>{feedback.message}</strong><span>{feedback.detail}</span></div></div>}{error&&<p className="inline-error" role="alert">{error}</p>}{stale&&<p role="status">Note changed. Scan again to review fresh suggestions.</p>}</div>
      <div className="entity-review-table-wrap" aria-busy={scanning}>
        {!scanning && !!scan?.subtypeSuggestions?.length && <section className="entity-review-subtype-proposals" aria-labelledby="subtype-proposals-title">
          <h3 id="subtype-proposals-title">Proposed subtypes <span>{subtypePending.length} pending</span></h3>
          <p>Review new subtypes before accepting their entities. Approve adds the subtype to this vault; reject continues without it.</p>
          <ul>{scan.subtypeSuggestions.filter(item => (filter === 'all' || (filter === 'pending' ? item.status === 'pending' : item.status !== 'pending')) && `${item.name} ${entityLabels[item.type]}`.toLowerCase().includes(query.toLowerCase())).map(item => <li key={item.id}>
            <div><strong>{item.name}</strong><small>{entityLabels[item.type]} · {scan.suggestions.filter(suggestion => suggestion.proposedSubtypeIds?.includes(item.id)).map(suggestion => suggestion.name).join(', ')}</small></div>
            {item.status === 'pending' ? <div className="entity-review-subtype-actions"><button type="button" className="button small" disabled={locked || stale} onClick={() => decide([item.id], 'accepted')}>Approve subtype</button><button type="button" className="button small" disabled={locked || stale} onClick={() => decide([item.id], 'rejected')}>Reject subtype</button></div> : <span>{item.status === 'accepted' ? 'Approved' : 'Rejected'}</span>}
          </li>)}</ul>
        </section>}

        {scanning?<div className="scan-empty"><span className="scan-spinner"/><strong>Finding connections in your note</strong><span>Suggestions will appear here for review.</span></div>:!visible.length?<div className="scan-empty"><Icon name="search"/><strong>{query||filter!=='all'?'No matching suggestions':scan?'No potential entities found':'Ready to discover entities'}</strong><span>{query?'Try another search.':filter!=='all'?'Choose another filter to see more.':'Scan your note to find people, places, works and more.'}</span></div>:<table className="entity-review-table"><thead><tr><th className="entity-review-check"><input ref={selectAll} type="checkbox" aria-label="Select all visible pending suggestions" checked={allSelected} disabled={locked||stale||!visiblePending.length} onChange={toggleAll}/></th><th>Entity</th><th>Category</th><th>In this note</th><th>Review</th></tr></thead><tbody>{visible.map(s=>{
          const draft=drafts[s.id]||{id:s.id,name:s.name,type:s.type,subtypes:s.subtypes||[],existingId:s.existingId};
          const saving=!!operation?.decision&&operation.ids.includes(s.id);
          return <Fragment key={s.id}><tr className={'is-'+s.status+(selectedIds.includes(s.id)?' is-selected':'')+(feedback?.ids.includes(s.id)?' was-reviewed':'')} aria-busy={saving}>
            <td className="entity-review-check"><input type="checkbox" aria-label={'Select '+s.name} checked={selectedIds.includes(s.id)} disabled={locked||stale||s.status!=='pending'} onChange={()=>setSelected(current=>current.includes(s.id)?current.filter(id=>id!==s.id):[...current,s.id])}/></td>
            <td><div className="entity-review-name"><span className={'scan-entity-icon '+draft.type}><Icon name={draft.type}/></span><div><strong>{draft.name}</strong><span className="entity-review-match-label">{draft.existingId?'In vault':'New entity'}{drafts[s.id]?' · Edited':''}</span></div></div></td>
            <td><span className="entity-review-category">{entityLabels[draft.type]}</span><small>{draft.subtypes.map(id=>schema.subtypes.find(t=>t.id===id)?.name).filter(Boolean).join(', ')}</small>{!!s.proposedSubtypeIds?.length && <small>{s.proposedSubtypeIds.flatMap(id => {const item=scan?.subtypeSuggestions?.find(item=>item.id===id);return item?.status==='pending'?[item.name+' (awaiting review)']:[];}).join(', ')}</small>}</td>
            <td><q title={s.reason}>{s.evidence}</q></td>
            <td><div className="entity-review-row-actions">{saving?<span className="scan-decision"><span className="scan-spinner"/>{operation.decision==='accepted'?'Connecting…':'Rejecting…'}</span>:s.status==='pending'?<><button className="scan-row-edit" disabled={locked||stale} aria-label={'Edit '+s.name} title={'Edit '+s.name} aria-expanded={editingId===s.id} aria-controls={'suggestion-edit-'+s.id} onClick={()=>setEditingId(current=>current===s.id?null:s.id)}><Icon name="edit"/></button><button className="scan-row-accept" disabled={locked||stale||!!awaitingSubtype(s)} aria-label={'Accept '+s.name} title={'Accept '+s.name} onClick={()=>decide([s.id],'accepted')}><Icon name="check"/></button><button className="scan-row-reject" disabled={locked||stale} aria-label={'Reject '+s.name} title={'Reject '+s.name} onClick={()=>decide([s.id],'rejected')}><Icon name="close"/></button></>:<span className={'scan-decision is-'+s.status}><Icon name={s.status==='accepted'?'check':'close'}/>{s.status==='accepted'?'Connected':'Rejected'}</span>}</div></td>
          </tr>{editingId===s.id&&s.status==='pending'&&<tr className="entity-review-editor-row"><td colSpan={5}><div className="entity-review-editor" id={'suggestion-edit-'+s.id}>
            <div className="entity-review-editor-heading"><strong>Edit suggestion</strong><button className="button small" disabled={locked} onClick={()=>setEditingId(null)}>Done editing</button></div>
            <div className="entity-review-editor-fields">
              <label className="entity-review-match-field">Match<Select aria-label={'Match entity for '+s.name} value={draft.existingId||''} disabled={locked||stale} onChange={e=>{
                const entity=entities.find(entity=>entity.id===e.target.value);
                editSuggestion(entity?{id:s.id,name:entity.name,type:entity.type,subtypes:entity.subtypes,existingId:entity.id}:{...draft,existingId:null});
              }}><option value="">Create new entity</option>{entities.map(entity=><option key={entity.id} value={entity.id}>{entity.name} · {entityLabels[entity.type]}</option>)}</Select></label>
              <label>Name<input aria-label={'Entity name for '+s.name} maxLength={200} value={draft.name} readOnly={!!draft.existingId} disabled={locked||stale} onChange={e=>editSuggestion({...draft,name:e.target.value})}/></label>
              <label>Category<Select aria-label={'Category for '+s.name} value={draft.type} disabled={locked||stale||!!draft.existingId} onChange={e=>editSuggestion({...draft,type:e.target.value as EntityType,subtypes:[]})}>{entityTypes.map(type=><option value={type} key={type}>{entityLabels[type]}</option>)}</Select></label>
            </div>
            <fieldset className="entity-review-edit-subtypes" disabled={locked||stale||!!draft.existingId}><legend>Subtypes</legend><div>{schema.subtypes.filter(type=>type.type===draft.type).map(type=><label key={type.id}><input type="checkbox" checked={draft.subtypes.includes(type.id)} onChange={e=>editSuggestion({...draft,subtypes:e.target.checked?[...draft.subtypes,type.id]:draft.subtypes.filter(id=>id!==type.id)})}/>{type.name}</label>)}{!schema.subtypes.some(type=>type.type===draft.type)&&<span>No subtypes available</span>}</div></fieldset>
            <p className="entity-review-edit-reason">{s.reason}{draft.existingId?' · Using saved entity details.':''}</p>
          </div></td></tr>}</Fragment>;
        })}</tbody></table>}
      </div>
      <footer className="entity-review-footer"><div className="entity-review-selection"><strong>{selectedIds.length} selected</strong><button disabled={locked||stale||!pending.length} onClick={()=>setSelected(pending.map(s=>s.id))}>Select all pending entities</button>{selectedIds.length>0&&<button disabled={locked} onClick={()=>setSelected([])}>Clear</button>}</div><div className="entity-review-bulk-actions"><button className="button" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'rejected')}>{operation?.decision==='rejected'&&<span className="scan-spinner"/>}Reject selected</button><button className="button primary" disabled={locked||stale||!selectedIds.length||pending.some(item=>selectedIds.includes(item.id)&&awaitingSubtype(item))} onClick={()=>decide(selectedIds,'accepted')}>{operation?.decision==='accepted'&&<span className="scan-spinner"/>}Accept selected{selectedIds.length>0?` (${selectedIds.length})`:''}</button><button className="button" onClick={()=>setOpen(false)}>Done</button></div></footer>
    </Modal>}
  </div>;
}
