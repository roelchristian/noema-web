import {useLayoutEffect,useState,type RefObject} from 'react';
import type {ReadingNoteAnchor} from '../../shared/source-reading';
import {Icon} from '../components/Icon';

interface Marker {top:number;left:number;notes:ReadingNoteAnchor[]}
/** Mark the rendered line containing the saved source offset, including after reflow. */
export function SourceReadingNoteMarkers({article,notes,onOpen}:{article:RefObject<HTMLElement|null>;notes:ReadingNoteAnchor[];onOpen:(pageId:string)=>void}) {
  const [markers,setMarkers]=useState<Marker[]>([]),[open,setOpen]=useState<string|null>(null);
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
        const block=leaf.closest('p,li,blockquote,td,h2,h3,h4,pre')??leaf.closest('.source-reader-passage')??leaf;
        const top=Math.round(rect.top-bounds.top),left=Math.round(block.getBoundingClientRect().left-bounds.left-24);
        const sameLine=next.find(marker=>Math.abs(marker.top-top)<4&&Math.abs(marker.left-left)<4);
        if(sameLine)sameLine.notes.push(note);else next.push({top,left,notes:[note]});
      }
      setMarkers(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
    measure();const resize=new ResizeObserver(schedule);resize.observe(root);
    const mutation=new MutationObserver(schedule);mutation.observe(root,{childList:true,subtree:true});
    void document.fonts.ready.then(()=>{if(active)schedule();});
    window.addEventListener('resize',schedule);
    return()=>{active=false;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();window.removeEventListener('resize',schedule);};
  },[article,notes]);
  return <div className="source-reading-note-markers">{markers.map(marker=>{
    const id=marker.notes[0]!.pageId,label=marker.notes.length===1?'Open reading note':`Open ${marker.notes.length} reading notes`;
    return <div key={id} className="source-reading-note-marker" style={{top:marker.top,left:marker.left}}>
      <button type="button" aria-label={label} title={label} aria-expanded={marker.notes.length>1?open===id:undefined} onClick={()=>{if(marker.notes.length===1)onOpen(id);else setOpen(current=>current===id?null:id);}}><Icon name="quote"/>{marker.notes.length>1&&<small>{marker.notes.length}</small>}</button>
      {open===id&&<div className="source-reading-note-marker-list" role="dialog" aria-label="Reading notes on this line" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(null);}}}><header><strong>Reading notes</strong><button type="button" aria-label="Close reading notes" onClick={()=>setOpen(null)}><Icon name="close"/></button></header>{marker.notes.map(note=><button type="button" key={note.pageId} onClick={()=>onOpen(note.pageId)}>{note.title}</button>)}</div>}
    </div>;
  })}</div>;
}
