import { smartQuoteTitle } from './smart-quotes';
import { useEffect, useRef, useState } from 'react';
import type { Entity, Page } from '../../shared/domain';
import type { SaveStatus } from '../state/page-saver';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { BlockEditor } from './BlockEditor';
import { Icon } from '../components/Icon';
import { api } from '../api';
import type { EntityMatchCache } from '../../shared/entity-match-cache';
import { EntityMatchReview } from './EntityMatchReview';
import { ambiguityReviewDelay } from './auto-entity-matching';
interface Props {onAddAlias: (id: string, alias: string) => Promise<void>; page: Page; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon'>>) => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void; onIdentify: () => Promise<void>; saveStatus: SaveStatus}
export function PageEditor({page, entities, onChange, onOpenEntity, onCreateEntity, onSave, onIdentify, onAddAlias, saveStatus}: Props) {
  const title = useRef<HTMLInputElement>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<{blocks: Page['blocks']; entities: Entity[]; cache: EntityMatchCache} | null>(() => page.entityMatchCache?.revision === page.revision ? {blocks:page.blocks,entities,cache:page.entityMatchCache} : null);
  const [reviewError, setReviewError] = useState('');
  const [resolving, setResolving] = useState(false);
  const cache = reviewSnapshot?.blocks === page.blocks && reviewSnapshot.entities === entities && reviewSnapshot.cache.revision === page.revision ? reviewSnapshot.cache : null;
  const reviewMatches = cache?.matches ?? [];
  const currentPage = useRef(page); currentPage.current = page;
  useEffect(() => {
    if (cache || saveStatus !== 'saved') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.entityMatches(page.vault_id,page.id,page.revision,controller.signal).then(cache => {
        if (!controller.signal.aborted && cache.revision === page.revision) { setReviewSnapshot({blocks:page.blocks,entities,cache}); setReviewError(''); }
      }).catch(error => { if (!controller.signal.aborted) setReviewError(error instanceof Error ? error.message : String(error)); });
    }, ambiguityReviewDelay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page.id, page.vault_id, page.blocks, page.revision, entities, saveStatus]);
  useEffect(() => { if (page.title === 'Untitled') { title.current?.focus(); title.current?.select(); } }, [page.id]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void onIdentify(); }, 1200); };
    schedule();
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('compositionend', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', schedule); document.removeEventListener('compositionend', schedule); };
  }, [page.id, page.blocks, entities, onIdentify]);
  const status = {saved: 'Automatically saved', pending: 'Waiting to save…', identifying: 'Identifying entities…', saving: 'Saving…', error: 'Could not save changes'}[saveStatus];
  return <article className="page" onCompositionStart={event => { event.currentTarget.dataset.entityComposing = 'true'; }} onCompositionEnd={event => { delete event.currentTarget.dataset.entityComposing; }}>
    <input ref={title} id="page-title" aria-label="Page title" placeholder="Untitled" maxLength={500} value={page.title} onChange={e => onChange({title: smartQuoteTitle(e.currentTarget, e.nativeEvent as InputEvent)})}/>
    {reviewError && <p className="entity-review-error" role="alert">{reviewError}</p>}
    <EntityMatchReview matches={reviewMatches} entities={entities} disabled={resolving} onResolve={async resolution => {
      if (!cache || resolving) return;
      const original = page;
      setResolving(true); setReviewError('');
      try {
        const {blocks} = await api.resolveEntityMatch(page.vault_id,page.id,{revision:page.revision,key:cache.key,matchId:resolution.match.id,entityId:resolution.entityId,all:!!resolution.all});
        if (currentPage.current === original) onChange({blocks});
        else setReviewError('The page changed while resolving this match. Review it again after saving.');
      } catch (error) { setReviewError(error instanceof Error ? error.message : String(error)); }
      finally { setResolving(false); }
    }}/>
    <BlockEditor onExplain={async blocks=>(await api.explainBlocks(page.vault_id,page.id,blocks)).markdown} reviewMatches={reviewMatches} onAddAlias={onAddAlias} key={page.vault_id + page.id} vaultId={page.vault_id} blocks={page.blocks} entities={entities} onChange={blocks => onChange({blocks})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated) => onCreateEntity({name, onCreated})} onSave={onSave}/>
    <footer className={'editor-save-status' + (saveStatus === 'error' ? ' is-error' : '')}>
      {saveStatus === 'saving' || saveStatus === 'identifying' ? <span className="scan-spinner" aria-hidden="true"/> : <Icon name={saveStatus === 'saved' ? 'check-circle' : saveStatus === 'error' ? 'alert' : 'recent'}/>}
      <span role="status" aria-live="polite" aria-atomic="true">{status}</span>
      {saveStatus === 'error' && <button type="button" onClick={onSave}>Retry</button>}
    </footer>
  </article>;
}
