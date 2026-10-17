import { applySmartQuotes } from './smart-quotes';
import { replaceEditableHTML } from './preserve-caret';
import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { Block, Entity, Segment } from '../../shared/domain';
import { clipboardBlocks } from './paste';
import { readSegments, segmentHTML } from './segments';
import { completeInlineMath } from './math';
function Cell({content, entities, register, onChange, onKeyDown, onPaste, onOpen}: {content: Segment[]; entities: Entity[]; register?: (el: HTMLDivElement | null) => void; onChange: (content: Segment[]) => void; onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void; onPaste: (e: ClipboardEvent<HTMLDivElement>) => void; onOpen: (id: string) => void}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = ref.current!; if (JSON.stringify(readSegments(el)) !== JSON.stringify(content)) replaceEditableHTML(el, segmentHTML(content, entities)); }, [content, entities]);
  return <div className="block-content table-cell" ref={el => {ref.current = el; register?.(el);}} contentEditable suppressContentEditableWarning aria-label="Table cell" onInput={e => {applySmartQuotes(e.currentTarget, e.nativeEvent as InputEvent); completeInlineMath(e.currentTarget); onChange(readSegments(e.currentTarget));}} onKeyDown={onKeyDown} onPaste={onPaste} onClick={e => {const mention = (e.target as Element).closest<HTMLElement>('[data-entity]'); if(mention) onOpen(mention.dataset.entity!);}}/>;
}
export function TableBlock({block, entities, onChange, onOpen, onSave, onExit, register}: {block: Block; entities: Entity[]; onChange: (rows: Segment[][][]) => void; onOpen: (id: string) => void; onSave: () => void; onExit: () => void; register: (el: HTMLDivElement | null) => void}) {
  const rows = block.rows ?? [[[], []], [[], []]], root = useRef<HTMLDivElement>(null), pending = useRef<number | null>(null);
  useLayoutEffect(() => { if(pending.current !== null) {root.current?.querySelectorAll<HTMLElement>('[contenteditable]')[pending.current]?.focus(); pending.current = null;} }, [rows]);
  function changeCell(row: number, col: number, content: Segment[]) { onChange(rows.map((cells, r) => cells.map((cell, c) => r === row && c === col ? content : cell))); }
  function paste(e: ClipboardEvent<HTMLDivElement>, row: number, col: number) {
    e.preventDefault(); const blocks = clipboardBlocks(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html'));
    const table = blocks.length === 1 && blocks[0]!.type === 'table' ? blocks[0]!.rows : undefined;
    if(table) {
      const height = Math.min(100, Math.max(rows.length, row + table.length)), width = Math.min(20, Math.max(rows[0]!.length, col + table[0]!.length));
      onChange(Array.from({length: height}, (_, r) => Array.from({length: width}, (_, c) => table[r - row]?.[c - col] ?? rows[r]?.[c] ?? []))); return;
    }
    const content = blocks.flatMap((b, i) => [...(i ? [{text: '\n'}] : []), ...b.content]);
    const selection = getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); if(!e.currentTarget.contains(range.commonAncestorContainer)) return;
    range.deleteContents(); const wrapper = document.createElement('div'); wrapper.innerHTML = segmentHTML(content, entities);
    const fragment = document.createDocumentFragment(); while(wrapper.firstChild) fragment.append(wrapper.firstChild);
    const last = fragment.lastChild; range.insertNode(fragment); if(last) range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    changeCell(row, col, readSegments(e.currentTarget));
  }
  return <div className="table-block" ref={root}><div className="table-scroll"><table style={{minWidth: rows[0]!.length * 140}}><tbody>{rows.map((cells, row) => <tr key={row}>{cells.map((content, col) => <td key={col}><Cell content={content} entities={entities} register={row === 0 && col === 0 ? register : undefined} onOpen={onOpen} onChange={content => changeCell(row, col, content)} onPaste={e => paste(e, row, col)} onKeyDown={e => {
    if(e.nativeEvent.isComposing) return;
    if((e.metaKey || e.ctrlKey) && e.key === 's') {e.preventDefault(); onSave();}
    if(e.key === 'Enter' && !e.shiftKey) {e.preventDefault(); onExit();}
    if(e.key === 'Tab') {
      const index = row * cells.length + col + (e.shiftKey ? -1 : 1);
      const next = root.current?.querySelectorAll<HTMLElement>('[contenteditable]')[index];
      if(next) {e.preventDefault(); next.focus();} else if(!e.shiftKey && rows.length < 100) {e.preventDefault(); pending.current = index; onChange([...rows, cells.map(() => [])]);}
    }
  }}/></td>)}</tr>)}</tbody></table></div><div className="table-actions" role="group" aria-label="Table controls">
    <button disabled={rows.length >= 100} onClick={() => onChange([...rows, rows[0]!.map(() => [])])}>+ Row</button>
    <button disabled={rows[0]!.length >= 20} onClick={() => onChange(rows.map(row => [...row, []]))}>+ Column</button>
    <button disabled={rows.length <= 1} onClick={() => onChange(rows.slice(0,-1))}>Remove last row</button>
    <button disabled={rows[0]!.length <= 1} onClick={() => onChange(rows.map(row => row.slice(0,-1)))}>Remove last column</button>
  </div></div>;
}
