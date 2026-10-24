import {speechText,useSpeech} from './speech';
import {speechSections,speechSelectionContext} from './speech-sections';
import {entityIconName} from '../../shared/entity-icons';
import {paragraphFlow} from './paragraph-indent';
import {useDefaultPersona} from '../components/PersonaSelect';
import {aiPersonas,personaMetadata,personaIdentityName,type PersonaIdentity} from '../../shared/ai-personas';
import { fetchClipboardImage } from '../api';
import {EntityLinkActions} from './EntityLinkActions';
import {memoizeBlock} from '../../shared/immutable-blocks';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import type {EditorReviewText,EditorReviewSuggestion} from '../../shared/editor-review';
import {WritingReview} from './WritingReview';
import {captureWritingReview,writingReviewChanges,applyWritingReviewEdits,type WritingReviewChange} from './writing-review';
import {inlineMathBlock,mathInlineOptions,recommendedMathInlinePlacement,type MathInlinePlacement} from '../../shared/math-blocks';
import {TitleText} from '../components/TitleText';
import {CitationPicker} from './CitationPicker';
import {citationKey,cleanCitationGroups,noteCitations} from '../../shared/citations';
import {citationSpace,trimTrailingCitationSpace,trimLeadingCitationSpace} from './citation-spacing';
import {bookmarkCitationRange,resolveCitationRange,type CitationBookmark} from './citation-bookmark';
import {deleteEditorReference} from './reference-deletion';
import {CitationPresentationContext} from '../sources/CitationPresentation';
import {mentionMatches,mentionCaretRect} from './mention-picker';
import {menuPlacement,revealMenuItem} from '../components/menu-placement';
import {useEntitySchema} from '../knowledge/useEntitySchema';
import { blockListNumber, entityMentionName, safeHref } from '../../shared/domain';
import {randomUUID} from '../../shared/uuid';
import { aiExplanationSources, aiExplanationsForSources, explanationsLinkedToDeletedBlocks, applySemantic, isAIExplanation, preserveAIExplanationTags, normalizeSemanticGroups, removeSemanticGroup, retagSemanticGroup, semanticDragItems, semanticFunctions, editableSemanticKinds, semanticRuns, type SemanticKind } from '../../shared/semantic-blocks';
import {pageTitleKey} from '../../shared/page-links';
import { completePageLink } from './page-links';
import { ReadOnlyExplanationBlock } from './ReadOnlyExplanationBlock';
import { clearEditorSelection,editorSelectionRange,selectedEditorBlocks,editorSelectionBlocks } from './block-selection';
import { installBlockDrag, reorderBlock } from './block-drag';
import { installBlockSelection, setEditorCaret } from './block-selection';
import { displayMathSource } from './math-delimiters';
import { applySmartQuotes } from './smart-quotes';
import { Fragment, memo, use, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode, type ClipboardEvent, type KeyboardEvent, type CSSProperties } from 'react';
import type { EntityReviewItem } from '../../shared/entity-match-cache';
import { entityLabels, type Block, type BlockType, type Entity, type PageSummary, type SourceReference, type Segment } from '../../shared/domain';
import { uploadImage } from '../api';
import { Icon } from '../components/Icon';
import { Modal, ModalHeader } from '../components/Modal';
import { useMobileViewport } from '../components/WorkspaceNavigation';
import {segmentsEqual} from '../../shared/segments-equal';
import { readSegments, segmentHTML, syncEditableSegments } from './segments';
import { clipboardContent, type ClipboardImage, markdownBlocks, makeBlock } from './paste';
import { compressImage } from './compress-image';
import { readImageCompression } from '../settings/image-settings';
import { ImageBlock } from './ImageBlock';
import {allowedInColumn, normalizeColumnBlocks} from '../../shared/column-blocks';
import { TableBlock } from './TableBlock';
import { SelectionToolbar } from './SelectionToolbar';
import { MathBlock } from './MathBlock';
import {InlineMathEditor} from './InlineMathEditor';
import { completeInlineMath, mathElement } from './math';
import { completeTypedMarkdown,typedMarkdownBlock } from './markdown-typing';
import { useMarkdownTyping } from '../state/markdown-preferences';
import {applyEditorTextFormat,shortcutTextFormat} from './text-formatting';
interface Props {pageId?:string;focusNewBody?:boolean;onCreationFocusConsumed?:()=>void;onReview?:(texts:EditorReviewText[])=>Promise<EditorReviewSuggestion[]>;featuredImageId?: string | null; pages?:PageSummary[];onOpenPage?:(id:string)=>void;onExplain?: (blocks: Block[],persona?:{id:string;version?:number}) => Promise<string|{markdown:string;persona:PersonaIdentity}>; reviewMatches?: EntityReviewItem[]; onAddAlias: (id: string, alias: string) => Promise<void>; vaultId: string; blocks: Block[]; entities: Entity[]; onChange: (blocks: Block[], featuredImageId?: string | null, aiReviewAccepted?:true) => void; onOpenEntity: (id: string) => void; onCreateEntity: (name: string, onCreated: (id: string) => void, onCancel?: () => void) => void; onSave: () => void}
function explanationInsertionIndex(blocks: Block[], ids: string[]) {
  const last=blocks.filter(block=>ids.includes(block.id)).at(-1);
  if(!last)return -1;
  let index=blocks.findIndex(block=>block.id===last.id);
  if(last.semanticGroup)blocks.forEach((block,i)=>{if(block.semanticGroup?.id===last.semanticGroup!.id)index=i;});
  return index;
}
function passagePreview(text: string) {
  const normalized=text.replace(/\s+/g,' ').trim();
  if(normalized.length<=180)return normalized;
  const start=Array.from(normalized).slice(0,180).join('');
  const boundary=start.lastIndexOf(' ');
  return (boundary>120?start.slice(0,boundary):start).trimEnd()+'…';
}
const options: {type: BlockType; title: string; detail: string; icon: string}[] = [
  {type: 'paragraph', get title(){return uiText("Text")}, get detail(){return uiText("Plain text for your thoughts")}, icon: 'text'},
  {type: 'heading1', get title(){return uiText("Heading 1")}, get detail(){return uiText("A large section heading")}, icon: 'heading-1'},
  {type: 'heading2', get title(){return uiText("Heading 2")}, get detail(){return uiText("A smaller section heading")}, icon: 'heading-2'},
  {type: 'bullet', get title(){return uiText("Bullet list")}, get detail(){return uiText("A simple list of ideas")}, icon: 'list-bullet'},
  {type: 'numbered', get title(){return uiText("Numbered list")}, get detail(){return uiText("An ordered list of ideas")}, icon: 'list-numbered'},
  {type: 'divider', get title(){return uiText("Divider")}, get detail(){return uiText("Separate sections with a horizontal line")}, icon: 'divider'},
  {type: 'code', get title(){return uiText("Code block")}, get detail(){return uiText("Write code with preserved whitespace")}, icon: 'code'},
  {type: 'todo', get title(){return uiText("To-do")}, get detail(){return uiText("Keep track of a task")}, icon: 'checklist'},
  {type: 'columns', get title(){return uiText("Two columns")}, get detail(){return uiText("Side by side text that stacks on mobile")}, icon: 'columns'},
  {type: 'table', get title(){return uiText("Table")}, get detail(){return uiText("A simple table with rows and columns")}, icon: 'table'},
  {type: 'math', get title(){return uiText("Equation")}, get detail(){return uiText("A LaTeX math equation")}, icon: 'equation'},
  {type: 'quote', get title(){return uiText("Quote")}, get detail(){return uiText("Make a thought stand out")}, icon: 'quote'},
];
interface ImageUpload {id:string; after?:string; name:string; message:string; current:number; total:number}
interface Choice {back?: boolean; danger?: boolean; disabled?: boolean; submenu?: boolean; color?:string; title: string; detail?: string; icon: string; pick: () => void}
interface Menu {items: Choice[]; index: number; left: number; top: number; label: string; sheet?: boolean; anchor?:Range; anchorElement?:HTMLElement}
function EditableBlock({block, entities, reviewMatches, onInput, onKeyDown, onOpen, register, onPaste}: {block: Block; entities: Entity[]; reviewMatches: EntityReviewItem[]; onInput: (el: HTMLElement, event:InputEvent) => void; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void; onOpen: (id: string) => void; register: (el: HTMLElement | null) => void; onPaste: (e: ClipboardEvent<HTMLElement>) => void}) {
  // React's use(Context) supports conditional subscriptions. Plain text must not
  // subscribe to the citation map that PageEditor rebuilds on every edit.
  const citations=block.content.some(segment=>segment.sourceReference)?use(CitationPresentationContext):undefined;
  const locale=getLocale();
  const ref = useRef<HTMLElement>(null);
  const Content = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : 'div';
  useLayoutEffect(() => {
    const el = ref.current!;
    syncEditableSegments(el, block.content, entities, {blockId: block.id, matches: reviewMatches},citations);
    el.querySelectorAll<HTMLElement>('[data-entity]:not([data-source-reference])').forEach(node => {
      const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: node.dataset.entity!, ...(node.dataset.skipAutoTag === 'true' ? {skipAutoTag:true} : {}), ...(node.dataset.mentionText ? {mentionText: node.dataset.mentionText} : {})}], entities);
      const fresh = wrapper.firstElementChild!;
      if (node.innerHTML !== fresh.innerHTML) node.innerHTML = fresh.innerHTML;
      if (node.className !== fresh.className) node.className = fresh.className;
      if (node.getAttribute('title') !== fresh.getAttribute('title')) {
        if(fresh.hasAttribute('title'))node.setAttribute('title',fresh.getAttribute('title')!);else node.removeAttribute('title');
      }
    });
  }, [block.id, block.type, block.content, entities, reviewMatches, citations, locale]);
  const registerElement=useCallback((el:HTMLElement|null)=>{ref.current=el;register(el);},[register]);
  return <Content ref={registerElement} className="block-content" contentEditable suppressContentEditableWarning spellCheck data-placeholder={uiText("Type / for blocks, @ for entities")} onInput={e => { applySmartQuotes(e.currentTarget, e.nativeEvent as InputEvent); onInput(e.currentTarget,e.nativeEvent as InputEvent); }} onKeyDown={onKeyDown}
    onClick={e => { const mention = (e.target as Element).closest<HTMLElement>('[data-entity]'); if (mention) onOpen(mention.dataset.entity!); }}
    onPaste={onPaste}/>;
}
function semanticStyle(kind?: SemanticKind): CSSProperties | undefined {return kind ? {'--semantic-color':semanticFunctions[kind].color} as CSSProperties : undefined;}
function semanticGlyph(kind?: SemanticKind) {return <>{kind && <span className="semantic-function-icon"><Icon name={semanticFunctions[kind].icon}/></span>}<span className="semantic-grip-icon"><Icon name="grip"/></span></>;}
const emptyReviewMatches: EntityReviewItem[] = [];
interface TextRowActions {
  addBelow:(element:HTMLElement,id:string)=>void;
  options:(element:HTMLElement,block:Block)=>void;
  update:(id:string,patch:Partial<Block>)=>void;
  register:(id:string,element:HTMLElement|null)=>void;
  input:(block:Block,element:HTMLElement,event:InputEvent)=>void;
  keyDown:(event:KeyboardEvent<HTMLElement>,block:Block)=>void;
  paste:(event:ClipboardEvent<HTMLElement>,block:Block)=>void;
  open:(id:string)=>void;
}
// Default shallow comparison keeps every visible dependency explicit, including list order.
const TextBlockRow=memo(function TextBlockRow({block,entities,reviewMatches,number,actions,paragraphPosition}: {block:Block;entities:Entity[];reviewMatches:EntityReviewItem[];number?:number;actions:TextRowActions;paragraphPosition?:'first'|'continuation';locale:ReturnType<typeof getLocale>}) {
  const register=useCallback((element:HTMLElement|null)=>actions.register(block.id,element),[actions,block.id]);
  return <div data-paragraph-flow={paragraphPosition} data-block-id={block.id} data-semantic-kind={block.semantic} style={semanticStyle(block.semantic)} className={'block '+block.type+(block.semantic?' semantic-block':'')}>
    {block.semantic&&<span className="semantic-callout-icon" aria-hidden="true"><Icon name={semanticFunctions[block.semantic].icon}/></span>}
    <div className="block-controls" role="group" aria-label={uiText("Block controls")}>
      <button className="block-add" title={uiText("Add block below")} aria-label={uiText("Add block below")} onClick={event=>actions.addBelow(event.currentTarget,block.id)}><Icon name="plus"/></button>
      <button className={'block-handle'+(block.semantic?' semantic-handle':'')} draggable={false} title={(block.semantic?uiText(semanticFunctions[block.semantic].label)+' · ':'')+uiText("Drag to move · Click for block options")} aria-label={block.semantic?uiText(semanticFunctions[block.semantic].label)+uiText(" block options"):uiText("Block options")} aria-describedby="block-drag-help" onClick={event=>actions.options(event.currentTarget,block)}>{semanticGlyph(block.semantic)}</button>
    </div>
    {block.type==='todo'?<input type="checkbox" aria-label={uiText("Complete task")} checked={block.checked} onChange={event=>actions.update(block.id,{checked:event.target.checked})}/>:block.type==='bullet'?<span className="bullet-marker">•</span>:block.type==='numbered'?<span className="bullet-marker numbered-marker">{number}.</span>:null}
    <EditableBlock block={block} entities={entities} reviewMatches={reviewMatches} register={register} onOpen={actions.open} onInput={(element,event)=>actions.input(block,element,event)} onKeyDown={event=>actions.keyDown(event,block)} onPaste={event=>actions.paste(event,block)}/>
  </div>;
});
const blockSuggestionIds=memoizeBlock(block=>{
  const ids=(block.type==='table'||block.type==='columns'?(block.rows??[]).flat(2):block.content).flatMap(segment=>segment.entityId?[segment.entityId]:[]);
  for(const citation of noteCitations([block]).values())ids.push(citation.reference.sourceId);
  return ids;
});
export function BlockEditor(props: Props) {
  const presentation=useContext(CitationPresentationContext);
  const presentationRef=useRef(presentation);presentationRef.current=presentation;
  const markdownTyping=useMarkdownTyping();
  const mobile = useMobileViewport();
  const [activeBlock, setActiveBlock] = useState<{id: string; group: boolean} | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const mobileToolbar = useRef<HTMLDivElement>(null);
  const {entities, onOpenEntity, onCreateEntity, onSave} = props;
  const {schema}=useEntitySchema(props.vaultId);

  const suggestionPriorityIds = useMemo(() => [...new Set(props.blocks.flatMap(blockSuggestionIds).reverse())], [props.blocks]);
  const blocks = useMemo(() => {
    const normalized = normalizeSemanticGroups(normalizeColumnBlocks(props.blocks));
    const last = normalized.at(-1);
    const hasTrailingText = last?.type === 'paragraph' && !last.column && !last.semantic && !last.semanticGroup && last.content.every(segment => !segment.entityId && segment.text === '');
    // A regular editable paragraph provides the slash helper after every layout.
    // It is saved with the next edit, rather than creating a change just by opening a note.
    const next=hasTrailingText || normalized.length >= 2000 ? normalized : [...normalized,makeBlock()];
    return next;
  }, [props.blocks]);

  const [linkedDeletion, setLinkedDeletion] = useState<string[]>([]);
  const onChange = (next: Block[], featuredImageId?: string | null, aiReviewAccepted?:true) => {
    const normalized = normalizeSemanticGroups(normalizeColumnBlocks(preserveAIExplanationTags(blocks,next)));
    const linked = explanationsLinkedToDeletedBlocks(blocks, normalized);
    if (linked.length) {
      setMenu(null);
      setLinkedDeletion(current => [...new Set([...current,...linked])]);
    }
    props.onChange(normalized, featuredImageId, aiReviewAccepted);
  };
  const [writingReview,setWritingReview]=useState<{anchorId:string;loading:boolean;error:string;changes:WritingReviewChange[]}|null>(null);
  const reviewRequest=useRef(0),reviewPending=useRef(false),reviewBlocks=useRef<Block[]|null>(null);
  useLayoutEffect(()=>{
    reviewBlocks.current=null;
    setWritingReview(current=>{
      if(!current)return current;
      const ids=new Set(blocks.filter(block=>!isAIExplanation(block)).map(block=>block.id));
      const changes=current.changes.filter(change=>ids.has(change.blockId));
      if(!ids.has(current.anchorId)&&!changes.length)return null;
      if(changes.length===current.changes.length&&ids.has(current.anchorId))return current;
      return {...current,anchorId:changes[0]?.blockId??current.anchorId,changes};
    });
  },[blocks]);
  function closeWritingReview(){++reviewRequest.current;reviewBlocks.current=null;setWritingReview(null);}
  function dismissWritingSuggestion(id:string){
    setWritingReview(current=>{
      if(!current)return null;
      const changes=current.changes.filter(change=>change.blockId!==id);
      return changes.length?{...current,anchorId:changes[0]!.blockId,changes}:null;
    });
  }
  async function reviewWriting(ids?:string[]) {
    if(reviewPending.current||!latest.current.onReview||!root.current)return;
    const targets=captureWritingReview(root.current,latest.current.blocks,ids);
    const draft=commitSelection();
    targets.forEach(target=>{const block=draft.find(block=>block.id===target.blockId);if(block)target.snapshot=JSON.stringify(block.content);});
    setMenu(null);reviewBlocks.current=null;
    if(!targets.length){setWritingReview({anchorId:ids?.[0]??draft[0]?.id??'',loading:false,error:'Select prose to review. Code, equations, references, and entity mentions are preserved.',changes:[]});return;}
    const request=++reviewRequest.current;reviewPending.current=true;
    setWritingReview({anchorId:targets[0]!.blockId,loading:true,error:'',changes:[]});
    try {
      const suggestions=await latest.current.onReview(targets.flatMap(target=>target.texts));
      if(mounted.current&&request===reviewRequest.current)setWritingReview({anchorId:targets[0]!.blockId,loading:false,error:'',changes:writingReviewChanges(targets,suggestions)});
    }catch(error){if(mounted.current&&request===reviewRequest.current)setWritingReview({anchorId:targets[0]!.blockId,loading:false,error:error instanceof Error?error.message:'Could not review this text.',changes:[]});}
    finally{reviewPending.current=false;}
  }
  function acceptWritingReview(change:WritingReviewChange,ids?:string[]) {
    // Accept-all may apply several corrections before React renders the updated props.
    const current=reviewBlocks.current??latest.current.blocks;
    const block=current.find(block=>block.id===change.blockId);
    if(!block||isAIExplanation(block)||JSON.stringify(block.content)!==change.snapshot)return 'This text changed after the review. Select it again for a fresh review.';
    const applied=applyWritingReviewEdits(change,ids);
    if(!applied)return 'Choose at least one edit to accept.';
    const next=current.map(block=>block.id===change.blockId?{...block,content:applied.content}:block);
    if(root.current)clearEditorSelection(root.current);
    const active=document.activeElement;
    if(active instanceof Element&&active.closest('.writing-review-inline'))focusTarget.current={id:change.blockId,start:false};
    reviewBlocks.current=next;latest.current.onChange(next,undefined,true);
    setWritingReview(current=>{
      if(!current)return null;
      const changes=current.changes.flatMap(item=>item.blockId!==change.blockId?[item]:applied.remaining?[applied.remaining]:[]);
      return changes.length?{...current,anchorId:changes[0]!.blockId,changes}:null;
    });
    return null;
  }
  const [pageLinkStatus,setPageLinkStatus]=useState('');
  const speech=useSpeech(props.vaultId,props.pageId);
  const speechSources=useRef(new Map<string,{source:string;projection:string}>());
  const speechSelection=useRef<string|null>(null);
  function validSpeechSource(id:string):boolean {
    const block=latest.current.blocks.find(item=>item.id===id),previous=speechSources.current.get(id);
    return !!block&&previous?.source===JSON.stringify(block)&&previous.projection===speechText([block],[id],latest.current.entities);
  }
  useEffect(()=>{
    const id=speech.activeBlockId;
    if(!id)return;
    // The active source remains guarded while paused. Advancing validates the
    // next block before playback; typing only projects this one source block.
    if(!validSpeechSource(id))speech.stop();
  },[blocks,entities,speech.activeBlockId]);
  const speechActive=!!speech.player;
  useEffect(()=>{
    if(!speechActive)return;
    const selectionChanged=()=>{
      const context=root.current?speechSelectionContext(root.current):null;
      if(context&&speechSelection.current&&context!==speechSelection.current)speech.stop();
    };
    document.addEventListener('selectionchange',selectionChanged);
    return()=>document.removeEventListener('selectionchange',selectionChanged);
  },[speechActive]);
  useEffect(()=>{
    const id=speech.currentBlockId;
    if(!id)return;
    const row=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-block-id]')??[]).find(element=>element.dataset.blockId===id);
    row?.setAttribute('data-speech-current','true');
    return()=>{row?.removeAttribute('data-speech-current');};
  },[speech.currentBlockId]);
  const defaultExplanationPersona=useDefaultPersona();
  const explanationPersona=useRef<string>('');
  const [explaining,setExplaining]=useState(false), [explanationError,setExplanationError]=useState('');
  const [explanationAnchor,setExplanationAnchor]=useState<{ids:string[];index:number}|null>(null);
  const explanationPending=useRef(false), retryExplanation=useRef<string[]>([]);
  const reviewMatches = props.reviewMatches ?? emptyReviewMatches;
  const reviewsByBlock=useMemo(()=>{
    const grouped=new Map<string,EntityReviewItem[]>();
    for(const match of reviewMatches){const matches=grouped.get(match.blockId)??[];matches.push(match);grouped.set(match.blockId,matches);}
    return grouped;
  },[reviewMatches]);
  const dragStatus = useRef<HTMLDivElement>(null);
  function announceDrag(message: string) {if (dragStatus.current) dragStatus.current.textContent = message;}
  const [citationTarget,setCitationTarget]=useState<{bookmark:CitationBookmark;editor:HTMLElement;blockId:string}|null>(null);
  const [mathTarget, setMathTarget] = useState<{range: Range; initial: string; node?: HTMLElement} | null>(null);
  const [uploads, setUploads] = useState<ImageUpload[]>([]), [imageError, setImageError] = useState('');
  const uploadQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true; return () => {mounted.current=false;};}, []);
  const pendingClipboardImages = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null), imageTarget = useRef<{after?: string; replace?: Block}>({});
  const [menu, setMenu] = useState<Menu | null>(null), elements = useRef(new Map<string, HTMLElement>());
  const root = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = {...props,blocks,onChange};
  const splitBlockRef = useRef(splitBlock); splitBlockRef.current = splitBlock;
  useEffect(()=>{
    const editor=root.current;if(!editor)return;
    const owner=(target:EventTarget|null)=>{
      const row=target instanceof Element?target.closest<HTMLElement>('[data-block-id]'):null;
      return row&&editor.contains(row)?row.dataset.blockId??null:null;
    };
    let activeId=owner(document.activeElement),frame:number|undefined;
    const cleanup=(id:string)=>{
      const current=latest.current.blocks,entries=noteCitations(current);
      const numberOf=(ref:SourceReference)=>presentationRef.current.style==='references'?entries.get(citationKey(ref))?.number??ref.sourceNumber??1:ref.sourceNumber??1;
      const normalize=(content:Segment[])=>trimTrailingCitationSpace(cleanCitationGroups(content,(left,right)=>numberOf(left)-numberOf(right)));
      let changed=false;
      const next=current.map(block=>{
        if(block.id!==id||isAIExplanation(block))return block;
        const content=normalize(block.content);
        const rows=block.rows?.map(row=>row.map(normalize));
        const rowsChanged=rows?.some((row,r)=>row.some((cell,c)=>cell!==block.rows![r]![c]));
        if(content===block.content&&!rowsChanged)return block;
        changed=true;return {...block,content,...(rowsChanged?{rows}:{})};
      });
      if(changed)latest.current.onChange(next);
    };
    const schedule=(nextId:string|null)=>{
      if(frame!==undefined)cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        frame=undefined;
        if(activeId===nextId)return;
        const previous=activeId;activeId=nextId;
        if(previous)cleanup(previous);
      });
    };
    const move=(event:FocusEvent|PointerEvent)=>{
      const target=event.target;
      // Pickers and formatting controls continue the current block's editing session.
      if(target instanceof Element&&target.closest('.selection-popover,.command-menu,.mobile-block-toolbar,dialog'))return;
      schedule(owner(target));
    };
    const blur=()=>schedule(null);
    document.addEventListener('focusin',move);document.addEventListener('pointerdown',move,true);window.addEventListener('blur',blur);
    return()=>{if(frame!==undefined)cancelAnimationFrame(frame);document.removeEventListener('focusin',move);document.removeEventListener('pointerdown',move,true);window.removeEventListener('blur',blur);};
  },[]);
  useLayoutEffect(()=>{
    if(!menu?.anchor||!menu.anchorElement||!menuRef.current)return;
    const popup=menuRef.current,anchor=menu.anchor,editor=menu.anchorElement;
    const position=()=>{
      if(!anchor.startContainer.isConnected){setMenu(null);return;}
      const visible=window.visualViewport;
      const viewport={left:visible?.offsetLeft??0,top:visible?.offsetTop??0,width:visible?.width??innerWidth,height:visible?.height??innerHeight};
      const rect=mentionCaretRect(anchor,editor);
      if(rect.bottom<viewport.top||rect.top>viewport.top+viewport.height){setMenu(null);return;}
      popup.style.maxHeight='none';
      const placement=menuPlacement(rect,240,popup.scrollHeight+popup.offsetHeight-popup.clientHeight,viewport,'start',350);
      popup.style.left=placement.left+'px';popup.style.top=placement.top+'px';popup.style.width=placement.width+'px';popup.style.maxHeight=placement.maxHeight+'px';
    };
    position();
    const selected=popup.children[menu.index];if(selected)revealMenuItem(popup,selected as HTMLElement);
    const onScroll=(event:Event)=>{if(!(event.target instanceof Node)||!popup.contains(event.target))position();};
    window.addEventListener('scroll',onScroll,true);window.addEventListener('resize',position);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[menu]);
  useEffect(() => {
    if (!mobile) { setActiveBlock(null); return; }
    const viewport = window.visualViewport;
    const update = () => {
      setKeyboardInset(viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0);
      setViewportHeight(viewport?.height ?? window.innerHeight);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !mobileToolbar.current?.contains(target) && !menuRef.current?.contains(target) && !(target instanceof Element && target.closest('dialog, .selection-popover'))) setActiveBlock(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('pointerdown', outside);
    };
  }, [mobile]);
  function activateBlock(target: EventTarget) {
    if (!mobile || !(target instanceof Element)) return;
    const row = target.closest<HTMLElement>('[data-block-id]');
    const group = target.closest<HTMLElement>('[data-block-group-id]');
    if (group?.dataset.semanticKind === 'ai-explanation' || !row) {
      if (group) setActiveBlock({id: group.dataset.blockGroupId!, group: true});
    } else setActiveBlock({id: row.dataset.blockId!, group: false});
  }
  const creationFocusConsumed=useRef(false);
  useLayoutEffect(()=>{
    if(!props.focusNewBody||creationFocusConsumed.current)return;
    const first=blocks[0];
    const el=first?.type==='paragraph'?elements.current.get(first.id):null;
    if(!el)return;
    creationFocusConsumed.current=true;
    el.focus({preventScroll:true});
    const range=document.createRange();
    range.selectNodeContents(el);range.collapse(true);
    const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
    props.onCreationFocusConsumed?.();
  },[props.focusNewBody,props.onCreationFocusConsumed,blocks]);
  const focusTarget = useRef<{id: string; start: boolean; offset?: number} | null>(null);
  useLayoutEffect(() => {
    const target = focusTarget.current; if (!target) return;
    const el = elements.current.get(target.id); if (!el) return; focusTarget.current = null;
    if(target.offset !== undefined && el.isContentEditable) {setEditorCaret(el,target.offset); return;}
    el.focus(); if(!el.isContentEditable) {el.querySelector('textarea')?.focus(); return;} const range = document.createRange(); range.selectNodeContents(el); range.collapse(target.start); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
  }, [blocks]);
  useEffect(() => {
    const restore = () => {
      closeWritingReview();
      setMenu(null); setMathTarget(null); setCitationTarget(null); setLinkedDeletion([]); focusTarget.current = null;
    };
    document.addEventListener('noema:history-restore', restore);
    return () => document.removeEventListener('noema:history-restore', restore);
  }, []);
  useEffect(() => {
    if (!root.current) return;
    return installBlockSelection(root.current, {
      blocks: () => latest.current.blocks, entities: () => latest.current.entities,
      commit: (blocks, focus) => { setMenu(null); focusTarget.current = {...focus, start: false}; latest.current.onChange(blocks); latest.current = {...latest.current, blocks}; },
      clipboard: data => {const {blocks, images} = clipboardContent(data); importClipboardImages(images); return blocks.map(block => block.type === 'image' ? {...block, type:'divider'} : block);},
    });
  }, []);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    if (!root.current) return;
    return installBlockDrag(root.current, {
      blocks: () => latest.current.blocks,
      commit: blocks => latest.current.onChange(blocks),
      preview: drop => {if (drop) setMenu(null);},
      announce: announceDrag,
    });
  }, []);
  useEffect(()=>{
    const editor=root.current;if(!editor)return;
    const beforeInput=(event:InputEvent)=>{
      if(!event.cancelable||event.isComposing)return;
      if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph'){
        const host=(event.target as Element).closest<HTMLElement>('.block-content[contenteditable="true"]');
        const id=host?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
        const block=latest.current.blocks.find(block=>block.id===id);
        if(host&&block){event.preventDefault();event.stopPropagation();splitBlockRef.current(host,block);return;}
      }
      const direction=event.inputType==='deleteContentBackward'?'backward':event.inputType==='deleteContentForward'?'forward':null;
      if(direction&&deleteEditorReference(editor,event.target,direction)){
        event.preventDefault();event.stopPropagation();commitSelection();
      }
    };
    editor.addEventListener('beforeinput',beforeInput);
    return()=>editor.removeEventListener('beforeinput',beforeInput);
  },[]);
  function commitSelection() {
    const list = latest.current.blocks.map(block => {
      const row = root.current?.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
      if (!row || block.type === 'image' || block.type === 'math') return block;
      const editors = Array.from(row.querySelectorAll<HTMLElement>('.block-content[contenteditable="true"]'));
      if (block.type === 'table' || block.type === 'columns') {
        let index = 0;
        return {...block, rows: block.rows?.map(cells => cells.map(content => {
          const el = editors[index++]; return el ? readSegments(el) : content;
        }))};
      }
      if(!editors[0])return block;
      const content=readSegments(editors[0]);
      return segmentsEqual(content,block.content)?block:{...block,content};
    });
    setMenu(null); latest.current.onChange(list);
    return list;
  }
  async function explain(ids?: string[]) {
    if(explanationPending.current || !latest.current.onExplain) return;
    const requestedIds=ids ?? (root.current ? selectedEditorBlocks(root.current)?.elements.map(el=>el.dataset.blockId!) : undefined);
    if(!requestedIds?.length) return;
    const draft=commitSelection(), selected=aiExplanationSources(draft,requestedIds);
    if(!selected.length) return;
    const selectedIds=selected.map(block=>block.id);
    const snapshot=JSON.stringify(selected);
    setExplanationAnchor({ids:selectedIds,index:explanationInsertionIndex(draft,selectedIds)});
    retryExplanation.current=selectedIds;explanationPending.current=true;setExplaining(true);setExplanationError('');
    try {
      const previous=aiExplanationsForSources(draft,selectedIds)[0]?.semanticGroup?.persona;
      const identity=explanationPersona.current?{id:explanationPersona.current}:previous;
      explanationPersona.current='';
      const result=await latest.current.onExplain(selected,identity);
      const markdown=typeof result==='string'?result:result.markdown;
      const persona=typeof result==='string'?undefined:result.persona;
      if(!mounted.current) return;
      const current=latest.current.blocks, sources=aiExplanationSources(current,selectedIds);
      if(JSON.stringify(sources)!==snapshot) throw new Error('The selected blocks changed. Select them again to generate a fresh explanation.');
      const excerpt=selected.map(block=>block.type==='image'?block.alt||'Image':((block.type==='table'||block.type==='columns')?(block.rows??[]).flat(2):block.content).map(segment=>segment.entityId?segment.mentionText??entityMentionName(latest.current.entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'').join('')).join('\n\n').slice(0,2000);
      const group={...(persona?{persona}:{}),id:randomUUID(),kind:'ai-explanation' as const,source:{blockIds:selected.map(block=>block.id),excerpt}};
      const column=sources.at(-1)?.column;
      const generated=markdownBlocks(markdown).map(block=>({...block,column,semantic:'ai-explanation' as const,semanticGroup:group}));
      if(!markdown.trim() || !generated.length) throw new Error('AI returned an empty explanation. Please try again.');
      const replaced=new Set(aiExplanationsForSources(current,selectedIds).map(block=>block.id));
      if(generated.length>128 || current.length-replaced.size+generated.length>2000) throw new Error('The explanation is too large for this page. Select fewer blocks.');
      // Insert after the last selected parent, so an existing group is never fragmented.
      const next=current.filter(block=>!replaced.has(block.id));
      const index=explanationInsertionIndex(next,selectedIds);
      next.splice(index+1,0,...generated);latest.current.onChange(next);
    } catch(error) {if(mounted.current)setExplanationError(error instanceof Error?error.message:'Could not explain these blocks.');}
    finally {explanationPending.current=false;if(mounted.current)setExplaining(false);}
  }
  function explainLabel(ids: string[]) {
    const sources=aiExplanationSources(latest.current.blocks,ids);
    return aiExplanationsForSources(latest.current.blocks,sources.map(block=>block.id)).length ? uiText('Regenerate AI explanation') : uiText('Explain with AI');
  }
  function explainChoice(ids: string[]): Choice {
    const regenerate=explainLabel(ids)===uiText('Regenerate AI explanation');
    return {title:explaining?uiText("Explaining…"):explainLabel(ids),detail:regenerate?uiText("Replace the existing explanation for the full linked passage"):uiText("Add an explanation below these blocks"),icon:'sparkles',pick:()=>{setMenu(null);void explain(ids);}};
  }
  function editInlineMath(node: HTMLElement) {
    const range = document.createRange(); range.selectNode(node);
    setMathTarget({range, initial: node.dataset.math ?? '', node});
  }
  function inlineMathHost() {
    if(!mathTarget)return;
    const container=mathTarget.range.commonAncestorContainer;
    const editor=(container instanceof Element?container:container.parentElement)?.closest<HTMLElement>('.block-content[contenteditable="true"]');
    const id=editor?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    const block=latest.current.blocks.find(block=>block.id===id);
    if(!editor||!root.current?.contains(editor)||!block||isAIExplanation(block)||!['paragraph','heading1','heading2','bullet','numbered','todo','quote'].includes(block.type)||latest.current.blocks.length>1998)return;
    return {editor,block};
  }
  function makeInlineMathDisplay(source:string) {
    const host=inlineMathHost();
    if(!mathTarget||!host||!source.trim()){setMathTarget(null);return;}
    const {range,node,initial}=mathTarget,{editor,block}=host;
    if(node?!node.isConnected||node.dataset.math!==initial:range.toString()!==initial){setMathTarget(null);return;}
    const before=range.cloneRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);
    const after=range.cloneRange();after.selectNodeContents(editor);after.setStart(range.endContainer,range.endOffset);
    const head=document.createElement('div'),tail=document.createElement('div');head.append(before.cloneContents());tail.append(after.cloneContents());
    const prefix=readSegments(head),suffix=readSegments(tail);
    const hasContent=(segments:Segment[])=>segments.some(segment=>segment.entityId||segment.math||segment.sourceReference||segment.text?.replace(/\u200b/g,'').trim());
    const hasPrefix=hasContent(prefix),hasSuffix=hasContent(suffix);
    const equation:Block={...makeBlock('math',[{text:source.trim()}]),column:block.column,semantic:block.semantic,semanticGroup:block.semanticGroup,...(!hasPrefix&&!hasSuffix?{id:block.id}:{})};
    const replacement:Block[]=[];
    if(hasPrefix)replacement.push({...block,content:prefix});
    replacement.push(equation);
    if(hasSuffix)replacement.push({...block,id:hasPrefix?randomUUID():block.id,content:suffix});
    const draft=commitSelection(),index=draft.findIndex(item=>item.id===block.id);
    if(index<0)return;
    draft.splice(index,1,...replacement);
    setMathTarget(null);focusTarget.current={id:equation.id,start:false};onChange(draft);
  }
  function saveInlineMath(source: string,restoreFocus=true) {
    if (!mathTarget || !root.current?.contains(mathTarget.range.commonAncestorContainer)) {setMathTarget(null); return;}
    const {range, node, initial} = mathTarget;
    if (node ? !node.isConnected || node.dataset.math !== initial : range.toString() !== initial) {setMathTarget(null); return;}
    range.deleteContents(); const math = mathElement(source); range.insertNode(math);
    const spacer = document.createTextNode('\u200b'); math.after(spacer);
    range.setStart(spacer, 1); range.collapse(true);
    const el = math.closest<HTMLElement>('.block-content');
    setMathTarget(null);
    if(restoreFocus){el?.focus();getSelection()?.removeAllRanges();getSelection()?.addRange(range);}
    commitSelection();
  }
  function chooseImages(after?: string, replace?: Block) {
    setMenu(null); imageTarget.current = {after, replace}; fileInput.current?.click();
  }
  function addImages(files: File[], target: {after?: string; replace?: Block; featured?: boolean}) {
    if (!files.length) return;
    const featurePastedImage=!!target.featured;
    const id=randomUUID(), autoCompress=readImageCompression();
    setImageError('');
    setUploads(items => [...items,{id,after:target.after,name:files[0]!.name,message:'Waiting to save…',current:1,total:files.length}]);
    const progress=(patch:Partial<ImageUpload>) => {if(mounted.current) setUploads(items => items.map(item => item.id === id ? {...item,...patch} : item));};
    uploadQueue.current = uploadQueue.current.then(async () => {
      let after=target.after;
      try {
        for (const [index,file] of files.entries()) {
          if(!mounted.current) return;
          progress({name:file.name,current:index+1,message:autoCompress ? 'Optimizing image…' : 'Preparing original image…'});
          // Yield to render the loading card before decoding a large clipboard image.
          await new Promise<void>(resolve => setTimeout(resolve,0));
          const prepared=autoCompress ? await compressImage(file) : file;
          if(!mounted.current) return;
          progress({message:'Saving to your vault…'});
          const image = await uploadImage(props.vaultId,prepared);
          if(!mounted.current) return;
          const source=latest.current.blocks.find(block=>block.id===after);
          const parent=source?.semanticGroup;
          const block: Block = {...makeBlock('image'),column:source?.column,...(parent?{semanticGroup:parent}:{}), imageId:image.id, alt:''};
          const list = [...latest.current.blocks];
          const position = after ? list.findIndex(b => b.id === after) : list.length - 1;
          const replace = target.replace && list[position] && JSON.stringify(list[position]) === JSON.stringify(target.replace);
          const trailing = {...makeBlock(),column:source?.column,...(parent?{semanticGroup:parent}:{})};
          list.splice(Math.max(0,position + (replace ? 0 : 1)),replace ? 1 : 0,block,trailing);
          focusTarget.current = {id:trailing.id,start:true};
          latest.current.onChange(list, featurePastedImage && index===0 ? image.id : undefined);
          latest.current = {...latest.current, blocks:list};
          after = block.id; target = {after}; progress({after});
        }
      } catch(error) { if(mounted.current) setImageError(error instanceof Error ? error.message : 'Image upload failed'); }
      finally { if(mounted.current) setUploads(items => items.filter(item => item.id !== id)); }
    });
  }
  function importClipboardImages(images: ClipboardImage[]) {
    if (!images.length) return;
    for (const image of images) pendingClipboardImages.current.add(image.block.id);
    const id = randomUUID(), autoCompress = readImageCompression();
    setImageError('');
    setUploads(items => [...items, {id, name:'Pasted image', message:'Saving to your vault…', current:1, total:images.length}]);
    uploadQueue.current = uploadQueue.current.then(async () => {
      try {
        for (const [index, item] of images.entries()) {
          if (!mounted.current) return;
          setUploads(items => items.map(upload => upload.id === id ? {...upload, current:index+1} : upload));
          try {
            let file = item.file;
            if (!file) {
              const url = new URL(item.source, window.location.href);
              if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('This clipboard image is not accessible. Copy the image itself and paste it again.');
              if (['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin) {
                file = await fetchClipboardImage(props.vaultId, url.href);
              } else {
                const response = await fetch(url.href, {credentials:'same-origin'});
                if (!response.ok) throw new Error('Could not read a clipboard image. Copy the image itself and paste it again.');
                const blob = await response.blob();
                if (!blob.type.startsWith('image/')) throw new Error('The clipboard image could not be read as an image.');
                file = new File([blob], 'pasted-image', {type:blob.type});
              }
            }
            if (file.size > 20 * 1024 * 1024) throw new Error('Images must be 20 MB or smaller');
            const prepared = autoCompress ? await compressImage(file) : file;
            if (!mounted.current) return;
            const image = await uploadImage(props.vaultId, prepared);
            if (!mounted.current) return;
            const patch = {type:'image' as const, imageId:image.id, alt:item.block.alt};
            root.current?.dispatchEvent(new CustomEvent('noema:clipboard-image-resolved', {bubbles:true, detail:{id:item.block.id, patch}}));
            if (!latest.current.blocks.some(block => block.id === item.block.id && block.type === 'divider')) continue;
            const list = latest.current.blocks.map(block => block.id === item.block.id && block.type === 'divider' ? {...block, ...patch} : block);
            latest.current.onChange(list);
            latest.current = {...latest.current, blocks:list};
          } catch (error) {
            if (!mounted.current) return;
            setImageError(error instanceof Error ? error.message : 'Image upload failed');
            root.current?.dispatchEvent(new CustomEvent('noema:clipboard-image-resolved', {bubbles:true, detail:{id:item.block.id, patch:null}}));
            if (!latest.current.blocks.some(block => block.id === item.block.id && block.type === 'divider')) continue;
            const list = latest.current.blocks.filter(block => block.id !== item.block.id || block.type !== 'divider');
            if (!list.length) list.push(makeBlock());
            latest.current.onChange(list);
            latest.current = {...latest.current, blocks:list};
          }
        }
      } finally {
        for (const image of images) pendingClipboardImages.current.delete(image.block.id);
        if (mounted.current) setUploads(items => items.filter(item => item.id !== id));
      }
    });
  }
  function uploadCards(after?: string) {
    return uploads.filter(item => after ? item.after === after : !item.after || !blocks.some(block => block.id === item.after)).map(item =>
      <div key={item.id} className="image-upload-card" role="status" aria-live="polite" aria-busy="true">
        <span className="image-upload-spinner" aria-hidden="true"/>
        <div><strong>{item.message}</strong><span>{item.name || uiText("Pasted image")}{item.total > 1 ? uiText(" · {value0} of {value1}",{value0: item.current,value1: item.total}) : ''}</span></div>
        <div className="image-upload-track" aria-hidden="true"><span/></div>
      </div>);
  }
  function imageChoice(after?: string, replace?: Block): Choice {
    return {title:uiText("Image"), detail:uiText("Upload an image from your device"), icon:'image', pick:() => chooseImages(after,replace)};
  }

  function tagSelection(kind: SemanticKind) {
    if (!root.current) return;
    const selected=selectedEditorBlocks(root.current);if (!selected) return;
    const ids=selected.elements.map(el=>el.dataset.blockId!);
    focusTarget.current={id:ids[0]!,start:true};onChange(applySemantic(latest.current.blocks,ids,kind));
  }
  function semanticChoices(pick: (kind: SemanticKind) => void): Choice[] {return editableSemanticKinds.map(kind=>({title:uiText(semanticFunctions[kind].label),detail:uiText(semanticFunctions[kind].description),icon:semanticFunctions[kind].icon,color:semanticFunctions[kind].color,pick:()=>{setMenu(null);pick(kind);}}));}
  function movementChoices(id: string): Choice[] {
    const list = latest.current.blocks, block = list.find(item => item.id === id);
    const items = block?.semanticGroup ? semanticDragItems(list, id) : semanticRuns(list).map(run => ({id: run.id}));
    const index = items.findIndex(item => item.id === id);
    return ([-1, 1] as const).map(direction => ({
      title: direction === -1 ? uiText("Move up") : uiText("Move down"), icon: direction === -1 ? 'arrow-up' : 'arrow-down',
      disabled: index < 0 || index + direction < 0 || index + direction >= items.length,
      pick: () => {
        if (index < 0 || index + direction < 0 || index + direction >= items.length) return;
        const before = direction === -1 ? items[index - 1]!.id : items[index + 2]?.id ?? null;
        setMenu(null); onChange(reorderBlock(latest.current.blocks, id, before));
        announceDrag(`Block moved ${direction === -1 ? 'up' : 'down'}.`);
      },
    }));
  }
  function blockOptionsFor(block?: Block) {return options.filter(option => !block?.column || allowedInColumn(option.type));}
  function blockOptions(anchor: HTMLElement, block: Block) {
    const selection=root.current ? selectedEditorBlocks(root.current)?.elements.map(el=>el.dataset.blockId!) : undefined;
    const ids=selection?.includes(block.id)?selection:[block.id];
    const back: Choice = {title:uiText("Back to block actions"),icon:'arrow-left',submenu:true,back:true,pick:()=>blockOptions(anchor,block)};
    show(anchor, [
      {get title(){return uiText("Format")},detail:uiText("Text, headings, lists, and other block formats"),icon:'text',submenu:true,pick:()=>show(anchor,[back,...blockOptionsFor(block).map(option=>({...option,pick:()=>convert(block,option.type)})),imageChoice(block.id,block),...(mobile?movementChoices(block.id):[])],'FORMAT',true)},
      ...(!isAIExplanation(block) ? [{get title(){return uiText("Turn into")},detail:block.semantic?semanticFunctions[block.semantic].label:uiText("Choose a semantic block"),icon:'semantic',submenu:true,
        pick:()=>show(anchor,[back,...semanticChoices(kind=>onChange(applySemantic(latest.current.blocks,ids,kind))),...(block.semantic?[{title:uiText("Remove semantic function"),icon:'close',pick:()=>{setMenu(null);update(block.id,{semantic:undefined});}}]:[]),...(mobile&&block.semanticGroup?[{get title(){return uiText("Group actions")},icon:'semantic',submenu:true,pick:()=>{setActiveBlock({id:block.semanticGroup!.id,group:true});groupOptions(anchor,block.semanticGroup!.id);}}]:[])],'TURN INTO SEMANTIC BLOCK', true)}] : []),
      ...(props.onExplain&&aiExplanationSources(latest.current.blocks,ids).length?[aiActionChoice(anchor,ids,back)]:[]),
      ...speakChoice(ids),
      {title:uiText("Delete block"),icon:'trash',danger:true,pick:()=>removeBlock(block.id)},
    ], 'BLOCK OPTIONS', true);
  }
  function speakChoice(ids:string[]):Choice[] {
    return speech.enabled?[{title:uiText("Speak"),detail:uiText("Read aloud with an AI-generated voice"),icon:'speaker',pick:()=>readBlocks(ids)}]:[];
  }
  function readSelection() {
    if (!root.current) return;
    const selected = editorSelectionBlocks(root.current, latest.current.blocks);
    if (selected.length) readBlocks(selected.map(block => block.id), selected);
  }
  function readBlocks(ids:string[], projection?:Block[]) {
    const draft=commitSelection(),selected=new Set(ids);
    // The pre-play validator can run before React echoes this explicit commit.
    latest.current={...latest.current,blocks:draft};
    const selectedBlocks=draft.filter(block=>selected.has(block.id));
    speechSources.current=new Map(selectedBlocks.map(block=>[block.id,{source:JSON.stringify(block),projection:speechText([block],[block.id],entities)}]));
    speechSelection.current=(root.current?speechSelectionContext(root.current):null)??(selectedBlocks.length?JSON.stringify([selectedBlocks[0]!.id,selectedBlocks.at(-1)!.id]):null);
    const narration = projection ?? draft;
    setMenu(null);speech.speak(speechText(narration,ids,entities),speechSections(narration,ids,entities),validSpeechSource);
  }
  function aiActionChoice(anchor: HTMLElement, ids: string[], back: Choice): Choice {
    return {get title(){return uiText("AI actions")},icon:'sparkles',submenu:true,pick:()=>show(anchor,[back,...(props.onReview?[{title:reviewPending.current?uiText("Reviewing…"):uiText("Review with AI"),detail:uiText("Suggest spelling, punctuation, grammar, and phrasing corrections"),icon:'sparkles',disabled:reviewPending.current,pick:()=>void reviewWriting(ids)}]:[]),{title:'Explanation persona · '+personaMetadata(explanationPersona.current||aiExplanationsForSources(latest.current.blocks,ids)[0]?.semanticGroup?.persona?.id||defaultExplanationPersona).name,icon:'sparkles',submenu:true,pick:()=>show(anchor,[back,...[{id:'',name:'Default / original'},...aiPersonas].map(p=>({title:p.name,icon:'sparkles',submenu:true,pick:()=>{explanationPersona.current=p.id;aiActionChoice(anchor,ids,back).pick();}}))],'AI PERSONA',true)},explainChoice(ids)],'AI ACTIONS',true)};
  }
  function groupOptions(anchor: HTMLElement, id: string) {
    const children=latest.current.blocks.filter(block=>block.semanticGroup?.id===id || block.id===id && isAIExplanation(block)),locked=children.some(isAIExplanation);
    const back: Choice = {title:uiText("Back to group actions"),icon:'arrow-left',submenu:true,back:true,pick:()=>groupOptions(anchor,id)};
    show(anchor,[...(props.onExplain&&aiExplanationSources(latest.current.blocks,children.map(block=>block.id)).length?[aiActionChoice(anchor,children.map(block=>block.id),back)]:[]),...speakChoice(children.map(block=>block.id)),...(mobile?movementChoices(id):[]),...(!locked?[...semanticChoices(kind=>onChange(retagSemanticGroup(latest.current.blocks,id,kind))),{title:uiText("Ungroup blocks"),detail:uiText("Keep all child blocks"),icon:'close',pick:()=>{setMenu(null);onChange(removeSemanticGroup(latest.current.blocks,id));}}]:[{get title(){return uiText("Delete explanation")},danger:true,detail:uiText("Remove this explanation and its subblocks"),icon:'close',pick:()=>{setMenu(null);const rest=latest.current.blocks.filter(block=>block.semanticGroup?.id!==id && block.id!==id);onChange(rest.length?rest:[makeBlock()]);}}])],'SEMANTIC GROUP', true);
  }
  function update(id: string, patch: Partial<Block>) { onChange(latest.current.blocks.map(b => b.id === id ? {...b, ...patch} : b)); }
  function convertMathToInline(id:string,placement:MathInlinePlacement) {
    const draft=commitSelection(),result=inlineMathBlock(draft,id,placement);
    if(!result)return;
    focusTarget.current={id:result.targetId,start:placement==='next'};
    onChange(result.blocks);
  }
  function removeBlock(id: string) {
    setMenu(null);
    const list=latest.current.blocks, index=list.findIndex(block => block.id === id);
    if(index < 0) return;
    if(list.length === 1) {
      focusTarget.current={id,start:true};
      onChange([{...makeBlock(),id,column:list[index]!.column}]);
    } else {
      focusTarget.current={id:list[index > 0 ? index-1 : index+1]!.id,start:false};
      onChange(list.filter(block => block.id !== id));
    }
  }
  function insert(after: string | undefined, type: BlockType = 'paragraph', content: Segment[] = [], outsideGroup = false) {
    const source=latest.current.blocks.find(block=>block.id===after);
    if (source?.column && !allowedInColumn(type)) return;
    const parent=outsideGroup ? undefined : source?.semanticGroup;
    const next = {...makeBlock(type, content),column:source?.column,...(parent?{semanticGroup:parent}:{})}, list = [...latest.current.blocks];
    list.splice(after ? list.findIndex(b => b.id === after) + 1 : list.length, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
  }
  function convert(block: Block, type: BlockType, clear = false) {
    if (block.column && !allowedInColumn(type)) {setMenu(null); return;}
    if (block.type === type && !clear) {setMenu(null); return;}
    if (type === 'code') {
      const content = clear ? [] : [{text: ((block.type === 'table' || block.type === 'columns') ? (block.rows ?? []).map(row => row.map(cell => cell.map(segment => segment.entityId ? entityMentionName(entities.find(entity => entity.id === segment.entityId)) ?? '' : segment.text ?? '').join('')).join('\t')).join('\n') : block.content.map(segment => segment.entityId ? segment.mentionText ?? entityMentionName(entities.find(entity => entity.id === segment.entityId)) ?? '' : segment.text ?? '').join(''))}];
      setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type, content, rows: undefined}); return;
    }
    if (type === 'divider') clear = true;
    const content = clear ? [] : (block.type === 'table' || block.type === 'columns')
      ? (block.rows ?? []).flatMap((row, index) => [...(index ? [{text: '\n'}] : []), ...row.flatMap((cell, col) => [...(col ? [{text: '\t'}] : []), ...cell])])
      : block.content;
    const rows = type === 'columns' ? [[content, []]] : type === 'table' ? (!clear ? block.rows : undefined) ?? [[content, []], [[], []]] : undefined;
    setMenu(null); focusTarget.current = {id: block.id, start: false};
    update(block.id, {type, content: type === 'columns' ? [] : content, rows, checked: false, imageId: undefined, alt: undefined});
  }

  function show(el: HTMLElement, items: Choice[], label: string, sheet = false, anchor?:Range) {
    if (!items.length) { setMenu(null); return; } const box = el.getBoundingClientRect();
    setMenu({items, index: 0, left: Math.max(8, Math.min(box.left, innerWidth - 248)), top: Math.max(8, Math.min(box.bottom + 5, innerHeight - 370)), label, sheet, anchor, anchorElement:anchor?el:undefined});
  }
  function addBelow(anchor: HTMLElement, after: string) {
    show(anchor, [...blockOptionsFor(latest.current.blocks.find(block => block.id === after)).map(option => ({...option, pick: () => { setMenu(null); insert(after, option.type); }})), imageChoice(after)], 'ADD BLOCK BELOW', true);
  }
  const active = activeBlock && (activeBlock.group
    ? blocks.some(block => block.semanticGroup?.id === activeBlock.id || block.id === activeBlock.id)
    : blocks.some(block => block.id === activeBlock.id)) ? activeBlock : null;
  const currentBlock = active && !active.group ? blocks.find(block => block.id === active.id) : undefined;
  const linkedExplanations = linkedDeletion.filter(id => blocks.some(block => isAIExplanation(block) && block.semanticGroup?.id === id));
  function deleteLinkedExplanations() {
    const ids = new Set(linkedExplanations), current = latest.current.blocks;
    const rest = current.filter(block => !isAIExplanation(block) || !block.semanticGroup || !ids.has(block.semanticGroup.id));
    const next = rest.length ? rest : [makeBlock()];
    setLinkedDeletion([]);
    const firstDeleted = current.findIndex(block => block.semanticGroup && ids.has(block.semanticGroup.id));
    const target = next[Math.max(0, Math.min(firstDeleted - 1, next.length - 1))]!;
    focusTarget.current = {id:target.id,start:false};
    latest.current.onChange(next);
  }
  const activeLabel = currentBlock ? options.find(option => option.type === currentBlock.type)?.title ?? 'Image' : 'Group';
  function menuChoices(sheet = false) {
    return menu?.items.map((item, index) => <button key={index} type="button" role={sheet ? undefined : 'menuitem'} disabled={item.disabled} className={[(index === menu.index && !sheet ? 'highlight' : ''),item.danger?'is-danger':''].filter(Boolean).join(' ')} onClick={event => {
      // Release modal focus before an action focuses a new or converted block.
      if (sheet && !item.submenu) event.currentTarget.closest('dialog')?.close();
      item.pick();
    }}><span className="menu-icon" aria-hidden="true" style={item.color?{color:item.color}:undefined}><Icon name={item.icon}/></span><span>{item.icon==='page'?<TitleText text={item.title}/>:item.title}{item.detail&&<small>{item.detail}</small>}</span>{item.submenu&&!item.back&&<span className="menu-submenu-arrow" aria-hidden="true"><Icon name="chevron"/></span>}</button>);
  }
  function insertMention(range: Range, id: string, blockId: string) {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || !root.current?.contains(range.commonAncestorContainer)) throw new Error('The insertion point changed. Select text again to link the created entity.');
    range.deleteContents(); const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: id}], latest.current.entities); const mention = wrapper.firstChild!;
    range.insertNode(mention); const space = document.createTextNode(' '); mention.after(space); range.setStartAfter(space); range.collapse(true);
    const el = elements.current.get(blockId); el?.focus(); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    if (el) update(blockId, {content: readSegments(el)}); setMenu(null);
  }
  function openPageLink(anchor:HTMLElement) {
    const title=anchor.dataset.pageTitle!;
    const matches=(latest.current.pages??[]).filter(page=>pageTitleKey(page.title)===pageTitleKey(title));
    if(matches.length===1 && latest.current.onOpenPage) {setPageLinkStatus('');latest.current.onOpenPage(matches[0]!.id);}
    else if(matches.length>1)show(anchor,matches.map(page=>({title:page.title,detail:(page.archived_at?'Archived · ':'')+'Updated '+new Date(page.updated_at).toLocaleString(getLocale()),icon:'page',pick:()=>{setMenu(null);latest.current.onOpenPage?.(page.id);}})),'CHOOSE NOTE');
    else setPageLinkStatus('Note “'+title+'” was not found in this vault.');
  }
  function insertPageLink(range:Range,title:string,alias:string|undefined,blockId:string) {
    if(!range.startContainer.isConnected)return;
    range.deleteContents();
    const source='[['+title+(alias?.trim()?'|'+alias.trim():'')+']]';
    const wrapper=document.createElement('div');wrapper.innerHTML=segmentHTML([{text:source}],latest.current.entities);
    const fragment=document.createDocumentFragment();while(wrapper.firstChild)fragment.append(wrapper.firstChild);
    const last=fragment.lastChild!;range.insertNode(fragment);
    const space=document.createTextNode(' ');last.after(space);range.setStartAfter(space);range.collapse(true);
    const el=elements.current.get(blockId);el?.focus();getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    if(el)update(blockId,{content:readSegments(el)});setMenu(null);
  }
  function closeCitation(restoreFocus=false) {
    const range=citationTarget?resolveCitationRange(citationTarget.editor,citationTarget.bookmark):null;
    if(restoreFocus&&range&&citationTarget){
      range.collapse(false);
      citationTarget.editor.focus({preventScroll:true});getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    }
    setCitationTarget(null);
  }
  function insertCitations(references:SourceReference[]) {
    if(!citationTarget)return;
    const {bookmark,editor,blockId}=citationTarget;
    const range=resolveCitationRange(editor,bookmark);
    if(!range||!latest.current.blocks.some(block=>block.id===blockId)){setCitationTarget(null);setPageLinkStatus('The insertion text changed. Type /cite again to choose a new position.');return;}
    range.deleteContents();
    const wrapper=document.createElement('div');
    wrapper.innerHTML=segmentHTML(references.flatMap(sourceReference=>[{text:' [ref]',sourceReference},{text:citationSpace}]),latest.current.entities);
    const fragment=document.createDocumentFragment();while(wrapper.firstChild)fragment.append(wrapper.firstChild);
    const last=fragment.lastChild!;range.insertNode(fragment);range.selectNodeContents(last);range.collapse(false);
    editor.focus({preventScroll:true});getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    update(blockId,{content:readSegments(editor)});setCitationTarget(null);
  }
  function detect(el: HTMLElement, block: Block) {
    const selection = getSelection(); if (!selection?.rangeCount) { setMenu(null); return; }
    const range = selection.getRangeAt(0); if (!el.contains(range.startContainer)) { setMenu(null); return; }
    if(!selection.isCollapsed){setMenu(null);return;}
    const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
    const cite=before.toString().match(/(?:^|\s)\/(cite|cit|ci|c|)$/i);
    let citeChoice:Choice[]=[];
    if(cite&&range.startContainer.nodeType===Node.TEXT_NODE&&!range.startContainer.parentElement?.closest('code,a,[data-math],[data-entity]')) {
      const start=range.startOffset-cite[1]!.length-1;
      if(start>=0){
        const saved=range.cloneRange();saved.setStart(range.startContainer,start);
        const bookmark=bookmarkCitationRange(el,saved);
        citeChoice=[{title:uiText("Cite"),detail:uiText("Add a source, section, or citation range"),icon:'source',pick:()=>{setMenu(null);setCitationTarget({bookmark,editor:el,blockId:block.id});}}];
      }
    }
    if (/^\/[^\n]*$/.test(el.textContent || '')) {
      const query = el.textContent!.slice(1).toLowerCase(); show(el, [...blockOptionsFor(block).filter(o => o.title.toLowerCase().includes(query)).map(o => ({...o, pick: () => convert(block, o.type, true)})), ...citeChoice,...editableSemanticKinds.filter(kind=>kind.includes(query)).map(kind=>({title:semanticFunctions[kind].label,get detail(){return uiText("Semantic function")},icon:semanticFunctions[kind].icon,color:semanticFunctions[kind].color,pick:()=>{setMenu(null);update(block.id,{semantic:kind,content:[]});}})), ...('image'.includes(query) ? [imageChoice(block.id, block)] : [])], 'TURN INTO',false,range.cloneRange()); return;
    }
    if(citeChoice.length){show(el,citeChoice,'CITATION',false,range.cloneRange());return;}
    const wiki=before.toString().match(/\[\[([^\[\]\n]*)$/);
    if(wiki && range.startContainer.nodeType===Node.TEXT_NODE && !(range.startContainer.parentElement?.closest('code,a,[data-math],[data-entity]'))) {
      const start=range.startOffset-wiki[0].length;
      if(start>=0) {
        const [query,...alias]=wiki[1]!.split('|'),saved=range.cloneRange();saved.setStart(range.startContainer,start);
        const pages=(latest.current.pages??[]).filter(page=>!/[\[\]\n|]/.test(page.title)&&page.title.toLocaleLowerCase().includes(query!.trim().toLocaleLowerCase())).slice(0,8);
        show(el,pages.map(page=>({title:page.title,detail:alias.length?'Display as '+alias.join('|'):uiText("Link to note"),icon:'page',pick:()=>insertPageLink(saved,page.title,alias.length?alias.join('|'):undefined,block.id)})),'LINK A NOTE');return;
      }
    }
    const match = before.toString().match(/(?:^|\s)@([^@\n]*)$/);
    if (match && range.startContainer.nodeType === Node.TEXT_NODE) {
      const query = match[1]!, start = range.startOffset - query.length - 1; if (start < 0) { setMenu(null); return; }
      const saved = range.cloneRange(); saved.setStart(range.startContainer, start);
      const matches=mentionMatches(latest.current.entities.filter(entity=>entity.vault_id===props.vaultId),query,{priorityIds:suggestionPriorityIds});
      const showMatches=(limit=3)=>{
        const items:Choice[]=matches.slice(0,limit).map(entity=>{
          const subtype=entity.subtypes.map(id=>schema.subtypes.find(subtype=>subtype.id===id&&subtype.type===entity.type)?.name).find(Boolean);
          return {title:entity.name,detail:[entityLabels[entity.type],subtype,entity.description].filter(Boolean).join(' · '),icon:entityIconName(entity),pick:()=>insertMention(saved,entity.id,block.id)};
        });
        if(matches.length>limit)items.push({title:`Show more (${matches.length-limit})`,icon:'chevron',pick:()=>showMatches(limit+10)});
        items.push({title:query?`Create and insert “${query}”`:uiText("Create and insert an entity"),icon:'plus',pick:()=>{const text=saved.toString(),caret=range.cloneRange();setMenu(null);onCreateEntity(query,id=>{if(saved.toString()!==text)throw new Error('Entity created, but the insertion text changed. Select text again to link it.');insertMention(saved,id,block.id);},()=>{if(caret.startContainer.isConnected&&root.current?.contains(caret.commonAncestorContainer)){el.focus();getSelection()?.removeAllRanges();getSelection()?.addRange(caret);}});}});
        show(el,items,'LINK AN ENTITY',false,range.cloneRange());
        if(limit>3)setMenu(current=>current?{...current,index:limit-10}:current);
      };
      showMatches();return;
    }
    setMenu(null);
  }
  function paste(e: ClipboardEvent<HTMLElement>, block: Block) {
    e.preventDefault(); setMenu(null);
    const el = e.currentTarget, selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    const {blocks: pasted, images} = clipboardContent(e.clipboardData);
    // A temporary divider can autosave while the image is being imported.
    const incoming = pasted.map(incoming=>({...incoming, ...(incoming.type === 'image' ? {type:'divider' as const} : {}), column:block.column,...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{}),...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{})}));
    if (pasted.at(-1)?.type === 'image') incoming.push({...makeBlock(), column:block.column, ...(block.semanticGroup ? {semanticGroup:block.semanticGroup} : {})});
    const wasEmpty=!el.textContent?.trim();
    range.deleteContents();
    if (incoming.length === 1 && incoming[0]!.type === 'paragraph') {
      const wrapper = document.createElement('div'); wrapper.innerHTML = segmentHTML(incoming[0]!.content, entities);
      const fragment = document.createDocumentFragment(); while (wrapper.firstChild) fragment.append(wrapper.firstChild);
      const last = fragment.lastChild;
      range.insertNode(fragment); if (last) range.setStartAfter(last); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range); update(block.id, {content: readSegments(el),...(wasEmpty&&incoming[0]!.semantic?{semantic:incoming[0]!.semantic}:{})}); return;
    }
    const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange(); after.selectNodeContents(el); after.setStart(range.endContainer, range.endOffset);
    const head = document.createElement('div'), tail = document.createElement('div'); head.append(before.cloneContents()); tail.append(after.cloneContents());
    const prefix = readSegments(head), suffix = readSegments(tail), replacement: Block[] = [];
    if (incoming[0]!.type === 'paragraph') incoming[0]!.content.unshift(...prefix);
    else if (prefix.length) replacement.push({...block, content: prefix});
    replacement.push(...incoming);
    if (suffix.length) replacement.push({...makeBlock(block.type, suffix),column:block.column,...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{}),...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{})});
    const list = [...latest.current.blocks], index = list.findIndex(b => b.id === block.id);
    list.splice(index, 1, ...replacement); focusTarget.current = {id: replacement.at(-1)!.id, start: !suffix.length ? false : true}; onChange(list);
    latest.current = {...latest.current, blocks:list};
    importClipboardImages(images);
  }
  function keyDown(e: KeyboardEvent<HTMLElement>, block: Block) {
    const el = e.currentTarget;
    if (e.nativeEvent.isComposing) return;
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenu({...menu, index: (menu.index + (e.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length}); return; }
      if (e.key === 'Enter') { e.preventDefault(); menu.items[menu.index]!.pick(); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave(); return; }
    if (e.key === 'Enter') {
      e.preventDefault(); splitBlock(el,block);
    }
    if (e.key === 'Backspace' && !el.textContent && blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
  }
  function splitBlock(el:HTMLElement,block:Block) {
    setMenu(null);
    if(block.type==='table'){insert(block.id);return;}
    if (!el.textContent && ['bullet', 'numbered', 'todo'].includes(block.type)) { convert(block, 'paragraph'); return; }
    const selection = getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); if(!el.contains(range.commonAncestorContainer))return;
    range.deleteContents(); const tail = range.cloneRange(); tail.setEnd(el, el.childNodes.length); const temp = document.createElement('div'); temp.append(tail.extractContents());
    const head=trimTrailingCitationSpace(readSegments(el));
    const tailContent=readSegments(temp);
    const nextContent=head.at(-1)?.sourceReference?trimLeadingCitationSpace(tailContent):tailContent;
    const next: Block = {column:block.column,...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{}),...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{}),id: randomUUID(), type: ['bullet', 'numbered', 'todo'].includes(block.type) ? block.type : 'paragraph', checked: false, content: nextContent};
    const list = latest.current.blocks.map(b => b.id === block.id ? {...b, content: head} : b); list.splice(list.findIndex(b => b.id === block.id) + 1, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
  }
  const liveExplanationIndex=explanationAnchor?explanationInsertionIndex(blocks,explanationAnchor.ids):-1;
  const explanationAnchorIndex=liveExplanationIndex>=0?liveExplanationIndex:Math.min(explanationAnchor?.index??-1,blocks.length-1);
  const explanationAnchorId=blocks[explanationAnchorIndex]?.id;
  const explanationStatus=(explaining||explanationError)?<div className="ai-explanation-placeholder" style={semanticStyle('ai-explanation')}>
    <div className="ai-explanation-label">{uiText("AI Explanation")}</div>
    {explaining?<div className="ai-explanation-status" role="status"><span className="scan-spinner" aria-hidden="true"/>{uiText("Explaining selected blocks…")}</div>:<div className="ai-explanation-status is-error" role="alert"><span>{explanationError}</span><button type="button" onClick={()=>void explain(retryExplanation.current)}>{uiText("Retry")}</button><button type="button" onClick={()=>{setExplanationError('');setExplanationAnchor(null);}}>{uiText("Dismiss")}</button></div>}
  </div>:null;
  function renderWritingReview(blockId:string){
    if(!writingReview)return null;
    const change=writingReview.changes.find(change=>change.blockId===blockId);
    if(!change&&writingReview.anchorId!==blockId)return null;
    // Once suggestions exist, each is rendered only alongside its source block.
    if(!change&&writingReview.changes.length)return null;
    const first=change===writingReview.changes[0];
    return <WritingReview key={`${reviewRequest.current}:${blockId}`} loading={writingReview.loading} error={writingReview.error} change={change} stale={!!change&&JSON.stringify(blocks.find(block=>block.id===blockId)?.content)!==change.snapshot} entities={entities} remaining={first?writingReview.changes.length:0} onAccept={acceptWritingReview} onDismiss={()=>dismissWritingSuggestion(blockId)} onAcceptAll={()=>writingReview.changes.forEach(change=>acceptWritingReview(change))} onClose={closeWritingReview}/>;
  }
  function textInput(block:Block,el:HTMLElement,event:InputEvent) {
      const markdownInput=markdownTyping&&!event.isComposing&&event.inputType==='insertText';
      const shortcut=markdownInput?typedMarkdownBlock(block,el):undefined;
      if(shortcut) {setMenu(null);focusTarget.current={id:block.id,start:false};update(block.id,shortcut);return;}
      const content = readSegments(el);
      const source = markdownInput && block.type === 'paragraph' && content.every(segment => !segment.entityId && !segment.math && !segment.code)
        ? displayMathSource(content.map(segment => segment.text ?? '').join('')) : undefined;
      if (source) { setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type: 'math', content: [{text: source}]}); return; }
      if(markdownInput)completeInlineMath(el); update(block.id, {content: readSegments(el)}); detect(el, block);
  }
  // Stable dispatchers read the current render's closures, so memoized rows never retain
  // stale menus, preferences, entity callbacks or document order.
  const rowHandlers=useRef<TextRowActions>(null!);
  rowHandlers.current={addBelow,options:blockOptions,update,register:(id,el)=>{if(el)elements.current.set(id,el);else elements.current.delete(id);},input:textInput,keyDown,paste,open:onOpenEntity};
  const rowActions=useMemo<TextRowActions>(()=>({
    addBelow:(...args)=>rowHandlers.current.addBelow(...args),options:(...args)=>rowHandlers.current.options(...args),
    update:(...args)=>rowHandlers.current.update(...args),register:(...args)=>rowHandlers.current.register(...args),
    input:(...args)=>rowHandlers.current.input(...args),keyDown:(...args)=>rowHandlers.current.keyDown(...args),
    paste:(...args)=>rowHandlers.current.paste(...args),open:(...args)=>rowHandlers.current.open(...args),
  }),[]);
  const paragraphPositions = useMemo(()=>paragraphFlow(blocks),[blocks]);
  const renderBlock = (block: Block) => isAIExplanation(block) ? <ReadOnlyExplanationBlock key={block.id} block={block} blocks={blocks} entities={entities} onOpen={onOpenEntity} vaultId={props.vaultId}/> : ['paragraph','heading1','heading2','quote','bullet','numbered','todo'].includes(block.type) ? <Fragment key={block.id}><TextBlockRow paragraphPosition={paragraphPositions.get(block.id)} locale={getLocale()} block={block} entities={entities} reviewMatches={reviewsByBlock.get(block.id)??emptyReviewMatches} number={block.type==='numbered'?blockListNumber(blocks,block.id):undefined} actions={rowActions}/>{renderWritingReview(block.id)}{uploadCards(block.id)}</Fragment> : <Fragment key={block.id}><div data-block-id={block.id} data-semantic-kind={block.semantic} style={semanticStyle(block.semantic)} className={'block ' + block.type + (block.semantic ? ' semantic-block' : '')}>
    {block.semantic && <span className="semantic-callout-icon" aria-hidden="true"><Icon name={semanticFunctions[block.semantic].icon}/></span>}
    <div className="block-controls" role="group" aria-label={uiText("Block controls")}>
      <button className="block-add" title={uiText("Add block below")} aria-label={uiText("Add block below")} onClick={e => addBelow(e.currentTarget, block.id)}><Icon name="plus"/></button>
      <button className={'block-handle' + (block.semantic ? ' semantic-handle' : '')} draggable={false} title={(block.semantic ? uiText(semanticFunctions[block.semantic].label)+' · ' : '')+uiText("Drag to move · Click for block options")} aria-label={block.semantic ? uiText(semanticFunctions[block.semantic].label)+uiText(" block options") : uiText("Block options")} aria-describedby="block-drag-help" onClick={e => blockOptions(e.currentTarget,block)}>{semanticGlyph(block.semantic)}</button>
    </div>
    {block.type === 'todo' ? <input type="checkbox" aria-label={uiText("Complete task")} checked={block.checked} onChange={e => update(block.id, {checked: e.target.checked})}/> : block.type === 'bullet' ? <span className="bullet-marker">•</span> : block.type === 'numbered' ? <span className="bullet-marker numbered-marker">{blockListNumber(blocks, block.id)}.</span> : null}
    {pendingClipboardImages.current.has(block.id) && !block.imageId ? <div className="image-block" role="status" aria-label={uiText("Saving image…")}/> : block.type === 'divider' ? <div className="divider-block" ref={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}} tabIndex={0} role="separator" aria-label={uiText("Divider")} onKeyDown={event => {
      if(event.key === 'Enter') {event.preventDefault(); insert(block.id);}
      if(event.key === 'Backspace' || event.key === 'Delete') {event.preventDefault(); removeBlock(block.id);}
      if((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
    }}><hr/></div> : block.type === 'code' ? <div className="code-block" ref={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}} tabIndex={-1}>
      <textarea aria-label={uiText("Code block")} placeholder={uiText("Write code…")} spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={10000} rows={Math.max(3, block.content.map(segment => segment.text ?? '').join('').split('\n').length)} value={block.content.map(segment => segment.text ?? '').join('')} onChange={event => update(block.id, {content: [{text: event.target.value}]})} onKeyDown={event => {
        if(event.nativeEvent.isComposing) return;
        if((event.metaKey || event.ctrlKey) && event.key === 's') {event.preventDefault(); onSave();}
        if((event.metaKey || event.ctrlKey) && event.key === 'Enter') {event.preventDefault(); insert(block.id);}
        if(event.key === 'Tab') {event.preventDefault(); const el=event.currentTarget, start=el.selectionStart; el.setRangeText('  ', start, el.selectionEnd, 'end'); update(block.id, {content: [{text: el.value}]});}
      }}/>
      <small>{uiText("Code · Tab to indent · ⌘/Ctrl+Enter to continue below")}</small>
    </div> : block.type === 'math' ? <MathBlock block={block} inlineOptions={mathInlineOptions(blocks,block.id)} recommendedInline={recommendedMathInlinePlacement(blocks,block.id)} onInline={placement=>convertMathToInline(block.id,placement)} onDelete={() => removeBlock(block.id)} onChange={source => update(block.id, {content: [{text: source}]})} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'image' ? <ImageBlock block={block} featured={props.featuredImageId===block.imageId} onSetFeatured={() => onChange(latest.current.blocks,props.featuredImageId===block.imageId?null:block.imageId)} vaultId={props.vaultId} onChange={alt => update(block.id,{alt})} onDelete={() => removeBlock(block.id)} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'table' ? <TableBlock reviewMatches={reviewMatches} block={block} entities={entities} onChange={rows => update(block.id, {rows})} onOpen={onOpenEntity} onSave={onSave} onExit={() => insert(block.id)} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }}/> : <EditableBlock reviewMatches={reviewMatches} block={block} entities={entities} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }} onOpen={onOpenEntity} onInput={(el,event) => {
      textInput(block,el,event);
    }} onKeyDown={e => keyDown(e, block)} onPaste={e => paste(e, block)}/>}
  </div>{renderWritingReview(block.id)}{uploadCards(block.id)}</Fragment>;
  function renderRuns(list: Block[]) {
    return semanticRuns(list).map(run => run.type==='block' && isAIExplanation(run.block) ? {type:'group' as const,id:run.id,kind:'ai-explanation' as const,blocks:[run.block]} : run).map(run => <Fragment key={run.id}>{run.type === 'block' ? renderBlock(run.block) : <section key={run.id} data-block-group-id={run.id} className="semantic-group" data-semantic-kind={run.kind} style={semanticStyle(run.kind)} aria-label={uiText(semanticFunctions[run.kind].label)+uiText(" semantic group")}>
      <span className="semantic-callout-icon" aria-hidden="true"><Icon name={semanticFunctions[run.kind].icon}/></span><div className="semantic-parent-controls"><button type="button" className="block-handle semantic-handle" data-semantic-parent-handle draggable={false} aria-describedby="block-drag-help" aria-label={uiText(semanticFunctions[run.kind].label)+uiText(" group options")} title={uiText(semanticFunctions[run.kind].label)+uiText(" · Drag group or click for options")} onClick={event=>groupOptions(event.currentTarget,run.id)}>{semanticGlyph(run.kind)}</button></div>
      {run.kind==='ai-explanation' ? <details className="ai-explanation" open>
        <summary className="ai-explanation-label"><span>{uiText("AI explanation")}{run.blocks[0]?.semanticGroup?.persona&&` · ${personaIdentityName(run.blocks[0].semanticGroup.persona)}`}</span><Icon name="chevron"/></summary>
        {run.blocks[0]?.semanticGroup?.source && <div className="ai-explanation-source"><span>{uiText("Passage explained")}</span><blockquote>{passagePreview(run.blocks[0].semanticGroup.source.excerpt)}</blockquote></div>}
        <div className="semantic-children">{run.blocks.map(renderBlock)}</div>
      </details> : <div className="semantic-children">{run.blocks.map(renderBlock)}</div>}
    </section>}{(run.type==='block'?run.block.id===explanationAnchorId:run.blocks.some(block=>block.id===explanationAnchorId))&&explanationStatus}</Fragment>);
  }
  function renderColumnLayout(list: Block[]): ReactNode[] {
    const runs: {id: string; column: boolean; blocks: Block[]}[] = [];
    for (const block of list) {
      const last = runs.at(-1), id = block.column?.id;
      if (last && (id ? last.column && last.id === id : !last.column)) last.blocks.push(block);
      else runs.push({id: id ?? block.id, column: !!id, blocks: [block]});
    }
    return runs.map((run, index) => run.column
      ? <div className="columns-block" role="group" aria-label={uiText("Two columns")} data-active={active && run.blocks.some(block => active.group ? block.semanticGroup?.id === active.id || block.id === active.id : block.id === active.id) || undefined} key={run.id + ':' + index}>
          {([0, 1] as const).map(column => <div className="column-pane" data-column-id={run.id} data-column-index={column} key={column} role="group" aria-label={column === 0 ? uiText("Left column") : uiText("Right column")}>
            {renderRuns(run.blocks.filter(block => block.column?.index === column))}
            {!run.blocks.some(block => block.column?.index === column) && <button type="button" className="column-add" onClick={() => {
              const next = {...makeBlock(),column:{id:run.id,index:column}};
              const list = [...latest.current.blocks], last = run.blocks.at(-1)!;
              list.splice(list.findIndex(block => block.id === last.id) + 1, 0, next);
              focusTarget.current = {id:next.id,start:true}; onChange(list);
            }}><Icon name="plus"/>{uiText("Add block")}</button>}
          </div>)}
        </div>
      : <Fragment key={run.id}>{renderRuns(run.blocks)}</Fragment>);
  }
  return <><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label={uiText("Choose images")} onChange={e => {const files=Array.from(e.currentTarget.files ?? []); e.currentTarget.value=''; void addImages(files,imageTarget.current);}}/>
    {speech.player}
    <div id="blocks" ref={root} onFocusCapture={event => activateBlock(event.target)} onPointerDownCapture={event => activateBlock(event.target)} onInputCapture={event=>{
      if(root.current?.dataset.formattingTransaction) {event.stopPropagation(); return;}
      if((event.nativeEvent as InputEvent).isComposing)return;
      const surface=(event.target as Element).closest<HTMLElement>('.block-content[contenteditable="true"]');
      if(surface) {if(markdownTyping)completeTypedMarkdown(surface,event.nativeEvent as InputEvent,entities);completePageLink(surface);}
    }} onClickCapture={e => {
      // A tap ending a native selection gesture must not open an inline item.
      const selection = getSelection();
      const anchor=(e.target as Element).closest<HTMLAnchorElement>('a[href]');
      if(anchor?.closest('.block-content[contenteditable="true"]')) {
        // Browsers suppress native link activation inside contenteditable.
        // Keep ordinary clicks for the caret and explicitly support modified clicks.
        e.preventDefault();
        const href=safeHref(anchor.getAttribute('href')??'');
        if(selection?.isCollapsed && (e.metaKey || e.ctrlKey) && href) window.open(href,anchor.target || '_self','noopener,noreferrer');
        return;
      }
      if (mobile && selection && !selection.isCollapsed && root.current?.contains(selection.anchorNode) && (e.target as Element).closest('[data-page-title], [data-entity], [data-entity-review], [data-math]')) { e.stopPropagation(); return; }
      const mention=(e.target as Element).closest<HTMLElement>('.mention[data-entity]');
      if(mention?.closest('.block-content[contenteditable="true"]')){e.preventDefault();e.stopPropagation();document.dispatchEvent(new CustomEvent('noema:entity-link',{detail:mention}));return;}
      const pageLink=(e.target as Element).closest<HTMLElement>('[data-page-title]');
      if(pageLink){e.preventDefault();e.stopPropagation();openPageLink(pageLink);return;}
      const review = (e.target as Element).closest<HTMLElement>('[data-entity-review]');
      if (review) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('noema:entity-review', {detail: {id: review.dataset.entityReview!, element: review}}));
        return;
      }
      const math = (e.target as Element).closest<HTMLElement>('[data-math]');
      if (math && !(e.target as Element).closest('[data-semantic-kind="ai-explanation"]')) {e.preventDefault(); e.stopPropagation(); editInlineMath(math);}
    }} onKeyDownCapture={e => {
      const anchor=(e.target as Element).closest<HTMLAnchorElement>('a[href]');
      if(!e.nativeEvent.isComposing && e.key==='Enter' && anchor && document.activeElement===anchor && anchor.closest('.block-content[contenteditable="true"]')) {
        const href=safeHref(anchor.getAttribute('href')??'');
        e.preventDefault();e.stopPropagation();
        if(href)window.open(href,anchor.target || '_self','noopener,noreferrer');
        return;
      }
      const mention=(e.target as Element).closest<HTMLElement>('.mention[data-entity]');
      if(!e.nativeEvent.isComposing&&mention?.closest('.block-content[contenteditable="true"]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();document.dispatchEvent(new CustomEvent('noema:entity-link',{detail:mention}));return;}
      if(!e.nativeEvent.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&(e.key==='Backspace'||e.key==='Delete')&&root.current&&deleteEditorReference(root.current,e.target,e.key==='Backspace'?'backward':'forward')){
        e.preventDefault();e.stopPropagation();commitSelection();return;
      }
      const command=shortcutTextFormat(e.nativeEvent),editor=root.current;
      if(command&&editor&&!(e.target as Element).closest('input,textarea,button,select,[contenteditable="false"]')) {
        const range=editorSelectionRange(editor);
        if(range&&applyEditorTextFormat(editor,range,command,commitSelection)) {e.preventDefault();e.stopPropagation();return;}
      }
      const pageLink=(e.target as Element).closest<HTMLElement>('[data-page-title]');
      if(pageLink && e.key==='Enter'){e.preventDefault();e.stopPropagation();openPageLink(pageLink);return;}
      const math = (e.target as Element).closest<HTMLElement>('[data-math]');
      if (math && !(e.target as Element).closest('[data-semantic-kind="ai-explanation"]') && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); e.stopPropagation(); editInlineMath(math);}
    }} onPasteCapture={e => {
      if ((e.target as Element).closest('[data-semantic-kind="ai-explanation"]')) return;
      const files=Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if(!files.length || e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain')) return;
      e.preventDefault(); e.stopPropagation(); setMenu(null);
      const blockElement=(e.target as Element).closest<HTMLElement>('[data-block-id]');
      void addImages(files,{after:blockElement?.dataset.blockId,featured:true});
    }}>{!explanationAnchorId&&explanationStatus}{renderColumnLayout(blocks)}{uploadCards()}</div>
    <span id="block-drag-help" className="block-drag-sr">{uiText("Drag to reorder. Click for options. With the handle focused, press Space to pick up, Up or Down to move, Space or Enter to drop, Escape to cancel.")}</span>
    <div ref={dragStatus} className="block-drag-sr" role="status" aria-live="polite" aria-atomic="true"/>
    <EntityLinkActions editor={root} entities={entities} onCommit={commitSelection} onOpen={onOpenEntity}/>
    <SelectionToolbar onRead={speech.enabled?readSelection:undefined} onOpenEntity={onOpenEntity} onReview={props.onReview?()=>void reviewWriting():undefined} reviewing={writingReview?.loading} explainLabel={explainLabel} mobile={mobile} keyboardInset={keyboardInset} viewportHeight={viewportHeight} onExplain={props.onExplain?()=>void explain():undefined} explaining={explaining} onAddAlias={props.onAddAlias} onMath={range => setMathTarget({range, initial: range.toString()})} editor={root} entities={entities} suggestionContext={{priorityIds:suggestionPriorityIds}} onCommit={commitSelection} onSemantic={tagSelection} onCreateEntity={onCreateEntity}/>
    {linkedExplanations.length > 0 && <Modal className="confirmation-dialog linked-explanation-dialog" titleId="linked-explanation-delete-title" onClose={() => setLinkedDeletion([])}>
      <ModalHeader titleId="linked-explanation-delete-title" leading={<Icon name="sparkles"/>} closeLabel={uiText("Close and keep explanations")}>{linkedExplanations.length === 1 ? uiText("Keep the explanation?") : uiText("Keep the explanations?")}</ModalHeader>
      <p>{linkedExplanations.length === 1
        ? uiText("The source block has been deleted. Its AI explanation can stay in your note, or you can remove it too.")
        : uiText("The source content has been deleted. You can keep the {value0} linked AI explanations in your note, or remove them too.",{value0: linkedExplanations.length})}</p>
      <div className="linked-explanation-passages" style={semanticStyle('ai-explanation')}>
        <span className="linked-explanation-passage-label">{linkedExplanations.length === 1 ? uiText("Original passage") : uiText("Original passages")}</span>
        {linkedExplanations.map(id => {
          const source = blocks.find(block => block.semanticGroup?.id === id)?.semanticGroup?.source;
          return source?.excerpt ? <blockquote key={id}>{passagePreview(source.excerpt)}</blockquote> : null;
        })}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button confirmation-action is-danger linked-explanation-delete" onClick={deleteLinkedExplanations}><Icon name="trash"/>{linkedExplanations.length === 1 ? uiText("Delete explanation") : uiText("Delete explanations")}</button>
        <button type="button" className="button primary" autoFocus onClick={() => setLinkedDeletion([])}>{linkedExplanations.length === 1 ? uiText("Keep explanation") : uiText("Keep explanations")}</button>
      </div>
    </Modal>}
    {citationTarget && <CitationPicker vaultId={props.vaultId} entities={entities} blocks={blocks} getAnchor={()=>resolveCitationRange(citationTarget.editor,citationTarget.bookmark)} editor={citationTarget.editor} onInsert={insertCitations} onClose={closeCitation}/>}
    {mathTarget && <InlineMathEditor onMakeDisplay={inlineMathHost()?makeInlineMathDisplay:undefined} range={mathTarget.range} node={mathTarget.node} initial={mathTarget.initial} onSave={saveInlineMath} onClose={() => setMathTarget(null)}/>}
    {pageLinkStatus && <div className="note-link-status" role="status">{pageLinkStatus}</div>}
    {imageError && <div className="image-upload-error" role="alert">{imageError}</div>}
    {mobile && active && <div ref={mobileToolbar} className="mobile-block-toolbar" role="toolbar" aria-label={uiText("{value0} actions",{value0: activeLabel})} style={{bottom: keyboardInset}} onPointerDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>
      <div className="mobile-block-toolbar-actions">
        <button type="button" aria-label={uiText("Add block below")} title={uiText("Add block below")} onClick={event => {
          const after = active.group ? blocks.filter(block => block.semanticGroup?.id === active.id || block.id === active.id).at(-1)?.id : active.id;
          if (after) {
            if (active.group) insert(after, 'paragraph', [], true);
            else addBelow(event.currentTarget, after);
          }
        }}><Icon name="plus"/></button>
        <button type="button" className="mobile-block-type" aria-label={currentBlock ? uiText("Change block type: {value0}",{value0: activeLabel}) : uiText("Group options")} onClick={event => currentBlock
          ? show(event.currentTarget, [...blockOptionsFor(currentBlock).map(option => ({...option, pick: () => convert(currentBlock, option.type)})),imageChoice(currentBlock.id,currentBlock)], 'TURN INTO', true)
          : groupOptions(event.currentTarget, active.id)}>{activeLabel}<Icon name="chevron"/></button>
        <button type="button" aria-label={uiText("More block actions")} title={uiText("More block actions")} onClick={event => currentBlock ? blockOptions(event.currentTarget, currentBlock) : groupOptions(event.currentTarget, active.id)}><Icon name="more"/></button>
      </div>
      <button type="button" className="mobile-block-done" aria-label={uiText("Finish editing")} title={uiText("Finish editing")} onClick={() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setMenu(null); setActiveBlock(null);
      }}><Icon name="check"/></button>
    </div>}
    {menu && (mobile && menu.sheet ? <Modal className="mobile-block-sheet" titleId="mobile-block-sheet-title" onClose={() => setMenu(null)} dismissOnBackdrop>
      <div ref={menuRef}>
        <ModalHeader titleId="mobile-block-sheet-title">{menu.label === 'ADD BLOCK BELOW' ? uiText("Add a block") : menu.label === 'FORMAT' || menu.label === 'TURN INTO' ? uiText("Format block") : menu.label === 'TURN INTO SEMANTIC BLOCK' ? uiText("Turn into") : menu.label === 'AI PERSONA' ? 'Explanation persona' : menu.label === 'AI ACTIONS' ? uiText("AI actions") : menu.label === 'SEMANTIC GROUP' ? uiText("Group actions") : menu.label === 'SEMANTIC FUNCTION' ? uiText("Semantic function") : uiText("Block actions")}</ModalHeader>
        <div key={menu.label} className="mobile-block-sheet-options menu-primitive" data-menu-size="touch" data-menu-presentation="sheet">{menuChoices(true)}</div>
      </div>
    </Modal> : <div key={menu.label} ref={menuRef} className="command-menu block-action-menu menu-primitive" data-menu-size="regular" data-menu-presentation="popup" style={{left: menu.left, top: menu.top}} onMouseDown={e => e.preventDefault()} role="menu" aria-label={menu.label}>{menuChoices()}</div>)}
  </>;
}
