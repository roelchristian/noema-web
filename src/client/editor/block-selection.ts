import { entityMentionName } from '../../shared/domain';
import {randomUUID} from '../../shared/uuid';
import {isAIExplanation} from '../../shared/semantic-blocks';
import type { Block, Entity, Segment } from '../../shared/domain';
import { clipboardBlocks, makeBlock } from './paste';
import { readSegments, segmentHTML } from './segments';

type Point = {node: Node; offset: number};
type Focus = {id: string; offset: number};
interface Options {blocks: () => Block[]; entities: () => Entity[]; commit: (blocks: Block[], focus: Focus) => void; clipboard?: (data: DataTransfer) => Block[]}
const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement;
const surface = (node: Node | null) => element(node)?.closest<HTMLElement>('.block-content[contenteditable="true"]');
function paragraphJoinSpace(left: string, right: string): Segment[] {
  const before = left.replace(/\u200b/g, ''), after = right.replace(/\u200b/g, '');
  if (!before || !after || /\s$/u.test(before) || /^\s/u.test(after)) return [];
  if (/[\p{Ps}\p{Pi}\-/]$/u.test(before) || /^[\p{Pe}\p{Pf},.;:!?%…，。；：！？、]/u.test(after)) return [];
  if (/^['’](?:s|t|re|ve|ll|d|m)\b/iu.test(after)) return [];
  // Chinese and Japanese prose does not separate adjacent characters with spaces.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(before) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(after)) return [];
  return [{text: ' '}];
}
const selections = new WeakMap<HTMLElement, Range>();
/** Keep restored cross-host ranges available on browsers that constrain native selection. */
export function setEditorSelectionRange(root: HTMLElement, range: Range) {
  clearEditorSelection(root);
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  selections.set(root, range);
  const selected = selectedEditorBlocks(root);
  selected?.elements.forEach(element => element.setAttribute('data-text-selected', 'true'));
  if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') CSS.highlights.set('noema-block-selection', new Highlight(...editorSelectionRanges(root, range)));
}
export function editorSelectionRange(root: HTMLElement, selection = document.getSelection()): Range | null {
  const saved = selections.get(root);
  if (saved && saved.startContainer.isConnected && saved.endContainer.isConnected && !saved.collapsed) return saved;
  if (saved) clearEditorSelection(root);
  return selection?.rangeCount ? selection.getRangeAt(0) : null;
}
export function clearEditorSelection(root: HTMLElement) {
  selections.delete(root);
  root.querySelectorAll('[data-text-selected]').forEach(element => element.removeAttribute('data-text-selected'));
  if (typeof CSS !== 'undefined') CSS.highlights?.delete('noema-block-selection');
}
const same = (a: Range, b: Range) => a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
function contentRange(block: HTMLElement): Range {
  const range = document.createRange(), surfaces = block.querySelectorAll<HTMLElement>('.block-content');
  if (surfaces.length) {range.setStart(surfaces[0]!, 0); const end = surfaces[surfaces.length - 1]!; range.setEnd(end, end.childNodes.length);}
  else {const body = block.querySelector('.math-block-render,.image-block') ?? block; range.selectNodeContents(body);}
  return range;
}
export function selectedEditorBlocks(root: HTMLElement, selection = document.getSelection()) {
  const range = editorSelectionRange(root, selection);
  if (!range || range.collapsed) return null;
  // Derived reading aids use native selection/copy and cannot edit their source.
  if (element(range.startContainer)?.closest('.block-transliteration') || element(range.endContainer)?.closest('.block-transliteration')) return null;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]')).filter(block => {
    if (block.contains(range.startContainer) || block.contains(range.endContainer)) return true;
    const contents = contentRange(block);
    return contents.comparePoint(range.startContainer,range.startOffset)<=0 && contents.comparePoint(range.endContainer,range.endOffset)>=0;
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
  if (block.type === 'table' || block.type === 'columns') {
    const cells = Array.from(el.querySelectorAll<HTMLElement>('.table-cell')); let index = 0;
    const rows = block.rows?.map(row => row.map(() => clippedSegments(cells[index++]!, range, part)));
    return rows?.some(row => row.some(cell => cell.length)) ? {...block, rows} : undefined;
  }
  const editor = el.querySelector<HTMLElement>('.block-content');
  if (!editor) return part === 'selected' ? block : undefined;
  const content = clippedSegments(editor, range, part);
  return content.length ? {...block, content} : undefined;
}
const textOf = (content: Segment[], entities: Entity[]) => content.map(s => s.entityId ? s.mentionText ?? entityMentionName(entities.find(e => e.id === s.entityId)) ?? '' : s.text ?? '').join('');
/** Preserve block structure and inline metadata while clipping to highlighted content. */
export function editorSelectionBlocks(root: HTMLElement, blocks: Block[]): Block[] {
  const selected = selectedEditorBlocks(root); if (!selected) return [];
  return selected.elements.flatMap(el => {
    const block = blocks.find(b => b.id === el.dataset.blockId);
    const result = block && sliceBlock(block, el, selected.range, 'selected'); return result ? [result] : [];
  });
}
export function editorSelectionClipboard(root: HTMLElement, blocks: Block[], entities: Entity[]) {
  const selected = selectedEditorBlocks(root); if (!selected) return null;
  const slices = editorSelectionBlocks(root, blocks);
  const text = slices.map(block => (block.type === 'table' || block.type === 'columns') ? block.rows?.map(row => row.map(cell => textOf(cell, entities)).join('\t')).join('\n') : block.type === 'math' ? `\\[${textOf(block.content, entities)}\\]` : block.type === 'image' ? block.alt ?? '' : block.type === 'divider' ? '---' : block.type === 'code' ? '```\n'+textOf(block.content, entities)+'\n```' : textOf(block.content, entities)).join('\n\n');
  const escapeAttribute=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const html = slices.map(block => {
    const attributes=(block.type === 'heading1' || block.type === 'heading2' ? ` data-noema-block-type="${block.type}"` : '')+(block.semantic?` data-noema-semantic="${block.semantic}"`:'')+(block.semanticGroup?` data-noema-group="${escapeAttribute(block.semanticGroup.id)}" data-noema-group-kind="${block.semanticGroup.kind}"`:'');
    if (block.type === 'image') {
      const image = selected.elements.find(el => el.dataset.blockId === block.id)?.querySelector('img');
      return image ? `<img${attributes} src="${escapeAttribute(image.src)}" alt="${escapeAttribute(block.alt ?? '')}">` : '';
    }
    if (block.type === 'divider') return '<hr'+attributes+'>';
    if (block.type === 'code') return '<pre'+attributes+'><code>'+escapeAttribute(textOf(block.content, entities)).replace(/>/g,'&gt;')+'</code></pre>';
    if (block.type === 'numbered' || block.type === 'bullet') {const tag=block.type === 'numbered' ? 'ol' : 'ul'; return `<${tag}><li${attributes}>${segmentHTML(block.content, entities, undefined, false, undefined, false)}</li></${tag}>`;}
    if (block.type === 'columns') return '<section data-noema-block-type="columns"'+attributes+'>'+(block.rows?.[0] ?? [[],[]]).map(cell => '<div>'+segmentHTML(cell, entities, undefined, false, undefined, false)+'</div>').join('')+'</section>';
    if (block.type === 'table') return '<table'+attributes+'>'+block.rows?.map(row => '<tr>'+row.map(cell => '<td>'+segmentHTML(cell, entities, undefined, false, undefined, false)+'</td>').join('')+'</tr>').join('')+'</table>';
    const tag = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : block.type === 'quote' ? 'blockquote' : 'p';
    const content = block.type === 'math' ? [{text: `\\[${textOf(block.content, entities)}\\]`}] : block.content;
    return `<${tag}${attributes}>${segmentHTML(content, entities, undefined, false, undefined, false)}</${tag}>`;
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
  const column = list[start]!.column;
  const sameColumn = column && column.id === list[end]!.column?.id && column.index === list[end]!.column?.index;
  const replacement: Block[] = incoming.map(block => ({...block,...(sameColumn?{column}:{}), ...(sameParent?{semanticGroup:parent}:{}), id: block.id}));
  if (prefix) {
    if (replacement[0]?.type === 'paragraph' && prefix.type !== 'table' && prefix.type !== 'columns') replacement[0] = {...prefix, content: [...prefix.content, ...replacement[0].content]};
    else replacement.unshift(prefix);
  }
  let target = replacement.at(-1), offset = target ? textOf(target.content, options.entities()).length : 0;
  if (suffix) {
    if (target && target.semanticGroup?.id === suffix.semanticGroup?.id && target.semantic === suffix.semantic && target.column?.id === suffix.column?.id && target.column?.index === suffix.column?.index && target.type !== 'table' && target.type !== 'columns' && target.type !== 'math' && target.type !== 'image' && suffix.type !== 'table' && suffix.type !== 'columns') target.content = [...target.content, ...suffix.content];
    else {target = {...suffix, id: replacement.some(b => b.id === suffix.id) ? randomUUID() : suffix.id}; replacement.push(target); offset = 0;}
  }
  if (!replacement.length) {target = {...makeBlock(),...(sameColumn?{column}:{})}; replacement.push(target); offset = 0;}
  // A sliced table keeps all unselected cells; continue typing in a text block beside it.
  if (target?.type === 'columns' || target?.type === 'divider' || target?.type === 'code' || target?.type === 'table' || target?.type === 'math' || target?.type === 'image') {const text = {...makeBlock(),column:target.column}; replacement.push(text); target = text; offset = 0;}
  const next = [...list]; next.splice(start, end - start + 1, ...replacement);
  clearEditorSelection(root);
  options.commit(next, {id: target!.id, offset}); return true;
}
export function setEditorCaret(el: HTMLElement, offset: number) {
  const range = document.createRange(); let remaining = offset;
  function visit(node: Node): boolean {
    if (node instanceof HTMLElement && (node.dataset.entity || node.dataset.wikilink!==undefined || node.dataset.math !== undefined)) {
      const size = node.dataset.wikilink?.length ?? node.dataset.math?.length ?? node.textContent?.length ?? 0;
      if (remaining <= size) {if (remaining === 0) range.setStartBefore(node); else range.setStartAfter(node); return true;}
      remaining -= size; return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {const size = node.textContent?.length ?? 0; if (remaining <= size) {range.setStart(node, remaining); return true;} remaining -= size;}
    return Array.from(node.childNodes).some(visit);
  }
  if (!visit(el)) {range.selectNodeContents(el); range.collapse(false);}
  range.collapse(true); el.focus(); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
/** Independent editing hosts cannot natively delete the paragraph break between them. */
export function deleteEditorBlockBoundary(root: HTMLElement, options: Options, direction: 'backward' | 'forward') {
  const range = editorSelectionRange(root);
  if (!range?.collapsed) return false;
  const host = surface(range.startContainer), row = host?.closest<HTMLElement>('[data-block-id]');
  if (!host || !row || !root.contains(host) || host.closest('[inert],[data-semantic-kind="ai-explanation"]')) return false;
  const edge = range.cloneRange();
  if (direction === 'backward') edge.setStart(host, 0); else edge.setEnd(host, host.childNodes.length);
  if (readSegments(edge.cloneContents()).length) return false;
  const blocks = options.blocks(), index = blocks.findIndex(block => block.id === row.dataset.blockId);
  const leftIndex = direction === 'backward' ? index - 1 : index;
  const left = blocks[leftIndex], right = blocks[leftIndex + 1];
  const textTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'numbered', 'todo', 'quote'];
  if (index < 0 || !left || !right || !textTypes.includes(left.type) || !textTypes.includes(right.type)) return false;
  if (isAIExplanation(left) || isAIExplanation(right) || left.semantic !== right.semantic || left.semanticGroup?.id !== right.semanticGroup?.id || left.column?.id !== right.column?.id || left.column?.index !== right.column?.index) return false;
  const editors = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
  const leftHost = editors.find(el => el.dataset.blockId === left.id)?.querySelector<HTMLElement>('.block-content[contenteditable="true"]');
  const rightHost = editors.find(el => el.dataset.blockId === right.id)?.querySelector<HTMLElement>('.block-content[contenteditable="true"]');
  if (!leftHost || !rightHost) return false;
  const prefix = readSegments(leftHost), suffix = readSegments(rightHost);
  // Match setEditorCaret's displayed atom lengths, including citation labels.
  const caretLength = (node: Node): number => {
    if (node instanceof HTMLElement && node.dataset.wikilink !== undefined) return node.dataset.wikilink.length;
    if (node instanceof HTMLElement && node.dataset.math !== undefined) return node.dataset.math.length;
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u200b/g, '').length;
    return Array.from(node.childNodes).reduce((total, child) => total + caretLength(child), 0);
  };
  const space = paragraphJoinSpace(leftHost.textContent ?? '', rightHost.textContent ?? '');
  const offset = caretLength(leftHost) + space.length;
  const next = [...blocks]; next.splice(leftIndex, 2, {...left, content: [...prefix, ...space, ...suffix]});
  clearEditorSelection(root);
  options.commit(next, {id: left.id, offset});
  return true;
}
/** Extend native selection across the independent contenteditable block hosts. */
export function installBlockSelection(root: HTMLElement, options: Options) {
  let progression: Range | undefined, drag: {anchor: Point; host: HTMLElement; cross: boolean; pointer: number} | undefined;
  let selectionFrame: number | undefined, lastPointer: {x:number;y:number} | undefined;
  let scrollHost: HTMLElement | undefined, lastDown: {host:HTMLElement;x:number;y:number;at:number;count:number} | undefined;
  function paint(range: Range) {
    root.querySelectorAll('[data-text-selected]').forEach(element=>element.removeAttribute('data-text-selected'));
    const selected=selectedEditorBlocks(root);
    if (selected && crossesHosts(selected)) {
      selected.elements.forEach(element=>element.setAttribute('data-text-selected','true'));
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') CSS.highlights.set('noema-block-selection',new Highlight(...editorSelectionRanges(root,range)));
    } else if (typeof CSS !== 'undefined') CSS.highlights?.delete('noema-block-selection');
    root.dispatchEvent(new Event('noema:editor-selection'));
  }
  function extend(caret: Point) {
    if (!drag || !drag.anchor.node.isConnected) return;
    const anchor=drag.anchor, start=document.createRange(), end=document.createRange();
    start.setStart(anchor.node,anchor.offset); start.collapse(true);
    end.setStart(caret.node,caret.offset); end.collapse(true);
    const forward=start.compareBoundaryPoints(Range.START_TO_START,end)<=0;
    const range=document.createRange();
    range.setStart(forward?anchor.node:caret.node,forward?anchor.offset:caret.offset);
    range.setEnd(forward?caret.node:anchor.node,forward?caret.offset:anchor.offset);
    document.getSelection()?.setBaseAndExtent(anchor.node,anchor.offset,caret.node,caret.offset);
    if (drag.cross && !range.collapsed) {selections.set(root,range);paint(range);}
    else clearEditorSelection(root);
  }
  function atomicPoint(point: Point, x: number): Point {
    const atom = element(point.node)?.closest<HTMLElement>('[data-entity],[data-math],[data-wikilink]');
    if (!atom?.parentNode || !root.contains(atom)) return point;
    const bounds = atom.getBoundingClientRect(), index = Array.from(atom.parentNode.childNodes).indexOf(atom);
    return {node: atom.parentNode, offset: index + Number(x >= (bounds.left + bounds.right) / 2)};
  }
  function point(x: number, y: number): Point | undefined {
    // Resolve the destination host independently: WebKit may return a caret in
    // the focused host even when the pointer has crossed into another block.
    const hit=document.elementFromPoint(x,y), direct=hit && surface(hit);
    const hosts=direct && root.contains(direct)?[]:Array.from(root.querySelectorAll<HTMLElement>('.block-content[contenteditable="true"]'));
    const host=direct && root.contains(direct)?direct:hosts.reduce<HTMLElement|undefined>((best,item)=>{
      const box=item.getBoundingClientRect(), current=best?.getBoundingClientRect();
      const distance=Math.max(box.top-y,0,y-box.bottom), previous=current?Math.max(current.top-y,0,y-current.bottom):Infinity;
      return distance<previous?item:best;
    },undefined);
    if(!host)return;
    const bounds=host.getBoundingClientRect();
    if(y<bounds.top)return {node:host,offset:0};
    if(y>bounds.bottom)return {node:host,offset:host.childNodes.length};
    const px=Math.max(bounds.left+1,Math.min(x,bounds.right-1)), py=Math.max(bounds.top+1,Math.min(y,bounds.bottom-1));
    const doc = document as Document & {caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node; offset: number} | null; caretRangeFromPoint?: (x: number, y: number) => Range | null};
    const position=doc.caretPositionFromPoint?.(px,py), range=position?undefined:doc.caretRangeFromPoint?.(px,py);
    const caret=position?{node:position.offsetNode,offset:position.offset}:range?{node:range.startContainer,offset:range.startOffset}:undefined;
    if(caret && host.contains(caret.node))return atomicPoint(caret,x);
    // Fall back to the nearest rendered text boundary instead of staying stuck
    // in the original editable host. Only the hovered host is measured.
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    let best: Point={node:host,offset:0}, distance=Infinity;
    while(walker.nextNode()) {
      const node=walker.currentNode;
      let low=0, high=node.textContent?.length ?? 0;
      while(low<=high) {
        const offset=Math.floor((low+high)/2);
        const probe=document.createRange();probe.setStart(node,offset);probe.collapse(true);
        const box=probe.getBoundingClientRect();
        if(!box.height)break;
        const score=Math.max(box.top-y,0,y-box.bottom)*1000+Math.abs(box.left-x);
        if(score<distance){distance=score;best={node,offset};}
        if(y<box.top || y<=box.bottom && x<box.left)high=offset-1;else low=offset+1;
      }
    }
    return atomicPoint(best,x);
  }
  function down(event: PointerEvent) {
    const target=element(event.target as Node);
    if(target?.closest('.selection-popover,.command-menu,.block-handle'))return;
    const previous=editorSelectionRange(root)?.cloneRange();
    clearEditorSelection(root); progression=undefined; drag=undefined;
    if (event.button !== 0 || event.isPrimary===false || event.pointerType === 'touch' || event.detail>1 || target?.closest('button,input,textarea,a,[data-math],[data-entity]')) return;
    const host=surface(event.target as Node);
    if(!host || !root.contains(host))return;
    const at=Date.now(), count=lastDown && lastDown.host===host && at-lastDown.at<450 && Math.hypot(event.clientX-lastDown.x,event.clientY-lastDown.y)<4?lastDown.count+1:1;
    lastDown={host,x:event.clientX,y:event.clientY,at,count};
    if(count>1)return;
    scrollHost=undefined;
    for(let parent=root.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
      if(/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight>parent.clientHeight){scrollHost=parent;break;}
    }
    const caret=point(event.clientX,event.clientY);
    if(!caret || !host.contains(caret.node))return;
    const anchor=event.shiftKey && previous && root.contains(previous.startContainer)?{node:previous.startContainer,offset:previous.startOffset}:caret;
    drag={anchor,host,cross:surface(anchor.node)!==host,pointer:event.pointerId};
    root.dataset.textSelecting='true';
    // Own the gesture before the browser starts host-confined text dragging.
    event.preventDefault(); host.focus({preventScroll:true}); extend(caret);
  }
  function updateDrag() {
    selectionFrame=undefined;
    if(!drag || !lastPointer)return;
    const caret=point(lastPointer.x,lastPointer.y), host=caret && surface(caret.node);
    if(!caret || !host || !root.contains(host))return;
    if(host!==drag.host)drag.cross=true;
    extend(caret);
    const viewport=scrollHost?.getBoundingClientRect(), top=Math.max(0,viewport?.top ?? 0), bottom=Math.min(window.innerHeight,viewport?.bottom ?? window.innerHeight), edge=48;
    const y=lastPointer.y, speed=y<top+edge?-Math.ceil(Math.min(edge,top+edge-y)/4):y>bottom-edge?Math.ceil(Math.min(edge,y-bottom+edge)/4):0;
    if(speed) {
      const before=scrollHost?.scrollTop ?? window.scrollY;
      if(scrollHost)scrollHost.scrollTop+=speed;else window.scrollBy({top:speed,behavior:'instant'});
      if(before!==(scrollHost?.scrollTop ?? window.scrollY))selectionFrame=requestAnimationFrame(updateDrag);
    }
  }
  function move(event: PointerEvent) {
    if(!drag || event.pointerId!==drag.pointer)return;
    if(!(event.buttons&1)){up();return;}
    event.preventDefault(); lastPointer={x:event.clientX,y:event.clientY};
    if(selectionFrame===undefined)selectionFrame=requestAnimationFrame(updateDrag);
  }
  function up(event?: PointerEvent) {
    if(event && drag && event.pointerId!==drag.pointer)return;
    if(event && drag)lastPointer={x:event.clientX,y:event.clientY};
    if(selectionFrame!==undefined)cancelAnimationFrame(selectionFrame);selectionFrame=undefined;
    if(drag && lastPointer)updateDrag();
    if(selectionFrame!==undefined)cancelAnimationFrame(selectionFrame);selectionFrame=undefined;
    if(event && drag?.cross)event.preventDefault();
    drag=undefined;lastPointer=undefined;scrollHost=undefined;delete root.dataset.textSelecting;
    root.dispatchEvent(new Event('noema:editor-selection'));
  }
  const blur=()=>{if(selectionFrame!==undefined)cancelAnimationFrame(selectionFrame);selectionFrame=undefined;drag=undefined;lastPointer=undefined;delete root.dataset.textSelecting;};
  function cancelPointer(event:PointerEvent) {if(!drag || event.pointerId===drag.pointer)blur();}
  function nativeDrag(event: DragEvent) {
    if(drag){event.preventDefault();}
  }
  function refreshSelection() {
    const range=selections.get(root);
    if(range && (!range.startContainer.isConnected || !range.endContainer.isConnected))clearEditorSelection(root);
  }
  function key(event: KeyboardEvent) {
    if (event.isComposing) return;
    const target = element(event.target as Node);
    if (target?.closest('input,textarea,button,select')) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      clearEditorSelection(root);
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
    if(event.key==='Tab')clearEditorSelection(root);
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      const selected = selectedEditorBlocks(root);
      if (selected && crossesHosts(selected)) {
        const portions = editorSelectionRanges(root, selected.range), left = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const edge = (left ? portions[0] : portions.at(-1))?.cloneRange();
        if (edge) {clearEditorSelection(root);edge.collapse(left); surface(edge.startContainer)?.focus(); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(edge); event.preventDefault(); event.stopPropagation(); return;}
      }
    }
    if (event.key.startsWith('Arrow') && event.shiftKey) clearEditorSelection(root);
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
    if ((event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') && replaceEditorSelection(root, options, event.key === 'Enter' ? [makeBlock(), makeBlock()] : [])) {event.preventDefault(); event.stopPropagation(); return;}
    if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'Backspace' || event.key === 'Delete') && deleteEditorBlockBoundary(root, options, event.key === 'Backspace' ? 'backward' : 'forward')) {event.preventDefault(); event.stopPropagation();}
  }
  function beforeInput(event: InputEvent) {
    if (event.cancelable && event.inputType.startsWith('delete') && replaceEditorSelection(root, options)) {event.preventDefault(); event.stopPropagation(); return;}
    const direction = event.inputType === 'deleteContentBackward' ? 'backward' : event.inputType === 'deleteContentForward' ? 'forward' : null;
    if (event.cancelable && !event.isComposing && direction && deleteEditorBlockBoundary(root, options, direction)) {event.preventDefault(); event.stopPropagation(); return;}
    if (!event.cancelable || !event.inputType.startsWith('insert') || event.inputType === 'insertFromPaste' || !event.data) return;
    if (replaceEditorSelection(root, options, [makeBlock('paragraph', [{text: event.data}])])) {event.preventDefault(); event.stopPropagation();}
  }
  function copy(event: ClipboardEvent) {
    const selected = selectedEditorBlocks(root); if (!selected || !event.clipboardData) return;
    if (!crossesHosts(selected)) {
      const fragment=selected.range.cloneContents();
      if (!fragment.querySelector('.external-link-indicator')) return;
      fragment.querySelectorAll('.external-link-indicator').forEach(node=>node.remove());
      const wrapper=document.createElement('div');wrapper.append(fragment);
      event.clipboardData.setData('text/plain',selected.range.toString());
      event.clipboardData.setData('text/html',wrapper.innerHTML);
      event.preventDefault();event.stopPropagation();
      if(event.type==='cut') {
        const host=(selected.range.startContainer instanceof Element?selected.range.startContainer:selected.range.startContainer.parentElement)?.closest('.block-content');
        selected.range.deleteContents();
        host?.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteByCut'}));
      }
      return;
    }
    const content = editorSelectionClipboard(root, options.blocks(), options.entities()); if (!content) return;
    event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData('text/html', content.html);
    event.preventDefault(); event.stopPropagation(); if (event.type === 'cut') replaceEditorSelection(root, options);
  }
  function paste(event: ClipboardEvent) {
    const selected = selectedEditorBlocks(root); if (!selected || !crossesHosts(selected) || !event.clipboardData) return;
    const blocks = options.clipboard ? options.clipboard(event.clipboardData) : clipboardBlocks(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
    if (replaceEditorSelection(root, options, blocks)) {event.preventDefault(); event.stopPropagation();}
  }
  document.addEventListener('pointerdown', down, true); document.addEventListener('pointermove', move, {capture:true,passive:false}); window.addEventListener('blur',blur); root.addEventListener('dragstart',nativeDrag); document.addEventListener('selectionchange',refreshSelection); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancelPointer);
  root.addEventListener('keydown', key, true); root.addEventListener('beforeinput', beforeInput, true); root.addEventListener('copy', copy, true); root.addEventListener('cut', copy, true); root.addEventListener('paste', paste, true);
  return () => {delete root.dataset.textSelecting;clearEditorSelection(root); if(selectionFrame!==undefined)cancelAnimationFrame(selectionFrame); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true); window.removeEventListener('blur',blur); root.removeEventListener('dragstart',nativeDrag); document.removeEventListener('selectionchange',refreshSelection); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancelPointer); root.removeEventListener('keydown', key, true); root.removeEventListener('beforeinput', beforeInput, true); root.removeEventListener('copy', copy, true); root.removeEventListener('cut', copy, true); root.removeEventListener('paste', paste, true);};
}
