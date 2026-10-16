import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { entityLabels, type Block, type BlockType, type Entity, type Segment } from '../../shared/domain';
import { uploadImage } from '../api';
import { Icon } from '../components/Icon';
import { readSegments, segmentHTML } from './segments';
import { clipboardBlocks, makeBlock } from './paste';
import { compressImage } from './compress-image';
import { readImageCompression } from '../settings/image-settings';
import { ImageBlock } from './ImageBlock';
import { TableBlock } from './TableBlock';
import { SelectionToolbar } from './SelectionToolbar';
import { MathBlock } from './MathBlock';
import { MathDialog } from './MathDialog';
import { completeInlineMath, mathElement } from './math';
interface Props {vaultId: string; blocks: Block[]; entities: Entity[]; onChange: (blocks: Block[]) => void; onOpenEntity: (id: string) => void; onCreateEntity: (name: string, onCreated: (id: string) => void) => void; onSave: () => void}
const options: {type: BlockType; title: string; detail: string; icon: string}[] = [
  {type: 'paragraph', title: 'Text', detail: 'Plain text for your thoughts', icon: 'T'},
  {type: 'heading1', title: 'Heading 1', detail: 'A large section heading', icon: 'H₁'},
  {type: 'heading2', title: 'Heading 2', detail: 'A smaller section heading', icon: 'H₂'},
  {type: 'bullet', title: 'Bullet list', detail: 'A simple list of ideas', icon: '•'},
  {type: 'todo', title: 'To-do', detail: 'Keep track of a task', icon: '☑'},
  {type: 'table', title: 'Table', detail: 'A simple table with rows and columns', icon: '▦'},
  {type: 'math', title: 'Equation', detail: 'A LaTeX math equation', icon: '∑'},
  {type: 'quote', title: 'Quote', detail: 'Make a thought stand out', icon: '❝'},
];
interface ImageUpload {id:string; after?:string; name:string; message:string; current:number; total:number}
interface Choice {title: string; detail?: string; icon: string; entity?: boolean; pick: () => void}
interface Menu {items: Choice[]; index: number; left: number; top: number; label: string}
function EditableBlock({block, entities, onInput, onKeyDown, onOpen, register, onPaste}: {block: Block; entities: Entity[]; onInput: (el: HTMLDivElement) => void; onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void; onOpen: (id: string) => void; register: (el: HTMLDivElement | null) => void; onPaste: (e: ClipboardEvent<HTMLDivElement>) => void}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (JSON.stringify(readSegments(el)) !== JSON.stringify(block.content)) el.innerHTML = segmentHTML(block.content, entities);
    el.querySelectorAll<HTMLElement>('[data-entity]').forEach(node => {
      const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: node.dataset.entity!}], entities);
      const fresh = wrapper.firstElementChild!;
      if (node.innerHTML !== fresh.innerHTML) node.innerHTML = fresh.innerHTML;
      node.className = fresh.className;
    });
  }, [block.content, entities]);
  return <div ref={el => { ref.current = el; register(el); }} className="block-content" contentEditable suppressContentEditableWarning spellCheck data-placeholder="Type / for blocks, @ for entities" onInput={e => onInput(e.currentTarget)} onKeyDown={onKeyDown}
    onClick={e => { const mention = (e.target as Element).closest<HTMLElement>('[data-entity]'); if (mention) onOpen(mention.dataset.entity!); }}
    onPaste={onPaste}/>;
}
export function BlockEditor(props: Props) {
  const {blocks, entities, onChange, onOpenEntity, onCreateEntity, onSave} = props;
  const [mathTarget, setMathTarget] = useState<{range: Range; initial: string; node?: HTMLElement} | null>(null);
  const [uploads, setUploads] = useState<ImageUpload[]>([]), [imageError, setImageError] = useState('');
  const uploadQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true; return () => {mounted.current=false;};}, []);
  const fileInput = useRef<HTMLInputElement>(null), imageTarget = useRef<{after?: string; replace?: Block}>({});
  const [menu, setMenu] = useState<Menu | null>(null), elements = useRef(new Map<string, HTMLDivElement>());
  const root = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const focusTarget = useRef<{id: string; start: boolean} | null>(null);
  useLayoutEffect(() => {
    const target = focusTarget.current; if (!target) return;
    const el = elements.current.get(target.id); if (!el) return; focusTarget.current = null;
    el.focus(); if(!el.isContentEditable) {el.querySelector('textarea')?.focus(); return;} const range = document.createRange(); range.selectNodeContents(el); range.collapse(target.start); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
  }, [blocks]);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
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
  }
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
    const id=crypto.randomUUID(), autoCompress=readImageCompression();
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
          const block: Block = {...makeBlock('image'), imageId:image.id, alt:''};
          const list = [...latest.current.blocks];
          const position = after ? list.findIndex(b => b.id === after) : list.length - 1;
          const replace = target.replace && list[position] && JSON.stringify(list[position]) === JSON.stringify(target.replace);
          const trailing = makeBlock();
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
  function insert(after: string | undefined, type: BlockType = 'paragraph', content: Segment[] = []) {
    const next = {...makeBlock(type, content)}, list = [...latest.current.blocks];
    list.splice(after ? list.findIndex(b => b.id === after) + 1 : list.length, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
  }
  function convert(block: Block, type: BlockType, clear = false) { setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type, content: clear ? [] : block.type === 'table' ? (block.rows ?? []).flatMap((row, i) => [...(i ? [{text: '\n'}] : []), ...row.flatMap((cell, col) => [...(col ? [{text: '\t'}] : []), ...cell])]) : block.content, rows: type === 'table' ? block.rows ?? [[clear ? [] : block.content, []], [[], []]] : undefined, checked: false, imageId: undefined, alt: undefined}); }
  function show(el: HTMLElement, items: Choice[], label: string) {
    if (!items.length) { setMenu(null); return; } const box = el.getBoundingClientRect();
    setMenu({items, index: 0, left: Math.max(8, Math.min(box.left, innerWidth - 330)), top: Math.max(8, Math.min(box.bottom + 5, innerHeight - 370)), label});
  }
  function insertMention(range: Range, id: string, blockId: string) {
    if (!range.startContainer.isConnected) return;
    range.deleteContents(); const wrapper = document.createElement('span'); wrapper.innerHTML = segmentHTML([{entityId: id}], latest.current.entities); const mention = wrapper.firstChild!;
    range.insertNode(mention); const space = document.createTextNode(' '); mention.after(space); range.setStartAfter(space); range.collapse(true);
    const el = elements.current.get(blockId); el?.focus(); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    if (el) update(blockId, {content: readSegments(el)}); setMenu(null);
  }
  function detect(el: HTMLDivElement, block: Block) {
    const selection = getSelection(); if (!selection?.rangeCount) { setMenu(null); return; }
    const range = selection.getRangeAt(0); if (!el.contains(range.startContainer)) { setMenu(null); return; }
    if (/^\/[^\n]*$/.test(el.textContent || '')) {
      const query = el.textContent!.slice(1).toLowerCase(); show(el, [...options.filter(o => o.title.toLowerCase().includes(query)).map(o => ({...o, pick: () => convert(block, o.type, true)})), ...('image'.includes(query) ? [imageChoice(block.id, block)] : [])], 'TURN INTO'); return;
    }
    const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
    const match = before.toString().match(/(?:^|\s)@([^@\n]*)$/);
    if (match && range.startContainer.nodeType === Node.TEXT_NODE) {
      const query = match[1]!, start = range.startOffset - query.length - 1; if (start < 0) { setMenu(null); return; }
      const saved = range.cloneRange(); saved.setStart(range.startContainer, start);
      const items: Choice[] = entities.filter(e => e.name.toLowerCase().includes(query.toLowerCase())).slice(0, 7).map(e => ({title: e.name, detail: entityLabels[e.type], icon: e.type, entity: true, pick: () => insertMention(saved, e.id, block.id)}));
      items.push({title: query ? `Create “${query}”` : 'Create a new entity', icon: '+', pick: () => { setMenu(null); onCreateEntity(query, id => insertMention(saved, id, block.id)); }}); show(el, items, 'LINK AN ENTITY'); return;
    }
    setMenu(null);
  }
  function paste(e: ClipboardEvent<HTMLDivElement>, block: Block) {
    e.preventDefault(); setMenu(null);
    const el = e.currentTarget, selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    const incoming = clipboardBlocks(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html'));
    range.deleteContents();
    if (incoming.length === 1 && incoming[0]!.type === 'paragraph') {
      const wrapper = document.createElement('div'); wrapper.innerHTML = segmentHTML(incoming[0]!.content, entities);
      const fragment = document.createDocumentFragment(); while (wrapper.firstChild) fragment.append(wrapper.firstChild);
      const last = fragment.lastChild;
      range.insertNode(fragment); if (last) range.setStartAfter(last); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range); update(block.id, {content: readSegments(el)}); return;
    }
    const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange(); after.selectNodeContents(el); after.setStart(range.endContainer, range.endOffset);
    const head = document.createElement('div'), tail = document.createElement('div'); head.append(before.cloneContents()); tail.append(after.cloneContents());
    const prefix = readSegments(head), suffix = readSegments(tail), replacement: Block[] = [];
    if (incoming[0]!.type === 'paragraph') incoming[0]!.content.unshift(...prefix);
    else if (prefix.length) replacement.push({...block, content: prefix});
    replacement.push(...incoming);
    if (suffix.length) replacement.push(makeBlock(block.type, suffix));
    const list = [...latest.current.blocks], index = list.findIndex(b => b.id === block.id);
    list.splice(index, 1, ...replacement); focusTarget.current = {id: replacement.at(-1)!.id, start: !suffix.length ? false : true}; onChange(list);
  }
  function keyDown(e: KeyboardEvent<HTMLDivElement>, block: Block) {
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
      const next: Block = {id: crypto.randomUUID(), type: ['bullet', 'todo'].includes(block.type) ? block.type : 'paragraph', checked: false, content: readSegments(temp)};
      const list = latest.current.blocks.map(b => b.id === block.id ? {...b, content: readSegments(el)} : b); list.splice(list.findIndex(b => b.id === block.id) + 1, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
    }
    if (e.key === 'Backspace' && !el.textContent && blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
  }
  return <><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label="Choose images" onChange={e => {const files=Array.from(e.currentTarget.files ?? []); e.currentTarget.value=''; void addImages(files,imageTarget.current);}}/>
    <div id="blocks" ref={root} onClickCapture={e => {
      const math = (e.target as Element).closest<HTMLElement>('[data-math]');
      if (math) {e.preventDefault(); e.stopPropagation(); editInlineMath(math);}
    }} onKeyDownCapture={e => {
      const math = (e.target as Element).closest<HTMLElement>('[data-math]');
      if (math && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); e.stopPropagation(); editInlineMath(math);}
    }} onPasteCapture={e => {
      const files=Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if(!files.length) return;
      e.preventDefault(); e.stopPropagation(); setMenu(null);
      const blockElement=(e.target as Element).closest<HTMLElement>('[data-block-id]');
      void addImages(files,{after:blockElement?.dataset.blockId});
    }}>{blocks.map(block => <Fragment key={block.id}><div data-block-id={block.id} className={'block ' + block.type}>
    <div className="block-controls" role="group" aria-label="Block controls">
      <button className="block-add" title="Add block below" aria-label="Add block below" onClick={e => show(e.currentTarget, [...options.map(option => ({...option, pick: () => { setMenu(null); insert(block.id, option.type); }})), imageChoice(block.id)], 'ADD BLOCK BELOW')}><Icon name="plus"/></button>
      <button className="block-handle" title="Block options" aria-label="Block options" onClick={e => show(e.currentTarget, [...options.map(o => ({...o, pick: () => convert(block, o.type)})), {title: 'Delete block', icon: '×', pick: () => removeBlock(block.id)}], 'BLOCK OPTIONS')}><Icon name="grip"/></button>
    </div>
    {block.type === 'todo' ? <input type="checkbox" aria-label="Complete task" checked={block.checked} onChange={e => update(block.id, {checked: e.target.checked})}/> : block.type === 'bullet' ? <span className="bullet-marker">•</span> : null}
    {block.type === 'math' ? <MathBlock block={block} onDelete={() => removeBlock(block.id)} onChange={source => update(block.id, {content: [{text: source}]})} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'image' ? <ImageBlock block={block} vaultId={props.vaultId} onChange={alt => update(block.id,{alt})} onDelete={() => removeBlock(block.id)} onExit={() => insert(block.id)} onSave={onSave} register={el => {if(el) elements.current.set(block.id,el); else elements.current.delete(block.id);}}/> : block.type === 'table' ? <TableBlock block={block} entities={entities} onChange={rows => update(block.id, {rows})} onOpen={onOpenEntity} onSave={onSave} onExit={() => insert(block.id)} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }}/> : <EditableBlock block={block} entities={entities} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }} onOpen={onOpenEntity} onInput={el => { completeInlineMath(el); update(block.id, {content: readSegments(el)}); detect(el, block); }} onKeyDown={e => keyDown(e, block)} onPaste={e => paste(e, block)}/>}
  </div>{uploadCards(block.id)}</Fragment>)}{uploadCards()}</div>
    <SelectionToolbar onMath={range => setMathTarget({range, initial: range.toString()})} editor={root} entities={entities} onCommit={commitSelection} onCreateEntity={onCreateEntity}/>
    {mathTarget && <MathDialog initial={mathTarget.initial} onSave={saveInlineMath} onClose={() => setMathTarget(null)}/>}
    {imageError && <div className="image-upload-error" role="alert">{imageError}</div>}
    {menu && <div ref={menuRef} className="command-menu" style={{left: menu.left, top: menu.top}} onMouseDown={e => e.preventDefault()} role="menu"><div className="menu-label">{menu.label}</div>{menu.items.map((item, index) => <button key={index} role="menuitem" className={index === menu.index ? 'highlight' : ''} onClick={item.pick}><span className="menu-icon">{item.entity ? <Icon name={item.icon}/> : item.icon}</span><span>{item.title}<small>{item.detail}</small></span></button>)}</div>}
  </>;
}
