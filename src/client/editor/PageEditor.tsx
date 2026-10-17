import { smartQuoteTitle } from './smart-quotes';
import { useEffect, useMemo, useRef } from 'react';
import type { Entity, Page } from '../../shared/domain';
import type { SaveStatus } from '../state/page-saver';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { BlockEditor } from './BlockEditor';
import { Icon } from '../components/Icon';
import { identifyEntityMentions } from '../../shared/auto-entities';
import { EntityMatchReview } from './EntityMatchReview';
interface Props {onAddAlias: (id: string, alias: string) => Promise<void>; page: Page; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon'>>) => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void; onIdentify: () => Promise<void>; saveStatus: SaveStatus}
export function PageEditor({page, entities, onChange, onOpenEntity, onCreateEntity, onSave, onIdentify, onAddAlias, saveStatus}: Props) {
  const title = useRef<HTMLInputElement>(null);
  const {ambiguous} = useMemo(() => identifyEntityMentions(page.blocks, entities, page.vault_id), [page.blocks, entities, page.vault_id]);
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
    <BlockEditor onAddAlias={onAddAlias} key={page.vault_id + page.id} vaultId={page.vault_id} blocks={page.blocks} entities={entities} onChange={blocks => onChange({blocks})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated) => onCreateEntity({name, onCreated})} onSave={onSave}/>
    <EntityMatchReview matches={ambiguous} entities={entities} onResolve={resolution => {
      const {blocks} = identifyEntityMentions(page.blocks, entities, page.vault_id, resolution);
      if (blocks !== page.blocks) onChange({blocks});
    }}/>
    <footer className={'editor-save-status' + (saveStatus === 'error' ? ' is-error' : '')}>
      {saveStatus === 'saving' || saveStatus === 'identifying' ? <span className="scan-spinner" aria-hidden="true"/> : <Icon name={saveStatus === 'saved' ? 'check-circle' : saveStatus === 'error' ? 'alert' : 'recent'}/>}
      <span role="status" aria-live="polite" aria-atomic="true">{status}</span>
      {saveStatus === 'error' && <button type="button" onClick={onSave}>Retry</button>}
    </footer>
  </article>;
}
