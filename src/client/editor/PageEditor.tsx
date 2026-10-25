import {useBibliographicPresentation} from '../sources/bibliographic-presentation';
import {NoteBibliographicReferences} from '../sources/NoteBibliographicReferences';
import {TransliterationBar} from './TransliterationBar';
import {noteDateItems} from '../../shared/note-dates';
import {DocumentFind} from './DocumentFind';
import {memoizeBlock} from '../../shared/immutable-blocks';
import {getLocale,languageLabel} from '../i18n';
import {t as uiText} from '../i18n';
import {readingNoteMaxWords,readingNoteWordCount} from '../../shared/source-reading';
import {projectPageText} from '../../shared/page-text';
import {PageTableOfContents} from './PageTableOfContents';
import type {PageHeading} from './page-headings';
import {TitleText,titleHasMath} from '../components/TitleText';
import {CitationPresentationContext,NoteReferences} from '../sources/CitationPresentation';
import {noteCitations,type CitationStyle} from '../../shared/citations';
import {PageProvenanceDisclosure} from '../components/PageProvenance';
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
interface Props {hideTitle?:boolean;focusNewBody?:boolean;onCreationFocusConsumed?:()=>void;tocVisible?:boolean;headings?:PageHeading[];subjectsSaving?:boolean;citationStyle?:CitationStyle;pages:PageSummary[];onOpenPage:(id:string)=>void;onAddAlias: (id: string, alias: string) => Promise<void>; page: Page; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon' | 'featuredImageId' | 'aiReviewAccepted'>>) => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void; onIdentify: () => Promise<void>; saveStatus: SaveStatus}
const emptyMatches:EntityMatchCache['matches']=[];
const mentionedIds=memoizeBlock(block=>blockSegments(block).flatMap(segment=>segment.entityId?[segment.entityId]:[]));
const wordSegmenter = new Intl.Segmenter(undefined, {granularity:'word'});
function editedLabel(updatedAt: string, now: number): string {
  const timestamp = Date.parse(updatedAt);
  const seconds = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 1000) : 0;
  if (seconds < 60) return uiText("Edited just now");
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']] as const;
  const [size, unit] = units.find(([size]) => seconds >= size)!;
  return uiText('Edited {time}',{time:new Intl.RelativeTimeFormat(getLocale(), {numeric:'always'}).format(-Math.floor(seconds/size),unit)});
}
export function PageEditor({hideTitle=false,focusNewBody=false,onCreationFocusConsumed,tocVisible=true,headings=[],subjectsSaving=false,citationStyle='references',pages,onOpenPage,page, entities, onChange, onOpenEntity, onCreateEntity, onSave, onIdentify, onAddAlias, saveStatus}: Props) {
  const readOnly=!!page.editLocked||!!page.archived_at;
  const priorCitations=useRef<ReturnType<typeof noteCitations>>(new Map());
  const citationEntries=useMemo(()=>{
    const entries=noteCitations(page.blocks),old=priorCitations.current;
    if(entries.size===old.size && [...entries].every(([key,item])=>{
      const before=old.get(key);
      return before && (before.reference===item.reference || JSON.stringify(before.reference)===JSON.stringify(item.reference)) && before.number===item.number && before.occurrences.length===item.occurrences.length && before.occurrences.every((id,i)=>id===item.occurrences[i]);
    }))return old;
    priorCitations.current=entries;return entries;
  },[page.blocks]);
  const scholarly=useBibliographicPresentation(page.blocks,page.vault_id,page.id);
  const citationPresentation=useMemo(()=>({style:citationStyle,entries:citationEntries,scholarly}),[citationStyle,citationEntries,scholarly]);
  const article = useRef<HTMLElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const entityCounts = useMemo(() => {
    const ids = new Set(page.blocks.flatMap(mentionedIds));
    const mentioned = entities.filter(entity => entity.vault_id === page.vault_id && ids.has(entity.id));
    return mentioned.length+noteDateItems(page.blocks).length;
  }, [page.blocks, page.vault_id, entities]);
  const countBlockWords = useMemo(()=>{
    const names = new Map(entities.filter(entity => entity.vault_id === page.vault_id).map(entity => [entity.id,entityMentionName(entity)]));
    const textOf = (content: Segment[]) => content.map(segment => segment.math ? ' ' : segment.entityId ? segment.mentionText ?? names.get(segment.entityId) ?? '' : segment.text ?? '').join('');
    return memoizeBlock(block=>{
      if (block.type === 'image' || block.type === 'math' || block.type === 'divider') return 0;
      const text=block.type==='table'||block.type==='columns' ? (block.rows??[]).map(row=>row.map(textOf).join(' ')).join(' ') : textOf(block.content);
      let count=0;
      for(const word of wordSegmenter.segment(text))if(word.isWordLike)count++;
      return count;
    });
  },[page.vault_id,entities]);
  const wordCount=useMemo(()=>page.blocks.reduce((sum,block)=>sum+countBlockWords(block),0),[page.blocks,countBlockWords]);
  const [reviewSnapshot, setReviewSnapshot] = useState<{blocks: Page['blocks']; domains:Page['pageDomains']; entities: Entity[]; cache: EntityMatchCache} | null>(() => page.entityMatchCache?.revision === page.revision ? {blocks:page.blocks,domains:page.pageDomains,entities,cache:page.entityMatchCache} : null);
  const [reviewError, setReviewError] = useState('');
  const [resolving, setResolving] = useState(false);
  const cache = reviewSnapshot?.blocks === page.blocks && reviewSnapshot.domains===page.pageDomains && reviewSnapshot.entities === entities && reviewSnapshot.cache.revision === page.revision ? reviewSnapshot.cache : null;
  const reviewMatches = cache?.matches ?? emptyMatches;
  const currentPage = useRef(page); currentPage.current = page;
  useEffect(() => {
    if (readOnly || cache || saveStatus !== 'saved') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.entityMatches(page.vault_id,page.id,page.revision,controller.signal).then(cache => {
        if (!controller.signal.aborted && cache.revision === page.revision) { setReviewSnapshot({blocks:page.blocks,domains:page.pageDomains,entities,cache}); setReviewError(''); }
      }).catch(error => { if (!controller.signal.aborted) setReviewError(error instanceof Error ? error.message : String(error)); });
    }, ambiguityReviewDelay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page.id, page.vault_id, page.blocks, page.revision, page.pageDomains, readOnly, entities, saveStatus]);
  useEffect(() => {
    if (readOnly) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void onIdentify(); }, 1200); };
    schedule();
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('compositionend', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', schedule); document.removeEventListener('compositionend', schedule); };
  }, [page.id, page.blocks, page.pageDomains, page.conceptContentHash, readOnly, entities, onIdentify]);
  const hasTitleMath=useMemo(()=>titleHasMath(page.title),[page.title]);
  const status = {saved: editedLabel(page.updated_at, now), pending: uiText("Waiting to save…"), identifying: uiText("Identifying entities…"), saving: uiText("Saving…"), error: uiText("Could not save changes")}[saveStatus];
  return <CitationPresentationContext.Provider value={citationPresentation}><article ref={article} className="page document-frame" lang={page.language??undefined} inert={subjectsSaving} aria-busy={subjectsSaving} onCompositionStart={event => { event.currentTarget.dataset.entityComposing = 'true'; }} onCompositionEnd={event => { delete event.currentTarget.dataset.entityComposing; }}>
    <TransliterationBar pageKey={page.vault_id+'/'+page.id}/>
    <DocumentFind key={page.vault_id+":"+page.id} blocks={page.blocks} entities={entities} disabled={!!readOnly} onChange={blocks=>onChange({blocks})}/>
    {!hideTitle && <h1 className={"page-title-heading page-heading"+(hasTitleMath?" has-title-math":"")+(page.editLocked?" is-title-locked":"")} aria-label={page.title || uiText("Untitled")}><textarea id="page-title" rows={1} aria-label={uiText("Page title")} title={uiText("Use $…$ or \\(…\\) for math")} placeholder={uiText("Untitled")} maxLength={500} readOnly={!!readOnly} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}} value={page.title} onChange={e => onChange({title: smartQuoteTitle(e.currentTarget, e.nativeEvent as InputEvent).replace(/[\r\n]+/g,' ')})}/>{!hasTitleMath&&<span className="page-title-sizer" aria-hidden="true">{page.title || uiText("Untitled")}</span>}{hasTitleMath&&<span className="page-title-preview" aria-hidden="true"><TitleText text={page.title}/></span>}</h1>}
    {page.readingNote&&<aside className="source-reading-note-context" aria-label={uiText("Reading note context")}><strong>{uiText("Reading note ·") + " "}{readingNoteWordCount(projectPageText(page.blocks,id=>entityMentionName(entities.find(entity=>entity.id===id))).text)} / {readingNoteMaxWords}{" " + uiText("words")}</strong><p>{page.readingNote.sourceId?<button type="button" onClick={()=>onOpenEntity(page.readingNote!.sourceId!)}>{uiText("Open source")}</button>:uiText("Original source unavailable")}</p><blockquote>{page.readingNote.excerpt}</blockquote></aside>}
    {headings.length>0&&<PageTableOfContents key={page.vault_id+'/'+page.id} headings={headings} showDocument={tocVisible} articleRef={article}/>}
    {page.editLocked && <div className="page-edit-lock-status" role="status"><Icon name="lock"/><span>{uiText("Locked for editing")}{page.editProtected ? uiText(" · Password protected") : ''}</span></div>}
    {reviewError && <p className="entity-review-error" role="alert">{reviewError}</p>}
    {!readOnly && <EntityMatchReview matches={reviewMatches} entities={entities} disabled={resolving} onResolve={async resolution => {
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
    {readOnly ? <ReadOnlyPageBlocks language={page.language} pageId={page.id} blocks={normalizeColumnBlocks(page.blocks)} entities={entities} pages={pages} vaultId={page.vault_id} onOpenEntity={onOpenEntity} onOpenPage={onOpenPage}/> : <BlockEditor language={page.language} pageId={page.id} focusNewBody={focusNewBody} onCreationFocusConsumed={onCreationFocusConsumed} onReview={async texts=>(await api.reviewText(page.vault_id,page.id,texts)).suggestions} featuredImageId={page.featuredImageId} pages={pages} onOpenPage={onOpenPage} onExplain={async (blocks,persona)=>api.explainBlocks(page.vault_id,page.id,blocks,persona)} reviewMatches={reviewMatches} onAddAlias={onAddAlias} key={page.vault_id + page.id} vaultId={page.vault_id} blocks={page.blocks} entities={entities} onChange={(blocks, featuredImageId, aiReviewAccepted) => onChange({blocks,...(aiReviewAccepted?{aiReviewAccepted:true}:{}),...(featuredImageId===undefined?{}:{featuredImageId})})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated, onCancel) => onCreateEntity({name, onCreated, onCancel, intent:'insert'})} onSave={onSave}/>}
    {citationStyle==='references'&&<NoteReferences blocks={page.blocks} entities={entities}/>}
    <NoteBibliographicReferences/>
    <footer className={'editor-save-status' + (saveStatus === 'error' ? ' is-error' : '')}>
      {saveStatus === 'saving' || saveStatus === 'identifying' ? <span className="scan-spinner" aria-hidden="true"/> : <Icon name={saveStatus === 'saved' ? 'recent' : saveStatus === 'error' ? 'alert' : 'recent'}/>}
      <span role="status" aria-live="polite" aria-atomic="true">{saveStatus === 'saved' ? <time dateTime={page.updated_at} title={new Date(page.updated_at).toLocaleString(getLocale())}>{status}</time> : status}</span>
      {saveStatus === 'error' && <button type="button" onClick={onSave}>{uiText("Retry")}</button>}
      <div className="editor-entity-counts" role="group" aria-label={uiText("Page statistics")}>
        <span className="editor-entity-count" title={uiText("Distinct entities on this page")}><Icon name="knowledge"/><span>{entityCounts} {entityCounts === 1 ? uiText("entity") : uiText("entities")}</span></span>
        <span className="editor-word-count" title={uiText("Words in note text")}>{wordCount.toLocaleString(getLocale())} {wordCount === 1 ? uiText("word") : uiText("words")}</span>
        {page.language?.trim()&&<span className="editor-language" title={uiText("Language")+': '+page.language}><Icon name="culture"/><span>{languageLabel(page.language)}</span></span>}
        <PageProvenanceDisclosure page={page}/>
      </div>
    </footer>
  </article></CitationPresentationContext.Provider>;
}
