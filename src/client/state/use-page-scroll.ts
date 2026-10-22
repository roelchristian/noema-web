import { useLayoutEffect, useRef } from 'react';
import type { Workspace, WorkspaceState } from './workspace';

type Position = {left:number;top:number};
const pageKey = (state:WorkspaceState) => state.view==='pages' && state.page && !state.busy && !state.vault?.locked
  ? JSON.stringify([state.page.vault_id,state.page.id])
  : state.view==='entity' && state.entityId && state.vault && !state.busy && !state.vault.locked
    ? JSON.stringify([state.vault.id,'entity',state.entityId]) : null;
const position = ():Position => ({left:window.scrollX,top:window.scrollY});

/** Subscribe before the React store subscription so outgoing offsets are captured
 * before replacing a long document can clamp the browser's scroll position. */
export function usePageScroll(workspace:Pick<Workspace,'snapshot'|'subscribe'>) {
  const positions=useRef(new Map<string,Position>());
  const active=useRef<string|null>(null);
  const pending=useRef<Position|null>(null);
  const key=pageKey(workspace.snapshot());
  useLayoutEffect(()=>{
    active.current=pageKey(workspace.snapshot());
    return workspace.subscribe(()=>{
      const next=pageKey(workspace.snapshot());
      if(next===active.current)return;
      if(active.current)positions.current.set(active.current,pending.current??position());
      active.current=next;
    });
  },[workspace]);
  useLayoutEffect(()=>{
    if(!key)return;
    const target=positions.current.get(key)??{left:0,top:0};
    let observer:ResizeObserver|undefined;
    let restoring=true;
    pending.current=target;
    const stop=()=>{restoring=false;pending.current=null;observer?.disconnect();};
    const restore=()=>{
      if(!restoring)return;
      window.scrollTo({...target,behavior:'instant'});
      // Images may not have established the document's full height yet.
      if(Math.abs(window.scrollY-target.top)<1&&Math.abs(window.scrollX-target.left)<1)stop();
    };
    restore();
    if(restoring){
      observer=new ResizeObserver(restore);
      const content=document.getElementById('content');
      if(content)observer.observe(content);
    }
    const interrupt=(event:Event)=>{
      if(event.type==='keydown'&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes((event as KeyboardEvent).key))return;
      stop();
    };
    for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(type,interrupt,{passive:true});
    return()=>{
      stop();
      for(const type of ['wheel','touchstart','pointerdown','keydown'])window.removeEventListener(type,interrupt);
    };
  },[key]);
}
