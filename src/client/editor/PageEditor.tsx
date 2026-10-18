import {PageTableOfContents} from './PageTableOfContents';
import type {PageHeading} from './page-headings';
import {TitleText,titleHasMath} from '../components/TitleText';
import {CitationPresentationContext,NoteReferences} from '../sources/CitationPresentation';
import {noteCitations,type CitationStyle} from '../../shared/citations';
import {pageAIStatusLabels, pageAIStatusDescriptions} from '../../shared/page-ai-status';
import {ReadOnlyPageBlocks} from './ReadOnlyPageBlocks';
import { smartQuoteTitle } from './smart-quotes';
import { useEffect, useMemo, useRef, useState } from 'react';
import {normalizeColumnBlocks} from '../../shared/column-blocks';
import { blockSegments, entityMentionName, type Segment, type Entity, type Page, type PageSummary } from '../../shared/domain';
import type { SaveStatus } from '../state/page-saver';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { BlockEditor } from './BlockEditor';
import { Icon } from '../components/Icon';
import { api } from '../api';
import type { EntityMatchCache } from '../../shared/entity-match-cache';
import { EntityMatchReview } from './EntityMatchReview';
import { ambiguityReviewDelay } from './auto-entity-matching';
interface Props {tocVisible?:boolean;headings?:PageHeading[];subjectsSaving?:boolean;citationStyle?:CitationStyle;pages:PageSummary[];onOpenPage:(id:string)=>void;onAddAlias: (id: string, alias: string) => Promise<void>; page: Page; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon' | 'featuredImageId'>>) => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void; onIdentify: () => Promise<void>; saveStatus: SaveStatus}
const wordSegmenter = new Intl.Segmenter(undefined, {granularity:'word'});
function editedLabel(updatedAt: string, now: number): string {
  const timestamp = Date.parse(updatedAt);
  const seconds = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 1000) : 0;
  if (seconds < 60) return 'Edited just now';
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']] as const;
  const [size, unit] = units.find(([size]) => seconds >= size)!;
  return 'Edited ' + new Intl.RelativeTimeFormat('en', {numeric: 'always'}).format(-Math.floor(seconds / size), unit);
}
export function PageEditor({tocVisible=true,headings=[],subjectsSaving=false,citationStyle='references',pages,onOpenPage,page, entities, onChange, onOpenEntity, onCreateEntity, onSave, onIdentify, onAddAlias, saveStatus}: Props) {
  const citationPresentation=useMemo(()=>({style:citationStyle,entries:noteCitations(page.blocks)}),[citationStyle,page.blocks]);
  const title = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const entityCounts = useMemo(() => {
    const ids = new Set(page.blocks.flatMap(block => blockSegments(block).flatMap(segment => segment.entityId ? [segment.entityId] : [])));
    const mentioned = entities.filter(entity => entity.vault_id === page.vault_id && ids.has(entity.id));
    return mentioned.length;
  }, [page.blocks, page.vault_id, entities]);
  const wordCount = useMemo(() => {
    const names = new Map(entities.filter(entity => entity.vault_id === page.vault_id).map(entity => [entity.id,entityMentionName(entity)]));
    const textOf = (content: Segment[]) => content.map(segment => segment.math ? ' ' : segment.entityId ? segment.mentionText ?? names.get(segment.entityId) ?? '' : segment.text ?? '').join('');
    const text = page.blocks.map(block => {
      if (block.type === 'image' || block.type === 'math' || block.type === 'divider') return '';
      return block.type === 'table' || block.type === 'columns' ? (block.rows ?? []).map(row => row.map(textOf).join(' ')).join(' ') : textOf(block.content);
    }).join(' ');
    let count = 0;
    for (const word of wordSegmenter.segment(text)) if (word.isWordLike) count++;
    return count;
  }, [page.blocks,page.vault_id,entities]);
  const [reviewSnapshot, setReviewSnapshot] = useState<{blocks: Page['blocks']; domains:Page['pageDomains']; entities: Entity[]; cache: EntityMatchCache} | null>(() => page.entityMatchCache?.revision === page.revision ? {blocks:page.blocks,domains:page.pageDomains,entities,cache:page.entityMatchCache} : null);
  const [reviewError, setReviewError] = useState('');
  const [resolving, setResolving] = useState(false);
  const cache = reviewSnapshot?.blocks === page.blocks && reviewSnapshot.domains===page.pageDomains && reviewSnapshot.entities === entities && reviewSnapshot.cache.revision === page.revision ? reviewSnapshot.cache : null;
  const reviewMatches = cache?.matches ?? [];
  const currentPage = useRef(page); currentPage.current = page;
  useEffect(() => {
    if (page.editLocked || cache || saveStatus !== 'saved') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.entityMatches(page.vault_id,page.id,page.revision,controller.signal).then(cache => {
        if (!controller.signal.aborted && cache.revision === page.revision) { setReviewSnapshot({blocks:page.blocks,domains:page.pageDomains,entities,cache}); setReviewError(''); }
      }).catch(error => { if (!controller.signal.aborted) setReviewError(error instanceof Error ? error.message : String(error)); });
    }, ambiguityReviewDelay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page.id, page.vault_id, page.blocks, page.revision, page.pageDomains, page.editLocked, entities, saveStatus]);
  useEffect(() => { if (!page.editLocked && page.title === 'Untitled') { title.current?.focus({preventScroll:true}); title.current?.select(); } }, [page.id]);
  useEffect(() => {
    if (page.editLocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void onIdentify(); }, 1200); };
    schedule();
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('compositionend', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', schedule); document.removeEventListener('compositionend', schedule); };
  }, [page.id, page.blocks, page.pageDomains, page.conceptContentHash, page.editLocked, entities, onIdentify]);
  const hasTitleMath=useMemo(()=>titleHasMath(page.title),[page.title]);
  const status = {saved: editedLabel(page.updated_at, now), pending: 'Waiting to save…', identifying: 'Identifying entities…', saving: 'Saving…', error: 'Could not save changes'}[saveStatus];
  return <CitationPresentationContext.Provider value={citationPresentation}><article ref={article} className="page" inert={subjectsSaving} aria-busy={subjectsSaving} onCompositionStart={event => { event.currentTarget.dataset.entityComposing = 'true'; }} onCompositionEnd={event => { delete event.currentTarget.dataset.entityComposing; }}>
    <h1 className={"page-title-heading page-heading"+(hasTitleMath?" has-title-math":"")+(page.editLocked?" is-title-locked":"")} aria-label={page.title || 'Untitled'}><input ref={title} id="page-title" aria-label="Page title" title="Use $…$ or \(…\) for math" placeholder="Untitled" maxLength={500} readOnly={!!page.editLocked} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}} value={page.title} onChange={e => onChange({title: smartQuoteTitle(e.currentTarget, e.nativeEvent as InputEvent)})}/>{hasTitleMath&&<span className="page-title-preview" aria-hidden="true"><TitleText text={page.title}/></span>}</h1>
    {headings.length>0&&<PageTableOfContents key={page.vault_id+'/'+page.id} headings={headings} showDocument={tocVisible} articleRef={article}/>}
    {page.editLocked && <div className="page-edit-lock-status" role="status"><Icon name="lock"/><span>Locked for editing{page.editProtected ? ' · Password protected' : ''}</span></div>}
    {reviewError && <p className="entity-review-error" role="alert">{reviewError}</p>}
    {!page.editLocked && <EntityMatchReview matches={reviewMatches} entities={entities} disabled={resolving} onResolve={async resolution => {
      if (!cache || resolving) return;
      const original = page;
      setResolving(true); setReviewError('');
      try {
        const {blocks} = await api.resolveEntityMatch(page.vault_id,page.id,{revision:page.revision,key:cache.key,matchId:resolution.match.id,entityId:resolution.entityId,all:!!resolution.all});
        if (currentPage.current === original) onChange({blocks});
        else setReviewError('The page changed while resolving this match. Review it again after saving.');
      } catch (error) { setReviewError(error instanceof Error ? error.message : String(error)); }
      finally { setResolving(false); }
    }}/>}
    {page.editLocked ? <ReadOnlyPageBlocks blocks={normalizeColumnBlocks(page.blocks)} entities={entities} pages={pages} vaultId={page.vault_id} onOpenEntity={onOpenEntity} onOpenPage={onOpenPage}/> : <BlockEditor featuredImageId={page.featuredImageId} pages={pages} onOpenPage={onOpenPage} onExplain={async blocks=>(await api.explainBlocks(page.vault_id,page.id,blocks)).markdown} reviewMatches={reviewMatches} onAddAlias={onAddAlias} key={page.vault_id + page.id} vaultId={page.vault_id} blocks={page.blocks} entities={entities} onChange={(blocks, featuredImageId) => onChange({blocks,...(featuredImageId===undefined?{}:{featuredImageId})})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated) => onCreateEntity({name, onCreated, intent:'insert'})} onSave={onSave}/>}
    {citationStyle==='references'&&<NoteReferences blocks={page.blocks} entities={entities}/>}
    <footer className={'editor-save-status' + (saveStatus === 'error' ? ' is-error' : '')}>
      {saveStatus === 'saving' || saveStatus === 'identifying' ? <span className="scan-spinner" aria-hidden="true"/> : <Icon name={saveStatus === 'saved' ? 'recent' : saveStatus === 'error' ? 'alert' : 'recent'}/>}
      <span role="status" aria-live="polite" aria-atomic="true">{saveStatus === 'saved' ? <time dateTime={page.updated_at} title={new Date(page.updated_at).toLocaleString()}>{status}</time> : status}</span>
      {saveStatus === 'error' && <button type="button" onClick={onSave}>Retry</button>}
      <span className="editor-entity-counts" role="group" aria-label="Page statistics">
        <span className="editor-entity-count" title="Distinct entities on this page"><Icon name="knowledge"/><span>{entityCounts} {entityCounts === 1 ? 'entity' : 'entities'}</span></span>
        <span className="editor-word-count" title="Words in note text">{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
        <span className="page-ai-provenance" aria-label={'AI provenance: ' + pageAIStatusLabels[page.aiStatus ?? 'regular']} title={pageAIStatusDescriptions[page.aiStatus ?? 'regular']}><Icon name={page.aiStatus && page.aiStatus !== 'regular' ? 'sparkles' : 'page'}/><span>{pageAIStatusLabels[page.aiStatus ?? 'regular']}</span></span>
      </span>
    </footer>
  </article></CitationPresentationContext.Provider>;
}
