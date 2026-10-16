import { Select } from '../components/Select';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { EntityScan, EntitySuggestionEdit } from '../../shared/entity-scan';
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
  const [error,setError]=useState(''),[announcement,setAnnouncement]=useState('');
  const running=useRef(false),active=useRef(true),selectAll=useRef<HTMLInputElement>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const pending=scan?.suggestions.filter(s=>s.status==='pending')||[];
  const selectedIds=selected.filter(id=>pending.some(s=>s.id===id));
  const visible=(scan?.suggestions||[]).filter(s=>(filter==='all'||(filter==='pending'?s.status==='pending':s.status!=='pending'))&&`${s.name} ${entityLabels[s.type]} ${s.evidence}`.toLowerCase().includes(query.toLowerCase()));
  const visiblePending=visible.filter(s=>s.status==='pending').map(s=>s.id);
  const allSelected=visiblePending.length>0&&visiblePending.every(id=>selectedIds.includes(id));
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=!allSelected&&visiblePending.some(id=>selectedIds.includes(id));},[allSelected,visiblePending,selectedIds]);
  const stale=!!scan&&scan.revision!==page.revision;
  const scanning=!!operation&&!operation.decision;
  const locked=!!operation||disabled;
  const reviewed=(scan?.suggestions.length||0)-pending.length;
  async function run(ids:string[],work:()=>Promise<EntityScan>,decision?:Decision) {
    if(running.current)return;
    running.current=true;setOperation({ids,decision});setError('');
    try {
      const result=await work();
      if(active.current){onScan(result);if(!decision||ids.includes(editingId||''))setEditingId(null);setDrafts(current=>decision?Object.fromEntries(Object.entries(current).filter(([id])=>!ids.includes(id))):{});setSelected(current=>decision?current.filter(id=>!ids.includes(id)):[]);setAnnouncement(decision?`${ids.length} ${ids.length===1?'entity':'entities'} ${decision}.`:`${result.suggestions.length} potential entities found.`);}
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
  function decide(ids:string[],decision:Decision){
    if(!scan||!ids.length)return;
    const edits=decision==='accepted'?ids.flatMap(id=>drafts[id]?[drafts[id]!]:[]):undefined;
    void run(ids,()=>onReview(scan.id,ids,decision,edits),decision);
  }
  function editSuggestion(draft:EntitySuggestionEdit){setDrafts(current=>({...current,[draft.id]:draft}));}
  function toggleAll(){setSelected(current=>allSelected?current.filter(id=>!visiblePending.includes(id)):[...new Set([...current,...visiblePending])]);}
  const help=<HelpMenu label="About entity scanning"><p>Find existing and new entities using your vault’s types and subtypes. Scans and review decisions are saved with this note.</p><p>Scanning sends this note’s title and text, your category schema, and this vault’s entity names and descriptions to your configured AI. AI can make mistakes; API charges may apply.</p><p>Edit names, categories and subtypes before accepting new entities, or choose a saved entity to match. Matching uses that entity’s saved details without changing it. Choose “Create new entity” to edit the suggested details. Accept connects the original matching phrase and creates the entity if needed. Reject leaves the note unchanged. Select rows to review them together. Bulk changes save together; if a phrase overlaps, review those rows individually. Scanning again replaces this review.</p></HelpMenu>;
  return <section className="knowledge-entity-scan" aria-labelledby="entity-scan-heading">
    <div className="knowledge-section-heading"><h2 id="entity-scan-heading">Potential entities{pending.length>0&&<span className="knowledge-count">{pending.length}</span>}</h2>{help}</div>
    <button className="entity-scan-trigger" disabled={disabled} onClick={()=>{setOpen(true);if(!scan&&!running.current)scanNote();}}><Icon name="sparkles"/><span>{operation?'Review in progress…':scan?'Review entities':'Scan for entities'}<small>{scan?`${pending.length} pending · ${reviewed} reviewed`:'Discover people, places, works & more'}</small></span><Icon name="chevron"/></button>
    {open&&<Modal className="entity-review-modal" titleId="entity-review-title" onClose={()=>setOpen(false)}>
      <header className="entity-review-header"><div><h2 id="entity-review-title">Review potential entities</h2><p>{page.title||'Untitled'}</p></div><div className="entity-review-header-actions">{help}<button className="page-tool" aria-label="Close entity review" onClick={()=>setOpen(false)}><Icon name="close"/></button></div></header>
      <div className="entity-review-toolbar"><div className="entity-review-filters" role="group" aria-label="Filter suggestions">{(['all','pending','reviewed'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?'All':value==='pending'?'Pending':'Reviewed'}<span>{value==='all'?scan?.suggestions.length||0:value==='pending'?pending.length:reviewed}</span></button>)}</div><label className="entity-review-search"><Icon name="search"/><input aria-label="Search suggestions" placeholder="Search entities…" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="button" disabled={locked} onClick={scanNote}>{scanning?<span className="scan-spinner"/>:<Icon name="sparkles"/>}{scanning?'Scanning…':scan?'Scan again':'Scan note'}</button></div>
      <div className="entity-review-messages" aria-live="polite">{announcement&&<span className="sr-only" role="status">{announcement}</span>}{error&&<p className="inline-error" role="alert">{error}</p>}{stale&&<p role="status">Note changed. Scan again to review fresh suggestions.</p>}</div>
      <div className="entity-review-table-wrap" aria-busy={scanning}>
        {scanning?<div className="scan-empty"><span className="scan-spinner"/><strong>Finding connections in your note</strong><span>Suggestions will appear here for review.</span></div>:!visible.length?<div className="scan-empty"><Icon name="search"/><strong>{query||filter!=='all'?'No matching suggestions':scan?'No potential entities found':'Ready to discover entities'}</strong><span>{query?'Try another search.':filter!=='all'?'Choose another filter to see more.':'Scan your note to find people, places, works and more.'}</span></div>:<table className="entity-review-table"><thead><tr><th className="entity-review-check"><input ref={selectAll} type="checkbox" aria-label="Select all visible pending suggestions" checked={allSelected} disabled={locked||stale||!visiblePending.length} onChange={toggleAll}/></th><th>Entity</th><th>Category</th><th>In this note</th><th>Review</th></tr></thead><tbody>{visible.map(s=>{
          const draft=drafts[s.id]||{id:s.id,name:s.name,type:s.type,subtypes:s.subtypes||[],existingId:s.existingId};
          const saving=!!operation?.decision&&operation.ids.includes(s.id);
          return <Fragment key={s.id}><tr className={'is-'+s.status+(selectedIds.includes(s.id)?' is-selected':'')} aria-busy={saving}>
            <td className="entity-review-check"><input type="checkbox" aria-label={'Select '+s.name} checked={selectedIds.includes(s.id)} disabled={locked||stale||s.status!=='pending'} onChange={()=>setSelected(current=>current.includes(s.id)?current.filter(id=>id!==s.id):[...current,s.id])}/></td>
            <td><div className="entity-review-name"><span className={'scan-entity-icon '+draft.type}><Icon name={draft.type}/></span><div><strong>{draft.name}</strong><span className="entity-review-match-label">{draft.existingId?'In vault':'New entity'}{drafts[s.id]?' · Edited':''}</span></div></div></td>
            <td><span className="entity-review-category">{entityLabels[draft.type]}</span><small>{draft.subtypes.map(id=>schema.subtypes.find(t=>t.id===id)?.name).filter(Boolean).join(', ')}</small></td>
            <td><q title={s.reason}>{s.evidence}</q></td>
            <td><div className="entity-review-row-actions">{saving?<span className="scan-decision"><span className="scan-spinner"/>{operation.decision==='accepted'?'Connecting…':'Rejecting…'}</span>:s.status==='pending'?<><button className="scan-row-edit" disabled={locked||stale} aria-label={'Edit '+s.name} title={'Edit '+s.name} aria-expanded={editingId===s.id} aria-controls={'suggestion-edit-'+s.id} onClick={()=>setEditingId(current=>current===s.id?null:s.id)}><Icon name="edit"/></button><button className="scan-row-accept" disabled={locked||stale} aria-label={'Accept '+s.name} title={'Accept '+s.name} onClick={()=>decide([s.id],'accepted')}><Icon name="check"/></button><button className="scan-row-reject" disabled={locked||stale} aria-label={'Reject '+s.name} title={'Reject '+s.name} onClick={()=>decide([s.id],'rejected')}><Icon name="close"/></button></>:<span className="scan-decision"><Icon name={s.status==='accepted'?'check':'close'}/>{s.status==='accepted'?'Connected':'Rejected'}</span>}</div></td>
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
      <footer className="entity-review-footer"><div className="entity-review-selection"><strong>{selectedIds.length} selected</strong><button disabled={locked||stale||!pending.length} onClick={()=>setSelected(pending.map(s=>s.id))}>Select all pending</button>{selectedIds.length>0&&<button disabled={locked} onClick={()=>setSelected([])}>Clear</button>}</div><div className="entity-review-bulk-actions"><button className="button" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'rejected')}>{operation?.decision==='rejected'&&<span className="scan-spinner"/>}Reject selected</button><button className="button primary" disabled={locked||stale||!selectedIds.length} onClick={()=>decide(selectedIds,'accepted')}>{operation?.decision==='accepted'&&<span className="scan-spinner"/>}Accept selected{selectedIds.length>0?` (${selectedIds.length})`:''}</button><button className="button" onClick={()=>setOpen(false)}>Done</button></div></footer>
    </Modal>}
  </section>;
}
