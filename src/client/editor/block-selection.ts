import {isAIExplanation} from '../../shared/semantic-blocks';
import type { Block, Entity, Segment } from '../../shared/domain';
import { clipboardBlocks, makeBlock } from './paste';
import { readSegments, segmentHTML } from './segments';

type Point = {node: Node; offset: number};
type Focus = {id: string; offset: number};
interface Options {blocks: () => Block[]; entities: () => Entity[]; commit: (blocks: Block[], focus: Focus) => void}
const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement;
const surface = (node: Node | null) => element(node)?.closest<HTMLElement>('.block-content[contenteditable="true"]');
const same = (a: Range, b: Range) => a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
function contentRange(block: HTMLElement): Range {
  const range = document.createRange(), surfaces = block.querySelectorAll<HTMLElement>('.block-content');
  if (surfaces.length) {range.setStart(surfaces[0]!, 0); const end = surfaces[surfaces.length - 1]!; range.setEnd(end, end.childNodes.length);}
  else {const body = block.querySelector('.math-block-render,.image-block') ?? block; range.selectNodeContents(body);}
  return range;
}
export function selectedEditorBlocks(root: HTMLElement, selection = document.getSelection()) {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]')).filter(block => {
    if (block.contains(range.startContainer) || block.contains(range.endContainer)) return true;
    const contents = contentRange(block);
    return range.compareBoundaryPoints(Range.END_TO_START, contents) < 0 && range.compareBoundaryPoints(Range.START_TO_END, contents) > 0;
  });
  return elements.length ? {range, elements} : null;
}
function crossesHosts(selected: NonNullable<ReturnType<typeof selectedEditorBlocks>>) {
  const start = surface(selected.range.startContainer), end = surface(selected.range.endContainer);
  return selected.elements.length > 1 || !start || !end || start !== end;
}
export function editorSelectionRanges(root: HTMLElement, range: Range) {
  return Array.from(root.querySelectorAll<HTMLElement>('.block-content[contenteditable="true"]')).flatMap(el => {
    const clipped = document.createRange(); clipped.selectNodeContents(el);
    if (clipped.comparePoint(range.startContainer, range.startOffset) > 0 || clipped.comparePoint(range.endContainer, range.endOffset) < 0) return [];
    if (clipped.comparePoint(range.startContainer, range.startOffset) === 0) clipped.setStart(range.startContainer, range.startOffset);
    if (clipped.comparePoint(range.endContainer, range.endOffset) === 0) clipped.setEnd(range.endContainer, range.endOffset);
    return clipped.collapsed ? [] : [clipped];
  });
}
function clippedSegments(el: HTMLElement, selection: Range, part: 'before' | 'selected' | 'after'): Segment[] {
  const range = document.createRange(); range.selectNodeContents(el);
  const start = {node: selection.startContainer, offset: selection.startOffset}, end = {node: selection.endContainer, offset: selection.endOffset};
  if (part === 'before') {
    if (range.comparePoint(start.node, start.offset) < 0) return [];
    if (range.comparePoint(start.node, start.offset) === 0) range.setEnd(start.node, start.offset);
  } else if (part === 'after') {
    if (range.comparePoint(end.node, end.offset) > 0) return [];
    if (range.comparePoint(end.node, end.offset) === 0) range.setStart(end.node, end.offset);
  } else {
    if (range.comparePoint(start.node, start.offset) > 0 || range.comparePoint(end.node, end.offset) < 0) return [];
    if (range.comparePoint(start.node, start.offset) === 0) range.setStart(start.node, start.offset);
    if (range.comparePoint(end.node, end.offset) === 0) range.setEnd(end.node, end.offset);
  }
  return readSegments(range.cloneContents());
}
function sliceBlock(block: Block, el: HTMLElement, range: Range, part: 'before' | 'selected' | 'after'): Block | undefined {
  if (block.type === 'table') {
    const cells = Array.from(el.querySelectorAll<HTMLElement>('.table-cell')); let index = 0;
    const rows = block.rows?.map(row => row.map(() => clippedSegments(cells[index++]!, range, part)));
    return rows?.some(row => row.some(cell => cell.length)) ? {...block, rows} : undefined;
  }
  const editor = el.querySelector<HTMLElement>('.block-content');
  if (!editor) return part === 'selected' ? block : undefined;
  const content = clippedSegments(editor, range, part);
  return content.length ? {...block, content} : undefined;
}
const textOf = (content: Segment[], entities: Entity[]) => content.map(s => s.entityId ? s.mentionText ?? entities.find(e => e.id === s.entityId)?.name ?? '' : s.text ?? '').join('');
export function editorSelectionClipboard(root: HTMLElement, blocks: Block[], entities: Entity[]) {
  const selected = selectedEditorBlocks(root); if (!selected) return null;
  const slices = selected.elements.flatMap(el => {
    const block = blocks.find(b => b.id === el.dataset.blockId);
    const result = block && sliceBlock(block, el, selected.range, 'selected'); return result ? [result] : [];
  });
  const text = slices.map(block => block.type === 'table' ? block.rows?.map(row => row.map(cell => textOf(cell, entities)).join('\t')).join('\n') : block.type === 'math' ? `\\[${textOf(block.content, entities)}\\]` : block.type === 'image' ? block.alt ?? '' : textOf(block.content, entities)).join('\n\n');
  const escapeAttribute=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const html = slices.map(block => {
    const attributes=(block.type === 'heading1' || block.type === 'heading2' ? ` data-noema-block-type="${block.type}"` : '')+(block.semantic?` data-noema-semantic="${block.semantic}"`:'')+(block.semanticGroup?` data-noema-group="${escapeAttribute(block.semanticGroup.id)}" data-noema-group-kind="${block.semanticGroup.kind}"`:'');
    if (block.type === 'table') return '<table'+attributes+'>'+block.rows?.map(row => '<tr>'+row.map(cell => '<td>'+segmentHTML(cell, entities)+'</td>').join('')+'</tr>').join('')+'</table>';
    const tag = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : block.type === 'quote' ? 'blockquote' : 'p';
    const content = block.type === 'math' ? [{text: `\\[${textOf(block.content, entities)}\\]`}] : block.type === 'image' ? [{text: block.alt ?? ''}] : block.content;
    return `<${tag}${attributes}>${segmentHTML(content, entities)}</${tag}>`;
  }).join('');
  return {text, html};
}
export function replaceEditorSelection(root: HTMLElement, options: Options, incoming: Block[] = []) {
  const selected = selectedEditorBlocks(root); if (!selected || !crossesHosts(selected)) return false;
  const list = options.blocks(), firstEl = selected.elements[0]!, lastEl = selected.elements.at(-1)!;
  const start = list.findIndex(b => b.id === firstEl.dataset.blockId), end = list.findIndex(b => b.id === lastEl.dataset.blockId);
  if (start < 0 || end < start) return false;
  if (list.slice(start,end+1).some(isAIExplanation)) return true;
  const prefix = sliceBlock(list[start]!, firstEl, selected.range, 'before'), suffix = sliceBlock(list[end]!, lastEl, selected.range, 'after');
  const parent=list[start]!.semanticGroup, sameParent=parent && parent.id===list[end]!.semanticGroup?.id;
  const replacement: Block[] = incoming.map(block => ({...block, ...(sameParent?{semanticGroup:parent}:{}), id: crypto.randomUUID()}));
  if (prefix) {
    if (replacement[0]?.type === 'paragraph' && prefix.type !== 'table') replacement[0] = {...prefix, content: [...prefix.content, ...replacement[0].content]};
    else replacement.unshift(prefix);
  }
  let target = replacement.at(-1), offset = target ? textOf(target.content, options.entities()).length : 0;
  if (suffix) {
    if (target && target.semanticGroup?.id === suffix.semanticGroup?.id && target.semantic === suffix.semantic && target.type !== 'table' && target.type !== 'math' && target.type !== 'image' && suffix.type !== 'table') target.content = [...target.content, ...suffix.content];
    else {target = {...suffix, id: replacement.some(b => b.id === suffix.id) ? crypto.randomUUID() : suffix.id}; replacement.push(target); offset = 0;}
  }
  if (!replacement.length) {target = makeBlock(); replacement.push(target); offset = 0;}
  // A sliced table keeps all unselected cells; continue typing in a text block beside it.
  if (target?.type === 'table' || target?.type === 'math' || target?.type === 'image') {const text = makeBlock(); replacement.push(text); target = text; offset = 0;}
  const next = [...list]; next.splice(start, end - start + 1, ...replacement);
  options.commit(next, {id: target!.id, offset}); return true;
}
export function setEditorCaret(el: HTMLElement, offset: number) {
  const range = document.createRange(); let remaining = offset;
  function visit(node: Node): boolean {
    if (node instanceof HTMLElement && (node.dataset.entity || node.dataset.math !== undefined)) {
      const size = node.dataset.math?.length ?? node.textContent?.length ?? 0;
      if (remaining <= size) {if (remaining === 0) range.setStartBefore(node); else range.setStartAfter(node); return true;}
      remaining -= size; return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {const size = node.textContent?.length ?? 0; if (remaining <= size) {range.setStart(node, remaining); return true;} remaining -= size;}
    return Array.from(node.childNodes).some(visit);
  }
  if (!visit(el)) {range.selectNodeContents(el); range.collapse(false);}
  range.collapse(true); el.focus(); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
/** Extend native selection across the independent contenteditable block hosts. */
export function installBlockSelection(root: HTMLElement, options: Options) {
  let progression: Range | undefined, drag: {anchor: Point; host: HTMLElement; cross: boolean} | undefined;
  function atomicPoint(point: Point, x: number): Point {
    const atom = element(point.node)?.closest<HTMLElement>('[data-entity],[data-math]');
    if (!atom?.parentNode || !root.contains(atom)) return point;
    const bounds = atom.getBoundingClientRect(), index = Array.from(atom.parentNode.childNodes).indexOf(atom);
    return {node: atom.parentNode, offset: index + Number(x >= (bounds.left + bounds.right) / 2)};
  }
  function point(x: number, y: number): Point | undefined {
    const doc = document as Document & {caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node; offset: number} | null; caretRangeFromPoint?: (x: number, y: number) => Range | null};
    const position = doc.caretPositionFromPoint?.(x, y); if (position) return atomicPoint({node: position.offsetNode, offset: position.offset}, x);
    const range = doc.caretRangeFromPoint?.(x, y); return range ? atomicPoint({node: range.startContainer, offset: range.startOffset}, x) : undefined;
  }
  function down(event: PointerEvent) {
    progression = undefined; drag = undefined;
    if (event.button !== 0 || event.pointerType === 'touch' || element(event.target as Node)?.closest('button,input,textarea,[data-math],[data-entity]')) return;
    const host = surface(event.target as Node), caret = point(event.clientX, event.clientY);
    if (!host || !root.contains(host) || !caret || !host.contains(caret.node)) return;
    const selection = document.getSelection();
    const anchor = event.shiftKey && selection?.anchorNode && root.contains(selection.anchorNode) ? {node: selection.anchorNode, offset: selection.anchorOffset} : caret;
    drag = {anchor, host, cross: false};
    if (event.shiftKey && surface(anchor.node) !== host) {event.preventDefault(); selection?.setBaseAndExtent(anchor.node, anchor.offset, caret.node, caret.offset); drag.cross = true;}
  }
  function move(event: MouseEvent) {
    if (!drag || !(event.buttons & 1)) return;
    const caret = point(event.clientX, event.clientY), host = caret && surface(caret.node);
    if (!caret || !host || !root.contains(host)) return;
    if (host !== drag.host) drag.cross = true;
    if (!drag.cross) return;
    event.preventDefault();
    document.getSelection()?.setBaseAndExtent(drag.anchor.node, drag.anchor.offset, caret.node, caret.offset);
  }
  function up() {drag = undefined;}
  function key(event: KeyboardEvent) {
    if (event.isComposing) return;
    const target = element(event.target as Node);
    if (target?.closest('input,textarea,button,select')) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      const selection = document.getSelection();
      const current = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      const block = element(selection?.focusNode ?? null)?.closest<HTMLElement>('[data-block-id]') ?? target?.closest<HTMLElement>('[data-block-id]');
      if (!selection || !block || !root.contains(block)) return;
      const next = document.createRange();
      if (progression && current && same(current, progression)) next.selectNodeContents(root); else {const contents = contentRange(block); next.setStart(contents.startContainer, contents.startOffset); next.setEnd(contents.endContainer, contents.endOffset);}
      selection.removeAllRanges(); selection.addRange(next); progression = next.cloneRange();
      event.preventDefault(); event.stopPropagation(); return;
    }
    progression = undefined;
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      const selected = selectedEditorBlocks(root);
      if (selected && crossesHosts(selected)) {
        const portions = editorSelectionRanges(root, selected.range), left = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const edge = (left ? portions[0] : portions.at(-1))?.cloneRange();
        if (edge) {edge.collapse(left); surface(edge.startContainer)?.focus(); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(edge); event.preventDefault(); event.stopPropagation(); return;}
      }
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const selection = document.getSelection(), host = surface(selection?.focusNode ?? null);
      if (selection?.anchorNode && selection.focusNode && host && root.contains(host)) {
        const edge = document.createRange(); edge.selectNodeContents(host);
        const left = event.key === 'ArrowLeft';
        if (left) edge.setEnd(selection.focusNode, selection.focusOffset); else edge.setStart(selection.focusNode, selection.focusOffset);
        if (!edge.toString()) {
          const surfaces = Array.from(root.querySelectorAll<HTMLElement>('.block-content[contenteditable="true"]'));
          const next = surfaces[surfaces.indexOf(host) + (left ? -1 : 1)];
          if (next) {selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, next, left ? next.childNodes.length : 0); event.preventDefault(); event.stopPropagation(); return;}
        }
      }
    }
    if ((event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') && replaceEditorSelection(root, options, event.key === 'Enter' ? [makeBlock(), makeBlock()] : [])) {event.preventDefault(); event.stopPropagation();}
  }
  function beforeInput(event: InputEvent) {
    if (event.cancelable && event.inputType.startsWith('delete') && replaceEditorSelection(root, options)) {event.preventDefault(); event.stopPropagation(); return;}
    if (!event.cancelable || !event.inputType.startsWith('insert') || event.inputType === 'insertFromPaste' || !event.data) return;
    if (replaceEditorSelection(root, options, [makeBlock('paragraph', [{text: event.data}])])) {event.preventDefault(); event.stopPropagation();}
  }
  function copy(event: ClipboardEvent) {
    const selected = selectedEditorBlocks(root); if (!selected || !crossesHosts(selected) || !event.clipboardData) return;
    const content = editorSelectionClipboard(root, options.blocks(), options.entities()); if (!content) return;
    event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData('text/html', content.html);
    event.preventDefault(); event.stopPropagation(); if (event.type === 'cut') replaceEditorSelection(root, options);
  }
  function paste(event: ClipboardEvent) {
    const selected = selectedEditorBlocks(root); if (!selected || !crossesHosts(selected) || !event.clipboardData || event.clipboardData.files.length) return;
    const blocks = clipboardBlocks(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
    if (replaceEditorSelection(root, options, blocks)) {event.preventDefault(); event.stopPropagation();}
  }
  document.addEventListener('pointerdown', down); document.addEventListener('pointermove', move, {passive: false}); document.addEventListener('mousemove', move, {capture: true, passive: false}); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  root.addEventListener('keydown', key, true); root.addEventListener('beforeinput', beforeInput, true); root.addEventListener('copy', copy, true); root.addEventListener('cut', copy, true); root.addEventListener('paste', paste, true);
  return () => {document.removeEventListener('pointerdown', down); document.removeEventListener('pointermove', move); document.removeEventListener('mousemove', move, true); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); root.removeEventListener('keydown', key, true); root.removeEventListener('beforeinput', beforeInput, true); root.removeEventListener('copy', copy, true); root.removeEventListener('cut', copy, true); root.removeEventListener('paste', paste, true);};
}
