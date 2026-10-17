import {randomUUID} from '../../shared/uuid';
import { applySemantic, isAIExplanation, preserveAIExplanationTags, normalizeSemanticGroups, removeSemanticGroup, retagSemanticGroup, semanticDragItems, semanticFunctions, editableSemanticKinds, semanticRuns, type SemanticKind } from '../../shared/semantic-blocks';
import {pageTitleKey} from '../../shared/page-links';
import { completePageLink } from './page-links';
import { ReadOnlyExplanationBlock } from './ReadOnlyExplanationBlock';
import { selectedEditorBlocks } from './block-selection';
import { installBlockDrag, reorderBlock, type BlockDropPreview } from './block-drag';
import { installBlockSelection, setEditorCaret } from './block-selection';
import { displayMathSource } from './math-delimiters';
import { applySmartQuotes } from './smart-quotes';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type CSSProperties } from 'react';
import type { EntityReviewItem } from '../../shared/entity-match-cache';
import { entityLabels, type Block, type BlockType, type Entity, type PageSummary, type Segment } from '../../shared/domain';
import { uploadImage } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useMobileViewport } from '../components/WorkspaceNavigation';
import { readSegments, segmentHTML, syncEditableSegments } from './segments';
import { clipboardBlocks, markdownBlocks, makeBlock } from './paste';
import { compressImage } from './compress-image';
import { readImageCompression } from '../settings/image-settings';
import { ImageBlock } from './ImageBlock';
import { TableBlock } from './TableBlock';
import { SelectionToolbar } from './SelectionToolbar';
import { MathBlock } from './MathBlock';
import { MathDialog } from './MathDialog';
import { completeInlineMath, mathElement } from './math';
interface Props {pages?:PageSummary[];onOpenPage?:(id:string)=>void;onExplain?: (blocks: Block[]) => Promise<string>; reviewMatches?: EntityReviewItem[]; onAddAlias: (id: string, alias: string) => Promise<void>; vaultId: string; blocks: Block[]; entities: Entity[]; onChange: (blocks: Block[]) => void; onOpenEntity: (id: string) => void; onCreateEntity: (name: string, onCreated: (id: string) => void) => void; onSave: () => void}
function explanationInsertionIndex(blocks: Block[], ids: string[]) {
  const last=blocks.filter(block=>ids.includes(block.id)).at(-1);
  if(!last)return -1;
  let index=blocks.findIndex(block=>block.id===last.id);
  if(last.semanticGroup)blocks.forEach((block,i)=>{if(block.semanticGroup?.id===last.semanticGroup!.id)index=i;});
  return index;
}
const options: {type: BlockType; title: string; detail: string; icon: string}[] = [
  {type: 'paragraph', title: 'Text', detail: 'Plain text for your thoughts', icon: 'T'},
  {type: 'heading1', title: 'Heading 1', detail: 'A large section heading', icon: 'H₁'},
  {type: 'heading2', title: 'Heading 2', detail: 'A smaller section heading', icon: 'H₂'},
  {type: 'bullet', title: 'Bullet list', detail: 'A simple list of ideas', icon: '•'},
  {type: 'todo', title: 'To-do', detail: 'Keep track of a task', icon: '☑'},
  {type: 'table', title: 'Table', detail: 'A simple table with rows and columns', icon: '▦'},
  {type: 'math', title: 'Equation', detail: 'A LaTeX math equation', icon: 'equation'},
  {type: 'quote', title: 'Quote', detail: 'Make a thought stand out', icon: '❝'},
];
interface ImageUpload {id:string; after?:string; name:string; message:string; current:number; total:number}
interface Choice {disabled?: boolean; submenu?: boolean; color?:string; title: string; detail?: string; icon: string; entity?: boolean; pick: () => void}
interface Menu {items: Choice[]; index: number; left: number; top: number; label: string; sheet?: boolean}
function EditableBlock({block, entities, reviewMatches, onInput, onKeyDown, onOpen, register, onPaste}: {block: Block; entities: Entity[]; reviewMatches: EntityReviewItem[]; onInput: (el: HTMLElement) => void; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void; onOpen: (id: string) => void; register: (el: HTMLElement | null) => void; onPaste: (e: ClipboardEvent<HTMLElement>) => void}) {
  const ref = useRef<HTMLElement>(null);
  const Content = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : 'div';
  useLayoutEffect(() => {
    const el = ref.current!;
    syncEditableSegments(el, block.content, entities, {blockId: block.id, matches: reviewMatches});
    el.querySelectorAll<HTMLElement>('[data-entity]').forEach(node => {
      const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: node.dataset.entity!, ...(node.dataset.mentionText ? {mentionText: node.dataset.mentionText} : {})}], entities);
      const fresh = wrapper.firstElementChild!;
      if (node.innerHTML !== fresh.innerHTML) node.innerHTML = fresh.innerHTML;
      node.className = fresh.className;
    });
  });
  return <Content ref={el => { ref.current = el; register(el); }} className="block-content" contentEditable suppressContentEditableWarning spellCheck data-placeholder="Type / for blocks, @ for entities" onInput={e => { applySmartQuotes(e.currentTarget, e.nativeEvent as InputEvent); onInput(e.currentTarget); }} onKeyDown={onKeyDown}
    onClick={e => { const mention = (e.target as Element).closest<HTMLElement>('[data-entity]'); if (mention) onOpen(mention.dataset.entity!); }}
    onPaste={onPaste}/>;
}
export function BlockEditor(props: Props) {
  const mobile = useMobileViewport();
  const [activeBlock, setActiveBlock] = useState<{id: string; group: boolean} | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const mobileToolbar = useRef<HTMLDivElement>(null);
  const {blocks, entities, onOpenEntity, onCreateEntity, onSave} = props;
  const onChange = (next: Block[]) => props.onChange(normalizeSemanticGroups(preserveAIExplanationTags(props.blocks,next)));
  const [pageLinkStatus,setPageLinkStatus]=useState('');
  const [explaining,setExplaining]=useState(false), [explanationError,setExplanationError]=useState('');
  const [explanationAnchor,setExplanationAnchor]=useState<{ids:string[];index:number}|null>(null);
  const explanationPending=useRef(false), retryExplanation=useRef<string[]>([]);
  const reviewMatches = props.reviewMatches ?? [];
  const [blockDrag, setBlockDrag] = useState<BlockDropPreview | null>(null), [dragStatus, setDragStatus] = useState('');
  const dropEndId = blockDrag ? semanticDragItems(blocks,blockDrag.id).filter(block => block.id !== blockDrag.id).at(-1)?.id : undefined;
  const [mathTarget, setMathTarget] = useState<{range: Range; initial: string; node?: HTMLElement} | null>(null);
  const [uploads, setUploads] = useState<ImageUpload[]>([]), [imageError, setImageError] = useState('');
  const uploadQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true; return () => {mounted.current=false;};}, []);
  const fileInput = useRef<HTMLInputElement>(null), imageTarget = useRef<{after?: string; replace?: Block}>({});
  const [menu, setMenu] = useState<Menu | null>(null), elements = useRef(new Map<string, HTMLElement>());
  const root = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = {...props,onChange};
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
  const focusTarget = useRef<{id: string; start: boolean; offset?: number} | null>(null);
  useLayoutEffect(() => {
    const target = focusTarget.current; if (!target) return;
    const el = elements.current.get(target.id); if (!el) return; focusTarget.current = null;
    if(target.offset !== undefined && el.isContentEditable) {setEditorCaret(el,target.offset); return;}
    el.focus(); if(!el.isContentEditable) {el.querySelector('textarea')?.focus(); return;} const range = document.createRange(); range.selectNodeContents(el); range.collapse(target.start); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
  }, [blocks]);
  useEffect(() => {
    if (!root.current) return;
    return installBlockSelection(root.current, {
      blocks: () => latest.current.blocks, entities: () => latest.current.entities,
      commit: (blocks, focus) => { setMenu(null); focusTarget.current = {...focus, start: false}; latest.current.onChange(blocks); },
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
      preview: drop => {setBlockDrag(drop); if (drop) setMenu(null);},
      announce: setDragStatus,
    });
  }, []);
  function commitSelection() {
    const list = latest.current.blocks.map(block => {
      const row = root.current?.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
      if (!row || block.type === 'image' || block.type === 'math') return block;
      const editors = Array.from(row.querySelectorAll<HTMLElement>('.block-content[contenteditable="true"]'));
      if (block.type === 'table') {
        let index = 0;
        return {...block, rows: block.rows?.map(cells => cells.map(content => {
          const el = editors[index++]; return el ? readSegments(el) : content;
        }))};
      }
      return editors[0] ? {...block, content: readSegments(editors[0])} : block;
    });
    setMenu(null); latest.current.onChange(list);
    return list;
  }
  async function explain(ids?: string[]) {
    if(explanationPending.current || !latest.current.onExplain) return;
    const selectedIds=ids ?? (root.current ? selectedEditorBlocks(root.current)?.elements.map(el=>el.dataset.blockId!) : undefined);
    if(!selectedIds?.length) return;
    const draft=commitSelection(), selected=draft.filter(block=>selectedIds.includes(block.id));
    if(!selected.length) return;
    const snapshot=JSON.stringify(selected);
    setExplanationAnchor({ids:selectedIds,index:explanationInsertionIndex(draft,selectedIds)});
    retryExplanation.current=selectedIds;explanationPending.current=true;setExplaining(true);setExplanationError('');
    try {
      const markdown=await latest.current.onExplain(selected);
      if(!mounted.current) return;
      const current=latest.current.blocks, sources=current.filter(block=>selectedIds.includes(block.id));
      if(JSON.stringify(sources)!==snapshot) throw new Error('The selected blocks changed. Select them again to generate a fresh explanation.');
      const excerpt=selected.map(block=>block.type==='image'?block.alt||'Image':(block.type==='table'?(block.rows??[]).flat(2):block.content).map(segment=>segment.entityId?segment.mentionText??latest.current.entities.find(entity=>entity.id===segment.entityId)?.name??'':segment.text??'').join('')).join('\n\n').slice(0,2000);
      const group={id:randomUUID(),kind:'ai-explanation' as const,source:{blockIds:selected.map(block=>block.id),excerpt}};
      const generated=markdownBlocks(markdown).map(block=>({...block,semantic:'ai-explanation' as const,semanticGroup:group}));
      if(!markdown.trim() || !generated.length) throw new Error('AI returned an empty explanation. Please try again.');
      if(generated.length>128 || current.length+generated.length>2000) throw new Error('The explanation is too large for this page. Select fewer blocks.');
      // Insert after the last selected parent, so an existing group is never fragmented.
      const index=explanationInsertionIndex(current,selectedIds);
      const next=[...current];next.splice(index+1,0,...generated);latest.current.onChange(next);
    } catch(error) {if(mounted.current)setExplanationError(error instanceof Error?error.message:'Could not explain these blocks.');}
    finally {explanationPending.current=false;if(mounted.current)setExplaining(false);}
  }
  function explainChoice(ids: string[]): Choice {return {title:explaining?'Explaining…':'Explain with AI',detail:'Insert an AI Explanation below these blocks',icon:'sparkles',entity:true,pick:()=>{setMenu(null);void explain(ids);}};}
  function editInlineMath(node: HTMLElement) {
    const range = document.createRange(); range.selectNode(node);
    setMathTarget({range, initial: node.dataset.math ?? '', node});
  }
  function saveInlineMath(source: string) {
    if (!mathTarget || !root.current?.contains(mathTarget.range.commonAncestorContainer)) {setMathTarget(null); return;}
    const {range, node, initial} = mathTarget;
    if (node ? !node.isConnected || node.dataset.math !== initial : range.toString() !== initial) {setMathTarget(null); return;}
    range.deleteContents(); const math = mathElement(source); range.insertNode(math);
    const spacer = document.createTextNode('\u200b'); math.after(spacer);
    range.setStart(spacer, 1); range.collapse(true);
    const el = math.closest<HTMLElement>('.block-content');
    setMathTarget(null); el?.focus(); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    commitSelection();
  }
  function chooseImages(after?: string, replace?: Block) {
    setMenu(null); imageTarget.current = {after, replace}; fileInput.current?.click();
  }
  function addImages(files: File[], target: {after?: string; replace?: Block}) {
    if (!files.length) return;
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
          const parent=latest.current.blocks.find(block=>block.id===after)?.semanticGroup;
          const block: Block = {...makeBlock('image'),...(parent?{semanticGroup:parent}:{}), imageId:image.id, alt:''};
          const list = [...latest.current.blocks];
          const position = after ? list.findIndex(b => b.id === after) : list.length - 1;
          const replace = target.replace && list[position] && JSON.stringify(list[position]) === JSON.stringify(target.replace);
          const trailing = {...makeBlock(),...(parent?{semanticGroup:parent}:{})};
          list.splice(Math.max(0,position + (replace ? 0 : 1)),replace ? 1 : 0,block,trailing);
          focusTarget.current = {id:trailing.id,start:true};
          latest.current.onChange(list);
          latest.current = {...latest.current, blocks:list};
          after = block.id; target = {after}; progress({after});
        }
      } catch(error) { if(mounted.current) setImageError(error instanceof Error ? error.message : 'Image upload failed'); }
      finally { if(mounted.current) setUploads(items => items.filter(item => item.id !== id)); }
    });
  }
  function uploadCards(after?: string) {
    return uploads.filter(item => after ? item.after === after : !item.after || !blocks.some(block => block.id === item.after)).map(item =>
      <div key={item.id} className="image-upload-card" role="status" aria-live="polite" aria-busy="true">
        <span className="image-upload-spinner" aria-hidden="true"/>
        <div><strong>{item.message}</strong><span>{item.name || 'Pasted image'}{item.total > 1 ? ` · ${item.current} of ${item.total}` : ''}</span></div>
        <div className="image-upload-track" aria-hidden="true"><span/></div>
      </div>);
  }
  function imageChoice(after?: string, replace?: Block): Choice {
    return {title:'Image', detail:'Upload an image from your device', icon:'▧', pick:() => chooseImages(after,replace)};
  }
  function semanticStyle(kind?: SemanticKind): CSSProperties | undefined {return kind ? {'--semantic-color':semanticFunctions[kind].color} as CSSProperties : undefined;}
  function semanticGlyph(kind?: SemanticKind) {return <>{kind && <span className="semantic-function-icon"><Icon name={semanticFunctions[kind].icon}/></span>}<span className="semantic-grip-icon"><Icon name="grip"/></span></>;}
  function tagSelection(kind: SemanticKind) {
    if (!root.current) return;
    const selected=selectedEditorBlocks(root.current);if (!selected) return;
    const ids=selected.elements.map(el=>el.dataset.blockId!);
    focusTarget.current={id:ids[0]!,start:true};onChange(applySemantic(latest.current.blocks,ids,kind));
  }
  function semanticChoices(pick: (kind: SemanticKind) => void): Choice[] {return editableSemanticKinds.map(kind=>({title:semanticFunctions[kind].label,detail:semanticFunctions[kind].description,icon:semanticFunctions[kind].icon,color:semanticFunctions[kind].color,entity:true,pick:()=>{setMenu(null);pick(kind);}}));}
  function movementChoices(id: string): Choice[] {
    const list = latest.current.blocks, block = list.find(item => item.id === id);
    const items = block?.semanticGroup ? semanticDragItems(list, id) : semanticRuns(list).map(run => ({id: run.id}));
    const index = items.findIndex(item => item.id === id);
    return ([-1, 1] as const).map(direction => ({
      title: direction === -1 ? 'Move up' : 'Move down', icon: direction === -1 ? 'arrow-up' : 'arrow-down', entity: true,
      disabled: index < 0 || index + direction < 0 || index + direction >= items.length,
      pick: () => {
        if (index < 0 || index + direction < 0 || index + direction >= items.length) return;
        const before = direction === -1 ? items[index - 1]!.id : items[index + 2]?.id ?? null;
        setMenu(null); onChange(reorderBlock(latest.current.blocks, id, before));
        setDragStatus(`Block moved ${direction === -1 ? 'up' : 'down'}.`);
      },
    }));
  }
  function blockOptions(anchor: HTMLElement, block: Block) {
    const selection=root.current ? selectedEditorBlocks(root.current)?.elements.map(el=>el.dataset.blockId!) : undefined;
    const ids=selection?.includes(block.id)?selection:[block.id];
    show(anchor, [
      ...(props.onExplain ? [explainChoice(ids)] : []),
      ...(!isAIExplanation(block) ? [{submenu:true, title:'Semantic function…', detail:block.semantic ? semanticFunctions[block.semantic].label : 'Question, Definition, Example…', icon:'semantic', entity:true,
        pick:()=>show(anchor,[...semanticChoices(kind=>update(block.id,{semantic:kind})),...(block.semantic?[{title:'Remove semantic function',icon:'close',entity:true,pick:()=>{setMenu(null);update(block.id,{semantic:undefined});}}]:[])],'SEMANTIC FUNCTION', true)}] : []),
      ...(mobile && block.semanticGroup ? [{submenu:true, title:'Group actions…', icon:'semantic', entity:true, pick:()=>{setActiveBlock({id:block.semanticGroup!.id,group:true});groupOptions(anchor,block.semanticGroup!.id);}}] : []),
      ...(mobile ? movementChoices(block.id) : options.map(option=>({...option,pick:()=>convert(block,option.type)}))),
      {title:'Delete block',icon:'trash',entity:true,pick:()=>removeBlock(block.id)},
    ], 'BLOCK OPTIONS', true);
  }
  function groupOptions(anchor: HTMLElement, id: string) {
    const children=latest.current.blocks.filter(block=>block.semanticGroup?.id===id || block.id===id && isAIExplanation(block)),locked=children.some(isAIExplanation);
    show(anchor,[...(props.onExplain?[explainChoice(children.map(block=>block.id))]:[]),...(mobile?movementChoices(id):[]),...(!locked?[...semanticChoices(kind=>onChange(retagSemanticGroup(latest.current.blocks,id,kind))),{title:'Ungroup blocks',detail:'Keep all child blocks',icon:'close',entity:true,pick:()=>{setMenu(null);onChange(removeSemanticGroup(latest.current.blocks,id));}}]:[{title:'Delete explanation',detail:'Remove this explanation and its subblocks',icon:'close',entity:true,pick:()=>{setMenu(null);const rest=latest.current.blocks.filter(block=>block.semanticGroup?.id!==id && block.id!==id);onChange(rest.length?rest:[makeBlock()]);}}])],'SEMANTIC GROUP', true);
  }
  function update(id: string, patch: Partial<Block>) { onChange(latest.current.blocks.map(b => b.id === id ? {...b, ...patch} : b)); }
  function removeBlock(id: string) {
    setMenu(null);
    const list=latest.current.blocks, index=list.findIndex(block => block.id === id);
    if(index < 0) return;
    if(list.length === 1) {
      focusTarget.current={id,start:true};
      onChange([{...makeBlock(),id}]);
    } else {
      focusTarget.current={id:list[index > 0 ? index-1 : index+1]!.id,start:false};
      onChange(list.filter(block => block.id !== id));
    }
  }
  function insert(after: string | undefined, type: BlockType = 'paragraph', content: Segment[] = [], outsideGroup = false) {
    const parent=outsideGroup ? undefined : latest.current.blocks.find(block=>block.id===after)?.semanticGroup;
    const next = {...makeBlock(type, content),...(parent?{semanticGroup:parent}:{})}, list = [...latest.current.blocks];
    list.splice(after ? list.findIndex(b => b.id === after) + 1 : list.length, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
  }
  function convert(block: Block, type: BlockType, clear = false) { setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type, content: clear ? [] : block.type === 'table' ? (block.rows ?? []).flatMap((row, i) => [...(i ? [{text: '\n'}] : []), ...row.flatMap((cell, col) => [...(col ? [{text: '\t'}] : []), ...cell])]) : block.content, rows: type === 'table' ? block.rows ?? [[clear ? [] : block.content, []], [[], []]] : undefined, checked: false, imageId: undefined, alt: undefined}); }
  function show(el: HTMLElement, items: Choice[], label: string, sheet = false) {
    if (!items.length) { setMenu(null); return; } const box = el.getBoundingClientRect();
    setMenu({items, index: 0, left: Math.max(8, Math.min(box.left, innerWidth - 330)), top: Math.max(8, Math.min(box.bottom + 5, innerHeight - 370)), label, sheet});
  }
  function addBelow(anchor: HTMLElement, after: string) {
    show(anchor, [...options.map(option => ({...option, pick: () => { setMenu(null); insert(after, option.type); }})), imageChoice(after)], 'ADD BLOCK BELOW', true);
  }
  const active = activeBlock && (activeBlock.group
    ? blocks.some(block => block.semanticGroup?.id === activeBlock.id || block.id === activeBlock.id)
    : blocks.some(block => block.id === activeBlock.id)) ? activeBlock : null;
  const currentBlock = active && !active.group ? blocks.find(block => block.id === active.id) : undefined;
  const activeLabel = currentBlock ? options.find(option => option.type === currentBlock.type)?.title ?? 'Image' : 'Group';
  function menuChoices(sheet = false) {
    return menu?.items.map((item, index) => <button key={index} type="button" role={sheet ? undefined : 'menuitem'} disabled={item.disabled} className={index === menu.index && !sheet ? 'highlight' : ''} onClick={event => {
      // Release modal focus before an action focuses a new or converted block.
      if (sheet && !item.submenu) event.currentTarget.closest('dialog')?.close();
      item.pick();
    }}><span className="menu-icon" style={item.color?{color:item.color}:undefined}>{item.entity || item.icon === 'equation' ? <Icon name={item.icon}/> : item.icon}</span><span>{item.title}<small>{item.detail}</small></span></button>);
  }
  function insertMention(range: Range, id: string, blockId: string) {
    if (!range.startContainer.isConnected) return;
    range.deleteContents(); const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: id}], latest.current.entities); const mention = wrapper.firstChild!;
    range.insertNode(mention); const space = document.createTextNode(' '); mention.after(space); range.setStartAfter(space); range.collapse(true);
    const el = elements.current.get(blockId); el?.focus(); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    if (el) update(blockId, {content: readSegments(el)}); setMenu(null);
  }
  function openPageLink(anchor:HTMLElement) {
    const title=anchor.dataset.pageTitle!;
    const matches=(latest.current.pages??[]).filter(page=>pageTitleKey(page.title)===pageTitleKey(title));
    if(matches.length===1 && latest.current.onOpenPage) {setPageLinkStatus('');latest.current.onOpenPage(matches[0]!.id);}
    else if(matches.length>1)show(anchor,matches.map(page=>({title:page.title,detail:'Updated '+new Date(page.updated_at).toLocaleString(),icon:'page',entity:true,pick:()=>{setMenu(null);latest.current.onOpenPage?.(page.id);}})),'CHOOSE NOTE');
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
  function detect(el: HTMLElement, block: Block) {
    const selection = getSelection(); if (!selection?.rangeCount) { setMenu(null); return; }
    const range = selection.getRangeAt(0); if (!el.contains(range.startContainer)) { setMenu(null); return; }
    if (/^\/[^\n]*$/.test(el.textContent || '')) {
      const query = el.textContent!.slice(1).toLowerCase(); show(el, [...options.filter(o => o.title.toLowerCase().includes(query)).map(o => ({...o, pick: () => convert(block, o.type, true)})), ...editableSemanticKinds.filter(kind=>kind.includes(query)).map(kind=>({title:semanticFunctions[kind].label,detail:'Semantic function',icon:semanticFunctions[kind].icon,color:semanticFunctions[kind].color,entity:true,pick:()=>{setMenu(null);update(block.id,{semantic:kind,content:[]});}})), ...('image'.includes(query) ? [imageChoice(block.id, block)] : [])], 'TURN INTO'); return;
    }
    const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
    const wiki=before.toString().match(/\[\[([^\[\]\n]*)$/);
    if(wiki && range.startContainer.nodeType===Node.TEXT_NODE && !(range.startContainer.parentElement?.closest('code,a,[data-math],[data-entity]'))) {
      const start=range.startOffset-wiki[0].length;
      if(start>=0) {
        const [query,...alias]=wiki[1]!.split('|'),saved=range.cloneRange();saved.setStart(range.startContainer,start);
        const pages=(latest.current.pages??[]).filter(page=>!/[\[\]\n|]/.test(page.title)&&page.title.toLocaleLowerCase().includes(query!.trim().toLocaleLowerCase())).slice(0,8);
        show(el,pages.map(page=>({title:page.title,detail:alias.length?'Display as '+alias.join('|'):'Link to note',icon:'page',entity:true,pick:()=>insertPageLink(saved,page.title,alias.length?alias.join('|'):undefined,block.id)})),'LINK A NOTE');return;
      }
    }
    const match = before.toString().match(/(?:^|\s)@([^@\n]*)$/);
    if (match && range.startContainer.nodeType === Node.TEXT_NODE) {
      const query = match[1]!, start = range.startOffset - query.length - 1; if (start < 0) { setMenu(null); return; }
      const saved = range.cloneRange(); saved.setStart(range.startContainer, start);
      const items: Choice[] = entities.filter(e => [e.name, ...(e.aliases ?? [])].some(name => name.toLowerCase().includes(query.toLowerCase()))).slice(0, 7).map(e => ({title: e.name, detail: entityLabels[e.type], icon: e.type, entity: true, pick: () => insertMention(saved, e.id, block.id)}));
      items.push({title: query ? `Create “${query}”` : 'Create a new entity', icon: '+', pick: () => { setMenu(null); onCreateEntity(query, id => insertMention(saved, id, block.id)); }}); show(el, items, 'LINK AN ENTITY'); return;
    }
    setMenu(null);
  }
  function paste(e: ClipboardEvent<HTMLElement>, block: Block) {
    e.preventDefault(); setMenu(null);
    const el = e.currentTarget, selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    const incoming = clipboardBlocks(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html')).map(incoming=>({...incoming,...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{}),...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{})}));
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
    if (suffix.length) replacement.push({...makeBlock(block.type, suffix),...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{}),...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{})});
    const list = [...latest.current.blocks], index = list.findIndex(b => b.id === block.id);
    list.splice(index, 1, ...replacement); focusTarget.current = {id: replacement.at(-1)!.id, start: !suffix.length ? false : true}; onChange(list);
  }
  function keyDown(e: KeyboardEvent<HTMLElement>, block: Block) {
    const el = e.currentTarget, mention = (e.target as Element).closest<HTMLElement>('[data-entity]');
    if (mention && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenEntity(mention.dataset.entity!); return; }
    if (e.nativeEvent.isComposing) return;
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenu({...menu, index: (menu.index + (e.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length}); return; }
      if (e.key === 'Enter') { e.preventDefault(); menu.items[menu.index]!.pick(); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); setMenu(null);
      if (!el.textContent && ['bullet', 'todo'].includes(block.type)) { convert(block, 'paragraph'); return; }
      const selection = getSelection(); if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0); range.deleteContents(); const tail = range.cloneRange(); tail.setEnd(el, el.childNodes.length); const temp = document.createElement('div'); temp.append(tail.extractContents());
      const next: Block = {...(isAIExplanation(block)?{semantic:'ai-explanation' as const}:{}),...(block.semanticGroup?{semanticGroup:block.semanticGroup}:{}),id: randomUUID(), type: ['bullet', 'todo'].includes(block.type) ? block.type : 'paragraph', checked: false, content: readSegments(temp)};
      const list = latest.current.blocks.map(b => b.id === block.id ? {...b, content: readSegments(el)} : b); list.splice(list.findIndex(b => b.id === block.id) + 1, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
    }
    if (e.key === 'Backspace' && !el.textContent && blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
  }
  const liveExplanationIndex=explanationAnchor?explanationInsertionIndex(blocks,explanationAnchor.ids):-1;
  const explanationAnchorIndex=liveExplanationIndex>=0?liveExplanationIndex:Math.min(explanationAnchor?.index??-1,blocks.length-1);
  const explanationAnchorId=blocks[explanationAnchorIndex]?.id;
  const explanationStatus=(explaining||explanationError)?<div className="ai-explanation-placeholder" style={semanticStyle('ai-explanation')}>
    <div className="ai-explanation-label">AI Explanation</div>
    {explaining?<div className="ai-explanation-status" role="status"><span className="scan-spinner" aria-hidden="true"/>Explaining selected blocks…</div>:<div className="ai-explanation-status is-error" role="alert"><span>{explanationError}</span><button type="button" onClick={()=>void explain(retryExplanation.current)}>Retry</button><button type="button" onClick={()=>{setExplanationError('');setExplanationAnchor(null);}}>Dismiss</button></div>}
  </div>:null;
  const renderBlock = (block: Block) => isAIExplanation(block) ? <ReadOnlyExplanationBlock key={block.id} block={block} entities={entities} onOpen={onOpenEntity} vaultId={props.vaultId}/> : <Fragment key={block.id}><div data-block-id={block.id} data-semantic-kind={block.semantic} style={semanticStyle(block.semantic)} className={'block ' + block.type + (block.semantic ? ' semantic-block' : '') + (blockDrag?.id === block.id ? ' is-block-dragging' : '')} data-drop-before={blockDrag?.valid && blockDrag.beforeId === block.id ? true : undefined} data-drop-after={blockDrag?.valid && blockDrag.beforeId === null && block.id === dropEndId ? true : undefined}>
    {block.semantic && <span className="semantic-accent" aria-hidden="true"/>}
    <div className="block-controls" role="group" aria-label="Block controls">
      <button className="block-add" title="Add block below" aria-label="Add block below" onClick={e => addBelow(e.currentTarget, block.id)}><Icon name="plus"/></button>
      <button className={'block-handle' + (block.semantic ? ' semantic-handle' : '')} draggable={false} title={(block.semantic ? semanticFunctions[block.semantic].label+' · ' : '')+'Drag to move · Click for block options'} aria-label={block.semantic ? semanticFunctions[block.semantic].label+' block options' : 'Block options'} aria-describedby="block-drag-help" aria-pressed={blockDrag?.id === block.id} onClick={e => blockOptions(e.currentTarget,block)}>{semanticGlyph(block.semantic)}</button>
    </div>
    {block.type === 'todo' ? <input type="checkbox" aria-label="Complete task" checked={block.checked} onChange={e => update(block.id, {checked: e.target.checked})}/> : block.type === 'bullet' ? <span className="bullet-marker">•</span> : null}
    {block.type === 'math' ? <MathBlock block={block} onDelete={() => removeBlock(block.id)} onChange={source => update(block.id, {content: [{text: source}]})} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'image' ? <ImageBlock block={block} vaultId={props.vaultId} onChange={alt => update(block.id,{alt})} onDelete={() => removeBlock(block.id)} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'table' ? <TableBlock reviewMatches={reviewMatches} block={block} entities={entities} onChange={rows => update(block.id, {rows})} onOpen={onOpenEntity} onSave={onSave} onExit={() => insert(block.id)} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }}/> : <EditableBlock reviewMatches={reviewMatches} block={block} entities={entities} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }} onOpen={onOpenEntity} onInput={el => {
      const content = readSegments(el);
      const source = block.type === 'paragraph' && content.every(segment => !segment.entityId && !segment.math && !segment.code)
        ? displayMathSource(content.map(segment => segment.text ?? '').join('')) : undefined;
      if (source) { setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type: 'math', content: [{text: source}]}); return; }
      completeInlineMath(el); update(block.id, {content: readSegments(el)}); detect(el, block);
    }} onKeyDown={e => keyDown(e, block)} onPaste={e => paste(e, block)}/>}
  </div>{uploadCards(block.id)}</Fragment>;
  return <><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label="Choose images" onChange={e => {const files=Array.from(e.currentTarget.files ?? []); e.currentTarget.value=''; void addImages(files,imageTarget.current);}}/>
    <div id="blocks" ref={root} onFocusCapture={event => activateBlock(event.target)} onPointerDownCapture={event => activateBlock(event.target)} onInputCapture={event=>{
      if((event.nativeEvent as InputEvent).isComposing)return;
      const surface=(event.target as Element).closest<HTMLElement>('.block-content[contenteditable="true"]');
      if(surface)completePageLink(surface);
    }} data-block-dragging={blockDrag ? true : undefined} onClickCapture={e => {
      // A tap ending a native selection gesture must not open an inline item.
      const selection = getSelection();
      if (mobile && selection && !selection.isCollapsed && root.current?.contains(selection.anchorNode) && (e.target as Element).closest('[data-page-title], [data-entity], [data-entity-review], [data-math]')) { e.stopPropagation(); return; }
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
      const pageLink=(e.target as Element).closest<HTMLElement>('[data-page-title]');
      if(pageLink && e.key==='Enter'){e.preventDefault();e.stopPropagation();openPageLink(pageLink);return;}
      const math = (e.target as Element).closest<HTMLElement>('[data-math]');
      if (math && !(e.target as Element).closest('[data-semantic-kind="ai-explanation"]') && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); e.stopPropagation(); editInlineMath(math);}
    }} onPasteCapture={e => {
      if ((e.target as Element).closest('[data-semantic-kind="ai-explanation"]')) return;
      const files=Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if(!files.length) return;
      e.preventDefault(); e.stopPropagation(); setMenu(null);
      const blockElement=(e.target as Element).closest<HTMLElement>('[data-block-id]');
      void addImages(files,{after:blockElement?.dataset.blockId});
    }}>{!explanationAnchorId&&explanationStatus}{semanticRuns(blocks).map(run => run.type==='block' && isAIExplanation(run.block) ? {type:'group' as const,id:run.id,kind:'ai-explanation' as const,blocks:[run.block]} : run).map(run => <Fragment key={run.id}>{run.type === 'block' ? renderBlock(run.block) : <section key={run.id} data-block-group-id={run.id} className={'semantic-group'+(blockDrag?.id===run.id?' is-block-dragging':'')} data-semantic-kind={run.kind} style={semanticStyle(run.kind)} aria-label={semanticFunctions[run.kind].label+' semantic group'} data-drop-before={blockDrag?.valid&&blockDrag.beforeId===run.id?true:undefined} data-drop-after={blockDrag?.valid&&blockDrag.beforeId===null&&dropEndId===run.id?true:undefined}>
      <span className="semantic-accent" aria-hidden="true"/><div className="semantic-parent-controls"><button type="button" className="block-handle semantic-handle" data-semantic-parent-handle draggable={false} aria-describedby="block-drag-help" aria-label={semanticFunctions[run.kind].label+' group options'} aria-pressed={blockDrag?.id===run.id} title={semanticFunctions[run.kind].label+' · Drag group or click for options'} onClick={event=>groupOptions(event.currentTarget,run.id)}>{semanticGlyph(run.kind)}</button></div>
      {run.kind==='ai-explanation' ? <details className="ai-explanation" open>
        <summary className="ai-explanation-label">AI Explanation</summary>
        {run.blocks[0]?.semanticGroup?.source && <div className="ai-explanation-source"><span>Passage explained</span><blockquote>{run.blocks[0].semanticGroup.source.excerpt}</blockquote></div>}
        <div className="semantic-children">{run.blocks.map(renderBlock)}</div>
      </details> : <div className="semantic-children">{run.blocks.map(renderBlock)}</div>}
    </section>}{(run.type==='block'?run.block.id===explanationAnchorId:run.blocks.some(block=>block.id===explanationAnchorId))&&explanationStatus}</Fragment>)}{uploadCards()}</div>
    <span id="block-drag-help" className="block-drag-sr">Drag to reorder. Click for options. With the handle focused, press Space to pick up, Up or Down to move, Space or Enter to drop, Escape to cancel.</span>
    <div className="block-drag-sr" role="status" aria-live="polite" aria-atomic="true">{dragStatus}</div>
    <SelectionToolbar mobile={mobile} keyboardInset={keyboardInset} viewportHeight={viewportHeight} onExplain={props.onExplain?()=>void explain():undefined} explaining={explaining} onAddAlias={props.onAddAlias} onMath={range => setMathTarget({range, initial: range.toString()})} editor={root} entities={entities} onCommit={commitSelection} onSemantic={tagSelection} onCreateEntity={onCreateEntity}/>
    {mathTarget && <MathDialog initial={mathTarget.initial} onSave={saveInlineMath} onClose={() => setMathTarget(null)}/>}
    {pageLinkStatus && <div className="note-link-status" role="status">{pageLinkStatus}</div>}
    {imageError && <div className="image-upload-error" role="alert">{imageError}</div>}
    {mobile && active && <div ref={mobileToolbar} className="mobile-block-toolbar" role="toolbar" aria-label={`${activeLabel} actions`} style={{bottom: keyboardInset}} onPointerDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>
      <div className="mobile-block-toolbar-actions">
        <button type="button" aria-label="Add block below" title="Add block below" onClick={event => {
          const after = active.group ? blocks.filter(block => block.semanticGroup?.id === active.id || block.id === active.id).at(-1)?.id : active.id;
          if (after) {
            if (active.group) insert(after, 'paragraph', [], true);
            else addBelow(event.currentTarget, after);
          }
        }}><Icon name="plus"/></button>
        <button type="button" className="mobile-block-type" aria-label={currentBlock ? `Change block type: ${activeLabel}` : 'Group options'} onClick={event => currentBlock
          ? show(event.currentTarget, options.map(option => ({...option, pick: () => convert(currentBlock, option.type)})), 'TURN INTO', true)
          : groupOptions(event.currentTarget, active.id)}>{activeLabel}<Icon name="chevron"/></button>
        <button type="button" aria-label="More block actions" title="More block actions" onClick={event => currentBlock ? blockOptions(event.currentTarget, currentBlock) : groupOptions(event.currentTarget, active.id)}><Icon name="more"/></button>
      </div>
      <button type="button" className="mobile-block-done" aria-label="Finish editing" title="Finish editing" onClick={() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setMenu(null); setActiveBlock(null);
      }}><Icon name="check"/></button>
    </div>}
    {menu && (mobile && menu.sheet ? <Modal className="mobile-block-sheet" titleId="mobile-block-sheet-title" onClose={() => setMenu(null)} dismissOnBackdrop>
      <div ref={menuRef}>
        <header><h2 id="mobile-block-sheet-title">{menu.label === 'ADD BLOCK BELOW' ? 'Add a block' : menu.label === 'TURN INTO' ? 'Change block type' : menu.label === 'SEMANTIC GROUP' ? 'Group actions' : menu.label === 'SEMANTIC FUNCTION' ? 'Semantic function' : 'Block actions'}</h2><button type="button" aria-label="Close block actions" onClick={() => setMenu(null)}><Icon name="close"/></button></header>
        <div className="mobile-block-sheet-options">{menuChoices(true)}</div>
      </div>
    </Modal> : <div ref={menuRef} className="command-menu" style={{left: menu.left, top: menu.top}} onMouseDown={e => e.preventDefault()} role="menu"><div className="menu-label">{menu.label}</div>{menuChoices()}</div>)}
  </>;
}
