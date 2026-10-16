import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { entityLabels, type Block, type BlockType, type Entity, type Segment } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { readSegments, segmentHTML } from './segments';
interface Props {blocks: Block[]; entities: Entity[]; onChange: (blocks: Block[]) => void; onOpenEntity: (id: string) => void; onCreateEntity: (name: string, onCreated: (id: string) => void) => void; onSave: () => void}
const options: {type: BlockType; title: string; detail: string; icon: string}[] = [
  {type: 'paragraph', title: 'Text', detail: 'Plain text for your thoughts', icon: 'T'},
  {type: 'heading1', title: 'Heading 1', detail: 'A large section heading', icon: 'H₁'},
  {type: 'heading2', title: 'Heading 2', detail: 'A smaller section heading', icon: 'H₂'},
  {type: 'bullet', title: 'Bullet list', detail: 'A simple list of ideas', icon: '•'},
  {type: 'todo', title: 'To-do', detail: 'Keep track of a task', icon: '☑'},
  {type: 'quote', title: 'Quote', detail: 'Make a thought stand out', icon: '❝'},
];
interface Choice {title: string; detail?: string; icon: string; entity?: boolean; pick: () => void}
interface Menu {items: Choice[]; index: number; left: number; top: number; label: string}
function EditableBlock({block, entities, onInput, onKeyDown, onOpen, register}: {block: Block; entities: Entity[]; onInput: (el: HTMLDivElement) => void; onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void; onOpen: (id: string) => void; register: (el: HTMLDivElement | null) => void}) {
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
    onPaste={e => {
      e.preventDefault(); const selection = getSelection(); if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(e.clipboardData.getData('text/plain')); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); onInput(e.currentTarget);
    }}/>;
}
export function BlockEditor(props: Props) {
  const {blocks, entities, onChange, onOpenEntity, onCreateEntity, onSave} = props;
  const [menu, setMenu] = useState<Menu | null>(null), elements = useRef(new Map<string, HTMLDivElement>());
  const root = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const focusTarget = useRef<{id: string; start: boolean} | null>(null);
  useLayoutEffect(() => {
    const target = focusTarget.current; if (!target) return;
    const el = elements.current.get(target.id); if (!el) return; focusTarget.current = null;
    el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(target.start); getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
  }, [blocks]);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  function update(id: string, patch: Partial<Block>) { onChange(latest.current.blocks.map(b => b.id === id ? {...b, ...patch} : b)); }
  function insert(after: string | undefined, type: BlockType = 'paragraph', content: Segment[] = []) {
    const next: Block = {id: crypto.randomUUID(), type, content, checked: false}, list = [...latest.current.blocks];
    list.splice(after ? list.findIndex(b => b.id === after) + 1 : list.length, 0, next); focusTarget.current = {id: next.id, start: true}; onChange(list);
  }
  function convert(block: Block, type: BlockType, clear = false) { setMenu(null); focusTarget.current = {id: block.id, start: false}; update(block.id, {type, ...(clear ? {content: []} : {}), checked: false}); }
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
      const query = el.textContent!.slice(1).toLowerCase(); show(el, options.filter(o => o.title.toLowerCase().includes(query)).map(o => ({...o, pick: () => convert(block, o.type, true)})), 'TURN INTO'); return;
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
    if (e.key === 'Backspace' && !el.textContent && blocks.length > 1) { e.preventDefault(); const index = blocks.findIndex(b => b.id === block.id); focusTarget.current = {id: blocks[index > 0 ? index - 1 : index + 1]!.id, start: false}; onChange(blocks.filter(b => b.id !== block.id)); setMenu(null); }
  }
  return <><div id="blocks" ref={root}>{blocks.map(block => <div key={block.id} className={'block ' + block.type}>
    <button className="block-handle" title="Block options" aria-label="Block options" onClick={e => show(e.currentTarget, [...options.map(o => ({...o, pick: () => convert(block, o.type)})), {title: 'Delete block', icon: '×', pick: () => { setMenu(null); if (blocks.length > 1) onChange(blocks.filter(b => b.id !== block.id)); else update(block.id, {content: []}); }}], 'BLOCK OPTIONS')}>⠿</button>
    {block.type === 'todo' ? <input type="checkbox" aria-label="Complete task" checked={block.checked} onChange={e => update(block.id, {checked: e.target.checked})}/> : block.type === 'bullet' ? <span className="bullet-marker">•</span> : null}
    <EditableBlock block={block} entities={entities} register={el => { if (el) elements.current.set(block.id, el); else elements.current.delete(block.id); }} onOpen={onOpenEntity} onInput={el => { update(block.id, {content: readSegments(el)}); detect(el, block); }} onKeyDown={e => keyDown(e, block)}/>
  </div>)}</div><button id="add-block" onClick={() => insert(blocks.at(-1)?.id)}>+ <span>Add a block</span></button>
    {menu && <div ref={menuRef} className="command-menu" style={{left: menu.left, top: menu.top}} onMouseDown={e => e.preventDefault()} role="menu"><div className="menu-label">{menu.label}</div>{menu.items.map((item, index) => <button key={index} role="menuitem" className={index === menu.index ? 'highlight' : ''} onClick={item.pick}><span className="menu-icon">{item.entity ? <Icon name={item.icon}/> : item.icon}</span><span>{item.title}<small>{item.detail}</small></span></button>)}</div>}
  </>;
}
