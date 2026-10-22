import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {api, ApiError} from '../api';
import {t as uiText} from '../i18n';
import type {SourceReference} from '../../shared/domain';
import type {EntityMentionReference} from '../../shared/entity-mentions';
import type {EntityDiscovery as Discovery, EntityDiscoverySuggestion} from '../../shared/entity-discovery';
import {MarkdownText} from '../intelligence/SummaryText';
import {getEntityOverviewDraft, subscribeEntityDrafts} from './entity-drafts';

export interface EntityDiscoveryProps {
  vaultId: string; id: string; refreshKey: string;
  onUpdated: () => Promise<void>;
  onOpenEntity: (id: string) => void;
  onOpenPage: (id: string) => void;
  onOpenSourcePassage?: (reference: SourceReference, trigger?: HTMLElement) => void;
  onOpenMention?: (reference: EntityMentionReference) => void;
}

/** Opening discovery only reads saved results. Generation always requires an explicit request. */
export function EntityDiscovery({vaultId, id, refreshKey, onUpdated, onOpenEntity, onOpenPage, onOpenSourcePassage}: EntityDiscoveryProps) {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const reviewRequest = useRef<AbortController | null>(null);
  const overviewDraft = useSyncExternalStore(subscribeEntityDrafts, () => getEntityOverviewDraft(vaultId, id));
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setGenerating(false); setReviewing(''); setError(''); setConflict(false); setCancelled(false); setDiscovery(null);
    void api.entityDiscovery(vaultId, id, controller.signal).then(result => {if (!controller.signal.aborted) setDiscovery(result);})
      .catch(value => {if (!controller.signal.aborted) setError(value instanceof Error ? value.message : String(value));})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => {controller.abort(); request.current?.abort(); reviewRequest.current?.abort();};
  }, [vaultId, id, refreshKey, attempt]);
  async function generate() {
    if (loading || generating || reviewing) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setGenerating(true); setError(''); setConflict(false); setCancelled(false);
    try {const result = await api.generateEntityDiscovery(vaultId, id, controller.signal); if (!controller.signal.aborted) setDiscovery(result);}
    catch (value) {if (!controller.signal.aborted) setError(value instanceof Error ? value.message : String(value));}
    finally {if (!controller.signal.aborted) setGenerating(false);}
  }
  function cancel() {request.current?.abort(); setGenerating(false); setCancelled(true);}
  async function review(suggestion: EntityDiscoverySuggestion, decision: 'accepted' | 'rejected') {
    if (!discovery || reviewing || generating || decision === 'accepted' && (discovery.stale || conflict || suggestion.kind === 'synthesis' && getEntityOverviewDraft(vaultId, id))) return;
    const controller = new AbortController(); reviewRequest.current = controller;
    setReviewing(suggestion.id); setError('');
    try {
      const result = await api.reviewEntityDiscovery(vaultId, id, discovery.id, {suggestionId: suggestion.id, decision, ...(suggestion.kind === 'synthesis' && decision === 'accepted' ? {expectedOverviewRevision: discovery.overviewRevision} : {})}, controller.signal);
      if (controller.signal.aborted) return;
      setDiscovery(result); if (decision === 'accepted') await onUpdated();
    } catch (value) {
      if (!controller.signal.aborted) {setError(value instanceof Error ? value.message : String(value)); if (value instanceof ApiError && value.status === 409) setConflict(true);}
    } finally {if (!controller.signal.aborted) setReviewing('');}
  }
  const busy = generating || !!reviewing;
  return <section className="eh-section eh-discovery">
    <h2>{uiText('AI discovery')}</h2>
    <p className="eh-writing-hint">{uiText('Explore existing knowledge for a provisional synthesis, directed relationships, and related pages. Review evidence before accepting each suggestion.')}</p>
    <p className="eh-writing-hint">{uiText('Explore with AI sends selected vault context to your configured AI provider and may incur charges. Configure your provider and API key in Settings → Intelligence.')}</p>
    <div className="eh-discovery-tools"><button type="button" className="button" disabled={loading || busy} onClick={() => void generate()}>{uiText(generating ? 'Exploring…' : 'Explore with AI')}</button>{generating && <button type="button" className="button" onClick={cancel}>{uiText('Cancel')}</button>}</div>
    {loading && <p role="status">{uiText('Loading saved discovery…')}</p>}
    {generating && <p role="status">{uiText('Exploring your knowledge. Suggestions will appear for review.')}</p>}
    {cancelled && <p role="status">{uiText('Discovery request cancelled. Any saved suggestions are preserved. The provider may still complete the request.')}</p>}
    {error && <div role="alert"><p>{uiText('Could not complete discovery:')} {error}</p><p>{uiText('Saved suggestions are preserved. Check Settings → Intelligence if your provider is not configured.')}</p>{!discovery && !loading && <button type="button" onClick={() => setAttempt(value => value + 1)}>{uiText('Retry loading saved discovery')}</button>}</div>}
    {(discovery?.stale || conflict) && <div className="eh-discovery-warning" role="alert"><p>{uiText('The entity or its evidence changed. These suggestions are preserved for comparison; explore again before accepting.')}</p></div>}
    {overviewDraft && <p className="eh-discovery-warning" role="status">{uiText('Your overview has an unsaved draft. Save or discard it before using an AI synthesis as your overview.')}</p>}
    {!loading && !discovery && !error && <p className="entity-detail-empty">{uiText('No saved discovery yet. Choose Explore with AI when you are ready.')}</p>}
    {discovery && <>
      <p className="eh-discovery-provenance">{uiText('Saved discovery')} · {discovery.createdAt} · {discovery.model}</p>
      {!discovery.suggestions.length && <p className="entity-detail-empty">{uiText('No supported suggestions found in the selected context.')}</p>}
      {(['synthesis', 'relationship', 'page'] as const).map(kind => {
        const suggestions = discovery.suggestions.filter(suggestion => suggestion.kind === kind);
        if (!suggestions.length) return null;
        return <section className="eh-discovery-group" key={kind}><h3>{uiText(kind === 'synthesis' ? 'Provisional synthesis' : kind === 'relationship' ? 'Proposed directed relationships' : 'Suggested associated pages')}</h3>
          {suggestions.map(suggestion => <article className="eh-discovery-card" key={suggestion.id} data-suggestion-id={suggestion.id}>
            {suggestion.kind === 'synthesis' ? <><p className="eh-writing-hint">{uiText('Using this synthesis replaces the saved overview. Review it carefully before continuing.')}</p><div className="eh-markdown"><MarkdownText text={suggestion.content}/></div></> : suggestion.kind === 'relationship' ? <p className="eh-discovery-relationship"><span>{uiText('This entity')}</span><span aria-hidden="true"> → </span><strong>{suggestion.label}</strong><span aria-hidden="true"> → </span><button type="button" onClick={() => onOpenEntity(suggestion.targetId)}>{suggestion.targetName}</button></p> : <button type="button" className="eh-discovery-page" onClick={() => onOpenPage(suggestion.pageId)}>{suggestion.pageTitle}</button>}
            <p className="eh-discovery-rationale">{suggestion.rationale}</p>
            <div className="eh-discovery-evidence"><h4>{uiText('Supporting evidence')}</h4>{suggestion.evidenceIds.map(evidenceId => {
              const evidence = discovery.evidence.find(item => item.id === evidenceId); if (!evidence) return null;
              return <div key={evidence.id}><button type="button" disabled={evidence.kind === 'source' ? !onOpenSourcePassage || !evidence.reference : !evidence.pageId} onClick={event => {if (evidence.kind === 'source' && evidence.reference) onOpenSourcePassage?.(evidence.reference, event.currentTarget); else if (evidence.pageId) onOpenPage(evidence.pageId);}}>{uiText(evidence.kind === 'source' ? 'Open source passage' : 'Open evidence page')}: {evidence.title}</button><blockquote>{evidence.excerpt}</blockquote></div>;
            })}</div>
            {suggestion.status === 'pending' ? <div className="eh-discovery-actions"><button type="button" className="button" disabled={busy || discovery.stale || conflict || suggestion.kind === 'synthesis' && !!overviewDraft} onClick={() => void review(suggestion, 'accepted')}>{uiText(reviewing === suggestion.id ? 'Saving decision…' : suggestion.kind === 'synthesis' ? 'Use as overview' : suggestion.kind === 'relationship' ? 'Accept relationship' : 'Associate page')}</button><button type="button" className="button" disabled={busy} onClick={() => void review(suggestion, 'rejected')}>{uiText('Reject')}</button></div> : <p className="eh-discovery-decision" role="status">{uiText(suggestion.status === 'accepted' ? 'Accepted' : 'Rejected')}</p>}
          </article>)}
        </section>;
      })}
    </>}
  </section>;
}
