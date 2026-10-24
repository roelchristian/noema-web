import {useEffect, useRef, useState} from 'react';
import type {EntityDetail, EntityPageAssociation, PageSummary} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {PageIcon} from '../components/PageIcon';
import {TitleText} from '../components/TitleText';
import type {EntityMentionReference} from '../../shared/entity-mentions';
import {ConnectPicker} from './ConnectPicker';

export function EntityPages({entity, pages, onOpenPage, onAssociate, onRemove, onCreatePage, onOpenMention, queryFilter='', mentionsOnly=false, showConnect=true}: {entity: EntityDetail; pages: PageSummary[]; onOpenPage: (id: string) => void; onAssociate: (id: string, input: {pinned?: boolean; annotation?: string}) => Promise<EntityDetail>; onRemove: (id: string) => Promise<EntityDetail>; onCreatePage?: () => Promise<PageSummary>; onOpenMention?: (reference:EntityMentionReference)=>void; queryFilter?:string; mentionsOnly?:boolean; showConnect?:boolean}) {
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const [attaching, setAttaching] = useState(false);
  const lock=useRef(false);
  const [undo,setUndo]=useState<EntityPageAssociation|null>(null);
  const [undoAdded,setUndoAdded]=useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linked = [...new Map((entity.linkedPages ?? []).map(page => [page.id, page])).values()];
  const ids = new Set(linked.map(page => page.id));
  async function run(work: () => Promise<unknown>) {
    if (lock.current) return false;
    lock.current=true;
    setBusy(true); setError('');
    try {await work(); return true;} catch (value) {if(mounted.current)setError(value instanceof Error ? value.message : String(value)); return false;} finally {lock.current=false;if(mounted.current)setBusy(false);}
  }
  const mentions=new Map((entity.pageMentions??[]).map(page=>[page.id,page]));
  const targets=[...new Map([...linked,...entity.pageMentions??[]].map(page=>[page.id,page])).values()].filter(page=>(!mentionsOnly||mentions.has(page.id))&&(page.title||'Untitled').toLocaleLowerCase().includes(queryFilter.toLocaleLowerCase())).sort((a,b)=>Number(linked.find(page=>page.id===b.id)?.pinned??false)-Number(linked.find(page=>page.id===a.id)?.pinned??false)||Number(ids.has(b.id))-Number(ids.has(a.id))||a.title.localeCompare(b.title));
  return <section className="eh-section"><h2>{uiText('Connected pages')} <span>{targets.length}</span></h2>
    <p className="eh-writing-hint">{uiText('Associations and text mentions remain independent. Removing an association keeps its mentions.')}</p>
    {targets.length?<ul className="eh-page-list">{targets.map(page=>{
      const association=linked.find(item=>item.id===page.id),mention=mentions.get(page.id);
      return <li key={page.id} className="eh-linked-page"><div><button type="button" className="eh-page-open" onClick={()=>onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><strong><TitleText text={page.title||'Untitled'}/></strong>{page.archived_at&&<small>{uiText('Archived')}</small>}{association?.annotation&&<small>{association.annotation}</small>}</span></button>
        <p className="eh-writing-hint">{[association&&uiText('Associated'),mention&&`${mention.mentionCount} ${uiText(mention.mentionCount===1?'mention':'mentions')}`,association?.pinned&&uiText('Featured')].filter(Boolean).join(' · ')}</p>
        {mention&&<details><summary>{uiText('View mentions')} ({mention.mentionCount})</summary>{mention.contexts?.length?<ul className="eh-mention-contexts">{mention.contexts.map(context=><li key={context.occurrences[0]?.id??context.blockId}>{!!context.heading.length&&<p className="eh-context-heading">{context.heading.join(' › ')}</p>}<p className="eh-context-excerpt">{context.excerpt}</p><div className="eh-occurrences">{context.occurrences.map((occurrence,index)=><button type="button" key={occurrence.id} onClick={()=>onOpenMention?onOpenMention(occurrence.reference):onOpenPage(page.id)} aria-label={`${uiText('Go to mention')} ${index+1}: ${occurrence.label}`}>{index+1}. {occurrence.label} ↗</button>)}</div></li>)}</ul>:<p>{mention.excerpt}</p>}</details>}
      </div><div className="eh-page-actions"><button type="button" disabled={busy} onClick={()=>void run(()=>onAssociate(page.id,{pinned:!association?.pinned}))} aria-label={`${uiText(association?.pinned?'Unpin':'Pin')} ${page.title||'Untitled'}`}>{uiText(association?.pinned?'Unpin':'Pin')}</button>{association&&<><PageAnnotation key={page.id} page={association} busy={busy} onSave={annotation=>run(()=>onAssociate(page.id,{annotation}))}/><button type="button" disabled={busy} onClick={()=>void run(async()=>{await onRemove(page.id);if(mounted.current)setUndo(association);})} aria-label={`Remove association with ${page.title||'Untitled'}`}>{uiText('Remove')}</button></>}</div></li>;
    })}</ul>:<p className="entity-detail-empty">{uiText('No connected pages.')}</p>}
    <div className="eh-overview-links">{showConnect&&<button type="button" onClick={()=>setAttaching(value=>!value)} aria-expanded={attaching}>{uiText('Connect')}</button>}{onCreatePage&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await onCreatePage();if(mounted.current)onOpenPage(page.id);})}>{uiText('Create associated page')}</button>}</div>
    {showConnect&&attaching&&<ConnectPicker sourceLabel={entity.name} pages={pages} excludePageIds={[...ids]} disabled={busy} onCancel={()=>setAttaching(false)} onConnect={async(target,options)=>{await onAssociate(target.id,{pinned:options.pinned,annotation:options.annotation});if(mounted.current)setUndoAdded(target.id);}}/>}
    {undoAdded&&<p role="status">{uiText('Connection added.')} <button type="button" disabled={busy} onClick={()=>void run(async()=>{await onRemove(undoAdded);if(mounted.current)setUndoAdded(null);})}>{uiText('Undo')}</button></p>}
    {undo&&<p role="status">{uiText('Association removed. Mentions kept.')} <button type="button" disabled={busy} onClick={()=>void run(async()=>{await onAssociate(undo.id,{pinned:undo.pinned,annotation:undo.annotation});if(mounted.current)setUndo(null);})}>{uiText('Undo')}</button></p>}
    {error&&<p role="alert">{uiText('Could not update pages:')} {error}</p>}
  </section>;
}

function PageAnnotation({page, busy, onSave}: {page: EntityPageAssociation; busy: boolean; onSave: (value: string) => Promise<boolean>}) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(page.annotation);
  const [saving, setSaving] = useState(false);
  useEffect(()=>{if(!editing)setValue(page.annotation);},[page.annotation,editing]);
  return editing ? <form className="eh-annotation-form" onSubmit={event => {event.preventDefault(); setSaving(true); void onSave(value).then(saved => {if (saved) setEditing(false);}).finally(() => setSaving(false));}}><label>{uiText('Why this page matters')}<input aria-label={`Annotation for ${page.title || 'Untitled'}`} value={value} maxLength={2000} disabled={busy || saving} onChange={event => setValue(event.target.value)}/></label><button type="submit" disabled={busy || saving}>{uiText('Save note')}</button><button type="button" disabled={saving} onClick={() => {setValue(page.annotation); setEditing(false);}}>{uiText('Cancel')}</button></form> : <button type="button" disabled={busy} onClick={() => setEditing(true)}>{uiText(page.annotation ? 'Edit note' : 'Add note')}</button>;
}
