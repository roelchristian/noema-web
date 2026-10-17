import { reorderSemanticBlock, semanticDragItems } from '../../shared/semantic-blocks';
import type { Block } from '../../shared/domain';

export interface BlockDropPreview {id: string; beforeId: string | null; valid: boolean; keyboard: boolean}
interface Options {blocks: () => Block[]; commit: (blocks: Block[]) => void; preview: (drop: BlockDropPreview | null) => void; announce: (message: string) => void}
interface Bounds {id: string; top: number; bottom: number}
/** Resolve insertion in the remaining list, independent of the dragged block's height. */
export function blockDropBefore(bounds: Bounds[], source: string, y: number): string | null {
  return bounds.find(block => block.id !== source && y < (block.top + block.bottom) / 2)?.id ?? null;
}
export function reorderBlock(blocks: Block[], source: string, before: string | null): Block[] {
  return reorderSemanticBlock(blocks,source,before);
}
/** Only the gutter handle starts a drag; a short click retains its options menu. */
export function installBlockDrag(root: HTMLElement, options: Options) {
  type Pending = {id: string; handle: HTMLElement; pointer: number; x: number; y: number};
  let pending: Pending | undefined, active: BlockDropPreview | undefined, scrollFrame: number | undefined;
  let pointer = {x: 0, y: 0}, suppressed: {handle: HTMLElement; until: number} | undefined;
  const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-block-id],[data-block-group-id]'));
  const row = (id: string) => rows().find(block => (block.dataset.blockId ?? block.dataset.blockGroupId) === id);
  function focus(id: string) {row(id)?.querySelector<HTMLElement>('.block-handle')?.focus({preventScroll: true});}
  function preview(next: BlockDropPreview) {
    if (active && active.id === next.id && active.beforeId === next.beforeId && active.valid === next.valid && active.keyboard === next.keyboard) return;
    active = next; options.preview(next);
    if (next.valid) {
      const remaining = semanticDragItems(options.blocks(),next.id).filter(block => block.id !== next.id), index = next.beforeId === null ? remaining.length : remaining.findIndex(block => block.id === next.beforeId);
      options.announce(`Move block to position ${index + 1} of ${remaining.length + 1}.`);
    } else options.announce('Outside the document. Release to cancel the move.');
  }
  function updatePointer() {
    if (!pending || !active || active.keyboard) return;
    const bounds = root.getBoundingClientRect(), valid = pointer.x >= bounds.left - 64 && pointer.x <= bounds.right + 24 && pointer.y >= bounds.top - 32 && pointer.y <= bounds.bottom + 32;
    const ids = new Set(semanticDragItems(options.blocks(),pending.id).map(item=>item.id));
    const blocks = rows().filter(block=>ids.has(block.dataset.blockId ?? block.dataset.blockGroupId!)).map(block => {const box = block.getBoundingClientRect(); return {id: (block.dataset.blockId ?? block.dataset.blockGroupId)!, top: box.top, bottom: box.bottom};});
    preview({id: pending.id, beforeId: blockDropBefore(blocks, pending.id, pointer.y), valid: valid && !!row(pending.id), keyboard: false});
  }
  function autoScroll() {
    scrollFrame = undefined;
    if (!active || active.keyboard || !pending) return;
    const edge = 56, height = window.innerHeight;
    const speed = pointer.y < edge ? -Math.ceil((edge - Math.max(0, pointer.y)) / 3) : pointer.y > height - edge ? Math.ceil((Math.min(height, pointer.y) - height + edge) / 3) : 0;
    if (!speed) return;
    window.scrollBy(0, speed); updatePointer(); scrollFrame = window.requestAnimationFrame(autoScroll);
  }
  function scheduleScroll() {if (scrollFrame === undefined) scrollFrame = window.requestAnimationFrame(autoScroll);}
  function clear(notify = true) {
    const previous = pending; pending = undefined; active = undefined;
    if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame); scrollFrame = undefined;
    if (previous) {try {previous.handle.releasePointerCapture?.(previous.pointer);} catch {/* The pointer may already be released. */}}
    if (notify) options.preview(null);
  }
  function finish(commit: boolean) {
    const current = active; if (!current) {pending = undefined; return;}
    if (pending) suppressed = {handle: pending.handle, until: Date.now() + 800};
    clear();
    if (commit && current.valid) {
      const blocks = options.blocks(), next = reorderBlock(blocks, current.id, current.beforeId);
      if (next !== blocks) {options.commit(next); options.announce(`Block moved to position ${semanticDragItems(next,current.id).findIndex(block => block.id === current.id) + 1} of ${semanticDragItems(next,current.id).length}.`);}
      else options.announce('Block position unchanged.');
    } else options.announce('Block move cancelled.');
    focus(current.id);
  }
  function handleFrom(target: EventTarget | null) {return (target instanceof Element ? target : null)?.closest<HTMLElement>('.block-handle');}
  function down(event: PointerEvent) {
    const handle = handleFrom(event.target);
    if (!handle || !root.contains(handle) || event.button !== 0 || event.isPrimary === false) return;
    if (active) finish(false);
    const id = handle.closest<HTMLElement>('[data-block-id],[data-block-group-id]')?.getAttribute(handle.hasAttribute('data-semantic-parent-handle') ? 'data-block-group-id' : 'data-block-id') ?? undefined;
    if (!id || !semanticDragItems(options.blocks(),id).some(block => block.id === id)) return;
    pending = {id, handle, pointer: event.pointerId, x: event.clientX, y: event.clientY};
    // Keep native text dragging and touch scrolling off the handle itself.
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointer || active?.keyboard) return;
    pointer = {x: event.clientX, y: event.clientY};
    if (!active && Math.hypot(pointer.x - pending.x, pointer.y - pending.y) < 6) return;
    event.preventDefault();
    if (!active) {
      document.getSelection()?.removeAllRanges();
      try {pending.handle.setPointerCapture?.(event.pointerId);} catch {/* Document listeners still track the drag. */}
      preview({id: pending.id, beforeId: null, valid: false, keyboard: false});
    }
    updatePointer(); scheduleScroll();
  }
  function up(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointer) return;
    if (!active) {pending = undefined; return;}
    pointer = {x: event.clientX, y: event.clientY}; updatePointer(); event.preventDefault(); finish(true);
  }
  function cancel(event?: PointerEvent) {if (event && pending && event.pointerId !== pending.pointer) return; if (active) finish(false); else pending = undefined;}
  function key(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.repeat && (event.key === ' ' || event.key === 'Enter')) {if (active || handleFrom(event.target)) {event.preventDefault(); event.stopPropagation();} return;}
    if (active) {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); finish(false); return;}
      if (!active.keyboard) return;
      if (event.key === ' ' || event.key === 'Enter') {event.preventDefault(); event.stopPropagation(); finish(true); return;}
      if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const remaining = semanticDragItems(options.blocks(),active.id).filter(block => block.id !== active!.id);
        const index = active.beforeId === null ? remaining.length : remaining.findIndex(block => block.id === active!.beforeId);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? remaining.length : Math.max(0, Math.min(remaining.length, index + (event.key === 'ArrowUp' ? -1 : 1)));
        preview({...active, beforeId: remaining[next]?.id ?? null, valid: true});
        const target = remaining[Math.min(next, remaining.length - 1)]; if (target) row(target.id)?.scrollIntoView?.({block: 'nearest'});
      } else if (event.key === 'Tab') finish(false);
      return;
    }
    const handle = handleFrom(event.target);
    if (!handle || !root.contains(handle) || event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;
    const id = handle.closest<HTMLElement>('[data-block-id],[data-block-group-id]')?.getAttribute(handle.hasAttribute('data-semantic-parent-handle') ? 'data-block-group-id' : 'data-block-id') ?? undefined, blocks = semanticDragItems(options.blocks(),id??''), index = blocks.findIndex(block => block.id === id);
    if (!id || index < 0) return;
    event.preventDefault(); event.stopPropagation(); document.getSelection()?.removeAllRanges();
    preview({id, beforeId: blocks[index + 1]?.id ?? null, valid: true, keyboard: true});
    options.announce('Block picked up. Use Up or Down to move, Space or Enter to drop, or Escape to cancel.');
  }
  function click(event: MouseEvent) {
    if (suppressed && suppressed.until >= Date.now() && event.detail !== 0 && handleFrom(event.target) === suppressed.handle) {event.preventDefault(); event.stopPropagation(); suppressed = undefined;}
  }
  const blur = () => cancel();
  const visibility = () => {if (document.hidden) cancel();};
  root.addEventListener('pointerdown', down); document.addEventListener('pointermove', move, {passive: false}); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', key, true); document.addEventListener('click', click, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  return () => {clear(false); root.removeEventListener('pointerdown', down); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('lostpointercapture', cancel); document.removeEventListener('keydown', key, true); document.removeEventListener('click', click, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);};
}
