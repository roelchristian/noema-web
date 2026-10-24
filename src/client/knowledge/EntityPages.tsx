import {useEffect, useRef, useState} from 'react';
import type {EntityDetail, EntityPageAssociation, PageSummary} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {PageIcon} from '../components/PageIcon';
import {TitleText} from '../components/TitleText';

export function EntityPages({entity, pages, onOpenPage, onAssociate, onRemove, onCreatePage}: {entity: EntityDetail; pages: PageSummary[]; onOpenPage: (id: string) => void; onAssociate: (id: string, input: {pinned?: boolean; annotation?: string}) => Promise<EntityDetail>; onRemove: (id: string) => Promise<EntityDetail>; onCreatePage?: () => Promise<PageSummary>}) {
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const [attaching, setAttaching] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linked = [...new Map((entity.linkedPages ?? []).map(page => [page.id, page])).values()];
  const ids = new Set(linked.map(page => page.id));
  const matches = pages.filter(page => !ids.has(page.id) && (page.title || 'Untitled').toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 20);
  async function run(work: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true); setError('');
    try {await work(); return true;} catch (value) {setError(value instanceof Error ? value.message : String(value)); return false;} finally {setBusy(false);}
  }
  function row(page: EntityPageAssociation) {
    return <li key={page.id} className="eh-linked-page"><button type="button" className="eh-page-open" onClick={() => onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><strong><TitleText text={page.title || 'Untitled'}/></strong>{page.archived_at&&<small>Archived</small>}{page.annotation && <small>{page.annotation}</small>}</span></button><div className="eh-page-actions"><button type="button" disabled={busy} onClick={() => void run(() => onAssociate(page.id, {pinned: !page.pinned}))} aria-label={`${uiText(page.pinned ? 'Unpin' : 'Pin')} ${page.title || 'Untitled'}`}>{uiText(page.pinned ? 'Unpin' : 'Pin')}</button><PageAnnotation key={page.id + ':' + page.annotation} page={page} busy={busy} onSave={annotation => run(() => onAssociate(page.id, {annotation}))}/><button type="button" disabled={busy} onClick={() => void run(() => onRemove(page.id))} aria-label={`Remove association with ${page.title || 'Untitled'}`}>{uiText('Remove')}</button></div></li>;
  }
  return <>
    <section className="eh-section"><h2>{uiText('Pinned pages')} <span>{linked.filter(page => page.pinned).length}</span></h2>{linked.some(page => page.pinned) ? <ul className="eh-page-list">{linked.filter(page => page.pinned).map(row)}</ul> : <p className="entity-detail-empty">{uiText('Pin a page to keep essential reading close at hand.')}</p>}</section>
    <section className="eh-section"><h2>{uiText('Associated pages')} <span>{linked.length}</span></h2><p className="eh-writing-hint">{uiText('Pages intentionally connected to this entity, independent of inline mentions. Unpinning keeps the association.')}</p>{linked.some(page => !page.pinned) && <ul className="eh-page-list">{linked.filter(page => !page.pinned).map(row)}</ul>}{!linked.length && <p className="entity-detail-empty">{uiText('No pages associated yet.')}</p>}
      <div className="eh-overview-links"><button type="button" onClick={() => setAttaching(value => !value)} aria-expanded={attaching}>{uiText('Attach existing page')}</button>{onCreatePage && <button type="button" disabled={busy} onClick={() => void run(async () => {const page = await onCreatePage(); if (mounted.current) onOpenPage(page.id);})}>{uiText('Create associated page')}</button>}</div>
      {attaching && <div className="eh-page-picker"><label>{uiText('Find a page')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={uiText('Search page titles')}/></label><ul>{matches.map(page => <li key={page.id}><span><TitleText text={page.title || 'Untitled'}/></span><button type="button" disabled={busy} onClick={() => void run(() => onAssociate(page.id, {pinned: false}))}>{uiText('Attach')}</button><button type="button" disabled={busy} onClick={() => void run(() => onAssociate(page.id, {pinned: true}))}>{uiText('Attach & pin')}</button></li>)}</ul>{!matches.length && <p className="entity-detail-empty">{uiText('No matching pages available to attach.')}</p>}</div>}
      {error && <p role="alert">{uiText('Could not update pages:')} {error} {uiText('Try the action again.')}</p>}
    </section>
  </>;
}
function PageAnnotation({page, busy, onSave}: {page: EntityPageAssociation; busy: boolean; onSave: (value: string) => Promise<boolean>}) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(page.annotation);
  const [saving, setSaving] = useState(false);
  return editing ? <form className="eh-annotation-form" onSubmit={event => {event.preventDefault(); setSaving(true); void onSave(value).then(saved => {if (saved) setEditing(false);}).finally(() => setSaving(false));}}><label>{uiText('Why this page matters')}<input aria-label={`Annotation for ${page.title || 'Untitled'}`} value={value} maxLength={2000} disabled={busy || saving} onChange={event => setValue(event.target.value)}/></label><button type="submit" disabled={busy || saving}>{uiText('Save note')}</button><button type="button" disabled={saving} onClick={() => {setValue(page.annotation); setEditing(false);}}>{uiText('Cancel')}</button></form> : <button type="button" disabled={busy} onClick={() => setEditing(true)}>{uiText(page.annotation ? 'Edit note' : 'Add note')}</button>;
}
