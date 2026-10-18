import {clearEditorSelection, editorSelectionRange, setEditorSelectionRange} from './block-selection';

/** DOM-independent coordinates survive React rendering and editable HTML replacement. */
export interface EditorHistoryPoint {blockId: string; surface: number; offset: number}
export type EditorHistorySelection =
  | {kind: 'text'; anchor: EditorHistoryPoint; focus: EditorHistoryPoint}
  | {kind: 'title'; start: number; end: number; direction: 'forward' | 'backward' | 'none'}
  | {kind: 'block'; blockId: string}
  | {kind: 'input'; blockId: string; index: number; start: number; end: number; direction: 'forward' | 'backward' | 'none'};
type DOMPoint = {node: Node; offset: number};
const elementOf = (node: Node) => node instanceof Element ? node : node.parentElement;
const textLength = (text: string) => text.replace(/\u200b/g, '').length;
const selectionRoot = (root: HTMLElement) => root.querySelector<HTMLElement>('#blocks') ?? root;
const restorationVersions = new WeakMap<HTMLElement, number>();
function atomLength(node: Node): number | undefined {
  if (!(node instanceof HTMLElement)) return;
  if (node.dataset.wikilink !== undefined) return node.dataset.wikilink.length;
  if (node.dataset.math !== undefined) return node.dataset.math.length;
  if (node.dataset.entity !== undefined) return textLength(node.dataset.mentionText ?? node.textContent ?? '');
  if (node.tagName === 'BR') return 1;
}
function lengthOf(node: Node): number {
  return atomLength(node) ?? (node.nodeType === Node.TEXT_NODE ? textLength(node.textContent ?? '') : Array.from(node.childNodes).reduce((length, child) => length + lengthOf(child), 0));
}
function offsetOf(host: HTMLElement, target: Node, offset: number): number {
  let length = 0, done = false;
  function visit(node: Node) {
    if (done) return;
    if (node === target) {
      const atom = atomLength(node);
      length += atom !== undefined ? (offset ? atom : 0) : node.nodeType === Node.TEXT_NODE ? textLength((node.textContent ?? '').slice(0, offset)) : Array.from(node.childNodes).slice(0, offset).reduce((total, child) => total + lengthOf(child), 0);
      done = true; return;
    }
    const atom = atomLength(node);
    if (atom !== undefined) {
      // Native selection occasionally lands inside a noneditable mention or equation.
      if (node.contains(target)) {length += offset === 0 ? 0 : atom; done = true;}
      else length += atom;
    } else if (node.nodeType === Node.TEXT_NODE) length += lengthOf(node);
    else node.childNodes.forEach(visit);
  }
  visit(host); return length;
}
function capturePoint(root: HTMLElement, node: Node, offset: number, end: boolean): EditorHistoryPoint | null {
  let block = elementOf(node)?.closest<HTMLElement>('[data-block-id]');
  if (!block || !root.contains(block)) {
    // Select All may place its boundaries on the editor root or group containers.
    if (!root.contains(node)) return null;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
    const probe = document.createRange(); probe.setStart(node, offset); probe.collapse(true);
    block = (end ? blocks.filter(item => probe.comparePoint(item, 0) <= 0).at(-1) : blocks.find(item => probe.comparePoint(item, item.childNodes.length) >= 0)) ?? (end ? blocks.at(-1) : blocks[0]);
    if (!block) return null;
    const hosts = block.querySelectorAll<HTMLElement>('.block-content');
    const host = end ? hosts[hosts.length - 1] : hosts[0];
    return {blockId: block.dataset.blockId!, surface: Math.max(0, end ? hosts.length - 1 : 0), offset: end ? lengthOf(host ?? block) : 0};
  }
  const hosts = Array.from(block.querySelectorAll<HTMLElement>('.block-content'));
  const host = elementOf(node)?.closest<HTMLElement>('.block-content');
  return {blockId: block.dataset.blockId!, surface: host ? Math.max(0, hosts.indexOf(host)) : 0, offset: offsetOf(host ?? block, node, offset)};
}
export function captureEditorSelection(root: HTMLElement): EditorHistorySelection | null {
  const active = document.activeElement;
  if ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && root.contains(active)) {
    if (active.id === 'page-title') return {kind: 'title', start: active.selectionStart ?? 0, end: active.selectionEnd ?? 0, direction: active.selectionDirection ?? 'none'};
    const block = active.closest<HTMLElement>('[data-block-id]');
    if (block && active.selectionStart !== null && active.selectionEnd !== null) return {kind: 'input', blockId: block.dataset.blockId!, index: Array.from(block.querySelectorAll('input,textarea')).indexOf(active), start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection ?? 'none'};
  }
  if (active instanceof HTMLElement && root.contains(active) && !active.closest('.block-content')) {
    const block = active.closest<HTMLElement>('[data-block-id]');
    if (block && active.matches('.math-block,.math-block-render,.divider-block,.image-block,.code-block')) return {kind: 'block', blockId: block.dataset.blockId!};
  }
  const selection = document.getSelection(), range = editorSelectionRange(selectionRoot(root), selection);
  if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const backward = selection?.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset && !range.collapsed;
  const start = capturePoint(root, range.startContainer, range.startOffset, false), end = capturePoint(root, range.endContainer, range.endOffset, true);
  return start && end ? {kind: 'text', anchor: backward ? end : start, focus: backward ? start : end} : null;
}
function pointAt(host: HTMLElement, offset: number): DOMPoint {
  let remaining = Math.max(0, offset), result: DOMPoint | undefined;
  function visit(node: Node): boolean {
    const atom = atomLength(node);
    if (atom !== undefined) {
      if (remaining <= atom && node.parentNode) {result = {node: node.parentNode, offset: Array.from(node.parentNode.childNodes).indexOf(node as ChildNode) + Number(remaining > 0)}; return true;}
      remaining -= atom; return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '', length = textLength(text);
      if (remaining <= length) {
        let index = 0, seen = 0;
        while (index < text.length && seen < remaining) {if (text[index] !== '\u200b') seen++; index++;}
        result = {node, offset: index}; return true;
      }
      remaining -= length; return false;
    }
    return Array.from(node.childNodes).some(visit);
  }
  visit(host); return result ?? {node: host, offset: host.childNodes.length};
}
export function restoreEditorSelection(root: HTMLElement, saved: EditorHistorySelection | null): boolean {
  const version = (restorationVersions.get(root) ?? 0) + 1;
  restorationVersions.set(root, version);
  if (!saved) return false;
  const blockFor = (id: string) => Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]')).find(block => block.dataset.blockId === id);
  clearEditorSelection(selectionRoot(root));
  if (saved.kind === 'title') {
    const title = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('#page-title');
    if (!title) return false;
    title.focus({preventScroll: true}); title.setSelectionRange(saved.start, saved.end, saved.direction); return true;
  }
  if (saved.kind === 'block') {
    const block = blockFor(saved.blockId), target = block?.querySelector<HTMLElement>('.math-block,.divider-block,.image-block,.code-block,[tabindex]');
    if (!target) return false;
    target.focus({preventScroll: true}); return true;
  }
  if (saved.kind === 'input') {
    const block = blockFor(saved.blockId);
    if (!block) return false;
    const restoreInput = () => {
      const control = block.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')[saved.index];
      if (!control) return false;
      control.focus({preventScroll: true}); control.setSelectionRange(saved.start, saved.end, saved.direction); return true;
    };
    if (restoreInput()) return true;
    // Remounted image and equation blocks initially hide their source controls.
    // Reveal once, then restore after React commits the conditional input.
    const reveal = new Event('noema:restore-input', {cancelable: true});
    block.dispatchEvent(reveal);
    if (!reveal.defaultPrevented) return false;
    requestAnimationFrame(() => {
      if (root.isConnected && block.isConnected && restorationVersions.get(root) === version) restoreInput();
    });
    return true;
  }
  function resolve(point: EditorHistoryPoint) {
    const block = blockFor(point.blockId); if (!block) return;
    const host = block.querySelectorAll<HTMLElement>('.block-content')[point.surface] ?? block;
    return {host, ...pointAt(host, point.offset)};
  }
  const anchor = resolve(saved.anchor), focus = resolve(saved.focus), selection = document.getSelection();
  if (!anchor || !focus || !selection) return false;
  focus.host.focus({preventScroll: true});
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  if (anchor.host !== focus.host) {
    const a = document.createRange(), b = document.createRange();
    a.setStart(anchor.node, anchor.offset); a.collapse(true); b.setStart(focus.node, focus.offset); b.collapse(true);
    const forward = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0;
    const range = document.createRange();
    range.setStart(forward ? anchor.node : focus.node, forward ? anchor.offset : focus.offset);
    range.setEnd(forward ? focus.node : anchor.node, forward ? focus.offset : anchor.offset);
    setEditorSelectionRange(selectionRoot(root), range);
  }
  root.dispatchEvent(new Event('noema:editor-selection'));
  return true;
}
