import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {ReadingNoteAnchor} from '../../shared/source-reading';
import {Icon} from '../components/Icon';

interface Marker {top:number;left:number;notes:ReadingNoteAnchor[]}
interface PreviewBox {left:number;top:number;width:number;height:number}
/** Mark the rendered line containing the saved source offset, including after reflow. */
export function SourceReadingNoteMarkers({article,notes,onOpen,onRemove}:{article:RefObject<HTMLElement|null>;notes:ReadingNoteAnchor[];onOpen:(pageId:string)=>void;onRemove:(note:ReadingNoteAnchor)=>void}) {
  const [markers,setMarkers]=useState<Marker[]>([]),[open,setOpen]=useState<string|null>(null);
  const [hovered,setHovered]=useState<string[]|null>(null),[focused,setFocused]=useState<string[]|null>(null);
  const [previewBoxes,setPreviewBoxes]=useState<PreviewBox[]>([]);
  const previewIds=JSON.stringify(hovered??focused??markers.find(marker=>marker.notes[0]?.pageId===open)?.notes.map(note=>note.pageId)??[]);
  const container=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null);
  function close(){setOpen(null);trigger.current?.focus();}
  useEffect(()=>{
    if(!open)return;
    function outside(event:PointerEvent){if(!container.current?.contains(event.target as Node))setOpen(null);}
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useLayoutEffect(()=>{
    const root=article.current;if(!root)return;
    let frame=0,active=true;
    function measure(){
      if(!active||!root)return;
      const bounds=root.getBoundingClientRect(),leaves=Array.from(root.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]'));
      const next:Marker[]=[];
      for(const note of notes){
        let low=0,high=leaves.length;
        while(low<high){const mid=(low+high)>>>1;if(Number(leaves[mid]!.dataset.sourceEnd)<=note.startOffset)low=mid+1;else high=mid;}
        const leaf=leaves[low];if(!leaf)continue;
        let rect=leaf.getBoundingClientRect();
        if(!leaf.hasAttribute('data-source-atomic')&&leaf.firstChild?.nodeType===Node.TEXT_NODE){
          const length=leaf.firstChild.textContent?.length??0;
          if(length){const range=document.createRange(),offset=Math.max(0,Math.min(length-1,note.startOffset-Number(leaf.dataset.sourceStart)));range.setStart(leaf.firstChild,offset);range.setEnd(leaf.firstChild,offset+1);const character=range.getBoundingClientRect();if(character.height)rect=character;}
        }
        const top=Math.round(rect.top-bounds.top+(rect.height-28)/2),left=Math.round(bounds.width-28);
        const sameLine=next.find(marker=>Math.abs(marker.top-top)<4&&Math.abs(marker.left-left)<4);
        if(sameLine)sameLine.notes.push(note);else next.push({top,left,notes:[note]});
      }
      setMarkers(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
      const ids=new Set<string>(JSON.parse(previewIds)),boxes:PreviewBox[]=[];
      for(const note of notes.filter(note=>ids.has(note.pageId)))for(const leaf of leaves) {
        const start=Number(leaf.dataset.sourceStart),end=Number(leaf.dataset.sourceEnd);
        if(start>=note.endOffset||end<=note.startOffset)continue;
        const range=document.createRange();
        range.selectNodeContents(leaf);
        if(!leaf.hasAttribute('data-source-atomic')&&leaf.firstChild?.nodeType===Node.TEXT_NODE) {
          const length=leaf.firstChild.textContent?.length??0;
          range.setStart(leaf.firstChild,Math.min(length,Math.max(0,note.startOffset-start)));
          range.setEnd(leaf.firstChild,Math.min(length,note.endOffset-start));
        }
        const clip=leaf.closest('pre,.source-reader-table,.summary-math-display')?.getBoundingClientRect();
        for(const rect of range.getClientRects())for(const inline of leaf.getClientRects()) {
          const left=Math.max(rect.left,inline.left,bounds.left,clip?.left??bounds.left);
          const right=Math.min(rect.right,inline.right,bounds.right,clip?.right??bounds.right);
          const top=Math.max(rect.top,inline.top,bounds.top,clip?.top??bounds.top);
          const bottom=Math.min(rect.bottom,inline.bottom,bounds.bottom,clip?.bottom??bounds.bottom);
          if(right>left&&bottom>top)boxes.push({left:left-bounds.left,top:top-bounds.top,width:right-left,height:bottom-top});
        }
      }
      setPreviewBoxes(previous=>JSON.stringify(previous)===JSON.stringify(boxes)?previous:boxes);
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
    measure();const resize=new ResizeObserver(schedule);resize.observe(root);
    const mutation=new MutationObserver(schedule);mutation.observe(root,{childList:true,subtree:true});
    void document.fonts.ready.then(()=>{if(active)schedule();});
    window.addEventListener('resize',schedule);
    root.addEventListener('scroll',schedule,true);
    return()=>{active=false;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();window.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);};
  },[article,notes,previewIds]);
  return <div ref={container} className="source-reading-note-markers">
    {!!previewBoxes.length&&<svg className="source-reading-note-preview" aria-hidden="true" focusable="false">{previewBoxes.map((box,index)=><rect key={index} x={box.left} y={box.top} width={box.width} height={box.height} rx="2"/>)}</svg>}
    {markers.map(marker=>{
    const id=marker.notes[0]!.pageId,label=marker.notes.length===1?'Show reading note actions':`Show ${marker.notes.length} reading notes`;
    const ids=marker.notes.map(note=>note.pageId);
    return <div key={id} className="source-reading-note-marker" style={{top:marker.top,left:marker.left}} onPointerEnter={()=>setHovered(ids)} onPointerLeave={()=>setHovered(null)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(null);}}>
      <button type="button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open===id} onFocus={()=>setFocused(ids)} onClick={event=>{trigger.current=event.currentTarget;setOpen(current=>current===id?null:id);}}><Icon name="annotation"/>{marker.notes.length>1&&<small>{marker.notes.length}</small>}</button>
      {open===id&&<div className="source-reading-note-marker-list" role="dialog" aria-label="Reading notes on this line" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
        <header><strong>Reading notes</strong><button type="button" autoFocus aria-label="Close reading notes" onClick={close}><Icon name="close"/></button></header>
        {marker.notes.map(note=><div className="source-reading-note-row" key={note.pageId} onPointerEnter={()=>setHovered([note.pageId])} onPointerLeave={()=>setHovered(ids)} onFocus={()=>setFocused([note.pageId])}>
          <button type="button" className="source-reading-note-open" onClick={()=>{setOpen(null);onOpen(note.pageId);}}>{note.title}</button>
          <button type="button" className="source-reading-remove-action" aria-label={`Move ${note.title} to Trash`} title="Move reading note to Trash" onClick={()=>{close();onRemove(note);}}><Icon name="trash"/></button>
        </div>)}
      </div>}
    </div>;
  })}</div>;
}
