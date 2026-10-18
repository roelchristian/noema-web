import {useLayoutEffect, useRef} from 'react';
import type {Workspace, WorkspaceState} from './workspace';
import {getLibraryViewState, setLibraryViewState, type LibraryViewState} from './library-view-state';

const capturers = new Set<() => void>();
/** Capture before a component changes its own destination without navigating. */
export function captureLibraryView(): void {for (const capture of capturers) capture();}
export function libraryDestination(state: WorkspaceState): string | null {
  if (!state.vault || state.vault.locked || state.busy && state.view !== 'trash') return null;
  if (state.view === 'organization') return JSON.stringify(['organization',state.organizationContext.collection,state.organizationContext.folder]);
  if (state.view === 'entities') {
    const type = getLibraryViewState(state.vault.id,'knowledge').entityType;
    return JSON.stringify(['knowledge',type ?? '']);
  }
  return ['favourites','inbox','recent','trash'].includes(state.view) ? state.view : null;
}
interface LibraryRoot {element: HTMLElement; vault: string; destination: string; key: string}
const identity = (vault: string, destination: string) => JSON.stringify([vault,destination]);
function mountedRoot(): LibraryRoot | null {
  const element = document.querySelector<HTMLElement>('[data-library-vault][data-library-destination]');
  const vault = element?.dataset.libraryVault, destination = element?.dataset.libraryDestination;
  return element && vault && destination ? {element,vault,destination,key: identity(vault,destination)} : null;
}
function rowFor(root: HTMLElement, id: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-library-row]')).find(row => row.dataset.libraryRow === id);
}
function captureRoot(root: LibraryRoot, focused?: string): void {
  const rows = Array.from(root.element.querySelectorAll<HTMLElement>('[data-library-row]'));
  const header = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect();
  const cutoff = header && header.top <= 0 ? header.bottom : 0;
  const anchor = rows.find(row => {const rect = row.getBoundingClientRect(); return rect.height > 0 && rect.bottom > cutoff && rect.top < window.innerHeight;});
  const active = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('[data-library-row]') : null;
  const focusedRow = focused ?? (active && root.element.contains(active) ? active.dataset.libraryRow : undefined);
  setLibraryViewState(root.vault,root.destination, previous => ({
    scroll: {left: window.scrollX, top: window.scrollY},
    anchor: anchor ? {row: anchor.dataset.libraryRow!, top: anchor.getBoundingClientRect().top} : null,
    focusedRow: focusedRow ?? previous.focusedRow,
  }),false);
}

/** Subscribe before React's workspace subscription, while the outgoing library
 * still has its original height. Observers retain an anchor through late rows,
 * previews, and images until the user takes control of scrolling or focus. */
export function useLibraryScroll(workspace: Pick<Workspace,'snapshot'|'subscribe'>): void {
  const afterRender = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    let active: LibraryRoot | null = null;
    let target: LibraryViewState | null = null;
    let focused = false;
    let panelId = workspace.snapshot().entityPanelId;
    let resize: ResizeObserver | undefined;
    let frame = 0;
    const allowed = (root: LibraryRoot) => {
      const state = workspace.snapshot();
      return state.vaults.some(vault => vault.id === root.vault && !vault.locked) && !(state.vault?.id === root.vault && state.vault.locked);
    };
    const capture = (focus?: string) => {
      if (active?.element.isConnected && allowed(active) && !target) captureRoot(active,focus);
    };
    const stop = () => {target = null; resize?.disconnect(); resize = undefined; cancelAnimationFrame(frame);};
    const restore = () => {
      if (!active || !target || !active.element.isConnected) return;
      const state = workspace.snapshot();
      if (!allowed(active) || state.vault?.id !== active.vault || libraryDestination(state) !== active.destination) {stop(); return;}
      if (!focused && target.focusedRow && document.hasFocus() && !document.querySelector('dialog[open]')) {
        const row = rowFor(active.element,target.focusedRow);
        const control = row?.matches('[data-library-focus]') ? row : row?.querySelector<HTMLElement>('[data-library-focus]') ?? row?.querySelector<HTMLElement>('button,a[href],input,[tabindex]');
        if (control) {control.focus({preventScroll: true}); focused = true;}
      }
      const anchor = target.anchor ? rowFor(active.element,target.anchor.row) : undefined;
      const top = anchor && target.anchor ? window.scrollY + anchor.getBoundingClientRect().top - target.anchor.top : target.scroll.top;
      window.scrollTo({left: target.scroll.left, top: Math.max(0,top), behavior: 'instant'});
    };
    const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(restore);};
    const expectedKey = () => {
      const state = workspace.snapshot(), destination = libraryDestination(state);
      return destination && state.vault ? identity(state.vault.id,destination) : null;
    };
    const transition = () => {
      const next = mountedRoot(), expected = expectedKey();
      if (active && (active.key !== expected || active.element !== next?.element)) {
        capture(); stop(); active = null;
      }
      if (!next || next.key !== expected) return;
      if (active?.key === next.key && active.element === next.element) {if (target) schedule(); return;}
      active = next; target = getLibraryViewState(next.vault,next.destination); focused = false;
      if (typeof ResizeObserver !== 'undefined') {resize = new ResizeObserver(schedule); resize.observe(next.element);}
      restore();
    };
    const beforeNavigation = () => {
      const nextPanel = workspace.snapshot().entityPanelId;
      if (nextPanel !== panelId) {focused = true; panelId = nextPanel;}
      if (active && active.key !== expectedKey()) {capture(); stop(); active = null;}
    };
    const beforeLocalNavigation = () => {capture(); stop(); active = null;};
    const pointer = (event: Event) => {
      if (!active) return;
      stop();
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-library-row]') : null;
      capture(row && active.element.contains(row) ? row.dataset.libraryRow : undefined);
    };
    const interrupt = () => {if (active) {stop(); capture();}};
    const focus = (event: FocusEvent) => {
      if (!target && active && event.target instanceof Element && active.element.contains(event.target)) capture();
    };
    const scroll = () => {capture();};
    const mutation = new MutationObserver(transition);
    mutation.observe(document.getElementById('content') ?? document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-library-vault','data-library-destination','src','aria-busy']});
    const unsubscribe = workspace.subscribe(beforeNavigation);
    capturers.add(beforeLocalNavigation); afterRender.current = transition;
    window.addEventListener('scroll',scroll,{passive: true});
    window.addEventListener('pointerdown',pointer,{capture: true, passive: true});
    window.addEventListener('wheel',interrupt,{passive: true});
    window.addEventListener('touchstart',interrupt,{passive: true});
    window.addEventListener('keydown',interrupt,true);
    window.addEventListener('focus',schedule);
    window.addEventListener('load',schedule,true);
    document.addEventListener('focusin',focus);
    transition();
    return () => {
      capture(); stop(); unsubscribe(); mutation.disconnect(); capturers.delete(beforeLocalNavigation); afterRender.current = () => {};
      window.removeEventListener('scroll',scroll);
      window.removeEventListener('pointerdown',pointer,true);
      window.removeEventListener('wheel',interrupt);
      window.removeEventListener('touchstart',interrupt);
      window.removeEventListener('keydown',interrupt,true);
      window.removeEventListener('focus',schedule);
      window.removeEventListener('load',schedule,true);
      document.removeEventListener('focusin',focus);
    };
  }, [workspace]);
  useLayoutEffect(() => {afterRender.current();});
}
