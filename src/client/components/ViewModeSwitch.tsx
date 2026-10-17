import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Icon} from './Icon';

export type ViewMode = 'list' | 'compact' | 'grid';
const modes = [{id: 'list', label: 'List'}, {id: 'compact', label: 'Compact'}, {id: 'grid', label: 'Grid'}] as const;
function readMode(scope: string): ViewMode {
  try {
    const stored = localStorage.getItem('noema-view-mode/' + scope);
    return stored === 'compact' || stored === 'grid' ? stored : 'list';
  } catch { return 'list'; }
}
export function useViewMode(scope: string) {
  const [mode, setMode] = useState<ViewMode>(() => readMode(scope));
  const root = useRef<HTMLElement>(null);
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
  useEffect(() => { setMode(readMode(scope)); }, [scope]);
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
    setMode(next);
    try { localStorage.setItem('noema-view-mode/' + scope, next); } catch { /* Layout remains usable without storage. */ }
  }
  return [mode, change, root] as const;
}
export function ViewModeSwitch({value, onChange}: {value: ViewMode; onChange: (mode: ViewMode) => void}) {
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
  return <div ref={root} className="view-mode-switch" role="group" aria-label="View layout"><span ref={indicator} className="view-mode-indicator" aria-hidden="true"/>{modes.map(mode => <button key={mode.id} type="button" title={mode.label + ' view'} aria-label={mode.label + ' view'} aria-pressed={value === mode.id} onClick={() => onChange(mode.id)}><Icon name={'view-' + mode.id}/><span>{mode.label}</span></button>)}</div>;
}
