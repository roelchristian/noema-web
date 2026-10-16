import { useEffect, useRef, type ReactNode } from 'react';

export function HelpMenu({label,children}:{label:string;children:ReactNode}) {
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))root.current.open=false;};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  return <details className="summary-help" ref={root} onKeyDown={event=>{
    if(event.key==='Escape'&&root.current?.open){event.stopPropagation();root.current.open=false;root.current.querySelector('summary')?.focus();}
  }}><summary aria-label={label} title={label}>?</summary><div className="summary-help-content">{children}</div></details>;
}
