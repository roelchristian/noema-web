import {useEffect, useRef, useState} from 'react';
import {api} from '../api';
import {t as uiText} from '../i18n';
import type {SourceReference, PageSummary} from '../../shared/domain';
import {citationLocation} from '../../shared/citations';
import type {EntityEvidence} from '../../shared/entity-evidence';

const reasonLabels = {
  citation: 'Cited alongside entity',
  'source-mention': 'Name appears in source',
  'reading-note': 'Reading note associated with entity',
  highlight: 'Entity name appears in highlighted passage',
};

/** Bounded source discovery is loaded only when the Sources section is opened. */
export function EntitySourceEvidence({vaultId, entityId, refreshKey, onOpenSourcePassage, onOpenPage, pages = []}: {
  vaultId: string; entityId: string; refreshKey: string;
  pages?: PageSummary[]; onOpenPage?: (id: string) => void;
  onOpenSourcePassage?: (reference: SourceReference, trigger?: HTMLElement) => void;
}) {
  const [evidence, setEvidence] = useState<EntityEvidence | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller; let active = true;
    setLoadingMore(false);
    setEvidence(null); setError('');
    void api.entityEvidence(vaultId, entityId, controller.signal).then(value => {if (active) setEvidence(value);}).catch(value => {if (active && !controller.signal.aborted) setError(String(value));});
    return () => {active = false; controller.abort();};
  }, [vaultId, entityId, refreshKey, attempt]);
  async function loadMore() {
    const controller = request.current;
    if (!evidence?.hasMore || evidence.nextOffset === undefined || !controller || controller.signal.aborted || loadingMore) return;
    setLoadingMore(true); setError('');
    try {
      const next = await api.entityEvidence(vaultId, entityId, controller.signal, evidence.nextOffset);
      if (controller.signal.aborted) return;
      setEvidence(previous => {
        if (!previous) return next;
        const groups = previous.groups.map(group => ({...group, passages: [...group.passages]}));
        for (const group of next.groups) {
          const existing = groups.find(item => item.sourceId === group.sourceId);
          if (existing) existing.passages.push(...group.passages.filter(passage => !existing.passages.some(item => item.id === passage.id)));
          else groups.push(group);
        }
        return {...next, groups};
      });
    } catch (value) {if (!controller.signal.aborted) setError(String(value));}
    finally {if (!controller.signal.aborted) setLoadingMore(false);}
  }
  const count = evidence?.groups.reduce((total, group) => total + group.passages.length, 0);
  return <section className="eh-section eh-source-evidence"><h2>{uiText('Relevant source passages')}{evidence && <span>{count} {uiText(count === 1 ? 'passage' : 'passages')}{evidence.hasMore ? '+' : ''}</span>}</h2>
    <p className="eh-writing-hint">{uiText('Passages connected through page citations, reading notes, or names in source text. Review the original for context.')}</p>
    {error && <div role="alert"><p>{error}</p><button type="button" className="eh-text-action" onClick={() => evidence ? void loadMore() : setAttempt(value => value + 1)}>{uiText('Retry')}</button></div>}
    {!evidence ? !error && <p role="status">{uiText('Finding source passages…')}</p> : !count ? <p className="entity-detail-empty">{uiText('No relevant source passages found yet.')}</p> : <>
      {evidence.groups.map(group => <section className="eh-source-group" key={group.sourceId}><h3>{group.sourceName}</h3><ul>{group.passages.map(passage => {
        const reference = passage.reference;
        const locator = citationLocation(reference);
        return <li key={passage.id}>
          <p className="eh-evidence-reason">{(passage.reasons?.length ? passage.reasons : [passage.reason]).map(reason => uiText(reasonLabels[reason])).join(' · ')}</p>
          {passage.heading && <p className="eh-context-heading">{passage.heading}</p>}
          <blockquote>{reference.excerpt}</blockquote>{passage.excerptTruncated && <p className="eh-writing-hint">{uiText('Excerpt shortened. Open the source or related page for the full passage.')}</p>}
          {onOpenPage && !!passage.pageIds.length && <div className="eh-evidence-pages"><span>{uiText('Related pages')}</span>{passage.pageIds.map(pageId => <button type="button" key={pageId} onClick={() => onOpenPage(pageId)}>{pages.find(page => page.id === pageId)?.title || uiText('Open page')}</button>)}</div>}
          <div className="eh-source-actions"><button type="button" disabled={!onOpenSourcePassage} onClick={event => onOpenSourcePassage?.(reference, event.currentTarget)} aria-label={`${uiText('Open source passage')}: ${group.sourceName}, ${locator}`}>{locator}<span aria-hidden="true"> ↗</span></button>{passage.stale && <span className="eh-evidence-stale">{uiText('Saved excerpt · source location could not be verified')}</span>}</div>
        </li>;
      })}</ul></section>)}
      {evidence.hasMore && <button type="button" className="eh-text-action" disabled={loadingMore} onClick={() => void loadMore()}>{uiText(loadingMore ? 'Loading more…' : 'Load more passages')}</button>}
      {evidence.truncated && <p className="eh-writing-hint">{uiText('Discovery was limited to keep this view responsive. Open the original sources to explore further.')}</p>}
    </>}
  </section>;
}
