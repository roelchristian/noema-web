import {useEffect, useState} from 'react';
import type {EntityDetail} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {MarkdownText} from '../intelligence/SummaryText';
import {clearEntityOverviewDraft, getEntityOverviewDraft, setEntityOverviewDraft} from './entity-drafts';

export function EntityOverview({vaultId, entity, onSave, onRefresh, guidance}: {guidance?: string; vaultId: string; entity: EntityDetail; onSave: (input: {content: string; revision: number}) => Promise<EntityDetail>; onRefresh: () => Promise<EntityDetail>}) {
  const server = entity.overview ?? {content: '', revision: 0};
  const savedDraft = getEntityOverviewDraft(vaultId, entity.id);
  const [draft, setDraft] = useState(() => savedDraft ?? {content: server.content, baseline: server.content, revision: server.revision});
  const [editing, setEditing] = useState(!!savedDraft);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = draft.content !== draft.baseline;
  const conflict = dirty && server.revision !== draft.revision && server.content !== draft.baseline;
  useEffect(() => {
    if (!dirty) setDraft({content: server.content, baseline: server.content, revision: server.revision});
    else if (server.content === draft.baseline && server.revision !== draft.revision) {
      const next = {...draft, revision: server.revision}; setDraft(next); setEntityOverviewDraft(vaultId, entity.id, next);
    }
  }, [server.content, server.revision, dirty, draft.baseline, draft.revision]);
  function change(content: string) {
    const next = {...draft, content}; setDraft(next); setEntityOverviewDraft(vaultId, entity.id, next); setError('');
  }
  function cancel() {
    clearEntityOverviewDraft(vaultId, entity.id); setDraft({content: server.content, baseline: server.content, revision: server.revision}); setEditing(false); setError(''); setPreview(false);
  }
  async function save() {
    if (saving || conflict || !dirty) return;
    const submitted = getEntityOverviewDraft(vaultId, entity.id);
    setSaving(true); setError('');
    try {
      const result = await onSave({content: draft.content, revision: draft.revision});
      clearEntityOverviewDraft(vaultId, entity.id, submitted);
      const overview = result.overview ?? {content: '', revision: 0};
      setDraft({content: overview.content, baseline: overview.content, revision: overview.revision}); setEditing(false); setPreview(false);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      // Refresh after a rejected revision so the user can compare before explicitly rebasing.
      try {await onRefresh();} catch { /* Keep the original save error and the user's draft. */ }
    } finally {setSaving(false);}
  }
  return <section className="eh-section eh-overview" data-entity-overview tabIndex={-1}>
    <h2>{uiText('Overview')} <button type="button" className="eh-text-action" onClick={() => setEditing(true)} hidden={editing}>{uiText(server.content ? 'Edit overview' : 'Write overview')}</button></h2>
    {editing ? <div className="eh-overview-editor">
      <p className="eh-writing-hint">{uiText(guidance ?? 'Write a synthesis in your own words. Markdown and math are supported.')}</p>
      <div className="eh-writing-tools"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>{uiText('Write')}</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>{uiText('Preview')}</button></div>
      {preview ? <div className="eh-markdown eh-overview-preview"><MarkdownText text={draft.content}/>{!draft.content && <p className="entity-detail-empty">{uiText('Your overview preview will appear here.')}</p>}</div> : <textarea aria-label={uiText('Entity overview Markdown')} value={draft.content} maxLength={100000} disabled={saving} onChange={event => change(event.target.value)} rows={12}/>}
      {conflict && <div className="eh-overview-conflict" role="alert"><p>{uiText('The saved overview changed while you were writing. Your draft is preserved. Compare the saved version before saving again.')}</p><details><summary>{uiText('Current saved overview')}</summary><div className="eh-markdown"><MarkdownText text={server.content}/></div></details><button type="button" onClick={() => {const next = {...draft, baseline: server.content, revision: server.revision}; setDraft(next); setEntityOverviewDraft(vaultId, entity.id, next); setError('');}}>{uiText('Keep my draft against this version')}</button></div>}
      {error && <p role="alert">{uiText('Could not save overview:')} {error} {uiText('Your draft is preserved.')}</p>}
      <div className="eh-writing-actions"><button type="button" className="button primary" disabled={saving || !dirty || conflict} onClick={() => void save()}>{uiText(saving ? 'Saving…' : error ? 'Retry save' : 'Save overview')}</button><button type="button" className="button" disabled={saving} onClick={cancel}>{uiText('Cancel')}</button>{dirty && <span>{uiText('Unsaved draft')}</span>}</div>
    </div> : server.content ? <div className="eh-markdown"><MarkdownText text={server.content}/></div> : <p className="entity-detail-empty">{uiText('Build a lasting understanding of this entity with notes, context, and a synthesis of its pages.')}</p>}
  </section>;
}
