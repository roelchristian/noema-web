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
  let nodes = new Map<string, HTMLElement>(), items: {id:string}[] = [], snapshot: Block[] | undefined;
  let geometry: Bounds[] = [], documentBounds: {left:number;right:number;top:number;bottom:number} | undefined;
  let dirty = true, parents: HTMLElement[] = [], scroller: HTMLElement | undefined, lastFrame = 0;
  let source: HTMLElement | undefined, indicator: HTMLElement | undefined, ghost: HTMLDivElement | undefined, dragHandle: HTMLElement | undefined;
  const animations = new Set<Animation>(), landingGhosts = new Set<HTMLElement>();
  let settleFrame: number | undefined;
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  function stopAnimations() {
    if (settleFrame !== undefined) window.cancelAnimationFrame(settleFrame); settleFrame=undefined;
    animations.forEach(animation=>animation.cancel()); animations.clear();
    landingGhosts.forEach(element=>element.remove()); landingGhosts.clear();
  }
  function animate(element: HTMLElement, keyframes: Keyframe[], duration: number) {
    if (!element.animate || reducedMotion()) return;
    const animation=element.animate(keyframes,{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
    animations.add(animation);
    animation.onfinish=animation.oncancel=()=>animations.delete(animation);
  }
  const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-block-id],[data-block-group-id]'));
  const row = (id: string) => nodes.get(id) ?? rows().find(block => (block.dataset.blockId ?? block.dataset.blockGroupId) === id);
  function focus(id: string) {row(id)?.querySelector<HTMLElement>('.block-handle')?.focus({preventScroll: true});}
  function prepare(id: string, handle: HTMLElement) {
    stopAnimations();
    snapshot = options.blocks(); items = semanticDragItems(snapshot,id);
    nodes = new Map(rows().map(element => [(element.dataset.blockId ?? element.dataset.blockGroupId)!, element]));
    parents = [];
    for (let parent=root.parentElement;parent && parent!==document.body && parent!==document.documentElement;parent=parent.parentElement) parents.push(parent);
    scroller = parents.find(parent => /auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight);
    source = nodes.get(id); dragHandle = handle; dirty = true; lastFrame = 0;
  }
  // Document-relative bounds stay valid during scrolling, including nested scroll containers.
  function offset() {return parents.reduce((position,parent) => ({x:position.x+parent.scrollLeft,y:position.y+parent.scrollTop}),{x:window.scrollX,y:window.scrollY});}
  function measure() {
    if (!dirty) return;
    const scroll = offset(), bounds = root.getBoundingClientRect();
    documentBounds = {left:bounds.left+scroll.x,right:bounds.right+scroll.x,top:bounds.top+scroll.y,bottom:bounds.bottom+scroll.y};
    geometry = items.flatMap(item => {
      const element=nodes.get(item.id); if (!element?.isConnected) return [];
      const box=element.getBoundingClientRect(); return [{id:item.id,top:box.top+scroll.y,bottom:box.bottom+scroll.y}];
    });
    dirty = false;
  }
  function preview(next: BlockDropPreview) {
    if (active && active.id === next.id && active.beforeId === next.beforeId && active.valid === next.valid && active.keyboard === next.keyboard) return;
    active = next;
    // Transient drag feedback stays outside React so contenteditable blocks never rerender on hover.
    root.dataset.blockDragging = 'true';
    source?.classList.add('is-block-dragging'); dragHandle?.setAttribute('aria-pressed','true');
    indicator?.removeAttribute('data-drop-before'); indicator?.removeAttribute('data-drop-after');
    indicator = undefined;
    if (next.valid) {
      const target=next.beforeId ?? items.filter(item=>item.id!==next.id).at(-1)?.id;
      indicator=target ? nodes.get(target) : undefined;
      indicator?.setAttribute(next.beforeId===null?'data-drop-after':'data-drop-before','true');
    }
    if (ghost) {
      ghost.dataset.valid = String(next.valid);
      const label=ghost.querySelector('strong');
      if(label) label.textContent=next.valid?ghost.dataset.label!:'Release to cancel';
    }
    options.preview(next);
    if (next.valid) {
      const remaining = items.filter(block => block.id !== next.id), index = next.beforeId === null ? remaining.length : remaining.findIndex(block => block.id === next.beforeId);
      options.announce(`Move block to position ${index + 1} of ${remaining.length + 1}.`);
    } else options.announce('Outside the document. Release to cancel the move.');
  }
  function updatePointer() {
    if (!pending || !active || active.keyboard) return;
    if (options.blocks() !== snapshot || !source?.isConnected) {finish(false); return;}
    measure();
    const scroll=offset(), x=pointer.x+scroll.x, y=pointer.y+scroll.y, bounds=documentBounds!;
    const valid=x>=bounds.left-64 && x<=bounds.right+24 && y>=bounds.top-32 && y<=bounds.bottom+32;
    let beforeId=blockDropBefore(geometry,pending.id,y);
    // Keep the current slot within a small buffer to prevent midpoint flicker.
    if (active.valid && beforeId!==active.beforeId) {
      const remaining=geometry.filter(item=>item.id!==pending!.id);
      const index=active.beforeId===null?remaining.length:remaining.findIndex(item=>item.id===active!.beforeId);
      const previous=remaining[index-1], next=remaining[index];
      if (index>=0 && (!previous || y>=(previous.top+previous.bottom)/2-5) && (!next || y<=(next.top+next.bottom)/2+5)) beforeId=active.beforeId;
    }
    preview({id:pending.id,beforeId,valid,keyboard:false});
    if (ghost) ghost.style.transform=`translate3d(${Math.max(8,Math.min(pointer.x+16,window.innerWidth-248))}px,${Math.max(8,Math.min(pointer.y+12,window.innerHeight-80))}px,0)`;
  }
  function createGhost() {
    ghost=document.createElement('div'); ghost.className='block-drag-preview'; ghost.setAttribute('aria-hidden','true');
    const label=document.createElement('strong'), excerpt=document.createElement('span');
    const count=snapshot?.filter(block=>block.id===pending?.id || block.semanticGroup?.id===pending?.id).length ?? 1;
    label.textContent=count>1?`Moving ${count} blocks`:'Moving block';
    excerpt.textContent=(source?.querySelector<HTMLTextAreaElement>('textarea')?.value || Array.from(source?.querySelectorAll<HTMLElement>('.block-content') ?? []).map(element=>element.textContent).join(' ') || source?.querySelector('img')?.getAttribute('alt') || 'Release at the line to move · Esc to cancel').replace(/\s+/g,' ').trim().slice(0,140);
    ghost.dataset.label=label.textContent;
    ghost.append(label,excerpt); document.body.append(ghost);
  }
  function autoScroll(timestamp: number) {
    scrollFrame = undefined;
    if (!active || active.keyboard || !pending) return;
    const elapsed=lastFrame?Math.min(32,timestamp-lastFrame):16; lastFrame=timestamp;
    updatePointer(); if (!active || !pending) return;
    const viewport=scroller?.getBoundingClientRect(), top=Math.max(0,viewport?.top ?? 0), bottom=Math.min(window.innerHeight,viewport?.bottom ?? window.innerHeight), edge=Math.min(72,(bottom-top)/3);
    const distance=pointer.y<top+edge?-Math.min(1,(top+edge-pointer.y)/edge):pointer.y>bottom-edge?Math.min(1,(pointer.y-bottom+edge)/edge):0;
    if (!distance || !active.valid) {lastFrame=0;return;}
    const previous=scroller?.scrollTop ?? window.scrollY, speed=distance*Math.abs(distance)*900*elapsed/1000;
    if (scroller) scroller.scrollTop+=speed; else window.scrollBy({top:speed,behavior:'instant'});
    if ((scroller?.scrollTop ?? window.scrollY)!==previous) {updatePointer();scheduleScroll();} else lastFrame=0;
  }
  function scheduleScroll() {if (scrollFrame === undefined) scrollFrame = window.requestAnimationFrame(autoScroll);}
  function clear(notify = true) {
    const previous = pending; pending = undefined; active = undefined;
    if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame); scrollFrame = undefined;
    delete root.dataset.blockDragging;
    source?.classList.remove('is-block-dragging'); dragHandle?.setAttribute('aria-pressed','false');
    indicator?.removeAttribute('data-drop-before'); indicator?.removeAttribute('data-drop-after');
    ghost?.remove(); ghost=undefined; indicator=undefined; source=undefined; dragHandle=undefined;
    geometry=[]; documentBounds=undefined; items=[]; snapshot=undefined; parents=[]; scroller=undefined; nodes.clear(); lastFrame=0;
    if (previous) {try {previous.handle.releasePointerCapture?.(previous.pointer);} catch {/* The pointer may already be released. */}}
    if (notify) options.preview(null);
  }
  function finish(commit: boolean) {
    if (commit && options.blocks()!==snapshot) commit=false;
    const current = active; if (!current) {pending = undefined; return;}
    if (pending) suppressed = {handle: pending.handle, until: Date.now() + 800};
    const blocks=options.blocks(), next=commit && current.valid?reorderBlock(blocks,current.id,current.beforeId):blocks;
    const moving=next!==blocks, positions=new Map<string,{top:number;left:number}>();
    if (moving && !reducedMotion()) for (const item of items) {
      const box=nodes.get(item.id)?.getBoundingClientRect();
      if (box && box.bottom>=0 && box.top<=window.innerHeight) positions.set(item.id,{top:box.top,left:box.left});
    }
    // Let the lightweight preview settle into the dropped block after React commits.
    const landing=moving && !reducedMotion()?ghost:undefined;
    if (landing) {ghost=undefined;landingGhosts.add(landing);}
    clear();
    if (moving) {
      options.commit(next); options.announce(`Block moved to position ${semanticDragItems(next,current.id).findIndex(block => block.id === current.id) + 1} of ${semanticDragItems(next,current.id).length}.`);
    } else options.announce(commit && current.valid?'Block position unchanged.':'Block move cancelled.');
    settleFrame=window.requestAnimationFrame(() => {
      settleFrame=undefined;
      if (!root.isConnected) {landing?.remove();if(landing)landingGhosts.delete(landing);return;}
      const updated=new Map(rows().map(element=>[(element.dataset.blockId ?? element.dataset.blockGroupId)!,element]));
      const target=updated.get(current.id);
      // Read the final layout before starting any animations.
      const layout=Array.from(positions).flatMap(([id,previous])=>{
        const element=updated.get(id); if(!element)return [];
        const box=element.getBoundingClientRect();
        return box.bottom>=0 && box.top<=window.innerHeight?[{id,element,x:previous.left-box.left,y:previous.top-box.top}]:[];
      });
      const destination=target?.getBoundingClientRect();
      for (const item of layout) {
        if(item.id!==current.id && (item.x || item.y) && Math.abs(item.y)<window.innerHeight) animate(item.element,[{transform:`translate(${item.x}px,${item.y}px)`},{transform:'translate(0,0)'}],220);
      }
      if(moving && target) animate(target,[{opacity:.55},{opacity:1}],220);
      if (landing) {
        if (destination && landing.animate) {
          landing.style.animation='none';
          const animation=landing.animate([{transform:landing.style.transform,opacity:1},{transform:`translate3d(${destination.left}px,${destination.top}px,0)`,opacity:0}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
          animations.add(animation);
          animation.onfinish=animation.oncancel=()=>{landing.remove();landingGhosts.delete(landing);animations.delete(animation);};
        } else {landing.remove();landingGhosts.delete(landing);}
      }
      focus(current.id);
    });
  }
  function handleFrom(target: EventTarget | null) {return (target instanceof Element ? target : null)?.closest<HTMLElement>('.block-handle');}
  function down(event: PointerEvent) {
    const handle = handleFrom(event.target);
    if (!handle || !root.contains(handle) || event.button !== 0 || event.isPrimary === false) return;
    if (active) finish(false);
    const id = handle.closest<HTMLElement>('[data-block-id],[data-block-group-id]')?.getAttribute(handle.hasAttribute('data-semantic-parent-handle') ? 'data-block-group-id' : 'data-block-id') ?? undefined;
    if (!id || !semanticDragItems(options.blocks(),id).some(block => block.id === id)) return;
    pending = {id, handle, pointer: event.pointerId, x: event.clientX, y: event.clientY};
    pointer={x:event.clientX,y:event.clientY};
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
      prepare(pending.id,pending.handle); measure(); createGhost();
      try {pending.handle.setPointerCapture?.(event.pointerId);} catch {/* Document listeners still track the drag. */}
      const index=items.findIndex(item=>item.id===pending!.id);
      preview({id: pending.id, beforeId: items[index+1]?.id ?? null, valid: true, keyboard: false});
      updatePointer();
    }
    scheduleScroll();
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
        if (options.blocks()!==snapshot) {finish(false);return;}
        const remaining = items.filter(block => block.id !== active!.id);
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
    prepare(id,handle);
    preview({id, beforeId: blocks[index + 1]?.id ?? null, valid: true, keyboard: true});
    options.announce('Block picked up. Use Up or Down to move, Space or Enter to drop, or Escape to cancel.');
  }
  function click(event: MouseEvent) {
    if (suppressed && suppressed.until >= Date.now() && event.detail !== 0 && handleFrom(event.target) === suppressed.handle) {event.preventDefault(); event.stopPropagation(); suppressed = undefined;}
  }
  const scroll = () => {if(active && !active.keyboard)scheduleScroll();};
  const resize = () => {dirty=true;scroll();};
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resize); observer?.observe(root);
  const blur = () => cancel();
  const visibility = () => {if (document.hidden) cancel();};
  document.addEventListener('scroll',scroll,true); window.addEventListener('resize',resize);
  root.addEventListener('pointerdown', down); document.addEventListener('pointermove', move, {passive: false}); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', key, true); document.addEventListener('click', click, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  return () => {stopAnimations();observer?.disconnect(); document.removeEventListener('scroll',scroll,true); window.removeEventListener('resize',resize); clear(false); root.removeEventListener('pointerdown', down); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('lostpointercapture', cancel); document.removeEventListener('keydown', key, true); document.removeEventListener('click', click, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);};
}
