import {t as uiText} from '../i18n';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {readLibraryPresentation,saveLibraryPresentation} from '../state/library-view-state';
import {Icon} from './Icon';

export type ViewMode = 'list' | 'compact' | 'grid';
const modes = [{id: 'list', label: uiText("List")}, {id: 'compact', label: uiText("Compact")}, {id: 'grid', label: uiText("Grid")}] as const;
function readMode(scope: string, fallbackScope: string | undefined, defaultMode: ViewMode): ViewMode {
  try {
    const [vaultId,destination]=JSON.parse(scope) as [string,string];
    const own=readLibraryPresentation(vaultId,destination,false).layout;
    const exact=localStorage.getItem('noema-view-mode/' + scope);
    const inherited=readLibraryPresentation(vaultId,destination).layout;
    const stored = own ?? exact ?? inherited ?? (fallbackScope ? localStorage.getItem('noema-view-mode/' + fallbackScope) : null);
    return stored === 'list' || stored === 'compact' || stored === 'grid' ? stored : defaultMode;
  } catch { return defaultMode; }
}
export function useViewMode(scope: string, fallbackScope?: string, defaultMode: ViewMode = 'list') {
  const [preference, setPreference] = useState(() => ({scope, mode: readMode(scope, fallbackScope, defaultMode)}));
  const mode = preference.scope === scope ? preference.mode : readMode(scope, fallbackScope, defaultMode);
  const root = useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const keydown=(event:KeyboardEvent)=>{
      if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.defaultPrevented)return;
      const target=event.target;
      if(!(target instanceof HTMLElement)||!target.matches('[data-library-focus]')||target.closest('dialog,[contenteditable=true]'))return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        const controls=Array.from(element.querySelectorAll<HTMLElement>('[data-library-focus]')).filter(control=>!control.closest('[hidden]')&&!control.matches(':disabled'));
        const index=controls.indexOf(target),next=controls[index+(event.key==='ArrowDown'?1:-1)];
        if(index>=0){event.preventDefault();next?.focus();}
      } else if(event.key===' '){
        const row=target.closest<HTMLElement>('[data-library-row]');
        if(row&&!element.dispatchEvent(new CustomEvent('noema:library-preview',{detail:row.dataset.libraryRow,cancelable:true})))event.preventDefault();
      }
    };
    element.addEventListener('keydown',keydown);
    return()=>element.removeEventListener('keydown',keydown);
  },[scope]);
  const before = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const animations = useRef(new Set<Animation>());
  function stop() {animations.current.forEach(animation => animation.cancel()); animations.current.clear();}
  useEffect(() => () => stop(), []);
  useLayoutEffect(() => {
    const previous=before.current; before.current=null;
    if(!previous || !root.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const changes: {element:HTMLElement; box:DOMRect; previous?:DOMRect}[]=[];
    for(const element of root.current.querySelectorAll<HTMLElement>('.organization-item,.organization-container-card')) {
      const box=element.getBoundingClientRect();
      if(box.bottom<0 || box.top>window.innerHeight || !box.width || !box.height)continue;
      changes.push({element,box,previous:previous.get(element)});
      if(changes.length>=48)break;
    }
    // Measure once after React applies the new layout, then animate with transforms.
    for(const {element,box,previous} of changes) {
      if(!element.animate)continue;
      const from=previous
        ? {transform:`translate(${previous.left-box.left}px,${previous.top-box.top}px) scale(${previous.width/box.width},${previous.height/box.height})`,opacity:1}
        : {transform:'translateY(6px) scale(.985)',opacity:0};
      const animation=element.animate([from,{transform:'translate(0,0) scale(1)',opacity:1}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
      animations.current.add(animation);
      animation.onfinish=animation.oncancel=()=>animations.current.delete(animation);
    }
  }, [mode]);
  useEffect(() => {
    const mode = readMode(scope, fallbackScope, defaultMode);
    setPreference(previous => previous.scope === scope && previous.mode === mode ? previous : {scope, mode});
  }, [scope, fallbackScope, defaultMode]);
  function change(next: ViewMode) {
    if(next===mode)return;
    let positions:Map<HTMLElement,DOMRect>|null=null;
    if(root.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      positions=new Map<HTMLElement,DOMRect>();
      for(const element of root.current.querySelectorAll<HTMLElement>('.organization-item,.organization-container-card')) {
        const box=element.getBoundingClientRect();
        if(box.bottom>=0 && box.top<=window.innerHeight && box.width && box.height)positions.set(element,box);
        if(positions.size>=48)break;
      }
    }
    // Capture the current visual position before cancelling an interrupted transition.
    stop(); before.current=positions;
    setPreference({scope, mode: next});
    try { const [vaultId,destination]=JSON.parse(scope) as [string,string]; saveLibraryPresentation(vaultId,destination,{layout:next});localStorage.setItem('noema-view-mode/' + scope, next); } catch { /* Layout remains usable without storage. */ }
  }
  return [mode, change, root] as const;
}
export function ViewModeSwitch({value, onChange, disabled = false}: {value: ViewMode; onChange: (mode: ViewMode) => void; disabled?: boolean}) {
  const root=useRef<HTMLDivElement>(null), indicator=useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const control=root.current, pill=indicator.current;
    if(!control || !pill)return;
    function position() {
      const selected=control!.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if(!selected)return;
      pill!.style.transform=`translate(${selected.offsetLeft}px,${selected.offsetTop}px)`;
      pill!.style.width=selected.offsetWidth+'px';
      pill!.style.height=selected.offsetHeight+'px';
      pill!.style.opacity='1';
    }
    position();
    // Position the initial selection immediately; animate subsequent changes only.
    const frame=requestAnimationFrame(()=>{control.dataset.indicatorReady='true';});
    const observer=new ResizeObserver(position);
    observer.observe(control);
    control.querySelectorAll('button').forEach(button=>observer.observe(button));
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[value]);
  return <div ref={root} className="view-mode-switch" role="group" aria-label={uiText("View layout")}><span ref={indicator} className="view-mode-indicator" aria-hidden="true"/>{modes.map(mode => <button key={mode.id} disabled={disabled} type="button" title={mode.label + uiText(" view")} aria-label={mode.label + uiText(" view")} aria-pressed={value === mode.id} onClick={() => onChange(mode.id)}><Icon name={'view-' + mode.id}/><span>{mode.label}</span></button>)}</div>;
}
