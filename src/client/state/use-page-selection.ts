import {useLayoutEffect,useRef} from 'react';
import type {Workspace,WorkspaceState} from './workspace';
type Point={blockId:string;surface:number;offset:number;text:string};
export type PageSelection={anchor:Point;focus:Point};
const key=(state:WorkspaceState)=>state.view==='pages'&&!state.busy&&state.page&&!state.vault?.locked?JSON.stringify([state.page.vault_id,state.page.id]):null;
function point(node:Node|null,offset:number):Point|null {
 const element=node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement;
 const surface=element?.closest<HTMLElement>('#content .block-content[contenteditable=true]'),block=surface?.closest<HTMLElement>('[data-block-id]');
 if(!surface||!block||!node||!surface.contains(node))return null;
 const range=document.createRange();range.selectNodeContents(surface);try{range.setEnd(node,offset);}catch{return null;}
 return {blockId:block.dataset.blockId!,surface:Array.from(block.querySelectorAll('.block-content')).indexOf(surface),offset:range.toString().length,text:surface.textContent??''};
}
export function capturePageSelection():PageSelection|null {
 const selection=getSelection();if(!selection?.rangeCount)return null;
 const anchor=point(selection.anchorNode,selection.anchorOffset),focus=point(selection.focusNode,selection.focusOffset);
 return anchor&&focus?{anchor,focus}:null;
}
export function restorePageSelection(saved:PageSelection):boolean {
 const locate=(point:Point)=>{
  const block=Array.from(document.querySelectorAll<HTMLElement>('#content [data-block-id]')).find(block=>block.dataset.blockId===point.blockId),surface=block?.querySelectorAll<HTMLElement>('.block-content')[point.surface];
  if(!surface||surface.textContent!==point.text||surface.getAttribute('contenteditable')!=='true')return null;
  const walker=document.createTreeWalker(surface,NodeFilter.SHOW_TEXT);let node:Node|null,offset=0;
  while((node=walker.nextNode())){const length=node.textContent?.length??0;if(point.offset<=offset+length)return {node,offset:point.offset-offset,surface};offset+=length;}
  return point.offset===0?{node:surface as Node,offset:0,surface}:null;
 };
 const anchor=locate(saved.anchor),focus=locate(saved.focus);if(!anchor||!focus)return false;
 anchor.surface.focus({preventScroll:true});getSelection()?.setBaseAndExtent(anchor.node,anchor.offset,focus.node,focus.offset);return true;
}
/** Retain selection across actual workspace transitions, never reapply it on edits.
 * Exact surface text is required; a changed block does not receive a guessed caret. */
export function usePageSelection(workspace:Pick<Workspace,'snapshot'|'subscribe'>) {
 const positions=useRef(new Map<string,PageSelection>()),active=useRef(key(workspace.snapshot()));
 const current=key(workspace.snapshot());
 useLayoutEffect(()=>{
  const capture=()=>{if(!active.current)return;const selection=capturePageSelection();if(selection)positions.current.set(active.current,selection);};
  document.addEventListener('selectionchange',capture);
  const unsubscribe=workspace.subscribe(()=>{const state=workspace.snapshot(),next=key(state);if(next===active.current)return;capture();active.current=next;if(state.vault?.locked)positions.current.clear();});
  return()=>{unsubscribe();document.removeEventListener('selectionchange',capture);};
 },[workspace]);
 useLayoutEffect(()=>{
  if(!current)return;const saved=positions.current.get(current);if(!saved)return;
  const frame=requestAnimationFrame(()=>restorePageSelection(saved));return()=>cancelAnimationFrame(frame);
 },[current]);
}
